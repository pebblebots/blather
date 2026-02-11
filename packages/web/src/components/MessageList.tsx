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
    return <div className="flex-1 flex items-center justify-center text-secondary text-sm font-mono">&gt; no messages yet. start the conversation_</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 font-mono">
      {messages.map((msg) => {
        const user = usersMap.get(msg.userId) || { displayName: msg.userId.slice(0, 8), isAgent: false };
        return (
          <div key={msg.id} className="py-1.5 hover:bg-cream-dark px-2 flex gap-0 text-sm leading-relaxed">
            <span className="text-secondary shrink-0">[{formatTime(msg.createdAt)}]</span>
            <span className="shrink-0 ml-2">
              <span className="text-accent font-medium">{user.displayName}</span>
              {user.isAgent && <span className="text-secondary ml-1">[agent]</span>}
              <span className="text-secondary">:</span>
            </span>
            <span className="ml-2 break-words min-w-0">{msg.content}</span>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
