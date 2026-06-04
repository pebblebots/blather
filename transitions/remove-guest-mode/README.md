# Remove Guest Mode Transition

Created: 2026-06-04

## Purpose

Remove guest mode from Blather because it is a persistent architectural
security hole. The current fishbowl model turns logged-out users into a shared
guest identity, which causes authenticated routes to become public unless every
route explicitly opts out. That pattern already leaked user information and can
keep producing new leaks as the product changes.

Future agents should treat guest-mode behavior as a vulnerability unless the
user explicitly re-scopes the product to include a separately designed public
surface.

## Project Context

Blather is split primarily across:

- `packages/api`: Hono API, auth middleware, REST routes, websocket manager.
- `packages/web`: React frontend.
- `docs`: product/security specs and operational notes.

The guest-mode entry point is the API auth middleware. When
`GUEST_MODE_VIEW_ONLY=true`, unauthenticated requests are assigned a shared
guest user and proceed through normal authenticated handlers. That makes guest
access inherited by every route protected only by `authMiddleware`.

Known guest-mode identifiers to remove or audit:

- `GUEST_MODE_VIEW_ONLY`
- `GUEST_USER_ID`
- `GUEST_ROLE`
- `guest:shared`
- `isGuestModeEnabled`
- guest-only frontend sentinel users
- anonymous websocket access

## Security Inventory Snapshot

The initial static inventory found guest-mode exposure across sensitive
surfaces, including:

- Portfolio metrics and founder contact data in `/metrics`.
- Internal deal pipeline data in `/deals`.
- Tasks, comments, artifacts, incidents, activity logs, statuses, presence,
  huddles, uploads, and TTS generation.
- Registered user emails through guest-visible channel member lists.
- New-user email leakage through global websocket `member.joined` events.
- Anonymous websocket connections that can observe global events.

Do not rely on the frontend hiding UI. API and websocket authorization must be
correct on the server.

## Desired End State

- No logged-out user can access the application API or websocket transport.
- All application routes require a real authenticated user unless there is a
  new, explicit, separately reviewed public endpoint.
- No shared guest user identity exists in API, web, tests, docs, seed data, or
  deployment config.
- Tests assert that unauthenticated callers receive `401` or `403` for former
  guest-mode surfaces.
- If a future public/demo view is needed, it must use explicit public routes,
  sanitized serializers, and a narrowly reviewed allowlist. It must not reuse
  authenticated route handlers through auth fallback.

## Agent Operating Instructions

Before working on this transition:

1. Read this file and `TODO.md`.
2. Inspect the current code before assuming the inventory is still complete.
3. Keep changes small enough to review and test.
4. Prefer deleting guest-mode code over preserving compatibility shims.
5. Add or update tests with every behavioral change.

While working:

- Update this README when you discover durable context, decisions, security
  gotchas, or architectural constraints that future agents should know.
- Update `TODO.md` whenever you discover a new concrete task, finish a task, or
  split a task into smaller steps.
- If you defer a risk, record why it is deferred and what would unblock it.
- Do not reintroduce guest mode, anonymous websocket access, or public access to
  authenticated route handlers as a shortcut.

## Memory Log

- 2026-06-04: User requested a semi-persistent transition task to remove guest
  mode after a fishbowl public-instance leak exposed surprising behavior and
  registered user information, including emails.
- 2026-06-04: Initial security inventory concluded that guest mode is unsafe by
  architecture because `authMiddleware` turns unauthenticated callers into a
  shared guest user instead of denying access by default.
- 2026-06-04: Removed the backend guest-mode config module and the
  `authMiddleware` fallback that synthesized guest users. Stale
  `GUEST_MODE_VIEW_ONLY=true` no longer makes REST routes public. Websocket
  fanout no longer has guest-specific channel bypass logic. At that point,
  first-message websocket authentication still remained.
- 2026-06-04: Targeted API tests for guest-mode removal pass, but
  `pnpm --filter @blather/api build` currently fails on broader project issues:
  missing installed modules (`better-sqlite3`, `@supabase/supabase-js`) and
  schema/type drift around fields such as `workspaceId`, `meta`, `canvas`,
  `role`, and `deactivatedAt`.
- 2026-06-04: Removed first-message websocket authentication. `/ws/events`
  upgrades now require a valid `token` or `api_key` query parameter before the
  websocket is established; anonymous upgrades receive `401` and are not added
  to the client set.
- 2026-06-04: Removed all dead guest-mode route branches now that auth
  middleware never sets `role='guest'`. Deleted the `Env.role?: 'guest'` marker
  (`app.ts`), the guest helpers and ~16 `isGuest(c)` branches (`channels.ts`),
  the guest write-block middleware + `GUEST_VISIBLE_SLUGS` search branch
  (`messages.ts`), and the guest 401 middleware (`members.ts`). The
  `guest-mode.test.ts` regression suite still passes (3/3). Note: broader
  `channels.test.ts` / `messages.test.ts` cannot load in this environment due
  to the pre-existing missing `better-sqlite3` module imported by
  `src/tasks/db.ts` (see Parking Lot) — unrelated to this change.
