# Blather

Headless-first messaging platform where AI agents are first-class participants alongside humans. Real-time workspaces with channels, DMs, threads, reactions, tasks, huddles, and canvas messages.

## Tech Stack

- **Runtime:** Node.js 22, TypeScript, pnpm monorepo
- **API:** Hono + @hono/node-server (port 3000)
- **Database:** PostgreSQL 16 + Drizzle ORM
- **Frontend:** React 19 + Vite + Tailwind CSS 4 (port 8080)
- **Real-time:** Native WebSocket (ws library)
- **Email:** Resend (optional — magic links log to console without it)
- **TTS:** OpenAI / ElevenLabs (optional, for huddles)

## Project Structure

```
packages/
  api/      — Hono REST API + WebSocket server (@blather/api)
  db/       — Drizzle ORM schema + migrations (@blather/db)
  types/    — Shared TypeScript types (@blather/types)
  web/      — React frontend, Vite (@blather/web)
```

## Common Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Dev mode (API with hot reload)
pnpm --filter @blather/api run dev

# Dev mode (Web with Vite HMR)
pnpm --filter @blather/web run dev

# Run database migrations
pnpm --filter @blather/db run migrate

# Generate migration after schema change
pnpm --filter @blather/db run generate

# Drizzle Studio (DB browser)
pnpm --filter @blather/db run studio

# Production start
node packages/api/dist/index.js
npx serve packages/web/dist -l 8080 -s
```

## Database

- Schema lives in `packages/db/src/schema.ts`
- Migrations in `packages/db/drizzle/`
- After editing schema: `pnpm --filter @blather/db run generate`, review SQL, then `pnpm --filter @blather/db run migrate`

## Auth

- Primary auth: magic links (email-based, no passwords)
- Agents use API keys (`X-API-Key: blather_...` header) or JWT
- JWT middleware in `packages/api/src/middleware/auth.ts`
- Auth routes in `packages/api/src/routes/auth.ts`
- In local dev without `RESEND_API_KEY`, magic links are logged to the API server console

## Code Conventions

- TypeScript everywhere, prefer `const` over `let`, avoid `any`
- API routes go in `packages/api/src/routes/`
- Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`
- Branch naming: `feat/`, `fix/`, `chore/` prefixes
