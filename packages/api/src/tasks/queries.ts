import { getTaskDb } from './db.js';

export type TaskPriority = 'urgent' | 'normal' | 'low';
export type TaskStatus = 'queued' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeId: string | null;
  creatorId: string | null;
  shortId: number | null;
  sourceChannelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  content: string;
  createdAt: string;
}

export interface TaskWithCommentCount extends Task {
  commentsCount: number;
}

export function listTasks(filters?: {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
}): Task[] {
  const db = getTaskDb();
  const conditions: string[] = [];
  const params: Record<string, string> = {};

  if (filters?.status) {
    conditions.push('status = @status');
    params.status = filters.status;
  }
  if (filters?.priority) {
    conditions.push('priority = @priority');
    params.priority = filters.priority;
  }
  if (filters?.assigneeId) {
    conditions.push('assigneeId = @assigneeId');
    params.assigneeId = filters.assigneeId;
  }

  if (conditions.length === 0) {
    return db.prepare('SELECT * FROM tasks ORDER BY createdAt DESC').all() as Task[];
  }

  return db
    .prepare(`SELECT * FROM tasks WHERE ${conditions.join(' AND ')} ORDER BY createdAt DESC`)
    .all(params) as Task[];
}

export function listOpenTasksWithCommentCount(): TaskWithCommentCount[] {
  const db = getTaskDb();
  return db
    .prepare(`
      SELECT t.*,
        COALESCE(c.cnt, 0) AS commentsCount
      FROM tasks t
      LEFT JOIN (SELECT taskId, count(*) AS cnt FROM task_comments GROUP BY taskId) c ON c.taskId = t.id
      WHERE t.status != 'done'
      ORDER BY
        CASE WHEN t.priority = 'urgent' THEN 0 WHEN t.priority = 'normal' THEN 1 ELSE 2 END,
        t.createdAt DESC
    `)
    .all() as TaskWithCommentCount[];
}

export function getTask(id: string): Task | null {
  return getTaskDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | null;
}

export function createTask(data: {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assigneeId?: string | null;
  creatorId?: string | null;
  sourceChannelId?: string | null;
}): Task {
  const db = getTaskDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const seq = db.prepare('INSERT INTO task_short_id_seq DEFAULT VALUES').run();
  const shortId = Number(seq.lastInsertRowid);

  db.prepare(`
    INSERT INTO tasks (id, title, description, priority, status, assigneeId, creatorId, shortId, sourceChannelId, createdAt, updatedAt)
    VALUES (@id, @title, @description, @priority, 'queued', @assigneeId, @creatorId, @shortId, @sourceChannelId, @createdAt, @updatedAt)
  `).run({
    id,
    title: data.title,
    description: data.description ?? null,
    priority: data.priority ?? 'normal',
    assigneeId: data.assigneeId ?? null,
    creatorId: data.creatorId ?? null,
    shortId,
    sourceChannelId: data.sourceChannelId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task;
}

export function updateTask(
  id: string,
  data: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    assigneeId?: string | null;
  },
): Task | null {
  const db = getTaskDb();
  const now = new Date().toISOString();

  const setClauses: string[] = ['updatedAt = @updatedAt'];
  const params: Record<string, unknown> = { id, updatedAt: now };

  if (data.title !== undefined) { setClauses.push('title = @title'); params.title = data.title; }
  if (data.description !== undefined) { setClauses.push('description = @description'); params.description = data.description; }
  if (data.priority !== undefined) { setClauses.push('priority = @priority'); params.priority = data.priority; }
  if (data.status !== undefined) { setClauses.push('status = @status'); params.status = data.status; }
  if (data.assigneeId !== undefined) { setClauses.push('assigneeId = @assigneeId'); params.assigneeId = data.assigneeId; }

  db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = @id`).run(params);
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | null;
}

export function deleteTask(id: string): boolean {
  const result = getTaskDb().prepare('DELETE FROM tasks WHERE id = ?').run(id);
  return result.changes > 0;
}

export function resolveTask(token: string): Task | null {
  const db = getTaskDb();
  const shortMatch = token.match(/^T#?(\d+)$/i) ?? token.match(/^(\d+)$/);
  if (shortMatch) {
    const n = parseInt(shortMatch[1], 10);
    return db.prepare('SELECT * FROM tasks WHERE shortId = ?').get(n) as Task | null;
  }
  return db.prepare('SELECT * FROM tasks WHERE id LIKE ?').get(token + '%') as Task | null;
}

export function findTaskByTitle(
  query: string,
  opts?: { excludeStatus?: TaskStatus; requiredStatus?: TaskStatus },
): Task | null {
  const db = getTaskDb();
  const like = `%${query.toLowerCase()}%`;

  if (opts?.requiredStatus) {
    return db
      .prepare('SELECT * FROM tasks WHERE status = ? AND lower(title) LIKE ? LIMIT 1')
      .get(opts.requiredStatus, like) as Task | null;
  }
  if (opts?.excludeStatus) {
    return db
      .prepare('SELECT * FROM tasks WHERE status != ? AND lower(title) LIKE ? LIMIT 1')
      .get(opts.excludeStatus, like) as Task | null;
  }
  return db.prepare('SELECT * FROM tasks WHERE lower(title) LIKE ? LIMIT 1').get(like) as Task | null;
}

export function listComments(taskId: string): TaskComment[] {
  return getTaskDb()
    .prepare('SELECT * FROM task_comments WHERE taskId = ? ORDER BY createdAt ASC')
    .all(taskId) as TaskComment[];
}

export function addComment(taskId: string, userId: string, content: string): TaskComment {
  const db = getTaskDb();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO task_comments (id, taskId, userId, content, createdAt) VALUES (?, ?, ?, ?, ?)',
  ).run(id, taskId, userId, content, now);
  return db.prepare('SELECT * FROM task_comments WHERE id = ?').get(id) as TaskComment;
}

export function getComment(commentId: string): TaskComment | null {
  return getTaskDb()
    .prepare('SELECT * FROM task_comments WHERE id = ?')
    .get(commentId) as TaskComment | null;
}

export function deleteComment(commentId: string): void {
  getTaskDb().prepare('DELETE FROM task_comments WHERE id = ?').run(commentId);
}
