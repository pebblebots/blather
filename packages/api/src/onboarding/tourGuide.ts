import { eq, and } from 'drizzle-orm';
import { users, channels, channelMembers, messages } from '@blather/db';
import type { Db } from '@blather/db';
import { publishEvent } from '../ws/manager.js';

const TOUR_GUIDE_EMAIL = 'tourguide@system.blather';
const HAIKU_MODEL = 'claude-3-haiku-20240307';

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
 * Build the static fallback welcome message.
 */
export function buildWelcomeMessage(): string {
  return `Hey! 👋 Welcome to Blather! I'm the Tour Guide — here to help you get oriented.

A few things to know:
• **#intros** is where people introduce themselves — drop in and say hi!
• Channels are in the sidebar — browse around
• You can DM anyone directly

Have fun! 🎉`;
}

/**
 * Generate a personalized welcome message using Claude Haiku.
 * Falls back to the static message if the API call fails.
 */
export async function generateWelcomeMessage(
  channelNames: string[],
  userDisplayName?: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY_TOURGUIDE;
  if (!apiKey) return buildWelcomeMessage();

  const channelList = channelNames.length > 0
    ? channelNames.map(n => `#${n}`).join(', ')
    : 'browse the sidebar to find channels';

  const nameGreeting = userDisplayName ? `The user's name is ${userDisplayName}.` : '';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 300,
        system: `You are Tour Guide, a friendly onboarding bot for a messaging platform called Blather. Write a short, warm welcome DM for a new user who just joined. Be casual and helpful — like a coworker showing someone around on their first day. Use 1-2 emoji max. Keep it under 4 short paragraphs. Don't use bullet points or lists. Mention a couple of channels naturally in conversation.`,
        messages: [{
          role: 'user',
          content: `New user just joined Blather. ${nameGreeting} Available channels: ${channelList}. Write a welcome DM.`,
        }],
      }),
    });

    if (!res.ok) {
      console.warn(`Tour Guide Haiku call failed: ${res.status}`);
      return buildWelcomeMessage();
    }

    const data = await res.json() as { content: Array<{ type: string; text: string }> };
    const text = data.content?.[0]?.text?.trim();
    return text || buildWelcomeMessage();
  } catch (err) {
    console.warn('Tour Guide Haiku call failed:', err);
    return buildWelcomeMessage();
  }
}

/**
 * Send a Tour Guide welcome DM to a new human user.
 * Skips agent users. Creates the DM channel and sends the welcome message.
 */
export async function sendTourGuideWelcome(
  db: Db,
  userId: string,
  isAgent: boolean,
) {
  // Only DM humans
  if (isAgent) return;

  const tourGuide = await ensureTourGuideUser(db);

  // Create DM channel between Tour Guide and the new user
  const userIds = [tourGuide.id, userId].sort();
  const dmSlug = `dm-${userIds.join('-')}`;

  // Check for existing DM
  const [existingDm] = await db.select().from(channels)
    .where(and(
      eq(channels.slug, dmSlug),
      eq(channels.channelType, 'dm'),
    ))
    .limit(1);

  let dmChannel;
  if (existingDm) {
    dmChannel = existingDm;
  } else {
    [dmChannel] = await db.insert(channels).values({
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
    await publishEvent({
      type: 'channel.created',
      channel_id: dmChannel.id,
      data: {
        id: dmChannel.id,
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

  // Fetch public channel names for context
  const publicChannels = await db.select({ name: channels.name })
    .from(channels)
    .where(eq(channels.channelType, 'public'));
  const channelNames = publicChannels.map(c => c.name).filter(Boolean) as string[];

  // Fetch the new user's display name
  const [newUser] = await db.select({ displayName: users.displayName })
    .from(users).where(eq(users.id, userId)).limit(1);

  // Generate personalized welcome via Haiku (falls back to static)
  const content = await generateWelcomeMessage(
    channelNames,
    newUser?.displayName ?? undefined,
  );
  const [msg] = await db.insert(messages).values({
    channelId: dmChannel.id,
    userId: tourGuide.id,
    content,
  }).returning();

  // Emit message.created
  await publishEvent({
    type: 'message.created',
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
