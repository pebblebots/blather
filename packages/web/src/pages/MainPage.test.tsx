import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MainPage } from './MainPage';
import { AppContext } from '../lib/store';
import type { ReactNode } from 'react';

beforeAll(() => { Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => cleanup());

const mockGetWorkspaces = vi.fn();
const mockGetChannels = vi.fn();
const mockGetMessages = vi.fn();
const mockGetWorkspaceMembers = vi.fn();
const mockGetUnreadCounts = vi.fn();
const mockGetPresence = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    getWorkspaces: (...args: any[]) => mockGetWorkspaces(...args),
    getChannels: (...args: any[]) => mockGetChannels(...args),
    getMessages: (...args: any[]) => mockGetMessages(...args),
    getWorkspaceMembers: (...args: any[]) => mockGetWorkspaceMembers(...args),
    getActiveHuddles: vi.fn(async () => []),
    sendMessage: vi.fn(),
    sendTyping: vi.fn(),
    searchMessages: vi.fn(async () => []),
  },
  unreadApi: {
    getUnreadCounts: (...args: any[]) => mockGetUnreadCounts(...args),
    markRead: vi.fn(async () => ({ ok: true })),
  },
  presenceApi: {
    getPresence: (...args: any[]) => mockGetPresence(...args),
  },
  clearToken: vi.fn(),
  taskApi: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
}));

vi.mock('../hooks/useWebSocket', () => ({
  useWebSocket: () => true,
}));

vi.mock('../components/MarkdownText', () => ({
  MarkdownText: ({ text }: { text: string }) => <span>{text}</span>,
}));

vi.mock('../components/MessageReactions', () => ({
  MessageReactions: () => null,
  EmojiPicker: () => null,
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AppContext.Provider value={{
      user: { id: 'u-1', email: 'alice@test.com', displayName: 'Alice', avatarUrl: null, isAgent: false },
      setUser: vi.fn(),
    }}>
      {children}
    </AppContext.Provider>
  );
}

describe('MainPage', () => {
  it('renders sidebar with channels', async () => {
    mockGetWorkspaces.mockResolvedValue([{ id: 'ws-1', name: 'Test WS', slug: 'test' }]);
    mockGetChannels.mockResolvedValue([
      { id: 'ch-1', name: 'general', slug: 'general', channelType: 'public' },
      { id: 'ch-2', name: 'random', slug: 'random', channelType: 'public' },
    ]);
    mockGetWorkspaceMembers.mockResolvedValue([{ id: 'u-1', displayName: 'Alice', isAgent: false }]);
    mockGetMessages.mockResolvedValue([]);
    mockGetUnreadCounts.mockResolvedValue({});
    mockGetPresence.mockResolvedValue([]);

    render(<MainPage />, { wrapper: Wrapper });

    const generals = await screen.findAllByText(/general/);
    expect(generals.length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/random/).length).toBeGreaterThanOrEqual(1);
  });

  it('loads messages when channel is selected', async () => {
    mockGetWorkspaces.mockResolvedValue([{ id: 'ws-1', name: 'WS', slug: 'ws' }]);
    mockGetChannels.mockResolvedValue([{ id: 'ch-1', name: 'general', slug: 'general', channelType: 'public' }]);
    mockGetWorkspaceMembers.mockResolvedValue([{ id: 'u-1', displayName: 'Alice', isAgent: false }]);
    mockGetMessages.mockResolvedValue([
      { id: 'm-1', userId: 'u-1', content: 'Hello world', createdAt: '2026-01-01T12:00:00Z', channelId: 'ch-1' },
    ]);
    mockGetUnreadCounts.mockResolvedValue({});
    mockGetPresence.mockResolvedValue([]);

    render(<MainPage />, { wrapper: Wrapper });

    expect(await screen.findByText('Hello world')).toBeInTheDocument();
  });

  it('shows workspace members', async () => {
    mockGetWorkspaces.mockResolvedValue([{ id: 'ws-1', name: 'WS', slug: 'ws' }]);
    mockGetChannels.mockResolvedValue([{ id: 'ch-1', name: 'general', slug: 'general', channelType: 'public' }]);
    mockGetWorkspaceMembers.mockResolvedValue([
      { id: 'u-1', displayName: 'Alice', isAgent: false },
      { id: 'u-2', displayName: 'BobMember', isAgent: false },
    ]);
    mockGetMessages.mockResolvedValue([]);
    mockGetUnreadCounts.mockResolvedValue({});
    mockGetPresence.mockResolvedValue([]);

    render(<MainPage />, { wrapper: Wrapper });

    // Members section should render — use findAllByText since names may appear in multiple places
    const members = await screen.findAllByText('BobMember');
    expect(members.length).toBeGreaterThanOrEqual(1);
  });
});
