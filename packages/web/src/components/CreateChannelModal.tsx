import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Channel, CreateChannelRequest } from '@blather/types';
import { Modal } from './Modal';
import { api } from '../lib/api';

interface CreateChannelModalProps {
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}

function buildChannelSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to create channel';
}

export function CreateChannelModal({ onClose, onCreated }: CreateChannelModalProps) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const trimmedName = name.trim();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');

    if (!trimmedName) {
      setError('Channel name is required');
      return;
    }

    const slug = buildChannelSlug(trimmedName);

    if (!slug) {
      setError('Channel name must include letters or numbers');
      return;
    }

    const payload: CreateChannelRequest = {
      name: trimmedName,
      slug,
      topic: topic.trim() || undefined,
      channelType: isPrivate ? 'private' : 'public',
    };

    setLoading(true);

    try {
      const channel = await api.createChannel(payload);
      onCreated(channel);
      onClose();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal title="Create Channel" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="channel-name" style={{ width: 60, textAlign: 'right', fontSize: 12 }}>Name:</label>
          <input
            id="channel-name"
            className="mac-input"
            style={{ flex: 1 }}
            placeholder="channel name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            autoFocus
          />
        </div>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="channel-private" style={{ width: 60, textAlign: 'right', fontSize: 12 }}>Private:</label>
          <input
            id="channel-private"
            type="checkbox"
            checked={isPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          <span style={{ fontSize: 11, color: '#666' }}>🔒 Only invited members can see this channel</span>
        </div>
        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label htmlFor="channel-topic" style={{ width: 60, textAlign: 'right', fontSize: 12 }}>Topic:</label>
          <input
            id="channel-topic"
            className="mac-input"
            style={{ flex: 1 }}
            placeholder="optional"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
          />
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
