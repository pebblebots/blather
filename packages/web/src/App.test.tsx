import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const mockGetChannels = vi.fn();
const mockClearToken = vi.fn();

vi.mock('./lib/api', () => ({
  api: { getChannels: () => mockGetChannels() },
  clearToken: (...args: unknown[]) => mockClearToken(...args),
}));

vi.mock('./pages/AuthPage', () => ({
  AuthPage: () => <div data-testid="auth-page">AuthPage</div>,
}));

vi.mock('./pages/MainPage', () => ({
  MainPage: () => <div data-testid="main-page">MainPage</div>,
}));

import App from './App';

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

const TEST_USER = {
  id: 'u1',
  email: 'a@b.com',
  displayName: 'Alice',
  avatarUrl: null,
  isAgent: false,
};

describe('App', () => {
  it('shows MainPage as guest when no token is stored AND server has guest mode on', async () => {
    // T#161 + 2026-05-09 narrowing: when there's no token, App probes the
    // server with /channels. If guest mode is on the server returns 200
    // (guest-visible channels). App mounts MainPage with the synthesized
    // GUEST_USER so the guest can read #general without signing in.
    mockGetChannels.mockResolvedValue([]);
    render(<App />);
    await screen.findByTestId('main-page');
    expect(mockGetChannels).toHaveBeenCalledTimes(1);
  });

  it('shows AuthPage when no token AND server returns 401 (guest mode off)', async () => {
    mockGetChannels.mockRejectedValue(new Error('401'));
    render(<App />);
    await screen.findByTestId('auth-page');
    expect(mockClearToken).not.toHaveBeenCalled();
  });

  it('does NOT persist the guest sentinel to localStorage', async () => {
    mockGetChannels.mockResolvedValue([]);
    render(<App />);
    await screen.findByTestId('main-page');
    // Guest sentinel must NEVER be written to localStorage so a future
    // page-load goes back through the unauth-token branch and re-derives
    // guest state from the server (catches the case where the server
    // turns guest mode off mid-session).
    expect(localStorage.getItem('blather_user')).toBeNull();
    expect(localStorage.getItem('blather_token')).toBeNull();
  });

  it('shows loading state while validating token', () => {
    localStorage.setItem('blather_token', 'tok');
    // Never resolve the workspace call
    mockGetChannels.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('⏳ Loading...')).toBeInTheDocument();
  });

  it('shows MainPage when token and stored user are valid', async () => {
    localStorage.setItem('blather_token', 'tok');
    localStorage.setItem('blather_user', JSON.stringify(TEST_USER));
    mockGetChannels.mockResolvedValue([]);

    render(<App />);
    await screen.findByTestId('main-page');
  });

  it('clears token and shows AuthPage when validation fails', async () => {
    localStorage.setItem('blather_token', 'bad-tok');
    mockGetChannels.mockRejectedValue(new Error('401'));

    render(<App />);
    await screen.findByTestId('auth-page');
    expect(mockClearToken).toHaveBeenCalled();
  });

  it('clears token when token is valid but no stored user', async () => {
    localStorage.setItem('blather_token', 'tok');
    // No blather_user in storage
    mockGetChannels.mockResolvedValue([]);

    render(<App />);
    await screen.findByTestId('auth-page');
    expect(mockClearToken).toHaveBeenCalled();
  });
});
