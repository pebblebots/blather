import { type Page, expect } from '@playwright/test';

const API_URL = 'http://localhost:3000';

/** Register/login a user via the magic-link API flow and return their JWT + user info */
export async function registerUser(email: string, _displayName?: string, _isAgent = false) {
  // Step 1: request a magic link (dev mode returns the token)
  const magicRes = await fetch(`${API_URL}/auth/magic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const magicBody = await magicRes.json();
  const devToken = magicBody._dev?.token;
  if (!devToken) throw new Error('No _dev token returned — is RESEND_API_KEY unset?');

  // Step 2: verify the magic token → creates user if needed, returns JWT
  const verifyRes = await fetch(`${API_URL}/auth/magic/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: devToken }),
  });
  if (!verifyRes.ok) throw new Error(`Magic verify failed: ${verifyRes.status}`);
  return verifyRes.json();
}

/** Authenticate via the dev magic link flow in the browser */
export async function loginViaMagicLink(page: Page, email: string) {
  await page.goto('/');
  await page.getByPlaceholder('you@company.com').fill(email);
  await page.getByRole('button', { name: /send magic link/i }).click();
  // In dev mode, a "Verify (Dev)" button appears
  await page.getByRole('button', { name: /verify.*dev/i }).click();
  // Should land on main page (or workspace creation modal)
  await expect(page.locator('.mac-menubar')).toBeVisible({ timeout: 10000 });
}

/** Login by injecting a JWT token + user into localStorage */
export async function loginWithToken(page: Page, token: string, user?: Record<string, unknown>) {
  await page.goto('/');
  await page.evaluate(({ t, u }) => {
    localStorage.setItem('blather_token', t);
    if (u) localStorage.setItem('blather_user', JSON.stringify(u));
  }, { t: token, u: user });
  await page.reload();
  await expect(page.locator('.mac-menubar')).toBeVisible({ timeout: 10000 });
}

/** Create a workspace via API */
export async function createWorkspace(token: string, name: string, slug: string) {
  const res = await fetch(`${API_URL}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, slug }),
  });
  return res.json();
}

/** Create a channel via API */
export async function createChannel(token: string, workspaceId: string, name: string, slug: string) {
  const res = await fetch(`${API_URL}/workspaces/${workspaceId}/channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name, slug }),
  });
  return res.json();
}

/** Send a message via API */
export async function sendMessage(token: string, channelId: string, content: string) {
  const res = await fetch(`${API_URL}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ content }),
  });
  return res.json();
}
