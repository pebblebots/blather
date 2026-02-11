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
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-indigo-500 focus:outline-none text-sm"
          placeholder="Channel name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <input
          className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-indigo-500 focus:outline-none text-sm"
          placeholder="Topic (optional)"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200">Cancel</button>
          <button type="submit" disabled={loading} className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg text-sm font-medium">
            {loading ? '...' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
