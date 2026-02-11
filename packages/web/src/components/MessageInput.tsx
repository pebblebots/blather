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
    <form onSubmit={handleSubmit} className="px-4 pb-4 pt-2 border-t border-border">
      <div className="flex gap-0 items-center border border-border bg-surface">
        <span className="pl-3 text-accent font-mono text-sm select-none">&gt;</span>
        <input
          className="flex-1 bg-transparent px-2 py-2.5 text-sm font-mono focus:outline-none placeholder-secondary"
          placeholder="type a message..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <span className="cursor-blink text-accent font-mono mr-1">▌</span>
        <button
          type="submit"
          disabled={disabled || !text.trim()}
          className="px-4 py-2.5 bg-accent hover:bg-accent-light text-surface disabled:opacity-30 text-sm font-mono border-l border-border transition-colors"
        >
          SEND
        </button>
      </div>
    </form>
  );
}
