/**
 * In-memory typing state and caches to avoid DB queries on the hot typing endpoint.
 */

// --- Typing tracking ---
// channelId -> Map<userId, timeout handle>
const typingMap = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();
const TYPING_TIMEOUT_MS = 5_000;

export function markTyping(channelId: string, userId: string): void {
  let channel = typingMap.get(channelId);
  if (!channel) {
    channel = new Map();
    typingMap.set(channelId, channel);
  }
  const existing = channel.get(userId);
  if (existing) clearTimeout(existing);
  channel.set(userId, setTimeout(() => {
    channel!.delete(userId);
    if (channel!.size === 0) typingMap.delete(channelId);
  }, TYPING_TIMEOUT_MS));
}

// --- Channel cache (id -> { channelType }) ---
interface CachedChannel {
  channelType: string;
}
const channelCache = new Map<string, CachedChannel>();
const CHANNEL_CACHE_TTL = 60_000; // 1 min

export function getCachedChannel(id: string): CachedChannel | undefined {
  return channelCache.get(id);
}

export function setCachedChannel(id: string, data: CachedChannel): void {
  channelCache.set(id, data);
  setTimeout(() => channelCache.delete(id), CHANNEL_CACHE_TTL);
}

// --- User display info cache (userId -> { displayName, isAgent }) ---
interface CachedUser {
  displayName: string | null;
  isAgent: boolean;
}
const userCache = new Map<string, CachedUser>();
const USER_CACHE_TTL = 60_000;

export function getCachedUser(id: string): CachedUser | undefined {
  return userCache.get(id);
}

export function setCachedUser(id: string, data: CachedUser): void {
  userCache.set(id, data);
  setTimeout(() => userCache.delete(id), USER_CACHE_TTL);
}

// --- Membership cache (channelId:userId -> true) ---
const membershipCache = new Map<string, boolean>();
const MEMBERSHIP_CACHE_TTL = 60_000;

export function getCachedMembership(channelId: string, userId: string): boolean | undefined {
  return membershipCache.get(`${channelId}:${userId}`);
}

export function setCachedMembership(channelId: string, userId: string, isMember: boolean): void {
  const key = `${channelId}:${userId}`;
  membershipCache.set(key, isMember);
  setTimeout(() => membershipCache.delete(key), MEMBERSHIP_CACHE_TTL);
}
