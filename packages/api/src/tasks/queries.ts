import { and, asc, desc, eq, getTableColumns, ilike, isNull, ne, or, sql } from 'drizzle-orm';
import { channelMembers, taskComments, tasks, users, type Db } from '@blather/db';

export type TaskPriority = 'urgent' | 'normal' | 'low';
export type TaskStatus = 'queued' | 'in_progress' | 'done';

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  assigneeId: string | null;
  claimedById: string | null;
  creatorId: string | null;
  shortId: number;
  sourceChannelId: string | null;
  createdAt: string;
  updatedAt: string;
  completionArtifact: string | null;
}

export class TaskClaimConflictError extends Error {
  constructor(readonly claimedById: string) {
    super(`Task already claimed by ${claimedById}`);
    this.name = 'TaskClaimConflictError';
  }
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

/**
 * The API connects as the database owner, so Postgres RLS is not the
 * authorization boundary for API-key/JWT requests. Keep the same boundary in
 * the API query layer: task actors can see their tasks, channel members can
 * see channel tasks. Mutation and claim operations remain actor-scoped.
 */
function taskActorCondition(userId: string) {
  return or(
    eq(tasks.creatorId, userId),
    eq(tasks.assigneeId, userId),
    eq(tasks.claimedById, userId),
  );
}

function taskChannelMemberCondition(userId: string) {
  return sql`EXISTS (SELECT 1 FROM ${channelMembers}
    WHERE ${channelMembers.channelId} = ${tasks.sourceChannelId}
      AND ${channelMembers.userId} = ${userId})`;
}

function taskVisibilityCondition(userId: string) {
  return or(
    taskActorCondition(userId),
    taskChannelMemberCondition(userId),
    // Unchannelled active tasks are the shared task-board queue. They are
    // readable so users can discover work; mutation remains actor-scoped.
    and(
      isNull(tasks.sourceChannelId),
      ne(tasks.status, 'done'),
    ),
  );
}

/** A task actor may mutate or claim a task. */
export async function canMutateTask(
  db: Db,
  id: string,
  userId: string,
  operation: 'update' | 'claim' | 'delete' = 'update',
): Promise<boolean> {
  // Claiming is a distinct queue capability: a user may claim visible queued
  // work that is not already assigned/claimed. All other edits and deletes
  // require task-actor authority. The atomic update below preserves the
  // existing one-claimant race protection.
  const condition = operation === 'claim'
    ? or(
      taskActorCondition(userId),
      and(
        eq(tasks.status, 'queued'),
        isNull(tasks.assigneeId),
        isNull(tasks.claimedById),
        or(
          isNull(tasks.sourceChannelId),
          taskChannelMemberCondition(userId),
        ),
      ),
    )
    : taskActorCondition(userId);
  const [row] = await db.select({ id: tasks.id }).from(tasks).where(and(
    eq(tasks.id, id),
    condition,
  )).limit(1);
  return Boolean(row);
}

/** Assignment targets must be active users and, for channel tasks, members. */
export async function canUseTaskChannel(db: Db, channelId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ userId: channelMembers.userId })
    .from(channelMembers)
    .where(and(
      eq(channelMembers.channelId, channelId),
      eq(channelMembers.userId, userId),
    ))
    .limit(1);
  return Boolean(row);
}

export async function canAssignTask(
  db: Db,
  sourceChannelId: string | null,
  assigneeId: string | null,
): Promise<boolean> {
  if (!assigneeId) return true;
  if (sourceChannelId) {
    const [row] = await db.select({ id: users.id })
      .from(users)
      .innerJoin(channelMembers, eq(channelMembers.userId, users.id))
      .where(and(
        eq(users.id, assigneeId),
        isNull(users.deactivatedAt),
        eq(channelMembers.channelId, sourceChannelId),
      ))
      .limit(1);
    return Boolean(row);
  }
  const [row] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.id, assigneeId),
    isNull(users.deactivatedAt),
  )).limit(1);
  return Boolean(row);
}

export async function canViewTask(db: Db, id: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: tasks.id }).from(tasks).where(and(
    eq(tasks.id, id),
    taskVisibilityCondition(userId),
  )).limit(1);
  return Boolean(row);
}

