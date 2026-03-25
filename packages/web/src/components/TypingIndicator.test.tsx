import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TypingIndicator } from './TypingIndicator';

afterEach(() => cleanup());

const usersMap = new Map([
  ['u-1', { displayName: 'Alice', isAgent: false }],
  ['u-2', { displayName: 'Bob', isAgent: true }],
  ['u-3', { displayName: 'Charlie', isAgent: false }],
]);

function makeTyping(entries: [string, string][]): Map<string, { timestamp: number; channelId: string }> {
  const map = new Map<string, { timestamp: number; channelId: string }>();
  for (const [userId, channelId] of entries) {
    map.set(`${channelId}:${userId}`, { timestamp: Date.now(), channelId });
  }
  return map;
}

describe('TypingIndicator', () => {
  it('renders empty when no one is typing', () => {
    const { container } = render(
      <TypingIndicator typingUsers={new Map()} usersMap={usersMap} currentUserId="u-1" selectedChannelId="ch-1" />
    );
    expect(container.textContent?.trim()).toBe('');
  });

  it('shows single user typing with verb', () => {
    const typing = makeTyping([['u-2', 'ch-1']]);
    render(
      <TypingIndicator typingUsers={typing} usersMap={usersMap} currentUserId="u-1" selectedChannelId="ch-1" />
    );
    expect(screen.getByText(/Bob is/)).toBeInTheDocument();
  });

  it('does not show current user as typing', () => {
    const typing = makeTyping([['u-1', 'ch-1']]);
    const { container } = render(
      <TypingIndicator typingUsers={typing} usersMap={usersMap} currentUserId="u-1" selectedChannelId="ch-1" />
    );
    expect(container.textContent).not.toContain('Alice');
  });

  it('only shows typing for selected channel', () => {
    const typing = makeTyping([['u-2', 'ch-2']]);
    const { container } = render(
      <TypingIndicator typingUsers={typing} usersMap={usersMap} currentUserId="u-1" selectedChannelId="ch-1" />
    );
    expect(container.textContent).not.toContain('Bob');
  });

  it('shows multiple users typing with group verb', () => {
    const typing = makeTyping([['u-2', 'ch-1'], ['u-3', 'ch-1']]);
    render(
      <TypingIndicator typingUsers={typing} usersMap={usersMap} currentUserId="u-1" selectedChannelId="ch-1" />
    );
    expect(screen.getByText(/Bob and Charlie are/)).toBeInTheDocument();
  });
});
