import { events } from '@blather/db';
import type { Db } from '@blather/db';
import type { EventType } from '@blather/types';
import { publishEvent } from './manager.js';

export async function emitEvent(
  db: Db,
  params: {
    channelId?: string | null;
    userId: string;
    type: EventType;
    payload: Record<string, unknown>;
  }
) {
  const { channelId, userId, type, payload } = params;
  const normalizedChannelId = channelId ?? null;

  const [eventRecord] = await db.insert(events).values({
    channelId: normalizedChannelId,
    userId,
    type,
    payload,
  }).returning();

  const publishedEvent = {
    id: eventRecord.id,
    type,
    channel_id: normalizedChannelId,
    data: payload,
    timestamp: eventRecord.createdAt.toISOString(),
  };

  await publishEvent(publishedEvent);

  return eventRecord;
}
