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

afterEach(() => {
  cleanup();
  // Reset URL between tests so /auth tests don't bleed into others.
  window.history.replaceState({}, '', '/');
});

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
  it('shows AuthPage without probing the server when no token is stored', async () => {
    // Guest mode is gone: an unauthenticated visitor goes straight to
    // AuthPage and the app never probes authenticated routes while logged out.
    render(<App />);
    await screen.findByTestId('auth-page');
    expect(mockGetChannels).not.toHaveBeenCalled();
    expect(mockClearToken).not.toHaveBeenCalled();
  });

  it('writes nothing to localStorage for an unauthenticated visitor', async () => {
    render(<App />);
    await screen.findByTestId('auth-page');
    expect(localStorage.getItem('blather_user')).toBeNull();
    expect(localStorage.getItem('blather_token')).toBeNull();
  });

  it('shows AuthPage on /auth without probing the server', async () => {
    // Magic-link verify and "sign in" both land on /auth with no token;
    // AuthPage renders and no authenticated route is probed.
    window.history.replaceState({}, '', '/auth');
    render(<App />);
    await screen.findByTestId('auth-page');
    expect(mockGetChannels).not.toHaveBeenCalled();
  });

  it('renders MainPage when on /auth but already signed in (real user)', async () => {
    // After auth completes, AuthPage replaceState's URL back to / then
    // calls setUser(realUser). But if React hasn't re-rendered yet and
    // we're still on /auth, the real user must still beat the auth-page
    // pin so we don't strand the user on AuthPage.
    window.history.replaceState({}, '', '/auth');
    localStorage.setItem('blather_token', 'tok');
    localStorage.setItem('blather_user', JSON.stringify(TEST_USER));
    mockGetChannels.mockResolvedValue([]);
    render(<App />);
    await screen.findByTestId('main-page');
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
