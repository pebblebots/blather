# Learnings


- 2026-03-24: Root `pnpm test` should use `pnpm -r --if-present test` during staged rollout so packages without a test script (like `packages/web` before T02) do not fail the workspace run. Vitest package configs can use `passWithNoTests: true` to keep the suite green while infrastructure lands before actual test files.
- 2026-03-24: For React + Vitest in this repo, use `import '@testing-library/jest-dom/vitest'` in a dedicated setup file (e.g. `src/test/setup.ts`) and register it via `setupFiles` in `vitest.config.ts`; this enables jest-dom matchers without needing Jest.
- 2026-03-24: In Playwright `webServer.command`, pass script args through pnpm without an extra `--` when filtering a workspace package (e.g. `pnpm --filter @blather/web dev --host 127.0.0.1 --port 8080`). Using `dev -- --host ...` leaves Vite on its default port (5173), causing `webServer` health checks for `localhost:8080` to time out.
- 2026-03-24: For `packages/web` Vitest setup, explicitly include TSX tests (`include: ['src/**/*.test.{ts,tsx}']`) with `environment: 'jsdom'`; otherwise component test files are skipped or fail due to missing DOM APIs.
- 2026-03-24: In ESM test helpers, resolve Drizzle `migrationsFolder` from `import.meta.url` (e.g. `fileURLToPath(new URL('../../../db/drizzle', import.meta.url))`) rather than relying on cwd; Vitest and package scripts can run with different working directories.
- 2026-03-24: For API route unit tests, export a `createApp(db)` factory instead of only a singleton app so tests can inject an isolated test DB handle; keep `export const app = createApp()` for production entrypoints.
- 2026-03-24: In this repo, API harness tests that touch Postgres should be gated behind `TEST_DATABASE_URL` (e.g. `describe.skip` when unset) so default `pnpm test` stays green on machines without a local `blather_test` database.
