import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '../test-utils';
import userEvent from '@testing-library/user-event';
import { ThreadPanel } from './ThreadPanel';

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

vi.mock('./MarkdownText', () => ({
  MarkdownText: ({ text }: { text: string }) => <span data-testid="md">{text}</span>,
}));

vi.mock('../lib/chatUtils', () => ({
  getNickColor: () => '#000000',
  formatTimestamp: (iso: string) => '12:00',
}));

const mockGetThreadReplies = vi.fn();
const mockSendThreadReply = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getThreadReplies: (...args: any[]) => mockGetThreadReplies(...args),
    sendThreadReply: (...args: any[]) => mockSendThreadReply(...args),
  },
}));

const usersMap = new Map([['u-1', { displayName: 'Alice', isAgent: false }]]);
const parentMessage = { id: 'msg-1', userId: 'u-1', content: 'Parent message', createdAt: '2026-01-01T12:00:00Z' };

describe('ThreadPanel', () => {
  it('renders parent message and fetches replies', async () => {
    mockGetThreadReplies.mockResolvedValue([
      { id: 'r-1', userId: 'u-1', content: 'Reply 1', createdAt: '2026-01-01T12:01:00Z' },
    ]);

    render(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} onClose={vi.fn()} />
    );

    expect(screen.getByText('Parent message')).toBeInTheDocument();
    expect(await screen.findByText('Reply 1')).toBeInTheDocument();
  });

  it('shows reply count with correct singular/plural', async () => {
    mockGetThreadReplies.mockResolvedValue([
      { id: 'r-1', userId: 'u-1', content: 'R1', createdAt: '2026-01-01T12:01:00Z' },
      { id: 'r-2', userId: 'u-1', content: 'R2', createdAt: '2026-01-01T12:02:00Z' },
    ]);

    render(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} onClose={vi.fn()} />
    );

    expect(await screen.findByText(/2 replies/)).toBeInTheDocument();
  });

  it('sends a reply via the input', async () => {
    mockGetThreadReplies.mockResolvedValue([]);
    mockSendThreadReply.mockResolvedValue({ id: 'r-new', userId: 'u-1', content: 'New reply', createdAt: '2026-01-01T12:05:00Z' });

    const user = userEvent.setup();
    render(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} currentUserId="u-1" onClose={vi.fn()} />
    );

    const input = screen.getByPlaceholderText('Reply in thread...');
    await user.type(input, 'New reply{Enter}');

    expect(mockSendThreadReply).toHaveBeenCalledWith('ch-1', 'New reply', 'msg-1');
    expect(await screen.findByText('New reply')).toBeInTheDocument();
  });

  it('does not send when input is empty or whitespace', async () => {
    mockGetThreadReplies.mockResolvedValue([]);

    const user = userEvent.setup();
    render(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} onClose={vi.fn()} />
    );

    const input = screen.getByPlaceholderText('Reply in thread...');
    // Press Enter with empty input
    await user.type(input, '{Enter}');
    expect(mockSendThreadReply).not.toHaveBeenCalled();

    // Type only spaces and press Enter
    await user.type(input, '   {Enter}');
    expect(mockSendThreadReply).not.toHaveBeenCalled();
  });

  it('calls onClose when close button is clicked', async () => {
    mockGetThreadReplies.mockResolvedValue([]);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} onClose={onClose} />
    );

    await user.click(screen.getByRole('button', { name: 'Close thread' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('deduplicates WS replies that were already fetched', async () => {
    const existingReply = { id: 'r-1', userId: 'u-1', content: 'Reply 1', createdAt: '2026-01-01T12:01:00Z' };
    mockGetThreadReplies.mockResolvedValue([existingReply]);

    const { rerender } = render(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} onClose={vi.fn()} />
    );

    // Wait for initial fetch to complete
    await screen.findByText('Reply 1');

    // Simulate a WS message arriving with the same id
    const wsReply = { ...existingReply, threadId: 'msg-1' };
    rerender(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} onClose={vi.fn()} newReplyFromWs={wsReply} />
    );

    // Should still show exactly one "Reply 1", not two
    const matches = screen.getAllByText('Reply 1');
    expect(matches).toHaveLength(1);
  });
});
