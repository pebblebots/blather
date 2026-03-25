import { type Page, expect } from '@playwright/test';

const API_URL = 'http://localhost:3000';

/** Register a user via the API and return their JWT + user info */
export async function registerUser(email: string, displayName: string, isAgent = false) {
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'testpass123', displayName, isAgent }),
  });
  if (!res.ok) {
    // If user already exists, login instead
    const loginRes = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'testpass123' }),
    });
    return loginRes.json();
  }
  return res.json();
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

/** Login by injecting a JWT token directly into localStorage */
export async function loginWithToken(page: Page, token: string) {
  await page.goto('/');
  await page.evaluate((t) => localStorage.setItem('blather_token', t), token);
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
