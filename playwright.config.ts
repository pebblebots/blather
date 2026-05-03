import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm --filter @blather/api dev',
      url: 'http://localhost:3000/',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      // Disable auth/general rate-limits in CI — all requests share ip=unknown
      // and the magic-link limiter (5/15min) trips mid-suite otherwise.
      env: process.env.CI ? { DISABLE_RATE_LIMIT: 'true' } : undefined,
    },
    {
      command: 'pnpm --filter @blather/web dev --host 127.0.0.1 --port 8080',
      url: 'http://localhost:8080',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
