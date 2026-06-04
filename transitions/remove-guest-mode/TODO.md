# TODO: Remove Guest Mode

This file is the working task list for the guest-mode removal transition. Keep
it current as work proceeds.

## Phase 0: Containment And Baseline

- [ ] Confirm public deployments have `GUEST_MODE_VIEW_ONLY` disabled while the
  removal is in progress.
- [x] Add regression tests proving unauthenticated callers cannot access
  sensitive routes that were exposed by guest mode.
- [x] Add websocket regression tests proving anonymous clients cannot connect or
  receive global events.
- [ ] Capture any deployment or environment references to guest mode before
  removing config knobs.

## Phase 1: Remove Backend Guest Authentication

- [x] Remove guest fallback from `packages/api/src/middleware/auth.ts`.
- [x] Remove `GUEST_MODE_VIEW_ONLY`, `GUEST_USER_ID`, `GUEST_ROLE`, and
  `isGuestModeEnabled` config paths.
- [x] Ensure unauthenticated API requests fail closed with `401`.
- [x] Require real authenticated users for websocket connections.
- [x] Remove guest-specific websocket event filtering once anonymous websocket
  access is impossible, or keep only filtering that is still needed for real
  user channel authorization.
- [x] Audit and remove guest-specific helpers such as guest-visible channel
  allowlists. Removed `GUEST_VISIBLE_SLUGS`, `isGuest`, `guestCanSeeChannel`,
  and `guestForbidden` from `channels.ts`, the guest write-block + search
  branch in `messages.ts`, the guest 401 middleware in `members.ts`, and the
  deprecated `role?: 'guest'` marker from the `Env` type in `app.ts`. All
  `c.get('role') === 'guest'` branches were dead because auth middleware no
  longer sets `role`.
- [ ] Ensure all mutating routes require a real authenticated user.
- [ ] Ensure route-level authorization still checks membership or ownership
  where needed, not just authentication.

## Phase 2: Remove Frontend Guest Experience

- [ ] Remove frontend guest-user sentinel state.
- [ ] Remove logged-out channel browsing and fishbowl UI flows.
- [ ] Redirect logged-out users to authentication.
- [ ] Remove guest-specific UI branches that hide controls instead of relying on
  server authorization.
- [ ] Verify app startup no longer probes authenticated API routes while logged
  out except for intentional auth/session checks.

## Phase 3: Route-Specific Hardening

- [ ] `/metrics`: require real auth and verify export paths cannot bypass
  sharing or role rules.
- [ ] `/deals`: require real auth and preserve internal-only handling.
- [ ] `/tasks`: require real auth for reads, writes, comments, and deletes.
- [ ] `/incidents`: require real auth for reads and mutations.
- [ ] `/activity`: require real auth and prevent spoofing arbitrary agent
  activity unless explicitly authorized.
- [ ] `/status` and `/channels/presence`: require real auth and consider
  visibility filtering even among authenticated users.
- [ ] `/huddles`: require real auth and add channel membership checks.
- [ ] `/tts`: require real auth and add channel/message visibility checks before
  generation or cache access.
- [ ] `/uploads`: require real auth for uploads and review whether public file
  serving is still acceptable.
- [ ] `/auth/api-keys`: explicitly require a real authenticated user.
- [ ] `/channels/:id/members`: avoid returning email unless the caller has a
  legitimate authenticated need for it.

## Phase 4: Cleanup

- [ ] Remove guest-mode tests or convert them into negative authorization tests.
- [ ] Update `SECURITY.md` and any docs that still describe guest/fishbowl
  behavior.
- [ ] Search for stale guest references across code, docs, tests, env examples,
  deployment manifests, and scripts.
- [ ] Run the full API and web test suites.
- [ ] Run typecheck and lint.
- [ ] Document any intentional public surface that remains after guest mode is
  removed.

## Parking Lot

- [ ] Decide whether Blather needs a future public/demo mode. If yes, design it
  as a separate public API with sanitized serializers and explicit threat-model
  review, not as an auth fallback.
- [ ] Resolve current API build/typecheck blockers so transition iterations can
  rely on `pnpm --filter @blather/api build` as a clean verification step.
