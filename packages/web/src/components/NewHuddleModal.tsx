import { useState } from 'react';
import { Modal } from './Modal';
import { apiUrl } from '../lib/urls';

interface NewHuddleModalProps {
  workspaceId: string;
  workspaceMembers: any[];
  onClose: () => void;
  onCreated: (huddle: any) => void;
}

export function NewHuddleModal({ workspaceId, workspaceMembers, onClose, onCreated }: NewHuddleModalProps) {
  const token = localStorage.getItem('blather_token') || '';
  const [topic, setTopic] = useState('');
  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const agents = workspaceMembers.filter(m => m.isAgent);

  const toggleAgent = (agentId: string) => {
    setSelectedAgents(prev => {
      if (prev.includes(agentId)) return prev.filter(id => id !== agentId);
      if (prev.length >= 3) return prev;
      return [...prev, agentId];
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || selectedAgents.length === 0) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(apiUrl('/huddles'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, topic: topic.trim(), agentIds: selectedAgents }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as any).error || `HTTP ${res.status}`);
      }
      const huddle = await res.json();
      onCreated(huddle);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="🎙️ Start a Huddle" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ width: 60, textAlign: 'right', fontSize: 12 }}>Prompt:</label>
          <input
            className="mac-input"
            style={{ flex: 1 }}
            placeholder="What should they talk about?"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 12, fontWeight: 'bold', display: 'block', marginBottom: 4 }}>Agents (max 3):</label>
          <div className="mac-inset" style={{ padding: 8, maxHeight: 150, overflow: 'auto' }}>
            {agents.length === 0 && (
              <div style={{ fontSize: 11, color: '#999999' }}>No agents in this workspace</div>
            )}
            {agents.map(agent => {
              const checked = selectedAgents.includes(agent.id);
              const disabled = !checked && selectedAgents.length >= 3;
              return (
                <label key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0', fontSize: 12, opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                  <input type="checkbox" checked={checked} onChange={() => toggleAgent(agent.id)} disabled={disabled} />
                  <span>{agent.displayName}</span>
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 'bold', color: '#CC0000' }}>⚠ {error}</div>
        )}
        <hr className="mac-separator" style={{ margin: '12px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="mac-btn">Cancel</button>
          <button type="submit" disabled={loading || !topic.trim() || selectedAgents.length === 0} className="mac-btn-primary">
            {loading ? '⏳...' : 'Start Huddle'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
