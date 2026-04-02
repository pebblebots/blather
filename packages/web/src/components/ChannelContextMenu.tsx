interface Channel {
  id: string;
  channelType: string;
  isDefault?: boolean;
  muted?: boolean;
}

interface ChannelContextMenuProps {
  x: number;
  y: number;
  channel: Channel;
  onClose: () => void;
  onArchive: (channelId: string) => void;
  onDelete: (channelId: string) => void;
  onInvite: (channelId: string) => void;
  onToggleMute: (channelId: string, muted: boolean) => void;
}

const menuStyle: React.CSSProperties = {
  position: 'fixed',
  zIndex: 9999,
  background: '#FFFFFF',
  border: '2px solid #000000',
  boxShadow: '2px 2px 0px rgba(0,0,0,0.3)',
  padding: '2px 0',
  minWidth: 160,
  fontSize: 12,
  fontFamily: 'Chicago, Geneva, "Helvetica Neue", Helvetica, sans-serif',
};

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  border: 0,
  padding: '4px 16px',
  background: 'transparent',
  color: 'inherit',
  cursor: 'pointer',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  font: 'inherit',
};

const disabledMenuItemStyle: React.CSSProperties = {
  ...menuItemStyle,
  color: '#999999',
  cursor: 'default',
};

function ChannelMenuItem({
  label,
  disabled = false,
  onSelect,
}: {
  label: string;
  disabled?: boolean;
  onSelect?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      style={disabled ? disabledMenuItemStyle : menuItemStyle}
      onClick={onSelect}
    >
      {label}
    </button>
  );
}

export function ChannelContextMenu({ x, y, channel, onClose, onArchive, onDelete, onInvite, onToggleMute }: ChannelContextMenuProps) {
  const isPrivateChannel = channel.channelType === 'private';

  return (
    <>
      <div
        data-testid="context-menu-backdrop"
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onClick={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <div role="menu" aria-label={`Actions for channel ${channel.id}`} style={{ ...menuStyle, left: x, top: y }}>
        <ChannelMenuItem
          label={channel.muted ? '🔔 Unmute Channel' : '🔇 Mute Channel'}
          onSelect={() => {
            onToggleMute(channel.id, !channel.muted);
            onClose();
          }}
        />
        <hr style={{ margin: '2px 0', border: 'none', borderTop: '1px solid #CCCCCC' }} />
        <ChannelMenuItem
          label="📦 Archive Channel"
          disabled={Boolean(channel.isDefault)}
          onSelect={() => {
            onArchive(channel.id);
            onClose();
          }}
        />
        <ChannelMenuItem
          label="🗑️ Delete Channel"
          onSelect={() => {
            onDelete(channel.id);
            onClose();
          }}
        />
        {isPrivateChannel && (
          <>
            <hr style={{ margin: '2px 0', border: 'none', borderTop: '1px solid #CCCCCC' }} />
            <ChannelMenuItem
              label="👥 Invite Members"
              onSelect={() => {
                onInvite(channel.id);
                onClose();
              }}
            />
          </>
        )}
      </div>
    </>
  );
}
