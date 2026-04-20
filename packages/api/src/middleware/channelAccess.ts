import { and, eq } from "drizzle-orm";
import { channelMembers } from "@blather/db";

/**
 * Check whether a user is a member of a given channel.
 *
 * Membership is the universal ACL: public, private, and DM channels all
 * require a row in `channel_members` for any write operation or receipt of
 * channel-scoped WebSocket events. See T#151 for the cost-control rationale.
 */
export async function requireChannelMembership(
  db: any,
  userId: string,
  channelId: string,
): Promise<boolean> {
  const [m] = await db
    .select()
    .from(channelMembers)
    .where(and(eq(channelMembers.channelId, channelId), eq(channelMembers.userId, userId)))
    .limit(1);
  return !!m;
}
