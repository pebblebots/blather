import { useState } from 'react';
import { Modal } from './Modal';
import { api } from '../lib/api';

export function CreateChannelModal({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: (ch: any) => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const ch = await api.createChannel(workspaceId, { name, slug, topic: topic || undefined });
      onCreated(ch);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Create Channel" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ width: 60, textAlign: 'right', fontSize: 12 }}>NAME:</label>
          <input
            className="win-input"
            style={{ flex: 1 }}
            placeholder="channel name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ width: 60, textAlign: 'right', fontSize: 12 }}>TOPIC:</label>
          <input
            className="win-input"
            style={{ flex: 1 }}
            placeholder="optional"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          />
        </div>
        {error && (
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 'bold' }}>⚠ ERR: {error}</div>
        )}
        <hr className="win-separator" style={{ margin: '12px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="win-btn">CANCEL</button>
          <button type="submit" disabled={loading} className="win-btn">
            {loading ? '⏳...' : 'CREATE'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
