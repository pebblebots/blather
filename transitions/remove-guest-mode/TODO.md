# TODO: Remove Guest Mode

This file is the working task list for the guest-mode removal transition. Keep
it current as work proceeds.

## Phase 0: Containment And Baseline

- [x] Confirm public deployments have `GUEST_MODE_VIEW_ONLY` disabled while the
  removal is in progress. The knob is absent from every env/deployment file
  (`.env`, `.env.example`, `docker-compose.yml`, `ecosystem.config.cjs.example`),
  so it defaults to off, AND the backend module that read it was already
  removed — the value is now inert regardless. `guest-mode.test.ts` asserts a
  stale `GUEST_MODE_VIEW_ONLY=true` still yields 401s.
- [x] Add regression tests proving unauthenticated callers cannot access
  sensitive routes that were exposed by guest mode.
- [x] Add websocket regression tests proving anonymous clients cannot connect or
  receive global events.
- [x] Capture any deployment or environment references to guest mode before
  removing config knobs. Repo-wide sweep (`git grep` + non-tracked `.env`) of
  env, compose, Dockerfile, Caddyfile, ecosystem, and doc files found NO
  deployment/config references to guest mode. The only surviving guest
  identifiers are the intentional `guest-mode.test.ts` regression suite and the
  frontend `guest:shared` sentinel (Phase 2). Nothing to migrate before
  removing knobs — none exist outside code.

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

- [x] Remove frontend guest-user sentinel state. Deleted `GUEST_USER` /
  `GUEST_USER_ID` from `App.tsx` and `GUEST_USER_ID` / `isGuest` from
  `MainPage.tsx`.
- [x] Remove logged-out channel browsing and fishbowl UI flows. Removed the
  "reading as a guest / Sign in to post" banners (mobile + desktop), the
  guest-only public-channel filter, and the guest-hidden Users panel.
- [x] Redirect logged-out users to authentication. `App.tsx` now renders
  `MainPage` only for a real signed-in user; everyone else gets `AuthPage`.
- [x] Remove guest-specific UI branches that hide controls instead of relying on
  server authorization. All `isGuest ? ... : ...` branches deleted.
- [x] Verify app startup no longer probes authenticated API routes while logged
  out except for intentional auth/session checks. The unauthenticated
  `getChannels()` probe is gone — `App.tsx` only calls it when a token exists.
  `App.test.tsx` asserts no probe happens without a token (incl. on `/auth`).

## Phase 3: Route-Specific Hardening

- [x] `/metrics`: require real auth and verify export paths cannot bypass
  sharing or role rules. VERIFIED (2026-06-04): all routes mount
  `authMiddleware`; `guest-mode.test.ts` asserts 401 for `/metrics` and
  `/metrics/export?includeAll=true`. `includeAll` is an export filter, not an
  authz bypass — the data is already visible to any authed caller via `GET /`,
  and `permissionToShare` governs EXTERNAL redistribution, not internal
  visibility. Deeper role-gating is out of scope (see note below).
- [x] `/deals`: require real auth and preserve internal-only handling. VERIFIED
  (2026-06-04): `dealRoutes` mounts `authMiddleware`; `guest-mode.test.ts`
  asserts 401 for `/deals`. Not used by the web frontend — agent/API surface.
- [x] `/tasks`: require real auth for reads, writes, comments, and deletes.
  VERIFIED (2026-06-04): `taskRoutes` mounts `authMiddleware`;
  `guest-mode.test.ts` asserts 401 for `GET /tasks` and `POST /tasks`.
- [x] `/incidents`: require real auth for reads and mutations. VERIFIED
  (2026-06-04): `incidentRoutes` mounts `authMiddleware`; `guest-mode.test.ts`
  asserts 401 for `/incidents`.

  NOTE (role-authz, out of scope): `/metrics` and `/deals` expose sensitive
  business data to ANY authenticated user (no owner/admin gate). This is NOT a
  guest-mode regression — they never had role checks, and the transition goal
  ("real authenticated user, no guest") is met. Naive role-gating to
  owner/admin would BREAK first-class AI agents, which authenticate as role
  `member` and need read/write access to deals/metrics. Fine-grained
  per-role/per-resource authorization for business data is a separate product
  decision; recorded in the Parking Lot.
- [x] `/activity`: require real auth and prevent spoofing arbitrary agent
  activity unless explicitly authorized. DONE (2026-06-04): `POST /activity`
  ignored the authenticated caller and inserted the client-supplied
  `agentUserId` verbatim, so any authed caller could log activity attributed to
  any other agent. Now entries are attributed to the authenticated `userId`;
  a supplied `agentUserId` that differs from the caller is rejected 403.
  Tests: spoof attempt 403 (and nothing logged under the victim) + attribution
  to caller when agentUserId omitted.
- [x] `/status` and `/channels/presence`: require real auth and consider
  visibility filtering even among authenticated users. REVIEWED (2026-06-04):
  both require auth (`statusRoutes`/`channelRoutes` use `authMiddleware`).
  `PUT /status` sets only the caller's own status (`userId` from context).
  `GET /status` and `GET /channels/presence` return all agent statuses /
  connected-user presence to any authenticated user — this is the intended
  cross-workspace transparency/presence surface, consistent with the accepted
  member-visibility decision. No spoofing path (you can't set another user's
  status). Left as intended; revisit only if per-channel presence scoping is
  later required.
