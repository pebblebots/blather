import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MessageReactions } from './MessageReactions';

afterEach(() => cleanup());

const reactions = [
  { id: 'r1', userId: 'u-1', emoji: '👍', createdAt: '2026-01-01T00:00:00Z' },
  { id: 'r2', userId: 'u-2', emoji: '👍', createdAt: '2026-01-01T00:00:01Z' },
  { id: 'r3', userId: 'u-1', emoji: '❤️', createdAt: '2026-01-01T00:00:02Z' },
];

describe('MessageReactions', () => {
  it('returns null for empty reactions', () => {
    const { container } = render(
      <MessageReactions reactions={[]} currentUserId="u-1" onToggleReaction={vi.fn()} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('groups reactions by emoji with counts', () => {
    render(<MessageReactions reactions={reactions} onToggleReaction={vi.fn()} />);
    // 👍 has count 2, ❤️ has count 1
    expect(screen.getByTitle('👍 2')).toBeInTheDocument();
    expect(screen.getByTitle('❤️ 1')).toBeInTheDocument();
  });

  it('shows count number only when > 1', () => {
    render(<MessageReactions reactions={reactions} onToggleReaction={vi.fn()} />);
    const thumbsBtn = screen.getByTitle('👍 2');
    expect(thumbsBtn).toHaveTextContent('2');
    const heartBtn = screen.getByTitle('❤️ 1');
    // Count 1 should NOT show a number
    expect(heartBtn.textContent).toBe('❤️');
  });

  it('highlights reaction if current user has reacted', () => {
    render(<MessageReactions reactions={reactions} currentUserId="u-1" onToggleReaction={vi.fn()} />);
    const thumbsBtn = screen.getByTitle('👍 2');
    // Active reactions have blue border (jsdom normalizes to rgb)
    expect(thumbsBtn.style.border).toContain('rgb(51, 102, 204)');
  });

  it('calls onToggleReaction with emoji when clicked', () => {
    const onToggle = vi.fn();
    render(<MessageReactions reactions={reactions} onToggleReaction={onToggle} />);
    fireEvent.click(screen.getByTitle('👍 2'));
    expect(onToggle).toHaveBeenCalledWith('👍');
  });
});
