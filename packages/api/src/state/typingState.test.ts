import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Each test gets a fresh module instance to avoid cross-test state leakage.
// vi.useFakeTimers() lets us test TTL expiration without real delays.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

async function loadModule() {
  return await import('./typingState.js');
}

// ---------------------------------------------------------------------------
// markTyping
// ---------------------------------------------------------------------------
describe('markTyping', () => {
  it('tracks a user as typing in a channel (no throw, no return)', async () => {
    const { markTyping } = await loadModule();
    expect(() => markTyping('ch1', 'u1')).not.toThrow();
  });

  it('replaces the timeout when the same user types again', async () => {
    const { markTyping } = await loadModule();
    markTyping('ch1', 'u1');
    // Calling again before the 5 s timeout should not throw
    vi.advanceTimersByTime(3_000);
    expect(() => markTyping('ch1', 'u1')).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Channel cache
// ---------------------------------------------------------------------------
describe('channel cache', () => {
  it('returns undefined for an unknown channel', async () => {
    const { getCachedChannel } = await loadModule();
    expect(getCachedChannel('missing')).toBeUndefined();
  });

  it('stores and retrieves a channel entry', async () => {
    const { getCachedChannel, setCachedChannel } = await loadModule();
    const data = { channelType: 'public' };
    setCachedChannel('ch1', data);
    expect(getCachedChannel('ch1')).toEqual(data);
  });

  it('expires entries after the TTL (60 s)', async () => {
    const { getCachedChannel, setCachedChannel } = await loadModule();
    setCachedChannel('ch1', { channelType: 'dm' });

    vi.advanceTimersByTime(59_999);
    expect(getCachedChannel('ch1')).toBeDefined();

    vi.advanceTimersByTime(2);
    expect(getCachedChannel('ch1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// User cache
// ---------------------------------------------------------------------------
describe('user cache', () => {
  it('returns undefined for an unknown user', async () => {
    const { getCachedUser } = await loadModule();
    expect(getCachedUser('missing')).toBeUndefined();
  });

  it('stores and retrieves a user entry', async () => {
    const { getCachedUser, setCachedUser } = await loadModule();
    const data = { displayName: 'Alice', isAgent: false };
    setCachedUser('u1', data);
    expect(getCachedUser('u1')).toEqual(data);
  });

  it('handles null displayName', async () => {
    const { getCachedUser, setCachedUser } = await loadModule();
    const data = { displayName: null, isAgent: true };
    setCachedUser('bot1', data);
    expect(getCachedUser('bot1')).toEqual(data);
  });

  it('expires entries after the TTL', async () => {
    const { getCachedUser, setCachedUser } = await loadModule();
    setCachedUser('u1', { displayName: 'Bob', isAgent: false });

    vi.advanceTimersByTime(60_001);
    expect(getCachedUser('u1')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Membership cache
// ---------------------------------------------------------------------------
describe('membership cache', () => {
  it('returns undefined for an unknown membership', async () => {
    const { getCachedMembership } = await loadModule();
    expect(getCachedMembership('ch1', 'u1')).toBeUndefined();
  });

  it('stores and retrieves a positive membership', async () => {
    const { getCachedMembership, setCachedMembership } = await loadModule();
    setCachedMembership('ch1', 'u1', true);
    expect(getCachedMembership('ch1', 'u1')).toBe(true);
  });

  it('stores and retrieves a negative membership', async () => {
    const { getCachedMembership, setCachedMembership } = await loadModule();
    setCachedMembership('ch1', 'u2', false);
    expect(getCachedMembership('ch1', 'u2')).toBe(false);
  });

  it('keeps different channel+user pairs separate', async () => {
    const { getCachedMembership, setCachedMembership } = await loadModule();
    setCachedMembership('ch1', 'u1', true);
    setCachedMembership('ch2', 'u1', false);

    expect(getCachedMembership('ch1', 'u1')).toBe(true);
    expect(getCachedMembership('ch2', 'u1')).toBe(false);
  });

  it('expires entries after the TTL', async () => {
    const { getCachedMembership, setCachedMembership } = await loadModule();
    setCachedMembership('ch1', 'u1', true);

    vi.advanceTimersByTime(60_001);
    expect(getCachedMembership('ch1', 'u1')).toBeUndefined();
  });
});
