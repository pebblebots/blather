import { test, expect } from '@playwright/test';
import { registerUser, loginWithToken, createWorkspace, createChannel, sendMessage } from './helpers';

test.describe('T42: Scroll position on channel load', () => {
  let token: string;
  let user: Record<string, unknown>;
  let workspaceId: string;
  let singleLineChName: string;
  let multiLineChName: string;

  const MESSAGE_COUNT = 40;

  test.beforeAll(async () => {
    const suffix = Date.now();
    const auth = await registerUser(`e2e-scroll-${suffix}@pbd.bot`);
    token = auth.token;
    user = auth.user;
    const ws = await createWorkspace(token, 'Scroll WS', `scroll-ws-${suffix}`);
    workspaceId = ws.id;

    singleLineChName = 'single-line';
    multiLineChName = 'multi-line';
    const ch1 = await createChannel(token, workspaceId, singleLineChName, `single-${suffix}`);
    const ch2 = await createChannel(token, workspaceId, multiLineChName, `multi-${suffix}`);

    // Seed single-line messages
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      await sendMessage(token, ch1.id, `single line message ${i}`);
    }

    // Seed multi-line messages (each message is ~10 lines)
    for (let i = 0; i < MESSAGE_COUNT; i++) {
      const lines = Array.from({ length: 10 }, (_, j) => `line ${j} of message ${i}`).join('\n');
      await sendMessage(token, ch2.id, lines);
    }
  });

  /** Returns how far the scroll container is from the bottom, in pixels. */
  async function getScrollDistanceFromBottom(page: import('@playwright/test').Page) {
    return page.evaluate(() => {
      const el = document.querySelector('[data-testid="message-list"]') as HTMLElement | null;
      if (!el) throw new Error('message list container not found');
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });
  }

  test('single-line channel scrolls to bottom', async ({ page }) => {
    await loginWithToken(page, token, user);

    // Switch to the Scroll WS workspace
    await expect(page.getByText('Scroll WS')).toBeVisible({ timeout: 10000 });
    await page.getByText('Scroll WS').click();

    await expect(page.getByText(singleLineChName)).toBeVisible({ timeout: 10000 });
    await page.getByText(singleLineChName).first().click();

    // Wait for last message to be rendered
    await expect(page.getByText(`single line message ${MESSAGE_COUNT - 1}`)).toBeVisible({ timeout: 10000 });

    // Give layout a moment to settle
    await page.waitForTimeout(500);

    const distance = await getScrollDistanceFromBottom(page);
    // Should be at or very near the bottom (within 5px)
    expect(distance).toBeLessThanOrEqual(5);
  });

  test('multi-line channel scrolls to bottom', async ({ page }) => {
    await loginWithToken(page, token, user);

    // Switch to the Scroll WS workspace
    await expect(page.getByText('Scroll WS')).toBeVisible({ timeout: 10000 });
    await page.getByText('Scroll WS').click();

    await expect(page.getByText(multiLineChName)).toBeVisible({ timeout: 10000 });
    await page.getByText(multiLineChName).first().click();

    // Wait for last message to be rendered
    await expect(page.getByText(`line 9 of message ${MESSAGE_COUNT - 1}`)).toBeVisible({ timeout: 10000 });

    // Give layout a moment to settle
    await page.waitForTimeout(500);

    const distance = await getScrollDistanceFromBottom(page);
    // Should be at or very near the bottom (within 5px)
    // This is the test that exposes the bug — multiline messages
    // cause the scroll-to-bottom to fire before layout is complete,
    // leaving the user stranded partway up.
    expect(distance).toBeLessThanOrEqual(5);
  });
});
