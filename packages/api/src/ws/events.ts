import { events } from '@blather/db';
import type { Db } from '@blather/db';
import type { EventType } from '@blather/types';
import { publishEvent } from './manager.js';

export async function emitEvent(
  db: Db,
  params: {
    workspaceId: string;
    channelId?: string | null;
    userId: string;
    type: EventType;
    payload: Record<string, unknown>;
  }
) {
  const [evt] = await db.insert(events).values({
    workspaceId: params.workspaceId,
    channelId: params.channelId ?? null,
    userId: params.userId,
    type: params.type,
    payload: params.payload,
  }).returning();

  publishEvent(params.workspaceId, {
    id: evt.id,
    type: params.type,
    workspace_id: params.workspaceId,
    channel_id: params.channelId ?? null,
    data: params.payload,
    timestamp: evt.createdAt.toISOString(),
  });

  return evt;
}
