import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MessageReactions, EmojiPicker } from './MessageReactions';

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

describe('EmojiPicker', () => {
  it('renders quick emoji buttons in compact mode', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    // Quick emojis should be visible as buttons
    expect(screen.getByText('👍')).toBeInTheDocument();
    expect(screen.getByText('❤️')).toBeInTheDocument();
    expect(screen.getByText('🔥')).toBeInTheDocument();
    // Search input should NOT be visible in compact mode
    expect(screen.queryByPlaceholderText('Search emoji...')).not.toBeInTheDocument();
  });

  it('calls onSelect and onClose when a quick emoji is clicked', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByText('🎉'));
    expect(onSelect).toHaveBeenCalledWith('🎉');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('expands to full picker when "⋯" button is clicked', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('⋯'));
    // Full picker shows search input
    expect(screen.getByPlaceholderText('Search emoji...')).toBeInTheDocument();
  });

  it('filters emojis by search term in full mode', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    // Expand to full picker
    fireEvent.click(screen.getByText('⋯'));
    const searchInput = screen.getByPlaceholderText('Search emoji...');
    fireEvent.change(searchInput, { target: { value: 'fire' } });
    // Should show fire emoji (matched by keyword)
    expect(screen.getByTitle(':fire:')).toBeInTheDocument();
  });

  it('calls onClose when clicking outside the picker', () => {
    const onClose = vi.fn();
    render(<EmojiPicker onSelect={vi.fn()} onClose={onClose} />);
    // Click on document body (outside the picker)
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledOnce();
  });
});


describe('EmojiPicker a11y (T#170)', () => {
  it('has role=dialog and aria-label on the container', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: /emoji picker/i });
    expect(dialog).toBeInTheDocument();
  });

  it('exposes descriptive aria-labels on quick emoji buttons', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: /add 👍 reaction/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open full emoji picker/i })).toBeInTheDocument();
  });

  it('Escape key calls onClose', () => {
    const onClose = vi.fn();
    render(<EmojiPicker onSelect={vi.fn()} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: /emoji picker/i });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ArrowRight/ArrowLeft navigate between quick emoji buttons (roving tabindex)', () => {
    const { container } = render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: /emoji picker/i });
    const first = container.querySelector('[data-emoji-idx="0"]') as HTMLButtonElement;
    const second = container.querySelector('[data-emoji-idx="1"]') as HTMLButtonElement;
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);

    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(first.tabIndex).toBe(-1);
    expect(second.tabIndex).toBe(0);

    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
  });

  it('ArrowLeft at the first quick emoji does not underflow', () => {
    const { container } = render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: /emoji picker/i });
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    const first = container.querySelector('[data-emoji-idx="0"]') as HTMLButtonElement;
    expect(first.tabIndex).toBe(0);
  });

  it('full-mode grid buttons have aria-labels with emoji name', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('⋯'));
    const searchInput = screen.getByPlaceholderText('Search emoji...');
    fireEvent.change(searchInput, { target: { value: 'fire' } });
    const fireBtn = screen.getByRole('button', { name: /fire/i });
    expect(fireBtn).toBeInTheDocument();
  });
});
