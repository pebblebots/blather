# Learnings


- 2026-03-24: Root `pnpm test` should use `pnpm -r --if-present test` during staged rollout so packages without a test script (like `packages/web` before T02) do not fail the workspace run. Vitest package configs can use `passWithNoTests: true` to keep the suite green while infrastructure lands before actual test files.
- 2026-03-24: For React + Vitest in this repo, use `import '@testing-library/jest-dom/vitest'` in a dedicated setup file (e.g. `src/test/setup.ts`) and register it via `setupFiles` in `vitest.config.ts`; this enables jest-dom matchers without needing Jest.