- [x] `/huddles`: require real auth and add channel membership checks. DONE
  (2026-06-04, user chose member-gating): `GET /huddles/:id` and
  `POST /huddles/:id/speak` now require channel membership (403 otherwise);
  `POST /:id/speak` no longer lets non-members inject messages into a huddle's
  private channel. The frontend `HuddleModal` was reordered to join FIRST, then
  load the now-gated detail + message history (also fixes a pre-existing silent
  race on the channel-messages fetch). `GET /huddles` (list) is intentionally
  LEFT OPEN as the discovery surface for the sidebar — huddle conversation
  CONTENT is already protected by the existing `GET /channels/:id/messages`
  membership check, so the list only exposes topics/status (intended). Tests:
  non-member 403 + post-join 200 for both detail and speak.
- [x] `/tts`: require real auth and add channel/message visibility checks before
  generation or cache access. DONE (2026-06-04): `POST /tts/:messageId` now
  fetches the message and checks `canViewChannel` (public, or member of
  private/DM) BEFORE the cache short-circuit or any OpenAI call. Stops authed
  users from minting a TTS capability URL for messages they can't see. The GET
  serving paths (`/tts/:messageId`, `/uploads/tts/:filename`) remain public by
  design — see `/uploads` capability-URL note below.
- [x] `/uploads`: require real auth for uploads and review whether public file
  serving is still acceptable. DECISION (2026-06-04): user confirmed the
  unguessable-UUID capability URL provides sufficient entropy — public file
  serving (`/uploads/:filename`, `/uploads/tts/:filename`) is ACCEPTED as-is so
  `<img>`/`<audio>`/`<video>` render without auth headers. Uploads POST already
  requires auth. No change. (Note: `POST /tts/:messageId` is now gated so only
  someone who can see a message can MINT its capability URL in the first place.)
- [x] `/auth/api-keys`: explicitly require a real authenticated user. VERIFIED
  (2026-06-04): `POST /auth/api-keys` already mounts `authMiddleware` and
  attributes the new key to the authenticated `userId` (the only
  client-controlled field is `name`). No change needed.
- [x] `/channels/:id/members`: avoid returning email unless the caller has a
  legitimate authenticated need for it. DECISION (2026-06-04): user accepted
  authenticated-member email visibility as legitimate (coworker tool). The
  frontend legitimately uses member emails for display-name disambiguation
  (`chatUtils.ts`) and TaskPanel tooltips. Acute leak is closed (no guest/
  unauth path reaches these). Treated as the intentional surface; no change.

## Phase 4: Cleanup

- [x] Remove guest-mode tests or convert them into negative authorization tests.
  Web `App.test.tsx` guest tests converted to negative-auth tests (Phase 2);
  backend `guest-mode.test.ts` is the negative-auth regression suite covering
  401 on every former guest-mode surface. No other guest-themed tests exist.
- [x] Update `SECURITY.md` and any docs that still describe guest/fishbowl
  behavior. No doc described guest/fishbowl (sweep was clean). Added an
  affirmative "Access Model" section to `SECURITY.md` documenting that all
  routes + WebSocket require auth, there is no guest/anonymous mode, and the
  only intentional public surface (health probes + capability-URL file serving).
- [x] Search for stale guest references across code, docs, tests, env examples,
  deployment manifests, and scripts. CLEAN (2026-06-04): `git grep -i guest`
  across the repo returns only (a) an intentional explanatory comment in
  `App.test.tsx`, (b) the deliberate `guest-mode.test.ts` regression suite, and
  (c) this transition dir. No `GUEST_*`, `guest:shared`, `fishbowl`, or
  `isGuest` references remain in shippable code, docs, env, or deploy config.
- [x] Run the full API and web test suites. Run every iteration in a
  CI-equivalent Node 22 + Postgres 16 container; latest green: types 7, cli 23,
  web 264, api 331 = 625, 0 failures. CI on `main` is green.
- [x] Run typecheck and lint. Typecheck runs via `pnpm build` (tsc) each
  iteration — clean. No `lint` script is configured in the monorepo (nothing to
  run); flagged here in case one is added later.
- [x] Document any intentional public surface that remains after guest mode is
  removed. Done in `SECURITY.md` Access Model: `/health` + `/api/health` probes,
  and unguessable-UUID capability URLs for `/uploads/*` + TTS audio.

## Parking Lot

- [ ] Decide whether Blather needs a future public/demo mode. If yes, design it
  as a separate public API with sanitized serializers and explicit threat-model
  review, not as an auth fallback.
- [ ] Fine-grained role/permission authorization for sensitive business data
  (`/metrics`, `/deals`, and arguably `/incidents`): currently any authenticated
  user (human or agent) can read/write. Not a guest-mode issue; deferred as a
  product decision. Constraint: first-class AI agents authenticate as role
  `member` and need access, so any scheme must not simply gate on owner/admin.
- [ ] Non-guest repo hygiene found during the Phase 4 sweep (out of scope for
  guest removal, surfaced for a separate cleanup): three orphaned backup files
  are tracked in git and contain NO guest code —
  `packages/web/src/pages/MainPage.tsx.backup`,
  `packages/web/src/pages/AuthPage.tsx.backup`,
  `packages/api/src/bots/tasks.ts.bak`. They are unreferenced and not built;
  safe to delete, but unrelated to this transition.
- [ ] Resolve current API build/typecheck blockers so transition iterations can
  rely on `pnpm --filter @blather/api build` as a clean verification step.
  Partially understood (2026-06-04): the local `better-sqlite3` failure is a
  native-build issue on the host Node 24 (CI uses Node 22 with prebuilds, so it
  is unaffected). To run the API suite locally, use a CI-equivalent container:
  `postgres:16` + `node:22-bookworm` with `DATABASE_URL` pointing at the pg
  container, then `pnpm install && pnpm build && db migrate && pnpm test`.
  Note: vite's web build shells out to `git rev-parse` so the copy needs a
  `.git`. The separate CI `meta`-column failures are now fixed (journal 0016).
