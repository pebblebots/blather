import { useState, useEffect, useCallback, useRef } from 'react';
import { taskApi } from '../lib/api';
import { Modal } from './Modal';
import { useToast } from './Toast';

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
  members: { id: string; displayName: string; isAgent: boolean; email?: string }[];
  /** Pre-computed disambiguated display names (e.g. from getDisambiguatedNames). When
   *  provided, these are used instead of raw displayName for assignee/creator labels. */
  disambiguatedNames?: Map<string, string>;
}

export function TaskPanel({ members, disambiguatedNames }: TaskPanelProps) {
  const [tasks, setTasks] = useState<any[]>([]);
  const [filter, setFilter] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  // Refresh tasks without loading spinner — used by action handlers after mutations.
  const refresh = useCallback(() => {
    const filters = filter === 'all' ? undefined : { status: filter };
    taskApi.list(filters).then(setTasks).catch((err) => {
      console.error('Failed to refresh tasks:', err);
    });
  }, [filter]);

  // Fetch with loading state on mount and filter changes. The cleanup flag discards
  // stale responses, fixing the race condition where React 18 strict mode double-fires
  // the effect or rapid filter changes cause setLoading(true) to overwrite a completed
  // fetch's setLoading(false). (T#99, T#102, T#115)
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const filters = filter === 'all' ? undefined : { status: filter };
    taskApi.list(filters).then((t) => {
      if (!cancelled) {
        setTasks(t);
        setLoading(false);
      }
    }).catch((err) => {
      console.error('Failed to load tasks:', err);
      if (!cancelled) {
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [filter]);

  const updateStatus = async (id: string, status: string) => {
    await taskApi.update(id, { status });
    refresh();
  };

  const updateAssignee = async (id: string, assigneeId: string | null) => {
    await taskApi.update(id, { assigneeId });
    refresh();
  };

  const deleteTask = async (id: string) => {
    if (!confirm('Delete this task?')) return;
    await taskApi.delete(id);
    refresh();
  };

  /** Returns { label, title } for a member ID.
   *  label: disambiguated display name (or raw displayName as fallback)
   *  title: full email for tooltip, or undefined if unavailable
   */
  const getMemberInfo = (id: string | null): { label: string; title?: string } => {
    if (!id) return { label: '—' };
    const m = members.find((u) => u.id === id);
    if (!m) return { label: id.slice(0, 8) };
    const label = disambiguatedNames?.get(id) ?? m.displayName;
    return { label, title: m.email ?? undefined };
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
        ) : (() => {
          // Determine which status groups to show based on the active filter.
          // "All Active" hides done tasks; specific filters show only that status.
          const visibleStatuses = (['queued', 'in_progress', 'done'] as const).filter((s) => (filter === 'all' ? s !== 'done' : true));
          const hasVisibleTasks = visibleStatuses.some((s) => grouped[s].length > 0);
          if (!hasVisibleTasks) {
            return (
              <div style={{ padding: 16, textAlign: 'center', fontSize: 11, color: '#999' }}>
                {filter === 'all' ? '✅ All tasks done! Queue is empty.' : `No ${filter.replace('_', ' ')} tasks.`}
              </div>
            );
          }
          return visibleStatuses.map((status) => {
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
                        {(() => {
                          const creator = getMemberInfo(task.creatorId);
                          const assignee = getMemberInfo(task.assigneeId);
                          const claimed = task.claimedById ? getMemberInfo(task.claimedById) : null;
                          return (
                            <>
                              by <span title={creator.title}>{creator.label}</span>
                              {' · '}assigned: <span title={assignee.title}>{assignee.label}</span>
                              {claimed && <> · claimed by: <span title={claimed.title}>{claimed.label}</span></>}
                            </>
                          );
                        })()}
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
                      <AssigneeDropdown
                        taskId={task.id}
                        currentAssigneeId={task.assigneeId}
                        members={members}
                        onAssign={updateAssignee}
                      />
                      <button className="mac-btn" style={{ fontSize: 9, padding: '0 4px', color: '#CC3333' }} onClick={() => deleteTask(task.id)} title="Delete">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            );
          });
        })()}
      </div>

      {showCreate && (
        <CreateTaskModal
          members={members}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); refresh(); }}
        />
      )}
    </div>
  );
}

function CreateTaskModal({ members, onClose, onCreated }: {
  members: { id: string; displayName: string }[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const { showToast } = useToast();
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
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        assigneeId: assigneeId || undefined,
      });
      onCreated();
    } catch (e: any) {
      showToast(e.message || 'Failed to create task', 'error');
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

function AssigneeDropdown({ taskId, currentAssigneeId, members, onAssign }: {
  taskId: string;
  currentAssigneeId: string | null;
  members: { id: string; displayName: string }[];
  onAssign: (taskId: string, assigneeId: string | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  
  const currentMember = currentAssigneeId ? members.find(m => m.id === currentAssigneeId) : null;
  const displayName = currentMember ? currentMember.displayName : 'Unassigned';
  
  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);
  
  const handleSelect = (assigneeId: string | null) => {
    onAssign(taskId, assigneeId);
    setIsOpen(false);
  };
  
  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        className="mac-btn"
        style={{ 
          fontSize: 9, 
          padding: '1px 4px', 
          maxWidth: 120, 
          minWidth: 60,
          textAlign: 'left',
          background: isHovered ? '#E6E6E6' : '#FFF',
          border: '1px solid #999',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title="Click to assign"
      >
        {displayName}
      </button>
      
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 1000,
            background: '#FFF',
            border: '1px solid #999',
            boxShadow: '2px 2px 4px rgba(0,0,0,0.2)',
            minWidth: 100,
            maxHeight: 200,
            overflowY: 'auto'
          }}
        >
          <button
            key="unassigned"
            style={{
              display: 'block',
              width: '100%',
              padding: '2px 6px',
              fontSize: 9,
              textAlign: 'left',
              border: 'none',
              background: !currentAssigneeId ? '#E6E6E6' : '#FFF',
              cursor: 'pointer'
            }}
            onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = '#CCCCFF'}
            onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = !currentAssigneeId ? '#E6E6E6' : '#FFF'}
            onClick={() => handleSelect(null)}
          >
            Unassigned
          </button>
          {members.map((member) => (
            <button
              key={member.id}
              style={{
                display: 'block',
                width: '100%',
                padding: '2px 6px',
                fontSize: 9,
                textAlign: 'left',
                border: 'none',
                background: currentAssigneeId === member.id ? '#E6E6E6' : '#FFF',
                cursor: 'pointer'
              }}
              onMouseEnter={(e) => (e.target as HTMLButtonElement).style.background = '#CCCCFF'}
              onMouseLeave={(e) => (e.target as HTMLButtonElement).style.background = currentAssigneeId === member.id ? '#E6E6E6' : '#FFF'}
              onClick={() => handleSelect(member.id)}
            >
              {member.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
