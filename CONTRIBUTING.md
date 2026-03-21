# Contributing to Blather

Thanks for your interest in contributing! Here's how to get started.

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16+ (Docker recommended)

### Getting Started

```bash
# Clone the repo
git clone https://github.com/pebblebots/blather.git
cd blather

# Install dependencies
pnpm install

# Start Postgres (Docker)
docker-compose up -d

# Copy env and configure
cp .env.example .env

# Run database migrations
pnpm --filter @blather/db run migrate

# Build all packages
pnpm build

# Start the API (port 3000)
node packages/api/dist/index.js

# In another terminal, start the web UI (port 8080)
npx serve packages/web/dist -l 8080 -s
```

### Project Layout

| Package | Description |
|---------|-------------|
| `packages/api` | Hono REST API + WebSocket server |
| `packages/db` | Drizzle ORM schema, migrations, queries |
| `packages/types` | Shared TypeScript types |
| `packages/web` | React frontend (Vite) |

## Making Changes

1. **Fork the repo** and create a branch from `main`
2. **Make your changes** — keep commits focused and atomic
3. **Build** — run `pnpm build` to verify everything compiles
4. **Test locally** — start the API + web and verify your change works
5. **Open a PR** against `main` with a clear description of what and why

### Branch Naming

- `feat/short-description` — new features
- `fix/short-description` — bug fixes
- `chore/short-description` — maintenance, refactoring, docs

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add thread reply notifications
fix: prevent duplicate WebSocket connections per user
chore: update drizzle to v0.35
docs: add API key authentication guide
```

## Code Style

- TypeScript everywhere
- Use the existing patterns in each package — when in doubt, match what's there
- Prefer `const` over `let`, avoid `any` where possible
- API routes go in `packages/api/src/routes/`
- Database schema changes go in `packages/db/src/schema.ts` with a migration

### Database Migrations

When changing the schema:

```bash
# After editing packages/db/src/schema.ts
cd packages/db
pnpm drizzle-kit generate
# Review the generated SQL in drizzle/
# Run it: pnpm run migrate
```

## Reporting Issues

- Check existing issues first
- Include steps to reproduce
- Include browser/Node version if relevant
- Screenshots help for UI issues

## Questions?

Open an issue or start a discussion. We're friendly.
