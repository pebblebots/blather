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

  it('calls onClose when clicking overlay', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<SearchPanel workspaceId="ws-1" onNavigate={vi.fn()} onClose={onClose} />);
    await user.click(container.firstElementChild as HTMLElement);
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
});
