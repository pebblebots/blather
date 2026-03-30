import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskPanel } from './TaskPanel';

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

const sampleTasks = [
  { id: 't-1', title: 'Fix bug', status: 'queued', priority: 'normal', creatorId: 'u-1', assigneeId: null },
  { id: 't-2', title: 'Deploy', status: 'in_progress', priority: 'urgent', creatorId: 'u-1', assigneeId: 'u-2' },
];

describe('TaskPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: resolve with empty tasks (individual tests override)
    mockList.mockResolvedValue([]);
  });

  it('shows loading then tasks', async () => {
    mockList.mockResolvedValue([sampleTasks[0]]);
    render(<TaskPanel members={members} />);
    expect(await screen.findByText('Fix bug')).toBeInTheDocument();
  });

  it('shows empty state when no tasks', async () => {
    render(<TaskPanel members={members} />);
    expect(await screen.findByText(/no tasks yet/i)).toBeInTheDocument();
  });

  it('groups tasks by status with section headers', async () => {
    mockList.mockResolvedValue(sampleTasks);
    render(<TaskPanel members={members} />);

    expect(await screen.findByText('Fix bug')).toBeInTheDocument();
    expect(screen.getByText('Deploy')).toBeInTheDocument();
    expect(screen.getByText(/📋 Queued/)).toBeInTheDocument();
    expect(screen.getByText(/⚙️ In Progress/)).toBeInTheDocument();
  });

  it('opens create modal and submits on Enter', async () => {
    mockCreate.mockResolvedValue({ id: 't-new' });
    mockList.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const user = userEvent.setup();
    render(<TaskPanel members={members} />);

    await screen.findByText(/no tasks yet/i);
    await user.click(screen.getByText('+ New Task'));

    const titleInput = screen.getByPlaceholderText('What needs to be done?');
    await user.type(titleInput, 'New task{Enter}');

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
      title: 'New task',
    }));
  });

  it('advances a queued task to in_progress', async () => {
    mockList.mockResolvedValue([sampleTasks[0]]);
    mockUpdate.mockResolvedValue({});

    const user = userEvent.setup();
    render(<TaskPanel members={members} />);

    const startBtn = await screen.findByTitle('Start');
    await user.click(startBtn);

    expect(mockUpdate).toHaveBeenCalledWith('t-1', { status: 'in_progress' });
  });

  it('marks an in-progress task as done', async () => {
    mockList.mockResolvedValue([sampleTasks[1]]);
    mockUpdate.mockResolvedValue({});

    const user = userEvent.setup();
    render(<TaskPanel members={members} />);

    const doneBtn = await screen.findByTitle('Done');
    await user.click(doneBtn);

    expect(mockUpdate).toHaveBeenCalledWith('t-2', { status: 'done' });
  });

  it('reopens a completed task', async () => {
    const doneTask = { id: 't-3', title: 'Old task', status: 'done', priority: 'low', creatorId: 'u-1', assigneeId: null };
    mockList.mockResolvedValue([doneTask]);
    mockUpdate.mockResolvedValue({});

    const user = userEvent.setup();
    render(<TaskPanel members={members} />);

    // Need to switch filter to "Done" to see done tasks (default is "All Active" which hides done)
    const filterSelect = screen.getByDisplayValue('All Active');
    await user.selectOptions(filterSelect, 'done');

    const reopenBtn = await screen.findByTitle('Reopen');
    await user.click(reopenBtn);

    expect(mockUpdate).toHaveBeenCalledWith('t-3', { status: 'queued' });
  });

  it('deletes a task after confirmation', async () => {
    mockList.mockResolvedValue([sampleTasks[0]]);
    mockDelete.mockResolvedValue({ ok: true });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const user = userEvent.setup();
    render(<TaskPanel members={members} />);

    const deleteBtn = await screen.findByTitle('Delete');
    await user.click(deleteBtn);

    expect(window.confirm).toHaveBeenCalledWith('Delete this task?');
    expect(mockDelete).toHaveBeenCalledWith('t-1');

    vi.mocked(window.confirm).mockRestore();
  });

  it('does not delete when confirmation is cancelled', async () => {
    mockList.mockResolvedValue([sampleTasks[0]]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const user = userEvent.setup();
    render(<TaskPanel members={members} />);

    const deleteBtn = await screen.findByTitle('Delete');
    await user.click(deleteBtn);

    expect(mockDelete).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockRestore();
  });

  it('changes filter and re-fetches with status param', async () => {
    mockList.mockResolvedValue([]);

    const user = userEvent.setup();
    render(<TaskPanel members={members} />);

    await screen.findByText(/no tasks yet/i);
    expect(mockList).toHaveBeenCalledWith(undefined);

    const filterSelect = screen.getByDisplayValue('All Active');
    await user.selectOptions(filterSelect, 'in_progress');

    expect(mockList).toHaveBeenCalledWith({ status: 'in_progress' });
  });

  it('displays member names for creator and assignee', async () => {
    mockList.mockResolvedValue([sampleTasks[1]]);
    render(<TaskPanel members={members} />);

    expect(await screen.findByText(/by Alice/)).toBeInTheDocument();
    expect(screen.getByText(/assigned: Bot/)).toBeInTheDocument();
  });
});
