import { useState } from 'react';
import { api } from '../lib/api';
import { Modal } from './Modal';

type MemberOption = {
  id: string;
  displayName: string;
};

type InviteMemberModalProps = {
  channelId: string;
  members: MemberOption[];
  onClose: () => void;
};

export function InviteMemberModal({ channelId, members, onClose }: InviteMemberModalProps) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInvite = async () => {
    if (!selectedUserId) {
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      await api.inviteMember(channelId, selectedUserId);
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to invite';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal title="Invite Member" onClose={onClose}>
      <div style={{ paddingTop: 4 }}>
        <label htmlFor="invite-member-select" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
          Select a user to invite:
        </label>
        <select
          id="invite-member-select"
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
          style={{ width: '100%', fontSize: 12, padding: 4, marginBottom: 8, fontFamily: 'inherit' }}
        >
          <option value="">— Choose —</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.displayName}
            </option>
          ))}
        </select>
        {error && <div role="alert" style={{ color: '#CC3333', fontSize: 11, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="mac-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="mac-btn" onClick={handleInvite} disabled={!selectedUserId || isSubmitting}>
            {isSubmitting ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
