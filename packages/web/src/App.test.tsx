import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const mockGetWorkspaces = vi.fn();
const mockClearToken = vi.fn();

vi.mock('./lib/api', () => ({
  api: { getWorkspaces: () => mockGetWorkspaces() },
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
  it('shows AuthPage when no token is stored', async () => {
    render(<App />);
    // No token → skip fetch, checking becomes false → render AuthPage
    await screen.findByTestId('auth-page');
    expect(mockGetWorkspaces).not.toHaveBeenCalled();
  });

  it('shows loading state while validating token', () => {
    localStorage.setItem('blather_token', 'tok');
    // Never resolve the workspace call
    mockGetWorkspaces.mockReturnValue(new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('⏳ Loading...')).toBeInTheDocument();
  });

  it('shows MainPage when token and stored user are valid', async () => {
    localStorage.setItem('blather_token', 'tok');
    localStorage.setItem('blather_user', JSON.stringify(TEST_USER));
    mockGetWorkspaces.mockResolvedValue([]);

    render(<App />);
    await screen.findByTestId('main-page');
  });

  it('clears token and shows AuthPage when validation fails', async () => {
    localStorage.setItem('blather_token', 'bad-tok');
    mockGetWorkspaces.mockRejectedValue(new Error('401'));

    render(<App />);
    await screen.findByTestId('auth-page');
    expect(mockClearToken).toHaveBeenCalled();
  });

  it('clears token when token is valid but no stored user', async () => {
    localStorage.setItem('blather_token', 'tok');
    // No blather_user in storage
    mockGetWorkspaces.mockResolvedValue([]);

    render(<App />);
    await screen.findByTestId('auth-page');
    expect(mockClearToken).toHaveBeenCalled();
  });
});
