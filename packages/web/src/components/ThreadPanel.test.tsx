import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThreadPanel } from './ThreadPanel';

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => cleanup());

vi.mock('./MarkdownText', () => ({
  MarkdownText: ({ text }: { text: string }) => <span data-testid="md">{text}</span>,
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

  it('shows reply count', async () => {
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

  it('calls onClose when close box is clicked', async () => {
    mockGetThreadReplies.mockResolvedValue([]);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(
      <ThreadPanel channelId="ch-1" parentMessage={parentMessage} usersMap={usersMap} onClose={onClose} />
    );

    const closeBox = document.querySelector('.mac-close-box') as HTMLElement;
    await user.click(closeBox);
    expect(onClose).toHaveBeenCalled();
  });
});
