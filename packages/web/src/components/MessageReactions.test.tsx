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

describe('EmojiPicker keyboard navigation', () => {
  it('applies grid + gridcell ARIA roles in compact mode', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Emoji picker' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Quick emoji reactions' })).toBeInTheDocument();
    // 8 quick emojis -> 8 gridcells
    expect(screen.getAllByRole('gridcell')).toHaveLength(8);
  });

  it('applies grid + gridcell ARIA roles in full mode', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('⋯'));
    expect(screen.getByRole('grid', { name: 'Emoji grid' })).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell').length).toBeGreaterThan(0);
  });

  it('ArrowRight moves focus to next emoji in compact mode', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const grid = screen.getByRole('grid', { name: 'Quick emoji reactions' });
    const cells = screen.getAllByRole('gridcell');
    // Start by focusing first cell
    cells[0].focus();
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[1]);
  });

  it('ArrowLeft wraps to last emoji from first in compact mode', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const grid = screen.getByRole('grid', { name: 'Quick emoji reactions' });
    const cells = screen.getAllByRole('gridcell');
    cells[0].focus();
    fireEvent.keyDown(grid, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cells[cells.length - 1]);
  });

  it('Home / End jump to first / last cell', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const grid = screen.getByRole('grid', { name: 'Quick emoji reactions' });
    const cells = screen.getAllByRole('gridcell');
    cells[3].focus();
    fireEvent.keyDown(grid, { key: 'End' });
    expect(document.activeElement).toBe(cells[cells.length - 1]);
    fireEvent.keyDown(grid, { key: 'Home' });
    expect(document.activeElement).toBe(cells[0]);
  });

  it('Enter selects focused emoji and closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const grid = screen.getByRole('grid', { name: 'Quick emoji reactions' });
    const cells = screen.getAllByRole('gridcell');
    cells[2].focus(); // focus -> onFocus -> setFocusedIndex(2), emoji = 😂
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('😂');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Space selects focused emoji and closes', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<EmojiPicker onSelect={onSelect} onClose={onClose} />);
    const grid = screen.getByRole('grid', { name: 'Quick emoji reactions' });
    const cells = screen.getAllByRole('gridcell');
    cells[0].focus();
    fireEvent.keyDown(grid, { key: ' ' });
    expect(onSelect).toHaveBeenCalledWith('👍');
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('Escape closes the picker', () => {
    const onClose = vi.fn();
    render(<EmojiPicker onSelect={vi.fn()} onClose={onClose} />);
    const grid = screen.getByRole('grid', { name: 'Quick emoji reactions' });
    const cells = screen.getAllByRole('gridcell');
    cells[0].focus();
    fireEvent.keyDown(grid, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('ArrowDown in full-mode grid moves down one row (8 cells)', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('⋯'));
    const grid = screen.getByRole('grid', { name: 'Emoji grid' });
    const cells = screen.getAllByRole('gridcell');
    // Need at least 2 rows for this test
    expect(cells.length).toBeGreaterThanOrEqual(9);
    cells[0].focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cells[8]);
  });

  it('uses roving tabindex (only focused cell has tabIndex=0)', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    const cells = screen.getAllByRole('gridcell');
    const tabbable = cells.filter((c) => c.getAttribute('tabindex') === '0');
    expect(tabbable).toHaveLength(1);
  });

  it('ArrowDown from search input moves focus into grid', () => {
    render(<EmojiPicker onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('⋯'));
    const searchInput = screen.getByPlaceholderText('Search emoji...');
    fireEvent.keyDown(searchInput, { key: 'ArrowDown' });
    const cells = screen.getAllByRole('gridcell');
    expect(document.activeElement).toBe(cells[0]);
  });
});
