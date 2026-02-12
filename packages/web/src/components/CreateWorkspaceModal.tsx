import { useState } from 'react';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

export function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (ws: any) => void }) {
  const { user } = useApp();
  const userDomain = user?.email?.split('@')[1] || '';

  const [name, setName] = useState('');
  const [domains, setDomains] = useState(userDomain);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const allowedDomains = domains
        .split(',')
        .map((d) => d.trim().toLowerCase())
        .filter(Boolean);
      const ws = await api.createWorkspace({ name, slug, allowedDomains });
      onCreated(ws);
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Create Workspace" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ width: 70, textAlign: 'right', fontSize: 12 }}>Name:</label>
          <input
            className="mac-input"
            style={{ flex: 1 }}
            placeholder="My Company"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        <div style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ width: 70, textAlign: 'right', fontSize: 12 }}>Domains:</label>
          <input
            className="mac-input"
            style={{ flex: 1 }}
            placeholder="acme.com, other.org"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
          />
        </div>
        <div style={{ marginLeft: 78, fontSize: 10, color: '#888', marginBottom: 8 }}>
          Anyone with a matching email can join automatically
        </div>
        {error && (
          <div style={{ marginBottom: 8, fontSize: 12, fontWeight: 'bold', color: '#CC0000' }}>⚠ {error}</div>
        )}
        <hr className="mac-separator" style={{ margin: '12px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} className="mac-btn">Cancel</button>
          <button type="submit" disabled={loading} className="mac-btn-primary">
            {loading ? '⏳...' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
