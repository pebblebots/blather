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

- [ ] `/metrics`: require real auth and verify export paths cannot bypass
  sharing or role rules.
- [ ] `/deals`: require real auth and preserve internal-only handling.
- [ ] `/tasks`: require real auth for reads, writes, comments, and deletes.
- [ ] `/incidents`: require real auth for reads and mutations.
- [ ] `/activity`: require real auth and prevent spoofing arbitrary agent
  activity unless explicitly authorized.
- [ ] `/status` and `/channels/presence`: require real auth and consider
  visibility filtering even among authenticated users.
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
- [ ] `/auth/api-keys`: explicitly require a real authenticated user.
- [x] `/channels/:id/members`: avoid returning email unless the caller has a
  legitimate authenticated need for it. DECISION (2026-06-04): user accepted
  authenticated-member email visibility as legitimate (coworker tool). The
  frontend legitimately uses member emails for display-name disambiguation
  (`chatUtils.ts`) and TaskPanel tooltips. Acute leak is closed (no guest/
  unauth path reaches these). Treated as the intentional surface; no change.

## Phase 4: Cleanup

- [ ] Remove guest-mode tests or convert them into negative authorization tests.
  (Web `App.test.tsx` guest tests already converted to negative-auth tests in
  Phase 2; backend `guest-mode.test.ts` is already a negative-auth suite.
  Remaining: audit for any other guest-themed tests.)
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
  Partially understood (2026-06-04): the local `better-sqlite3` failure is a
  native-build issue on the host Node 24 (CI uses Node 22 with prebuilds, so it
  is unaffected). To run the API suite locally, use a CI-equivalent container:
  `postgres:16` + `node:22-bookworm` with `DATABASE_URL` pointing at the pg
  container, then `pnpm install && pnpm build && db migrate && pnpm test`.
  Note: vite's web build shells out to `git rev-parse` so the copy needs a
  `.git`. The separate CI `meta`-column failures are now fixed (journal 0016).
