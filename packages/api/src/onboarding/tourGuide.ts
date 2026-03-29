import { eq, and } from 'drizzle-orm';
import { users, channels, channelMembers, messages, workspaceMembers } from '@blather/db';
import type { Db } from '@blather/db';
import { publishEvent } from '../ws/manager.js';

const TOUR_GUIDE_EMAIL = 'tourguide@system.blather';

/**
 * Ensure the Tour Guide system user exists, creating it if needed.
 * Returns the Tour Guide user record.
 */
export async function ensureTourGuideUser(db: Db) {
  const [existing] = await db.select().from(users)
    .where(eq(users.email, TOUR_GUIDE_EMAIL))
    .limit(1);

  if (existing) return existing;

  const [created] = await db.insert(users).values({
    email: TOUR_GUIDE_EMAIL,
    displayName: 'Tour Guide',
    isAgent: true,
  }).onConflictDoNothing().returning();

  // If onConflictDoNothing returned nothing, another concurrent insert won the race
  if (!created) {
    const [raced] = await db.select().from(users)
      .where(eq(users.email, TOUR_GUIDE_EMAIL))
      .limit(1);
    return raced!;
  }

  return created;
}

/**
 * Build the welcome message for a workspace.
 */
export function buildWelcomeMessage(workspaceName: string): string {
  return `Hey! 👋 Welcome to ${workspaceName}! I'm the Tour Guide — here to help you get oriented.

A few things to know:
• **#intros** is where people introduce themselves — drop in and say hi!
• Channels are in the sidebar — browse around
• You can DM anyone directly

Have fun! 🎉`;
}

/**
 * Send a Tour Guide welcome DM to a new human user who just joined a workspace.
 * Skips agent users. Creates the DM channel and sends the welcome message.
 */
export async function sendTourGuideWelcome(
  db: Db,
  userId: string,
  workspaceId: string,
  workspaceName: string,
  isAgent: boolean,
) {
  // Only DM humans
  if (isAgent) return;

  const tourGuide = await ensureTourGuideUser(db);

  // Ensure Tour Guide is a workspace member (needed for DM to work)
  const [existingWsMember] = await db.select().from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, tourGuide.id),
    )).limit(1);

  if (!existingWsMember) {
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: tourGuide.id,
      role: 'member',
    });
  }

  // Create DM channel between Tour Guide and the new user
  const userIds = [tourGuide.id, userId].sort();
  const dmSlug = `dm-${userIds.join('-')}`;

  // Check for existing DM
  const [existingDm] = await db.select().from(channels)
    .where(and(
      eq(channels.workspaceId, workspaceId),
      eq(channels.slug, dmSlug),
      eq(channels.channelType, 'dm'),
    ))
    .limit(1);

  let dmChannel;
  if (existingDm) {
    dmChannel = existingDm;
  } else {
    [dmChannel] = await db.insert(channels).values({
      workspaceId,
      name: '',
      slug: dmSlug,
      channelType: 'dm',
      isDefault: false,
      topic: null,
      createdBy: tourGuide.id,
    }).returning();

    // Add both users to the channel
    await db.insert(channelMembers).values([
      { channelId: dmChannel.id, userId: tourGuide.id },
      { channelId: dmChannel.id, userId },
    ]);

    // Emit channel.created
    await publishEvent(workspaceId, {
      type: 'channel.created',
      workspace_id: workspaceId,
      channel_id: dmChannel.id,
      data: {
        id: dmChannel.id,
        workspaceId,
        name: dmChannel.name,
        slug: dmChannel.slug,
        channelType: dmChannel.channelType,
        isDefault: dmChannel.isDefault,
        topic: dmChannel.topic,
        createdBy: dmChannel.createdBy,
        createdAt: dmChannel.createdAt.toISOString(),
      },
    });
  }

  // Send welcome message
  const content = buildWelcomeMessage(workspaceName);
  const [msg] = await db.insert(messages).values({
    channelId: dmChannel.id,
    userId: tourGuide.id,
    content,
  }).returning();

  // Emit message.created
  await publishEvent(workspaceId, {
    type: 'message.created',
    workspace_id: workspaceId,
    channel_id: dmChannel.id,
    data: {
      id: msg.id,
      channelId: msg.channelId,
      userId: msg.userId,
      content: msg.content,
      threadId: msg.threadId,
      createdAt: msg.createdAt.toISOString(),
      attachments: msg.attachments || [],
      canvas: msg.canvas || null,
      user: { displayName: tourGuide.displayName, isAgent: tourGuide.isAgent },
    },
  });
}
