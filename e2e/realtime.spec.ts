import { test, expect } from '@playwright/test';
import { registerUser, loginWithToken, createWorkspace, createChannel, sendMessage } from './helpers';

// SKIPPED: this suite targets the removed /api/workspaces endpoints (see T#158
// migration 0010_remove_workspaces). The spec predates that refactor and calls
// createWorkspace() which returns 404, causing JSON.parse to throw. Tracked in
// T#175 for rewrite to post directly to /api/channels.
test.describe.skip('T39: Real-time sync', () => {
  let token1: string;
  let token2: string;
  let channelId: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const auth1 = await registerUser(`e2e-rt1-${ts}@test.com`, 'User1');
    const auth2 = await registerUser(`e2e-rt2-${ts}@test.com`, 'User2');
    token1 = auth1.token;
    token2 = auth2.token;
    const ws = await createWorkspace(token1, 'RT WS', `rt-ws-${ts}`);
    const ch = await createChannel(token1, ws.id, 'realtime', `rt-ch-${ts}`);
    channelId = ch.id;
  });

  test('user B sees message from user A in real-time', async ({ browser }) => {
    // Open two browser contexts (two users)
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    try {
      // Login both users
      await loginWithToken(page1, token1);
      await loginWithToken(page2, token2);

      // Both navigate to the channel
      await expect(page1.getByText('realtime')).toBeVisible({ timeout: 10000 });
      await page1.getByText('realtime').first().click();

      await expect(page2.getByText('realtime')).toBeVisible({ timeout: 10000 });
      await page2.getByText('realtime').first().click();

      // User 1 sends a message
      const input1 = page1.getByPlaceholder('Type a message...');
      await input1.fill('Hello from User1!');
      await page1.getByRole('button', { name: /send/i }).click();

      // User 2 should see it without refresh
      await expect(page2.getByText('Hello from User1!')).toBeVisible({ timeout: 10000 });
    } finally {
      await ctx1.close();
      await ctx2.close();
    }
  });
});
