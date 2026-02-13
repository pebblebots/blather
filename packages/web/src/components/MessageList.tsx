import { MarkdownText } from './MarkdownText';
import { useEffect, useRef } from 'react';

interface Msg {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  user?: { displayName: string; isAgent: boolean };
}

// Warm, retro-friendly palette that works on cream backgrounds
const NICK_COLORS = [
  '#b91c1c', // red
  '#0369a1', // blue
  '#15803d', // green
  '#9333ea', // purple
  '#c2410c', // orange
  '#0e7490', // teal
  '#a21caf', // magenta
  '#854d0e', // amber
  '#4338ca', // indigo
  '#be185d', // pink
  '#166534', // dark green
  '#7e22ce', // violet
];

function hashUserId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getNickColor(userId: string): string {
  return NICK_COLORS[hashUserId(userId) % NICK_COLORS.length];
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
