import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MessageList } from './MessageList';

// jsdom doesn't implement scrollIntoView
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => cleanup());

// Mock MarkdownText to keep tests focused on MessageList logic
vi.mock('./MarkdownText', () => ({
  MarkdownText: ({ text }: { text: string }) => <span data-testid="md">{text}</span>,
}));

// Mock MessageReactions
vi.mock('./MessageReactions', () => ({
  MessageReactions: () => <span data-testid="reactions" />,
  EmojiPicker: () => null,
}));

const usersMap = new Map([
  ['u-1', { displayName: 'Alice', isAgent: false }],
  ['u-2', { displayName: 'Bob', isAgent: true }],
]);

function makeMsg(overrides: Partial<{
  id: string; userId: string; content: string; createdAt: string;
  updatedAt: string; replyCount: number; reactions: any[];
  attachments: { url: string; filename: string; contentType: string; size: number }[];
}> = {}) {
  return {
    id: overrides.id ?? 'msg-1',
    userId: overrides.userId ?? 'u-1',
    content: overrides.content ?? 'Hello world',
    createdAt: overrides.createdAt ?? '2026-03-24T12:00:00Z',
    ...overrides,
  };
}

describe('MessageList', () => {
  it('shows empty state when no messages', () => {
    render(<MessageList messages={[]} usersMap={usersMap} />);
    expect(screen.getByText(/no messages yet/i)).toBeInTheDocument();
  });

  it('renders messages with sender name and content', () => {
    const messages = [makeMsg({ id: 'm1', userId: 'u-1', content: 'hi' })];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText('hi')).toBeInTheDocument();
  });

  it('renders timestamp for each message', () => {
    const messages = [makeMsg()];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    // Timestamp is rendered as [Mon DD HH:MM AM/PM] (or "Today"/"Yesterday") — verify the bracket/time format exists
    expect(screen.getByText(/\[.*\d{1,2}:\d{2}.*\]/)).toBeInTheDocument();
  });

  it('renders multiple messages', () => {
    const messages = [
      makeMsg({ id: 'm1', userId: 'u-1', content: 'First' }),
      makeMsg({ id: 'm2', userId: 'u-2', content: 'Second' }),
    ];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    expect(screen.getByText('First')).toBeInTheDocument();
    expect(screen.getByText('Second')).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it('renders markdown content via MarkdownText', () => {
    const messages = [makeMsg({ content: '**bold** text' })];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    expect(screen.getByTestId('md')).toHaveTextContent('**bold** text');
  });

  it('shows reply count when message has replies', () => {
    const messages = [makeMsg({ replyCount: 3 })];
    render(<MessageList messages={messages} usersMap={usersMap} onOpenThread={vi.fn()} />);
    expect(screen.getByText(/3 replies/)).toBeInTheDocument();
  });

  it('shows singular "reply" for count of 1', () => {
    const messages = [makeMsg({ replyCount: 1 })];
    render(<MessageList messages={messages} usersMap={usersMap} onOpenThread={vi.fn()} />);
    expect(screen.getByText(/1 reply$/)).toBeInTheDocument();
  });

  it('falls back to truncated userId when user not in map', () => {
    const unknownUser = 'unknown-user-id-1234';
    const messages = [makeMsg({ userId: unknownUser })];
    render(<MessageList messages={messages} usersMap={new Map()} />);
    expect(screen.getByText(/unknown-/)).toBeInTheDocument();
  });

  // --- Edited indicator ---

  it('shows "(edited)" when updatedAt is well after createdAt', () => {
    const messages = [makeMsg({
      createdAt: '2026-03-24T12:00:00Z',
      updatedAt: '2026-03-24T12:05:00Z',
    })];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    expect(screen.getByText('(edited)')).toBeInTheDocument();
  });

  it('does not show "(edited)" when updatedAt is within save threshold', () => {
    const messages = [makeMsg({
      createdAt: '2026-03-24T12:00:00.000Z',
      updatedAt: '2026-03-24T12:00:00.500Z',
    })];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    expect(screen.queryByText('(edited)')).not.toBeInTheDocument();
  });

  // --- Loading / pagination indicators ---

  it('shows loading indicator when isLoadingOlder is true', () => {
    const messages = [makeMsg()];
    render(<MessageList messages={messages} usersMap={usersMap} isLoadingOlder={true} />);
    expect(screen.getByText(/loading older messages/i)).toBeInTheDocument();
  });

  it('shows beginning-of-conversation marker when hasMoreOlder is false', () => {
    const messages = [makeMsg()];
    render(<MessageList messages={messages} usersMap={usersMap} hasMoreOlder={false} />);
    expect(screen.getByText(/beginning of conversation/i)).toBeInTheDocument();
  });

  // --- Attachments ---

  it('renders image attachments as thumbnails', () => {
    const messages = [makeMsg({
      attachments: [{ url: '/uploads/pic.png', filename: 'pic.png', contentType: 'image/png', size: 2048 }],
    })];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    const img = screen.getByAltText('pic.png');
    expect(img).toBeInTheDocument();
    expect(img.tagName).toBe('IMG');
  });

  it('renders non-image attachments as download links with file size', () => {
    const messages = [makeMsg({
      attachments: [{ url: '/uploads/doc.pdf', filename: 'doc.pdf', contentType: 'application/pdf', size: 1536 }],
    })];
    render(<MessageList messages={messages} usersMap={usersMap} />);
    expect(screen.getByText(/doc\.pdf/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 KB/)).toBeInTheDocument();
  });

  // --- Edit flow ---

  it('enters edit mode and submits on Enter', () => {
    const onEdit = vi.fn();
    const messages = [makeMsg({ id: 'm1', userId: 'u-1', content: 'original' })];
    render(<MessageList messages={messages} usersMap={usersMap} currentUserId="u-1" onEditMessage={onEdit} />);

    // Hover to reveal action buttons
    const msgEl = screen.getByText('original').closest('[id="msg-m1"]')!;
    fireEvent.mouseEnter(msgEl);

    // Click edit button
    const editBtn = screen.getByTitle('Edit message');
    fireEvent.click(editBtn);

    // Input appears with current content
    const input = screen.getByDisplayValue('original');
    expect(input).toBeInTheDocument();

    // Change text and submit
    fireEvent.change(input, { target: { value: 'updated' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onEdit).toHaveBeenCalledWith('m1', 'updated');
  });

  it('cancels edit on Escape', () => {
    const onEdit = vi.fn();
    const messages = [makeMsg({ id: 'm1', userId: 'u-1', content: 'original' })];
    render(<MessageList messages={messages} usersMap={usersMap} currentUserId="u-1" onEditMessage={onEdit} />);

    // Hover + click edit
    const msgEl = screen.getByText('original').closest('[id="msg-m1"]')!;
    fireEvent.mouseEnter(msgEl);
    fireEvent.click(screen.getByTitle('Edit message'));

    // Press Escape
    const input = screen.getByDisplayValue('original');
    fireEvent.keyDown(input, { key: 'Escape' });

    // Should exit edit mode without calling onEdit
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue('original')).not.toBeInTheDocument();
    // Original text still rendered
    expect(screen.getByText('original')).toBeInTheDocument();
  });

  // --- Delete flow ---

  it('shows delete confirmation and deletes on confirm', () => {
    const onDelete = vi.fn();
    const messages = [makeMsg({ id: 'm1', userId: 'u-1', content: 'bye' })];
    render(<MessageList messages={messages} usersMap={usersMap} currentUserId="u-1" onDeleteMessage={onDelete} />);

    // Hover to reveal actions
    const msgEl = screen.getByText('bye').closest('[id="msg-m1"]')!;
    fireEvent.mouseEnter(msgEl);

    // Click delete button — should show confirmation
    fireEvent.click(screen.getByTitle('Delete message'));
    expect(screen.getByText('Delete this message?')).toBeInTheDocument();

    // Click confirm
    fireEvent.click(screen.getByText('Delete'));
    expect(onDelete).toHaveBeenCalledWith('m1');
  });

  it('cancels delete on cancel button', () => {
    const onDelete = vi.fn();
    const messages = [makeMsg({ id: 'm1', userId: 'u-1', content: 'keep' })];
    render(<MessageList messages={messages} usersMap={usersMap} currentUserId="u-1" onDeleteMessage={onDelete} />);

    const msgEl = screen.getByText('keep').closest('[id="msg-m1"]')!;
    fireEvent.mouseEnter(msgEl);
    fireEvent.click(screen.getByTitle('Delete message'));

    // Click cancel
    fireEvent.click(screen.getByText('Cancel'));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('Delete this message?')).not.toBeInTheDocument();
  });
});
