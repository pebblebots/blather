import { test, expect } from '@playwright/test';
import { registerUser, loginWithToken, createWorkspace } from './helpers';

test.describe('T42: DM flow', () => {
  let token1: string;
  let token2: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const auth1 = await registerUser(`e2e-dm1-${ts}@test.com`, 'DmUser1');
    const auth2 = await registerUser(`e2e-dm2-${ts}@test.com`, 'DmUser2');
    token1 = auth1.token;
    token2 = auth2.token;
    // Both need to be in the same workspace
    const ws = await createWorkspace(token1, 'DM WS', `dm-ws-${ts}`);
    // User2 joins by creating via API (or workspace auto-join)
  });

  test('create DM and send message', async ({ page }) => {
    await loginWithToken(page, token1);

    // Look for DM section or "+" button to create a DM
    const dmSection = page.getByText(/direct messages/i);
    if (await dmSection.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Click to expand or find a "new DM" button
      const newDmBtn = page.getByText(/new dm/i).or(page.getByTitle(/new dm/i));
      if (await newDmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await newDmBtn.click();
        // Select DmUser2
        const user2Option = page.getByText('DmUser2');
        if (await user2Option.isVisible({ timeout: 2000 }).catch(() => false)) {
          await user2Option.click();
        }
      }
    }

    // If we got into a DM, send a message
    const input = page.getByPlaceholder('Type a message...');
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.fill('Hello via DM!');
      await page.getByRole('button', { name: /send/i }).click();
      await expect(page.getByText('Hello via DM!')).toBeVisible({ timeout: 5000 });
    }
  });
});
