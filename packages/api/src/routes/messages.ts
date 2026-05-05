import { Hono } from "hono";
import { eq, and, ilike, gt, lt, sql, inArray, type SQL } from "drizzle-orm";
import { messages, channels, channelMembers, users } from "@blather/db";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";

export const messageRoutes = new Hono<Env>();
messageRoutes.use("*", authMiddleware);

// T#161: block writes for guests. Currently /messages has no POST routes,
// but guard the Hono group so any future POST/PATCH/DELETE inherits the
// 403 without silently allowing writes.
messageRoutes.use("*", async (c, next) => {
  if (c.get("role") === "guest" && c.req.method !== "GET") {
    return c.json({ error: "Guests cannot perform this action. Sign in to continue." }, 403);
  }
  return next();
});

// GET /messages/search
messageRoutes.get("/search", async (c) => {
  const db = c.get("db");
  const userId = c.get("userId");

  const q = c.req.query("q");
  if (!q) {
    return c.json({ error: "q is required" }, 400);
  }

  const channelId = c.req.query("channelId");
  const filterUserId = c.req.query("userId");
  const before = c.req.query("before");
  const after = c.req.query("after");
  const limit = Math.min(parseInt(c.req.query("limit") || "20", 10), 50);

  // Get channels the user can access:
  // All public channels + private/dm channels the user is a member of.
  // T#161: guests see public-only.
  const allChannels = await db
    .select({ id: channels.id, channelType: channels.channelType })
    .from(channels);

  const publicChannelIds = allChannels
    .filter((ch) => ch.channelType === "public")
    .map((ch) => ch.id);

  const isGuest = c.get("role") === "guest";

  let accessibleChannelIds: string[];
  if (isGuest) {
    accessibleChannelIds = publicChannelIds;
  } else {
    const privateMemberships = await db
      .select({ channelId: channelMembers.channelId })
      .from(channelMembers)
      .where(eq(channelMembers.userId, userId));

    const privateMemberChannelIds = privateMemberships.map((m) => m.channelId);

    const privateAccessibleIds = allChannels
      .filter(
        (ch) =>
          (ch.channelType === "private" || ch.channelType === "dm") &&
          privateMemberChannelIds.includes(ch.id)
      )
      .map((ch) => ch.id);

    accessibleChannelIds = [...publicChannelIds, ...privateAccessibleIds];
  }

  if (accessibleChannelIds.length === 0) {
    return c.json([]);
  }

  // If channelId filter specified, verify access
  if (channelId && !accessibleChannelIds.includes(channelId)) {
    return c.json({ error: "Channel not accessible" }, 403);
  }

  const searchChannelIds = channelId ? [channelId] : accessibleChannelIds;

  // Build conditions
  const conditions: SQL[] = [
    inArray(messages.channelId, searchChannelIds),
    ilike(messages.content, `%${q}%`),
  ];

  if (filterUserId) conditions.push(eq(messages.userId, filterUserId));
  if (before) conditions.push(lt(messages.createdAt, new Date(before)));
  if (after) conditions.push(gt(messages.createdAt, new Date(after)));

  const results = await db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      userId: messages.userId,
      content: messages.content,
      threadId: messages.threadId,
      createdAt: messages.createdAt,
      updatedAt: messages.updatedAt,
      userName: users.displayName,
      userIsAgent: users.isAgent,
      channelName: channels.name,
      channelSlug: channels.slug,
      channelType: channels.channelType,
    })
    .from(messages)
    .innerJoin(users, eq(messages.userId, users.id))
    .innerJoin(channels, eq(messages.channelId, channels.id))
    .where(and(...conditions))
    .orderBy(sql`${messages.createdAt} DESC`)
    .limit(limit);

  return c.json(results);
});
