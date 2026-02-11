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
    <form onSubmit={handleSubmit} style={{ padding: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
      <input
        className="win-input"
        style={{ flex: 1, fontSize: 12 }}
        placeholder="TYPE A MESSAGE..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="win-btn"
        style={{ minWidth: 60 }}
      >
        SEND
      </button>
    </form>
  );
}
