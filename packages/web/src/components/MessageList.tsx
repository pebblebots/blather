import { useEffect, useRef } from 'react';

interface Msg {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  user?: { displayName: string; isAgent: boolean };
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
      <div className="win-sunken" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#808080' }}>
        &gt; NO MESSAGES YET. START THE CONVERSATION.
      </div>
    );
  }

  return (
    <div className="win-sunken" style={{ flex: 1, overflowY: 'auto', padding: 4, fontSize: 12 }}>
      {messages.map((msg) => {
        const user = usersMap.get(msg.userId) || { displayName: msg.userId.slice(0, 8), isAgent: false };
        return (
          <div key={msg.id} style={{ padding: '1px 2px', lineHeight: 1.5 }}>
            <span style={{ color: '#808080' }}>[{formatTime(msg.createdAt)}]</span>
            {' '}
            <span style={{ fontWeight: 'bold' }}>&lt;{user.displayName}&gt;</span>
            {user.isAgent && <span style={{ fontWeight: 'bold' }}> [BOT]</span>}
            {' '}
            <span>{msg.content}</span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
