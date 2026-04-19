import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from 'vitest';
import { render, screen, cleanup, waitFor } from '../test-utils';
import userEvent from '@testing-library/user-event';
import { CreateChannelModal } from './CreateChannelModal';
import { HelpModal } from './HelpModal';
import { InviteMemberModal } from './InviteMemberModal';
import { NewHuddleModal } from './NewHuddleModal';
import { HuddleModal } from './HuddleModal';
import { Modal } from './Modal';

afterEach(() => cleanup());

const mockCreateChannel = vi.fn();
const mockInviteMember = vi.fn();
const mockCreateHuddle = vi.fn();
const mockGetHuddle = vi.fn();
const mockJoinHuddle = vi.fn();
const mockSpeak = vi.fn();
const mockEndHuddle = vi.fn();
const mockGetMessages = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  // Default: getHuddle returns minimal data, joinHuddle resolves
  mockGetHuddle.mockResolvedValue({ participants: [], status: 'active' });
  mockJoinHuddle.mockResolvedValue({});
  mockGetMessages.mockResolvedValue([]);
});

vi.mock('../lib/api', () => ({
  api: {
    createChannel: (...args: any[]) => mockCreateChannel(...args),
    inviteMember: (...args: any[]) => mockInviteMember(...args),
    createHuddle: (...args: any[]) => mockCreateHuddle(...args),
    getHuddle: (...args: any[]) => mockGetHuddle(...args),
    joinHuddle: (...args: any[]) => mockJoinHuddle(...args),
    speak: (...args: any[]) => mockSpeak(...args),
    endHuddle: (...args: any[]) => mockEndHuddle(...args),
    getMessages: (...args: any[]) => mockGetMessages(...args),
  },
}));

