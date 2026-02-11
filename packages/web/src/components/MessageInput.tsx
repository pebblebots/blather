import { useState } from 'react';

export function MessageInput({ onSend, disabled }: { onSend: (content: string) => void; disabled?: boolean }) {
  const [text, setText] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2">
      <div className="flex gap-2 bg-gray-700 rounded-lg p-1">
        <input
          className="flex-1 bg-transparent px-3 py-2 text-sm focus:outline-none placeholder-gray-400"
          placeholder="Type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 rounded-md text-sm font-medium transition-colors"
        >
          Send
        </button>
      </div>
    </form>
  );
}
