import { useState } from 'react';
import { Modal } from './Modal';
import { api } from '../lib/api';

export function CreateWorkspaceModal({ onClose, onCreated }: { onClose: () => void; onCreated: (ws: any) => void }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const ws = await api.createWorkspace({ name, slug });
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
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-secondary mb-1">name:</label>
          <input
            className="w-full px-3 py-2 bg-cream border border-border focus:border-accent focus:outline-none text-sm font-mono"
            placeholder="workspace name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
        </div>
        {error && <p className="text-error text-sm">ERR: {error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-secondary hover:text-ink border border-border">cancel</button>
          <button type="submit" disabled={loading} className="px-4 py-2 bg-accent hover:bg-accent-light text-surface disabled:opacity-50 text-sm font-mono border border-accent">
            {loading ? '...' : '[ CREATE ]'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
