import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@blather/db';

vi.mock('./manager.js', () => ({
  publishEvent: vi.fn(async () => {}),
}));

import { emitEvent } from './events.js';
import { publishEvent } from './manager.js';

type StoredEvent = {
  id: string;
  workspaceId: string;
  channelId: string | null;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: Date;
};

type InsertedEventValues = {
  workspaceId: string;
  channelId: string | null;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
};

function makeStoredEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 'evt-1',
    workspaceId: 'ws-1',
    channelId: 'ch-1',
    userId: 'u-1',
    type: 'message.created',
    payload: { text: 'hello' },
    createdAt: new Date('2026-03-24T12:00:00Z'),
    ...overrides,
  };
}

function createDbMock(returnedEvent: StoredEvent) {
  let insertedValues: InsertedEventValues | undefined;

  const returning = vi.fn().mockResolvedValue([returnedEvent]);
  const values = vi.fn().mockImplementation((v: InsertedEventValues) => {
    insertedValues = v;
    return { returning };
  });
  const insert = vi.fn().mockReturnValue({ values });

  return {
    db: { insert } as unknown as Db,
    getInsertedValues: () => insertedValues,
  };
}

const mockedPublishEvent = vi.mocked(publishEvent);

describe('emitEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores an event and publishes the persisted event payload', async () => {
    const storedEvent = makeStoredEvent();
    const db = createDbMock(storedEvent);

    const result = await emitEvent(db.db, {
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      userId: 'u-1',
      type: 'message.created',
      payload: { text: 'hello' },
    });

    expect(result).toEqual(storedEvent);
    expect(db.getInsertedValues()).toEqual({
      workspaceId: 'ws-1',
      channelId: 'ch-1',
      userId: 'u-1',
      type: 'message.created',
      payload: { text: 'hello' },
    });
    expect(mockedPublishEvent).toHaveBeenCalledWith('ws-1', {
      id: 'evt-1',
      type: 'message.created',
      workspace_id: 'ws-1',
      channel_id: 'ch-1',
      data: { text: 'hello' },
      timestamp: '2026-03-24T12:00:00.000Z',
    });
  });

  it.each([null, undefined])(
    'normalizes channelId=%s to null for storage and publishing',
    async (channelId) => {
      const storedEvent = makeStoredEvent({
        id: 'evt-2',
        channelId: null,
        type: 'presence.changed',
        payload: { status: 'online' },
      });
      const db = createDbMock(storedEvent);

      await emitEvent(db.db, {
        workspaceId: 'ws-1',
        channelId,
        userId: 'u-1',
        type: 'presence.changed',
        payload: { status: 'online' },
      });

      expect(db.getInsertedValues()).toMatchObject({ channelId: null });
      expect(mockedPublishEvent).toHaveBeenCalledWith(
        'ws-1',
        expect.objectContaining({ channel_id: null })
      );
    }
  );
});
