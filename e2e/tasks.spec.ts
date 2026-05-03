import { test, expect } from '@playwright/test';
import { registerUser, loginWithToken, createWorkspace, createChannel } from './helpers';

// SKIPPED: this suite targets the removed /api/workspaces endpoints (see T#158
// migration 0010_remove_workspaces). The spec predates that refactor and calls
// createWorkspace() which returns 404, causing JSON.parse to throw. Tracked in
// T#175 for rewrite to post directly to /api/channels.
test.describe.skip('T40: Tasks', () => {
  let token: string;

  test.beforeAll(async () => {
    const ts = Date.now();
    const auth = await registerUser(`e2e-task-${ts}@test.com`, 'TaskUser');
    token = auth.token;
    const ws = await createWorkspace(token, 'Task WS', `task-ws-${ts}`);
    await createChannel(token, ws.id, 'general', `gen-${ts}`);
  });

  test('create a task and update status', async ({ page }) => {
    await loginWithToken(page, token);

    // Open task panel
    const taskBtn = page.getByText('📋').first();
    await taskBtn.click();

    // Click "+ New Task"
    await page.getByText('+ New Task').click();

    // Fill in task form
    await page.getByPlaceholder('What needs to be done?').fill('E2E Test Task');
    await page.keyboard.press('Enter');

    // Task should appear in list
    await expect(page.getByText('E2E Test Task')).toBeVisible({ timeout: 5000 });
  });
});
