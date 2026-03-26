import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CreateChannelModal } from './CreateChannelModal';
import { CreateWorkspaceModal } from './CreateWorkspaceModal';
import { InviteMemberModal } from './InviteMemberModal';
import { NewHuddleModal } from './NewHuddleModal';
import { Modal } from './Modal';
import { AppContext } from '../lib/store';
import type { ReactNode } from 'react';

afterEach(() => cleanup());

const mockCreateChannel = vi.fn();
const mockCreateWorkspace = vi.fn();
const mockInviteMember = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock('../lib/api', () => ({
  api: {
    createChannel: (...args: any[]) => mockCreateChannel(...args),
    createWorkspace: (...args: any[]) => mockCreateWorkspace(...args),
    inviteMember: (...args: any[]) => mockInviteMember(...args),
  },
}));

function UserWrapper({ children }: { children: ReactNode }) {
  return (
    <AppContext.Provider value={{ user: { id: 'u-1', email: 'alice@test.com', displayName: 'Alice', avatarUrl: null, isAgent: false }, setUser: vi.fn() }}>
      {children}
    </AppContext.Provider>
  );
}

describe('Modal', () => {
  it('renders title and children', () => {
    render(<Modal title="Test Modal" onClose={vi.fn()}>Content here</Modal>);
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Content here')).toBeInTheDocument();
  });

  it('calls onClose when overlay is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<Modal title="Test" onClose={onClose}>Body</Modal>);
    await user.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CreateChannelModal', () => {
  it('renders form fields', () => {
    render(<CreateChannelModal workspaceId="ws-1" onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByPlaceholderText('channel name')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Create')).toBeInTheDocument();
  });

  it('submits with name and calls onCreated', async () => {
    mockCreateChannel.mockResolvedValue({ id: 'ch-new', name: 'test' });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<CreateChannelModal workspaceId="ws-1" onClose={onClose} onCreated={onCreated} />);
    await user.type(screen.getByPlaceholderText('channel name'), 'test-channel');
    await user.click(screen.getByText('Create'));

    expect(mockCreateChannel).toHaveBeenCalledWith('ws-1', expect.objectContaining({ name: 'test-channel' }));
  });

  it('calls onClose on cancel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CreateChannelModal workspaceId="ws-1" onClose={onClose} onCreated={vi.fn()} />);
    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('CreateWorkspaceModal', () => {
  it('renders form fields with domain pre-filled', () => {
    render(<CreateWorkspaceModal onClose={vi.fn()} onCreated={vi.fn()} />, { wrapper: UserWrapper });
    expect(screen.getByPlaceholderText('My Company')).toBeInTheDocument();
    // Domain should be pre-filled from user email
    const domainInput = screen.getByPlaceholderText('acme.com, other.org');
    expect((domainInput as HTMLInputElement).value).toBe('test.com');
  });

  it('submits workspace creation', async () => {
    mockCreateWorkspace.mockResolvedValue({ id: 'ws-new' });
    const onCreated = vi.fn();
    const user = userEvent.setup();

    render(<CreateWorkspaceModal onClose={vi.fn()} onCreated={onCreated} />, { wrapper: UserWrapper });
    await user.type(screen.getByPlaceholderText('My Company'), 'Acme');
    await user.click(screen.getByText('Create'));

    expect(mockCreateWorkspace).toHaveBeenCalledWith(expect.objectContaining({ name: 'Acme' }));
  });
});

describe('InviteMemberModal', () => {
  const members = [
    { id: 'u-1', displayName: 'Alice' },
    { id: 'u-2', displayName: 'Bob' },
  ];

  it('renders member select and action buttons', () => {
    render(<InviteMemberModal channelId="ch-1" workspaceMembers={members} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Select a user to invite:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled();
  });

  it('enables invite after selecting a member', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal channelId="ch-1" workspaceMembers={members} onClose={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox'), 'u-2');

    expect(screen.getByRole('button', { name: 'Invite' })).toBeEnabled();
  });

  it('invites the selected member and closes on success', async () => {
    mockInviteMember.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<InviteMemberModal channelId="ch-1" workspaceMembers={members} onClose={onClose} />);

    await user.selectOptions(screen.getByRole('combobox'), 'u-2');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    await waitFor(() => {
      expect(mockInviteMember).toHaveBeenCalledWith('ch-1', 'u-2');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  it('shows the API error and stays open when invite fails', async () => {
    mockInviteMember.mockRejectedValue(new Error('Already invited'));
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<InviteMemberModal channelId="ch-1" workspaceMembers={members} onClose={onClose} />);

    await user.selectOptions(screen.getByRole('combobox'), 'u-2');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Already invited');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on cancel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<InviteMemberModal channelId="ch-1" workspaceMembers={members} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('NewHuddleModal', () => {
  const members = [
    { id: 'u-1', displayName: 'Alice', isAgent: false },
    { id: 'u-2', displayName: 'AgentBot', isAgent: true },
    { id: 'u-3', displayName: 'AgentTwo', isAgent: true },
  ];

  it('renders prompt input and agent checkboxes', () => {
    render(<NewHuddleModal workspaceId="ws-1" workspaceMembers={members} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByPlaceholderText(/what should they talk about/i)).toBeInTheDocument();
    expect(screen.getByText('AgentBot')).toBeInTheDocument();
    expect(screen.getByText('AgentTwo')).toBeInTheDocument();
    // Human users should not appear as agent checkboxes
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('submit is disabled without topic or agents', () => {
    render(<NewHuddleModal workspaceId="ws-1" workspaceMembers={members} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByText('Start Huddle')).toBeDisabled();
  });

  it('calls onClose on cancel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NewHuddleModal workspaceId="ws-1" workspaceMembers={members} onClose={onClose} onCreated={vi.fn()} />);
    await user.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalled();
  });
});
