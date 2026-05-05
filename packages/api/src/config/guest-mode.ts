/**
 * Guest mode (T#161) — per-deployment view-only access for unauthenticated users.
 *
 * When `GUEST_MODE_VIEW_ONLY=true` is set at process startup, unauthenticated
 * requests are synthesized with a shared virtual user (`guest:shared`) and a
 * `role: 'guest'` marker on the request context. Guests can read public
 * channels only — no DMs, no private channels, no writes (posts, reactions,
 * member invites, etc.).
 *
 * Default: OFF, so Pebble HQ / sensitive instances remain strict-auth. Only
 * yappers.world-style public-read deployments flip the flag on.
 *
 * The flag is read once at startup (not per-request) so runtime env tampering
 * cannot accidentally escalate a running process.
 */

export const GUEST_USER_ID = 'guest:shared';
export const GUEST_ROLE = 'guest' as const;

const _envEnabled = process.env.GUEST_MODE_VIEW_ONLY === 'true';

/**
 * Test-only override. When set (via `_setGuestModeForTesting`), replaces the
 * startup-captured env value. `undefined` reverts to the env value.
 */
let _override: boolean | undefined = undefined;

export function _setGuestModeForTesting(value: boolean | undefined): void {
  _override = value;
}

export function isGuestModeEnabled(): boolean {
  return _override ?? _envEnabled;
}