function mapTask(row: typeof tasks.$inferSelect): Task {
  return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

function mapComment(row: typeof taskComments.$inferSelect): TaskComment {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export async function listTasks(db: Db, filters?: {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string;
  viewerId?: string;
}): Promise<Task[]> {
  const conditions = [];
  if (filters?.status) conditions.push(eq(tasks.status, filters.status));
  if (filters?.priority) conditions.push(eq(tasks.priority, filters.priority));
  if (filters?.assigneeId) conditions.push(eq(tasks.assigneeId, filters.assigneeId));
  if (filters?.viewerId) conditions.push(taskVisibilityCondition(filters.viewerId));
  const rows = await db.select().from(tasks).where(and(...conditions)).orderBy(desc(tasks.createdAt));
  return rows.map(mapTask);
}

export async function listOpenTasksWithCommentCount(db: Db): Promise<TaskWithCommentCount[]> {
  const rows = await db.select({
    ...getTableColumns(tasks),
    commentsCount: sql<number>`(
      SELECT count(*)::int FROM ${taskComments}
      WHERE ${taskComments.taskId} = ${tasks.id}
    )`.mapWith(Number),
  }).from(tasks).where(ne(tasks.status, 'done')).orderBy(
    sql`CASE ${tasks.priority} WHEN 'urgent' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END`,
    desc(tasks.createdAt),
  );
  return rows.map((row) => ({ ...mapTask(row), commentsCount: row.commentsCount }));
}

export async function getTask(db: Db, id: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row ? mapTask(row) : null;
}

export async function getTaskForViewer(db: Db, id: string, userId: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(and(
    eq(tasks.id, id),
    taskVisibilityCondition(userId),
  )).limit(1);
  return row ? mapTask(row) : null;
}

export async function getTaskByShortId(db: Db, shortId: number): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(eq(tasks.shortId, shortId)).limit(1);
  return row ? mapTask(row) : null;
}

export async function getTaskByShortIdForViewer(db: Db, shortId: number, userId: string): Promise<Task | null> {
  const [row] = await db.select().from(tasks).where(and(
    eq(tasks.shortId, shortId),
    taskVisibilityCondition(userId),
  )).limit(1);
  return row ? mapTask(row) : null;
}

export async function createTask(db: Db, data: {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assigneeId?: string | null;
  creatorId?: string | null;
  sourceChannelId?: string | null;
}): Promise<Task> {
  const [row] = await db.insert(tasks).values({
    title: data.title,
    description: data.description ?? null,
    priority: data.priority ?? 'normal',
    assigneeId: data.assigneeId ?? null,
    creatorId: data.creatorId ?? null,
    sourceChannelId: data.sourceChannelId ?? null,
  }).returning();
  return mapTask(row);
}

export async function updateTask(
  db: Db,
  id: string,
  data: {
    title?: string;
    description?: string | null;
    priority?: TaskPriority;
    status?: TaskStatus;
    assigneeId?: string | null;
    completionArtifact?: string | null;
  },
  userId?: string,
): Promise<Task | null> {
  const values: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  if (data.title !== undefined) values.title = data.title;
  if (data.description !== undefined) values.description = data.description;
  if (data.priority !== undefined) values.priority = data.priority;
  if (data.status !== undefined) values.status = data.status;
  if (data.assigneeId !== undefined) values.assigneeId = data.assigneeId;
  if (data.completionArtifact !== undefined) values.completionArtifact = data.completionArtifact;

  if (data.status === 'in_progress' && userId) {
    values.claimedById = userId;
    const [updated] = await db.update(tasks).set(values).where(and(
      eq(tasks.id, id),
      or(isNull(tasks.claimedById), eq(tasks.claimedById, userId)),
    )).returning();
    if (updated) return mapTask(updated);

    const [existing] = await db.select({ claimedById: tasks.claimedById }).from(tasks).where(eq(tasks.id, id)).limit(1);
    if (existing?.claimedById && existing.claimedById !== userId) throw new TaskClaimConflictError(existing.claimedById);
    return null;
  }

  if (data.status === 'queued' || data.status === 'done') values.claimedById = null;
  const [updated] = await db.update(tasks).set(values).where(eq(tasks.id, id)).returning();
  return updated ? mapTask(updated) : null;
}

export async function getTaskClaimConflict(
  db: Db,
  id: string,
  requestingUserId: string,
): Promise<{ claimedById: string } | null> {
  const [task] = await db.select({ status: tasks.status, claimedById: tasks.claimedById })
    .from(tasks).where(eq(tasks.id, id)).limit(1);
  if (task?.status === 'in_progress' && task.claimedById && task.claimedById !== requestingUserId) {
    return { claimedById: task.claimedById };
  }
  return null;
}

export async function deleteTask(db: Db, id: string): Promise<boolean> {
  const deleted = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
  return deleted.length > 0;
}

export async function resolveTask(db: Db, token: string): Promise<Task | null> {
  const shortMatch = token.match(/^T#?(\d+)$/i) ?? token.match(/^(\d+)$/);
  if (shortMatch) return getTaskByShortId(db, Number.parseInt(shortMatch[1], 10));
  const [row] = await db.select().from(tasks)
    .where(sql`${tasks.id}::text LIKE ${`${token}%`}`)
    .orderBy(asc(tasks.createdAt)).limit(1);
  return row ? mapTask(row) : null;
}

export async function findTaskByTitle(
  db: Db,
  query: string,
  opts?: { excludeStatus?: TaskStatus; requiredStatus?: TaskStatus },
): Promise<Task | null> {
  const conditions = [ilike(tasks.title, `%${query}%`)];
  if (opts?.requiredStatus) conditions.push(eq(tasks.status, opts.requiredStatus));
  if (opts?.excludeStatus) conditions.push(ne(tasks.status, opts.excludeStatus));
  const [row] = await db.select().from(tasks).where(and(...conditions)).orderBy(desc(tasks.createdAt)).limit(1);
  return row ? mapTask(row) : null;
}

export async function listComments(db: Db, taskId: string): Promise<TaskComment[]> {
  const rows = await db.select().from(taskComments).where(eq(taskComments.taskId, taskId)).orderBy(asc(taskComments.createdAt));
  return rows.map(mapComment);
}

export async function addComment(db: Db, taskId: string, userId: string, content: string): Promise<TaskComment> {
  const [row] = await db.insert(taskComments).values({ taskId, userId, content }).returning();
  return mapComment(row);
}

export async function getComment(db: Db, commentId: string): Promise<TaskComment | null> {
  const [row] = await db.select().from(taskComments).where(eq(taskComments.id, commentId)).limit(1);
  return row ? mapComment(row) : null;
}

export async function deleteComment(db: Db, commentId: string): Promise<void> {
  await db.delete(taskComments).where(eq(taskComments.id, commentId));
}
