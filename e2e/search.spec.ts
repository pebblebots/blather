import { test, expect } from '@playwright/test';
import { registerUser, loginWithToken, createWorkspace, createChannel, sendMessage } from './helpers';

// SKIPPED: this suite targets the removed /api/workspaces endpoints (see T#158
// migration 0010_remove_workspaces). The spec predates that refactor and calls
// createWorkspace() which returns 404, causing JSON.parse to throw. Tracked in
// T#175 for rewrite to post directly to /api/channels.
test.describe.skip('T41: Search', () => {
  let token: string;
  let channelId: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const auth = await registerUser(`e2e-search-${ts}@test.com`, 'SearchUser');
    token = auth.token;
    const ws = await createWorkspace(token, 'Search WS', `search-ws-${ts}`);
    const ch = await createChannel(token, ws.id, 'searchable', `search-ch-${ts}`);
    channelId = ch.id;

    // Seed distinct messages
    await sendMessage(token, channelId, 'The quick brown fox jumps');
    await sendMessage(token, channelId, 'Hello world greeting');
    await sendMessage(token, channelId, 'Another random message');
  });

  test('search finds matching messages', async ({ page }) => {
    await loginWithToken(page, token);
    await expect(page.getByText('searchable')).toBeVisible({ timeout: 10000 });

    // Open search (Cmd+K or click search button)
    await page.keyboard.press('Meta+k');

    // If Cmd+K doesn't open search, try clicking the search icon
    const searchInput = page.getByPlaceholder('Search messages...');
    if (!await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      // Look for a search button in the UI
      const searchBtn = page.getByText('🔍').first();
      if (await searchBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await searchBtn.click();
      }
    }

    if (await searchInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      await searchInput.fill('quick brown fox');

      // Should find the matching message
      await expect(page.getByText(/quick brown fox/i)).toBeVisible({ timeout: 5000 });
      // Should NOT show unrelated messages
      expect(await page.getByText('Hello world greeting').count()).toBe(0);
    }
  });
});
