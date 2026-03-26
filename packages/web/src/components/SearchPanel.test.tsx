import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPanel } from './SearchPanel';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mockSearchMessages = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    searchMessages: (...args: any[]) => mockSearchMessages(...args),
  },
}));

describe('SearchPanel', () => {
  it('renders search input and initial state', () => {
    render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByPlaceholderText('Search messages...')).toBeInTheDocument();
    expect(screen.getByText(/type to search/i)).toBeInTheDocument();
  });

  it('displays search results after typing', async () => {
    mockSearchMessages.mockResolvedValue([
      { id: 'm-1', channelId: 'ch-1', content: 'Hello world', userName: 'Alice', channelName: 'general', createdAt: '2026-01-01T12:00:00Z' },
    ]);

    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Search messages...'), 'Hello');

    // Wait for debounce + render
    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled(), { timeout: 2000 });
    expect(await screen.findByText(/Alice/)).toBeInTheDocument();
  });

  it('shows no results state', async () => {
    mockSearchMessages.mockResolvedValue([]);

    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Search messages...'), 'nonexistent');

    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled(), { timeout: 2000 });
    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
  });

  it('calls onClose when clicking the backdrop overlay', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={onClose} />);
    // The search title is inside the panel; clicking the backdrop (outside) should close.
    // Find the outermost overlay by its role as backdrop — it covers the full viewport.
    const backdrop = screen.getByText('🔍 Search Messages').closest('.mac-window')!.parentElement!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onNavigate when clicking a result', async () => {
    mockSearchMessages.mockResolvedValue([
      { id: 'm-1', channelId: 'ch-1', content: 'Found message', userName: 'Bob', channelName: 'general', createdAt: '2026-01-01T12:00:00Z' },
    ]);

    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-1" onNavigate={onNavigate} onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Search messages...'), 'query');

    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled(), { timeout: 2000 });
    // Click the userName which won't be split by highlighting
    const resultName = await screen.findByText('Bob');
    await user.click(resultName);
    expect(onNavigate).toHaveBeenCalledWith('ch-1', 'm-1');
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={onClose} />);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('highlights matching text in results', async () => {
    mockSearchMessages.mockResolvedValue([
      { id: 'm-1', channelId: 'ch-1', content: 'Say hello to the world', userName: 'Eve', channelName: 'general', createdAt: '2026-01-01T12:00:00Z' },
    ]);

    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Search messages...'), 'hello');

    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled(), { timeout: 2000 });
    await screen.findByText('Eve');
    // The highlighted word should be bold and yellow-backgrounded
    const highlighted = screen.getByText('hello');
    expect(highlighted.tagName).toBe('SPAN');
    expect(highlighted.style.fontWeight).toBe('bold');
  });

  it('shows empty results on API error', async () => {
    mockSearchMessages.mockRejectedValue(new Error('Network error'));

    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Search messages...'), 'fail');

    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled(), { timeout: 2000 });
    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
  });

  it('passes workspace and query to the API', async () => {
    mockSearchMessages.mockResolvedValue([]);

    const user = userEvent.setup();
    render(<SearchPanel workspaceId="ws-42" onNavigate={vi.fn()} onClose={vi.fn()} />);
    await user.type(screen.getByPlaceholderText('Search messages...'), 'test query');

    await waitFor(() => expect(mockSearchMessages).toHaveBeenCalled(), { timeout: 2000 });
    expect(mockSearchMessages).toHaveBeenCalledWith({
      q: 'test query',
      workspaceId: 'ws-42',
      limit: 30,
    });
  });
});