describe('Modal', () => {
  it('renders an accessible dialog with its title and children', () => {
    render(<Modal title="Test Modal" onClose={vi.fn()}>Content here</Modal>);

    expect(screen.getByRole('dialog', { name: 'Test Modal' })).toBeInTheDocument();
    expect(screen.getByText('Content here')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close modal' })).toBeInTheDocument();
  });

  it('calls onClose when the overlay is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<Modal title="Test" onClose={onClose}>Body</Modal>);
    await user.click(screen.getByTestId('modal-overlay'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open when the dialog body is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<Modal title="Test" onClose={onClose}>Body</Modal>);
    await user.click(screen.getByRole('dialog', { name: 'Test' }));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<Modal title="Test" onClose={onClose}>Body</Modal>);
    await user.click(screen.getByRole('button', { name: 'Close modal' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('HelpModal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders an About dialog with core content', () => {
    render(<HelpModal onClose={vi.fn()} />);

    expect(screen.getByRole('dialog', { name: 'About Blather' })).toBeInTheDocument();
    expect(screen.getByText('Blather')).toBeInTheDocument();
    expect(screen.getByText(/Headless-first messaging platform/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'github.com/pebblebots/blather' })).toHaveAttribute(
      'href',
      'https://github.com/pebblebots/blather',
    );
    expect(screen.getByRole('link', { name: 'Pebblebed' })).toHaveAttribute(
      'href',
      'https://pebblebed.com',
    );
  });

  it('shows plain text commit hash when full hash is unavailable', () => {
    render(<HelpModal onClose={vi.fn()} />);

    // With no globals defined, falls back to "dev" with no link
    expect(screen.getByText(/Commit/)).toHaveTextContent('Commit dev');
    const commitLinks = screen.queryAllByRole('link').filter(
      (a) => (a as HTMLAnchorElement).href.includes('github.com/pebblebots/blather/commit'),
    );
    expect(commitLinks).toHaveLength(0);
  });

  it('links the commit hash to GitHub when full hash is available', () => {
    vi.stubGlobal('__GIT_HASH__', 'abc1234');
    vi.stubGlobal('__GIT_HASH_FULL__', 'abc1234567890def');
    vi.stubGlobal('__GIT_DATE__', '2026-03-28 12:00:00');

    render(<HelpModal onClose={vi.fn()} />);

    const commitLink = screen.getByRole('link', { name: 'abc1234' });
    expect(commitLink).toHaveAttribute(
      'href',
      'https://github.com/pebblebots/blather/commit/abc1234567890def',
    );
    expect(screen.getByText(/Commit/)).toHaveTextContent('Commit abc1234 — 2026-03-28');
  });

  it('displays the current year in the copyright', () => {
    render(<HelpModal onClose={vi.fn()} />);

    const year = new Date().getFullYear().toString();
    expect(screen.getByText(new RegExp(`© ${year}`))).toBeInTheDocument();
  });
});

describe('CreateChannelModal', () => {
  it('renders labeled form fields and action buttons', () => {
    render(<CreateChannelModal onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByLabelText('Name:')).toBeInTheDocument();
    expect(screen.getByLabelText('Private:')).toBeInTheDocument();
    expect(screen.getByLabelText('Topic:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('shows a validation error and skips the API call when the name is blank after trimming', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<CreateChannelModal onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Name:'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Channel name is required');
    expect(mockCreateChannel).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('normalizes the payload before submitting and closes on success', async () => {
    mockCreateChannel.mockResolvedValue({ id: 'ch-new', name: 'Project Alpha' });
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<CreateChannelModal onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Name:'), '  Project Alpha  ');
    await user.click(screen.getByLabelText('Private:'));
    await user.type(screen.getByLabelText('Topic:'), '  Launch plans  ');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(mockCreateChannel).toHaveBeenCalledWith({
        name: 'Project Alpha',
        slug: 'project-alpha',
        topic: 'Launch plans',
        channelType: 'private',
      });
    });
    expect(onCreated).toHaveBeenCalledWith({ id: 'ch-new', name: 'Project Alpha' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows a validation error when the name cannot produce a usable slug', async () => {
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<CreateChannelModal onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Name:'), '!!!');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Channel name must include letters or numbers');
    expect(mockCreateChannel).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows the API error and stays open when channel creation fails', async () => {
    mockCreateChannel.mockRejectedValue(new Error('Channel slug already exists'));
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<CreateChannelModal onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Name:'), 'Roadmap');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Channel slug already exists');
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on cancel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<CreateChannelModal onClose={onClose} onCreated={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('InviteMemberModal', () => {
  const members = [
    { id: 'u-1', displayName: 'Alice' },
    { id: 'u-2', displayName: 'Bob' },
  ];

  it('renders member select and action buttons', () => {
    render(<InviteMemberModal channelId="ch-1" members={members} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Select a user to invite:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled();
  });

  it('enables invite after selecting a member', async () => {
    const user = userEvent.setup();
    render(<InviteMemberModal channelId="ch-1" members={members} onClose={vi.fn()} />);

    await user.selectOptions(screen.getByRole('combobox'), 'u-2');

    expect(screen.getByRole('button', { name: 'Invite' })).toBeEnabled();
  });

  it('invites the selected member and closes on success', async () => {
    mockInviteMember.mockResolvedValue(undefined);
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<InviteMemberModal channelId="ch-1" members={members} onClose={onClose} />);

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

    render(<InviteMemberModal channelId="ch-1" members={members} onClose={onClose} />);

    await user.selectOptions(screen.getByRole('combobox'), 'u-2');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Already invited');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('calls onClose on cancel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<InviteMemberModal channelId="ch-1" members={members} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });
});

describe('NewHuddleModal', () => {
  const members = [
    { id: 'u-1', displayName: 'Alice', isAgent: false },
    { id: 'u-2', displayName: 'AgentBot', isAgent: true },
    { id: 'u-3', displayName: 'AgentTwo', isAgent: true },
    { id: 'u-4', displayName: 'AgentTri', isAgent: true },
    { id: 'u-5', displayName: 'AgentQuad', isAgent: true },
  ];

  it('renders labeled topic input and only agent checkboxes', () => {
    render(<NewHuddleModal members={members} onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByLabelText('Topic:')).toBeInTheDocument();
    expect(screen.getByText('AgentBot')).toBeInTheDocument();
    expect(screen.getByText('AgentTwo')).toBeInTheDocument();
    // Human users should not appear as agent checkboxes
    expect(screen.queryByText('Alice')).toBeNull();
  });

  it('submit button is disabled without topic or agents selected', () => {
    render(<NewHuddleModal members={members} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Start Huddle' })).toBeDisabled();
  });

  it('calls onClose on cancel', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<NewHuddleModal members={members} onClose={onClose} onCreated={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('submits the trimmed topic and selected agents, then closes on success', async () => {
    const huddle = { id: 'h-1', topic: 'AI Ethics' };
    mockCreateHuddle.mockResolvedValue(huddle);
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<NewHuddleModal members={members} onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Topic:'), '  AI Ethics  ');
    await user.click(screen.getByText('AgentBot'));
    await user.click(screen.getByText('AgentTwo'));
    await user.click(screen.getByRole('button', { name: 'Start Huddle' }));

    await waitFor(() => {
      expect(mockCreateHuddle).toHaveBeenCalledWith({
        topic: 'AI Ethics',
        agentIds: ['u-2', 'u-3'],
      });
    });
    expect(onCreated).toHaveBeenCalledWith(huddle);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the API error and stays open when creation fails', async () => {
    mockCreateHuddle.mockRejectedValue(new Error('Maximum 3 agents per huddle'));
    const onCreated = vi.fn();
    const onClose = vi.fn();
    const user = userEvent.setup();

    render(<NewHuddleModal members={members} onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByLabelText('Topic:'), 'Test huddle');
    await user.click(screen.getByText('AgentBot'));
    await user.click(screen.getByRole('button', { name: 'Start Huddle' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Maximum 3 agents per huddle');
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('caps agent selection at 3 — fourth checkbox is disabled', async () => {
    const user = userEvent.setup();

    render(<NewHuddleModal members={members} onClose={vi.fn()} onCreated={vi.fn()} />);

    await user.click(screen.getByText('AgentBot'));
    await user.click(screen.getByText('AgentTwo'));
    await user.click(screen.getByText('AgentTri'));

    // The fourth agent checkbox should be disabled
    const quadCheckbox = screen.getByText('AgentQuad').parentElement!.querySelector('input')!;
    expect(quadCheckbox).toBeDisabled();
  });

  it('allows deselecting an agent to free a slot', async () => {
    const user = userEvent.setup();

    render(<NewHuddleModal members={members} onClose={vi.fn()} onCreated={vi.fn()} />);

    // Select 3
    await user.click(screen.getByText('AgentBot'));
    await user.click(screen.getByText('AgentTwo'));
    await user.click(screen.getByText('AgentTri'));

    // Deselect one
    await user.click(screen.getByText('AgentBot'));

    // Fourth should now be enabled
    const quadCheckbox = screen.getByText('AgentQuad').parentElement!.querySelector('input')!;
    expect(quadCheckbox).not.toBeDisabled();
  });
});

describe('HuddleModal', () => {
  // jsdom has no Audio or AudioContext, so stub them
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal('AudioContext', vi.fn(() => ({
      resume: () => Promise.resolve(),
      close: vi.fn(),
    })));
    vi.stubGlobal('Audio', vi.fn(() => ({
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      src: '',
      onended: null,
      onerror: null,
    })));
  });

  const defaultUsersMap = new Map([
    ['u-creator', { displayName: 'Alice', isAgent: false }],
    ['u-agent-1', { displayName: 'BotOne', isAgent: true }],
    ['u-agent-2', { displayName: 'BotTwo', isAgent: true }],
  ]);

  const renderHuddle = (overrides: Partial<Parameters<typeof HuddleModal>[0]> = {}) =>
    render(
      <HuddleModal
        huddleId="h-1"
        topic="AI Ethics"
        createdBy="u-creator"
        currentUserId="u-creator"
        usersMap={defaultUsersMap}
        onClose={vi.fn()}
        onEnded={vi.fn()}
        huddleEvents={[]}
        {...overrides}
      />
    );

  it('renders the topic in the title bar', () => {
    renderHuddle();
    expect(screen.getByText(/AI Ethics/)).toBeInTheDocument();
  });

  it('renders the elapsed timer starting at 00:00', () => {
    renderHuddle();
    expect(screen.getByText(/00:00/)).toBeInTheDocument();
  });

  it('shows the empty-state placeholder when no transcript entries exist', () => {
    renderHuddle();
    expect(screen.getByText('Waiting for agents to speak...')).toBeInTheDocument();
  });

  it('fetches huddle details and joins on mount', async () => {
    renderHuddle();
    await waitFor(() => {
      expect(mockGetHuddle).toHaveBeenCalledWith('h-1');
      expect(mockJoinHuddle).toHaveBeenCalledWith('h-1');
    });
  });

  it('displays agent participants returned by the API', async () => {
    mockGetHuddle.mockResolvedValue({
      participants: [
        { id: 'p-1', userId: 'u-agent-1', role: 'agent' },
        { id: 'p-2', userId: 'u-agent-2', role: 'agent' },
      ],
      status: 'active',
    });
    renderHuddle();
    // Agent names appear as participant avatars
    expect(await screen.findByText('BotOne')).toBeInTheDocument();
    expect(screen.getByText('BotTwo')).toBeInTheDocument();
  });

  it('loads message history when the huddle has a channel', async () => {
    mockGetHuddle.mockResolvedValue({
      participants: [],
      status: 'active',
      channel: { id: 'ch-huddle' },
    });
    mockGetMessages.mockResolvedValue([
      { id: 'm-2', userId: 'u-agent-1', content: 'Second message', createdAt: '2026-01-01T00:01:00Z' },
      { id: 'm-1', userId: 'u-agent-2', content: 'First message', createdAt: '2026-01-01T00:00:00Z' },
    ]);

    renderHuddle();

    // Messages should appear in chronological order (reversed from API newest-first)
    expect(await screen.findByText('First message')).toBeInTheDocument();
    expect(screen.getByText('Second message')).toBeInTheDocument();
    expect(mockGetMessages).toHaveBeenCalledWith('ch-huddle', 100);
  });

  it('adds transcript entries from huddle.audio events', async () => {
    const events = [
      { type: 'huddle.audio', huddleId: 'h-1', messageId: 'ev-1', userId: 'u-agent-1', content: 'Hello world' },
    ];
    const { rerender } = renderHuddle({ huddleEvents: [] });

    // Simulate new event arriving
    rerender(
      <HuddleModal
        huddleId="h-1"
        topic="AI Ethics"
        createdBy="u-creator"
        currentUserId="u-creator"
        usersMap={defaultUsersMap}
        onClose={vi.fn()}
        onEnded={vi.fn()}
        huddleEvents={events}
      />
    );

    expect(await screen.findByText('Hello world')).toBeInTheDocument();
  });

  it('calls onEnded when a huddle.ended event arrives', async () => {
    const onEnded = vi.fn();
    const { rerender } = renderHuddle({ huddleEvents: [], onEnded });

    rerender(
      <HuddleModal
        huddleId="h-1"
        topic="AI Ethics"
        createdBy="u-creator"
        currentUserId="u-creator"
        usersMap={defaultUsersMap}
        onClose={vi.fn()}
        onEnded={onEnded}
        huddleEvents={[{ type: 'huddle.ended', huddleId: 'h-1' }]}
      />
    );

    await waitFor(() => expect(onEnded).toHaveBeenCalledTimes(1));
  });

  it('submits input via api.speak and clears the field', async () => {
    mockSpeak.mockResolvedValue({});
    const user = userEvent.setup();
    renderHuddle();

    const input = screen.getByPlaceholderText('Say something...');
    await user.type(input, 'My opinion');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(mockSpeak).toHaveBeenCalledWith('h-1', 'My opinion');
    });
    expect(input).toHaveValue('');
  });

  it('does not submit when input is blank', async () => {
    const user = userEvent.setup();
    renderHuddle();

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    // Type spaces only
    await user.type(screen.getByPlaceholderText('Say something...'), '   ');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(mockSpeak).not.toHaveBeenCalled();
  });

  it('shows the End button only for the huddle creator', () => {
    renderHuddle({ currentUserId: 'u-creator' });
    expect(screen.getByRole('button', { name: 'End' })).toBeInTheDocument();

    cleanup();

    renderHuddle({ currentUserId: 'u-other' });
    expect(screen.queryByRole('button', { name: 'End' })).toBeNull();
  });

  it('calls api.endHuddle and onEnded when End is confirmed', async () => {
    mockEndHuddle.mockResolvedValue({});
    const onEnded = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();

    renderHuddle({ onEnded });
    await user.click(screen.getByRole('button', { name: 'End' }));

    await waitFor(() => {
      expect(mockEndHuddle).toHaveBeenCalledWith('h-1');
      expect(onEnded).toHaveBeenCalledTimes(1);
    });
    vi.restoreAllMocks();
  });

  it('does not end the huddle when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const user = userEvent.setup();

    renderHuddle();
    await user.click(screen.getByRole('button', { name: 'End' }));

    expect(mockEndHuddle).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('calls onClose when the overlay is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    const { container } = renderHuddle({ onClose });

    // Click the overlay (first child = the fixed backdrop)
    await user.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('disables input and send when the huddle has ended', async () => {
    mockGetHuddle.mockResolvedValue({ participants: [], status: 'ended' });
    renderHuddle();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Say something...')).toBeDisabled();
    });
  });

  it('ignores events for a different huddleId', async () => {
    const onEnded = vi.fn();
    const { rerender } = renderHuddle({ huddleEvents: [], onEnded });

    rerender(
      <HuddleModal
        huddleId="h-1"
        topic="AI Ethics"
        createdBy="u-creator"
        currentUserId="u-creator"
        usersMap={defaultUsersMap}
        onClose={vi.fn()}
        onEnded={onEnded}
        huddleEvents={[{ type: 'huddle.ended', huddleId: 'h-OTHER' }]}
      />
    );

    // Give effects a tick to run
    await waitFor(() => {});
    expect(onEnded).not.toHaveBeenCalled();
  });
});
