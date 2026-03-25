import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./manager.js', () => ({
  publishEvent: vi.fn(async () => {}),
}));

import { emitEvent } from './events.js';
import { publishEvent } from './manager.js';

const mockedPublishEvent = vi.mocked(publishEvent);

function makeMockDb(returnedEvent: Record<string, unknown>) {
  const chain: any = {};
  chain.values = () => chain;
  chain.returning = () => Promise.resolve([returnedEvent]);
  return {
    insert: () => chain,
  } as any;
}

describe('emitEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts event into DB and calls publishEvent with correct shape', async () => {
    const fakeEvent = {
      id: 'evt-1',
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      userId: 'u-1',
      type: 'message.created',
      payload: { text: 'hello' },
      createdAt: new Date('2026-03-24T12:00:00Z'),
    };
    const db = makeMockDb(fakeEvent);

    const result = await emitEvent(db, {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      userId: 'u-1',
      type: 'message.created',
      payload: { text: 'hello' },
    });

    expect(result).toEqual(fakeEvent);
    expect(mockedPublishEvent).toHaveBeenCalledOnce();
    expect(mockedPublishEvent).toHaveBeenCalledWith('ws-1', {
      id: 'evt-1',
      type: 'message.created',
      workspace_id: 'ws-1',
      channel_id: 'ch-1',
      data: { text: 'hello' },
      timestamp: '2026-03-24T12:00:00.000Z',
    });
  });

  it('handles null channelId', async () => {
    const fakeEvent = {
      id: 'evt-2',
      workspaceId: 'ws-1',
      channelId: null,
      userId: 'u-1',
      type: 'presence.changed',
      payload: { status: 'online' },
      createdAt: new Date('2026-03-24T12:00:00Z'),
    };
    const db = makeMockDb(fakeEvent);

    await emitEvent(db, {
      workspaceId: 'ws-1',
      userId: 'u-1',
      type: 'presence.changed',
      payload: { status: 'online' },
    });

    expect(mockedPublishEvent).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      channel_id: null,
    }));
  });

  it('handles undefined channelId (defaults to null)', async () => {
    const fakeEvent = {
      id: 'evt-3',
      workspaceId: 'ws-1',
      channelId: null,
      userId: 'u-1',
      type: 'member.joined',
      payload: {},
      createdAt: new Date('2026-03-24T12:00:00Z'),
    };
    const db = makeMockDb(fakeEvent);

    await emitEvent(db, {
      workspaceId: 'ws-1',
      channelId: undefined,
      userId: 'u-1',
      type: 'member.joined',
      payload: {},
    });

    expect(mockedPublishEvent).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      channel_id: null,
    }));
  });

  it('returns the inserted event record', async () => {
    const fakeEvent = {
      id: 'evt-4',
      workspaceId: 'ws-1',
      channelId: 'ch-2',
      userId: 'u-2',
      type: 'reaction.added',
      payload: { emoji: '👍' },
      createdAt: new Date('2026-03-24T13:00:00Z'),
    };
    const db = makeMockDb(fakeEvent);

    const result = await emitEvent(db, {
      workspaceId: 'ws-1',
      channelId: 'ch-2',
      userId: 'u-2',
      type: 'reaction.added',
      payload: { emoji: '👍' },
    });

    expect(result.id).toBe('evt-4');
    expect(result.createdAt).toBeInstanceOf(Date);
  });
});
