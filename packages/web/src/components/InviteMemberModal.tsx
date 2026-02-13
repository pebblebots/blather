import { useState } from 'react';
import { api } from '../lib/api';

interface InviteMemberModalProps {
  channelId: string;
  workspaceMembers: any[];
  onClose: () => void;
}

export function InviteMemberModal({ channelId, workspaceMembers, onClose }: InviteMemberModalProps) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleInvite = async () => {
    if (!selectedUserId) return;
    setLoading(true);
    setError('');
    try {
      await api.inviteMember(channelId, selectedUserId);
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to invite');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000, background: 'rgba(0,0,0,0.3)' }}>
      <div className="mac-window" style={{ width: 300 }}>
        <div className="mac-titlebar">
          <div className="mac-close-box" onClick={onClose} />
          <div style={{ flex: 1, textAlign: 'center' }}>Invite Member</div>
        </div>
        <div style={{ padding: 12 }}>
          <div style={{ marginBottom: 8, fontSize: 12 }}>Select a user to invite:</div>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            style={{ width: '100%', fontSize: 12, padding: 4, marginBottom: 8, fontFamily: 'inherit' }}
          >
            <option value="">— Choose —</option>
            {workspaceMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.displayName}</option>
            ))}
          </select>
          {error && <div style={{ color: '#CC3333', fontSize: 11, marginBottom: 4 }}>{error}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="mac-btn" onClick={onClose}>Cancel</button>
            <button className="mac-btn" onClick={handleInvite} disabled={!selectedUserId || loading}>
              {loading ? 'Inviting…' : 'Invite'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
