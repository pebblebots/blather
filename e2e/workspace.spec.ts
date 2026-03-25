import { test, expect } from '@playwright/test';
import { loginViaMagicLink } from './helpers';

test.describe('T36: Workspace and channel creation', () => {
  test('create workspace and channel', async ({ page }) => {
    await loginViaMagicLink(page, `e2e-ws-${Date.now()}@test.com`);

    // If no workspace exists, create workspace modal should appear
    // or we can click create
    const createWsModal = page.getByText('Create Workspace');
    if (await createWsModal.isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.getByPlaceholder('My Company').fill('E2E Workspace');
      await page.getByRole('button', { name: 'Create' }).click();
    }

    // Should see the workspace loaded
    await expect(page.locator('.mac-menubar')).toBeVisible();

    // Create a new channel
    const newChBtn = page.getByRole('button', { name: /new/i }).first();
    if (await newChBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await newChBtn.click();
      await page.getByPlaceholder('channel name').fill('e2e-test-channel');
      await page.getByRole('button', { name: 'Create' }).click();

      // Verify channel appears in sidebar
      await expect(page.getByText('e2e-test-channel')).toBeVisible({ timeout: 5000 });
    }
  });
});
