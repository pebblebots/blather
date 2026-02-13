import { MarkdownText } from './MarkdownText';
import { useEffect, useRef } from 'react';

interface Msg {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  user?: { displayName: string; isAgent: boolean };
}

const NICK_COLORS = [
  '#c41e3a', // crimson
  '#0057b7', // blue
  '#16a34a', // green
  '#9333ea', // purple
  '#d97706', // amber
  '#0891b2', // cyan
  '#c026d3', // magenta
  '#854d0e', // brown
  '#4338ca', // indigo
  '#dc2626', // red
  '#059669', // emerald
  '#db2777', // pink
  '#1d4ed8', // royal blue
];

function getNickColor(userId: string): string {
  // Use last 8 hex chars of UUID — high entropy in v4 UUIDs
  const hex = userId.replace(/-/g, '').slice(-8);
  const num = parseInt(hex, 16) >>> 0;
  return NICK_COLORS[num % NICK_COLORS.length];
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

export function MessageList({ messages, usersMap }: { messages: Msg[]; usersMap: Map<string, { displayName: string; isAgent: boolean }> }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return (
      <div className="mac-inset" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#999999', margin: 4 }}>
        No messages yet. Start the conversation.
      </div>
    );
  }

  return (
    <div className="mac-inset" style={{ flex: 1, overflowY: 'auto', padding: 6, fontSize: 12, fontFamily: "'Monaco', 'IBM Plex Mono', monospace", margin: 4 }}>
      {messages.map((msg) => {
        const user = usersMap.get(msg.userId) || { displayName: msg.userId.slice(0, 8), isAgent: false };
        const nickColor = getNickColor(msg.userId);
        return (
          <div key={msg.id} style={{ padding: '1px 2px', lineHeight: 1.6 }}>
            <span style={{ color: '#999999' }}>[{formatTime(msg.createdAt)}]</span>
            {' '}
            <span style={{ fontWeight: 'bold', color: nickColor }}>&lt;{user.displayName}&gt;</span>
            {user.isAgent && <span style={{ fontWeight: 'bold', color: '#666666' }}> [BOT]</span>}
            {' '}
            <MarkdownText text={msg.content} />
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
