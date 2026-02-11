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
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Avatar({ name, isAgent }: { name: string; isAgent: boolean }) {
  const letter = (name?.[0] || '?').toUpperCase();
  const colors = ['bg-indigo-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600', 'bg-purple-600'];
  const color = colors[name.charCodeAt(0) % colors.length];
  return (
    <div className={`w-9 h-9 rounded-full ${color} flex items-center justify-center text-sm font-semibold shrink-0 relative`}>
      {letter}
      {isAgent && <span className="absolute -bottom-0.5 -right-0.5 text-xs">🤖</span>}
    </div>
  );
}

export function MessageList({ messages, usersMap }: { messages: Msg[]; usersMap: Map<string, { displayName: string; isAgent: boolean }> }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (messages.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">No messages yet. Start the conversation!</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
      {messages.map((msg) => {
        const user = usersMap.get(msg.userId) || { displayName: msg.userId.slice(0, 8), isAgent: false };
        return (
          <div key={msg.id} className="flex gap-3 py-1.5 hover:bg-gray-800/50 rounded px-2 group">
            <Avatar name={user.displayName} isAgent={user.isAgent} />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-sm">{user.displayName}</span>
                <span className="text-xs text-gray-500">{formatTime(msg.createdAt)}</span>
              </div>
              <p className="text-sm text-gray-300 break-words">{msg.content}</p>
            </div>
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
