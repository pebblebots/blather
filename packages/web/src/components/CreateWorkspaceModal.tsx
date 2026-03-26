import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Workspace } from '@blather/types';
import { Modal } from './Modal';
import { api } from '../lib/api';
import { useApp } from '../lib/store';

interface CreateWorkspaceModalProps {
  onClose: () => void;
  onCreated: (workspace: Workspace) => void;
}

function buildWorkspaceSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function parseAllowedDomains(domains: string): string[] {
  return Array.from(
    new Set(
      domains
        .split(',')
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to create workspace';
}

export function CreateWorkspaceModal({ onClose, onCreated }: CreateWorkspaceModalProps) {
  const { user } = useApp();
  const initialDomain = user?.email?.split('@')[1] ?? '';

  const [name, setName] = useState('');
  const [domains, setDomains] = useState(initialDomain);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Workspace name is required');
      return;
    }

    setLoading(true);

    try {
      const workspace = await api.createWorkspace({
        name: trimmedName,
        slug: buildWorkspaceSlug(trimmedName),
        allowedDomains: parseAllowedDomains(domains),
      });
      onCreated(workspace);
      onClose();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
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
            onChange={(event) => setName(event.target.value)}
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
            onChange={(event) => setDomains(event.target.value)}
          />
        </div>
        <div style={{ marginLeft: 78, fontSize: 10, color: '#888', marginBottom: 8 }}>
          Anyone with a matching email can join automatically
        </div>
        {error && (
          <div role="alert" style={{ marginBottom: 8, fontSize: 12, fontWeight: 'bold', color: '#CC0000' }}>
            ⚠ {error}
          </div>
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
