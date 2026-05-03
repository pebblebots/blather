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
      // CI-only env:
      //  - DISABLE_RATE_LIMIT: shared ip=unknown trips the 5/15min magic-link limiter otherwise.
      //  - BLA_ALLOWED_EMAILS: enables magic-link login for the @test.com fixtures; without
      //    this, /auth/magic returns 403 "Email not allowed" and the UI never shows
      //    "check your inbox".
      env: process.env.CI ? {
        DISABLE_RATE_LIMIT: 'true',
        BLA_ALLOWED_EMAILS: '*@test.com',
        // Enables "Verify (Dev)" button in AuthPage by returning the magic token
        // in the /auth/magic response. CI-only; never use in production.
        EXPOSE_MAGIC_TOKEN_IN_RESPONSE: 'true',
      } : undefined,
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
