import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
  replyCount: number; reactions: any[];
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
    // Timestamp is rendered as [HH:MM] — just verify the bracket format exists
    expect(screen.getByText(/\[\d{2}:\d{2}\]/)).toBeInTheDocument();
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
});
