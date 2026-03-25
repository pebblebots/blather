import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskPanel } from './TaskPanel';
import { AppContext } from '../lib/store';
import type { ReactNode } from 'react';

afterEach(() => cleanup());

const mockList = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

vi.mock('../lib/api', () => ({
  taskApi: {
    list: (...args: any[]) => mockList(...args),
    create: (...args: any[]) => mockCreate(...args),
    update: (...args: any[]) => mockUpdate(...args),
    delete: (...args: any[]) => mockDelete(...args),
  },
}));

const members = [
  { id: 'u-1', displayName: 'Alice', isAgent: false },
  { id: 'u-2', displayName: 'Bot', isAgent: true },
];

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AppContext.Provider value={{ user: { id: 'u-1', email: 'a@b.com', displayName: 'Alice', avatarUrl: null, isAgent: false }, setUser: vi.fn() }}>
      {children}
    </AppContext.Provider>
  );
}

describe('TaskPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading then tasks', async () => {
    mockList.mockResolvedValue([
      { id: 't-1', title: 'Fix bug', status: 'queued', priority: 'normal', creatorId: 'u-1', assigneeId: null },
    ]);

    render(<TaskPanel workspaceId="ws-1" members={members} />, { wrapper: Wrapper });
    expect(await screen.findByText('Fix bug')).toBeInTheDocument();
  });

  it('shows empty state when no tasks', async () => {
    mockList.mockResolvedValue([]);
    render(<TaskPanel workspaceId="ws-1" members={members} />, { wrapper: Wrapper });
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it('groups tasks by status', async () => {
    mockList.mockResolvedValue([
      { id: 't-1', title: 'Task A', status: 'queued', priority: 'normal', creatorId: 'u-1', assigneeId: null },
      { id: 't-2', title: 'Task B', status: 'in_progress', priority: 'urgent', creatorId: 'u-1', assigneeId: 'u-2' },
    ]);

    render(<TaskPanel workspaceId="ws-1" members={members} />, { wrapper: Wrapper });
    expect(await screen.findByText('Task A')).toBeInTheDocument();
    expect(screen.getByText('Task B')).toBeInTheDocument();
    // Status group headers (include emoji to disambiguate from <option>)
    expect(screen.getByText(/📋 Queued/)).toBeInTheDocument();
    expect(screen.getByText(/⚙️ In Progress/)).toBeInTheDocument();
  });

  it('opens create modal and creates task', async () => {
    mockList.mockResolvedValue([]);
    mockCreate.mockResolvedValue({ id: 't-new' });

    const user = userEvent.setup();
    render(<TaskPanel workspaceId="ws-1" members={members} />, { wrapper: Wrapper });

    await screen.findByText(/no tasks yet/i);
    await user.click(screen.getByText('+ New Task'));

    const titleInput = screen.getByPlaceholderText('What needs to be done?');
    await user.type(titleInput, 'New task{Enter}');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      title: 'New task',
    }));
  });
});
