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
    <form onSubmit={handleSubmit} style={{ padding: 4, display: 'flex', gap: 4, alignItems: 'center', borderTop: '1px solid #CCCCCC' }}>
      <input
        className="mac-input"
        style={{ flex: 1, fontSize: 12, fontFamily: "'Monaco', 'IBM Plex Mono', monospace" }}
        placeholder="Type a message..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="mac-btn-primary"
        style={{ minWidth: 60 }}
      >
        Send
      </button>
    </form>
  );
}
