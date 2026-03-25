import { test, expect } from '@playwright/test';

test.describe('T35: Auth flow', () => {
  test('magic link login flow', async ({ page }) => {
    await page.goto('/');
    // Should see the sign-in page
    await expect(page.getByText('Blather — Sign In')).toBeVisible();

    // Enter email and request magic link
    await page.getByPlaceholder('you@company.com').fill('e2e-auth@test.com');
    await page.getByRole('button', { name: /send magic link/i }).click();

    // Should transition to check-inbox step
    await expect(page.getByText(/check your inbox/i)).toBeVisible();

    // In dev mode, "Verify (Dev)" button should appear
    const verifyBtn = page.getByRole('button', { name: /verify.*dev/i });
    await expect(verifyBtn).toBeVisible({ timeout: 5000 });

    // Click verify to complete auth
    await verifyBtn.click();

    // Should land on the main page (menu bar visible)
    await expect(page.locator('.mac-menubar')).toBeVisible({ timeout: 10000 });
  });

  test('back button returns to email step', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('you@company.com').fill('e2e-back@test.com');
    await page.getByRole('button', { name: /send magic link/i }).click();
    await expect(page.getByText(/check your inbox/i)).toBeVisible();

    await page.getByRole('button', { name: '← Back' }).click();
    await expect(page.getByPlaceholder('you@company.com')).toBeVisible();
  });
});
