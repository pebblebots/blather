import { useState, useEffect, useCallback } from 'react';
import { taskApi } from '../lib/api';
import { Modal } from './Modal';

const PRIORITY_ICONS: Record<string, string> = {
  urgent: '🔴',
  normal: '🔵',
  low: '⚪',
};

const STATUS_LABELS: Record<string, string> = {
  queued: '📋 Queued',
  in_progress: '⚙️ In Progress',
  done: '✅ Done',
};

interface TaskPanelProps {
  workspaceId: string;
  members: { id: string; displayName: string; isAgent: boolean }[];
}

export function TaskPanel({ workspaceId, members }: TaskPanelProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    const filters = filter === 'all' ? undefined : { status: filter };
    return taskApi.list(workspaceId, filters).then((t) => { setTasks(t); setLoading(false); }).catch(() => setLoading(false));
  }, [workspaceId, filter]);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    const filters = filter === 'all' ? undefined : { status: filter };
    taskApi.list(workspaceId, filters).then((t) => {
      if (!stale) { setTasks(t); setLoading(false); }
    }).catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [workspaceId, filter]);

  const updateStatus = async (id: string, status: string) => {
    await taskApi.update(id, { status });
    load();
  };

  const updateAssignee = async (id: string, assigneeId: string | null) => {
    await taskApi.update(id, { assigneeId });
    load();
  };

  const deleteTask = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    await taskApi.delete(id);
    load();
  };

  const getMemberName = (id: string | null) => {
    if (!id) return '—';
    const m = members.find((u) => u.id === id);
    return m ? m.displayName : id.slice(0, 8);
  };

  const grouped = {
    queued: tasks.filter((t) => t.status === 'queued'),
    in_progress: tasks.filter((t) => t.status === 'in_progress'),
    done: tasks.filter((t) => t.status === 'done'),
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#FFFFFF' }}>
      <div className="mac-titlebar" style={{ fontSize: 11 }}>
        <div className="mac-close-box" style={{ width: 10, height: 10 }} />
        <div style={{ flex: 1, textAlign: 'center' }}>📋 Tasks</div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderBottom: '1px solid #CCCCCC', background: '#EEEEEE', fontSize: 11 }}>
        <button className="mac-btn" style={{ fontSize: 10, padding: '1px 8px' }} onClick={() => setShowCreate(true)}>+ New Task</button>
        <div style={{ flex: 1 }} />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ fontSize: 10, fontFamily: 'Geneva, monospace', border: '1px solid #999', background: '#FFF', padding: '1px 4px' }}
        >
          <option value="all">All Active</option>
          <option value="queued">Queued</option>
          <option value="in_progress">In Progress</option>
          <option value="done">Done</option>
        </select>
      </div>

      {/* Task list */}
      <div className="mac-inset" style={{ flex: 1, overflow: 'auto', margin: 4 }}>
        {loading ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: '#999' }}>⏳ Loading tasks...</div>
        ) : tasks.length === 0 ? (
          <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: '#999' }}>No tasks yet. Create one!</div>
        ) : (
          (['queued', 'in_progress', 'done'] as const).filter((s) => (filter === 'all' ? s !== 'done' : true)).map((status) => {
            const items = grouped[status];
            if (items.length === 0) return null;
            return (
              <div key={status} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 'bold', padding: '4px 8px', background: '#EEEEEE', borderBottom: '1px solid #CCC' }}>
                  {STATUS_LABELS[status]} ({items.length})
                </div>
                {items.map((task: any) => (
                  <div
                    key={task.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px',
                      borderBottom: '1px solid #EEEEEE', fontSize: 11,
                    }}
                  >
                    <span title={task.priority}>{PRIORITY_ICONS[task.priority]}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontWeight: 'bold',
                        textDecoration: task.status === 'done' ? 'line-through' : 'none',
                        color: task.status === 'done' ? '#999' : '#000',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{task.title}</div>
                      {task.description && (
                        <div style={{ fontSize: 10, color: '#666', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {task.description}
                        </div>
                      )}
                      <div style={{ fontSize: 9, color: '#999', marginTop: 1 }}>
                        by {getMemberName(task.creatorId)} · assigned: {getMemberName(task.assigneeId)}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      {task.status === 'queued' && (
                        <button className="mac-btn" style={{ fontSize: 9, padding: '0 4px' }} onClick={() => updateStatus(task.id, 'in_progress')} title="Start">▶</button>
                      )}
                      {task.status === 'in_progress' && (
                        <button className="mac-btn" style={{ fontSize: 9, padding: '0 4px' }} onClick={() => updateStatus(task.id, 'done')} title="Done">✓</button>
                      )}
                      {task.status === 'done' && (
                        <button className="mac-btn" style={{ fontSize: 9, padding: '0 4px' }} onClick={() => updateStatus(task.id, 'queued')} title="Reopen">↺</button>
                      )}
                      <select
                        value={task.assigneeId || ''}
                        onChange={(e) => updateAssignee(task.id, e.target.value || null)}
                        style={{ fontSize: 9, fontFamily: 'Geneva, monospace', border: '1px solid #999', background: '#FFF', padding: '0 2px', maxWidth: 80 }}
                        title="Assign"
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>{m.displayName}</option>
                        ))}
                      </select>
                      <button className="mac-btn" style={{ fontSize: 9, padding: '0 4px', color: '#CC3333' }} onClick={() => deleteTask(task.id)} title="Delete">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })
        )}
      </div>

      {showCreate && (
        <CreateTaskModal
          workspaceId={workspaceId}
          members={members}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
    </div>
  );
}

function CreateTaskModal({ workspaceId, members, onClose, onCreated }: {
  workspaceId: string;
  members: { id: string; displayName: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('normal');
  const [assigneeId, setAssigneeId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await taskApi.create({
        workspaceId,
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assigneeId: assigneeId || undefined,
      });
      onCreated();
    } catch (e: any) {
      alert(e.message || 'Failed to create task');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="📋 New Task" onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
        <div>
          <label style={{ fontSize: 11, fontWeight: 'bold' }}>Title *</label>
          <input
            className="mac-input"
            style={{ width: '100%', marginTop: 2 }}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to be done?"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, fontWeight: 'bold' }}>Description</label>
          <textarea
            className="mac-input"
            style={{ width: '100%', marginTop: 2, minHeight: 48, resize: 'vertical', fontFamily: 'Geneva, monospace', fontSize: 11 }}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional details..."
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 'bold' }}>Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              style={{ width: '100%', marginTop: 2, fontSize: 11, fontFamily: 'Geneva, monospace', border: '1px solid #999', background: '#FFF', padding: '2px 4px' }}
            >
              <option value="urgent">🔴 Urgent</option>
              <option value="normal">🔵 Normal</option>
              <option value="low">⚪ Low</option>
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, fontWeight: 'bold' }}>Assign to</label>
            <select
              value={assigneeId}
              onChange={(e) => setAssigneeId(e.target.value)}
              style={{ width: '100%', marginTop: 2, fontSize: 11, fontFamily: 'Geneva, monospace', border: '1px solid #999', background: '#FFF', padding: '2px 4px' }}
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button className="mac-btn" onClick={onClose}>Cancel</button>
          <button className="mac-btn" onClick={submit} disabled={!title.trim() || submitting}>
            {submitting ? '⏳' : 'Create Task'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
