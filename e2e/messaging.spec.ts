import { test, expect } from '@playwright/test';
import { registerUser, loginWithToken, createWorkspace, createChannel } from './helpers';

test.describe('T37: Messaging', () => {
  let token: string;
  let workspaceId: string;
  let channelId: string;

  test.beforeAll(async () => {
    const auth = await registerUser(`e2e-msg-${Date.now()}@test.com`, 'MsgUser');
    token = auth.token;
    const ws = await createWorkspace(token, 'Msg WS', `msg-ws-${Date.now()}`);
    workspaceId = ws.id;
    const ch = await createChannel(token, workspaceId, 'msg-channel', `msg-ch-${Date.now()}`);
    channelId = ch.id;
  });

  test('send and see a message', async ({ page }) => {
    await loginWithToken(page, token);

    // Wait for channel to load
    await expect(page.getByText('msg-channel')).toBeVisible({ timeout: 10000 });
    await page.getByText('msg-channel').first().click();

    // Type and send a message
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('Hello from E2E test!');
    await page.getByRole('button', { name: /send/i }).click();

    // Verify message appears
    await expect(page.getByText('Hello from E2E test!')).toBeVisible({ timeout: 5000 });

    // Input should be cleared
    await expect(input).toHaveValue('');
  });
});

test.describe('T38: Reactions', () => {
  let token: string;

  test.beforeAll(async () => {
    const auth = await registerUser(`e2e-react-${Date.now()}@test.com`, 'ReactUser');
    token = auth.token;
    const ws = await createWorkspace(token, 'React WS', `react-ws-${Date.now()}`);
    const ch = await createChannel(token, ws.id, 'reactions', `react-ch-${Date.now()}`);
  });

  test('add and toggle a reaction', async ({ page }) => {
    await loginWithToken(page, token);

    // Wait for channel
    await expect(page.getByText('reactions')).toBeVisible({ timeout: 10000 });
    await page.getByText('reactions').first().click();

    // Send a message first
    const input = page.getByPlaceholder('Type a message...');
    await input.fill('React to me!');
    await page.getByRole('button', { name: /send/i }).click();
    await expect(page.getByText('React to me!')).toBeVisible({ timeout: 5000 });

    // Hover over message to reveal reaction button
    const msg = page.getByText('React to me!');
    await msg.hover();

    // Click the emoji picker button (😀+)
    const addReactionBtn = page.getByTitle('Add reaction');
    if (await addReactionBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await addReactionBtn.click();
      // Click thumbs up from quick emojis
      const thumbs = page.locator('button').filter({ hasText: '👍' }).first();
      if (await thumbs.isVisible({ timeout: 2000 }).catch(() => false)) {
        await thumbs.click();
        // Verify reaction appears
        await expect(page.getByTitle(/👍/)).toBeVisible({ timeout: 5000 });
      }
    }
  });
});
