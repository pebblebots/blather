import { useState } from 'react';

interface ChannelContextMenuProps {
  x: number;
  y: number;
  channel: any;
  onClose: () => void;
  onArchive: (channelId: string) => void;
  onDelete: (channelId: string) => void;
  onInvite: (channelId: string) => void;
}

export function ChannelContextMenu({ x, y, channel, onClose, onArchive, onDelete, onInvite }: ChannelContextMenuProps) {
  const isPrivate = channel.channelType === 'private';
  const isDefault = channel.isDefault;

  const menuStyle: React.CSSProperties = {
    position: 'fixed',
    left: x,
    top: y,
    zIndex: 9999,
    background: '#FFFFFF',
    border: '2px solid #000000',
    borderRight: '2px solid #000000',
    borderBottom: '2px solid #000000',
    boxShadow: '2px 2px 0px rgba(0,0,0,0.3)',
    padding: '2px 0',
    minWidth: 160,
    fontSize: 12,
    fontFamily: 'Chicago, Geneva, "Helvetica Neue", Helvetica, sans-serif',
  };

  const itemStyle: React.CSSProperties = {
    padding: '4px 16px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };

  const disabledStyle: React.CSSProperties = {
    ...itemStyle,
    color: '#999999',
    cursor: 'default',
  };

  return (
    <>
      {/* Backdrop to close menu */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
        onClick={onClose}
        onContextMenu={(e) => { e.preventDefault(); onClose(); }}
      />
      <div style={menuStyle}>
        {!isDefault && (
          <div
            style={itemStyle}
            onClick={() => { onArchive(channel.id); onClose(); }}
            onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3366CC'; (e.target as HTMLElement).style.color = '#FFFFFF'; }}
            onMouseLeave={(e) => { (e.target as HTMLElement).style.background = ''; (e.target as HTMLElement).style.color = ''; }}
          >
            📦 Archive Channel
          </div>
        )}
        {isDefault && (
          <div style={disabledStyle}>
            📦 Archive Channel
          </div>
        )}
        <div
          style={itemStyle}
          onClick={() => { onDelete(channel.id); onClose(); }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3366CC'; (e.target as HTMLElement).style.color = '#FFFFFF'; }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.background = ''; (e.target as HTMLElement).style.color = ''; }}
        >
          🗑️ Delete Channel
        </div>
        {isPrivate && (
          <>
            <hr style={{ margin: '2px 0', border: 'none', borderTop: '1px solid #CCCCCC' }} />
            <div
              style={itemStyle}
              onClick={() => { onInvite(channel.id); onClose(); }}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.background = '#3366CC'; (e.target as HTMLElement).style.color = '#FFFFFF'; }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.background = ''; (e.target as HTMLElement).style.color = ''; }}
            >
              👥 Invite Members
            </div>
          </>
        )}
      </div>
    </>
  );
}
