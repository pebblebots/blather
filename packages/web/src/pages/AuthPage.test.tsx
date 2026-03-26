import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthPage } from './AuthPage';
import { AppContext } from '../lib/store';
import type { ReactNode } from 'react';

afterEach(() => cleanup());

const mockRequestMagicLink = vi.fn();
const mockVerifyMagicLink = vi.fn();
const mockSetToken = vi.fn();
const setUser = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    requestMagicLink: (email: string) => mockRequestMagicLink(email),
    verifyMagicLink: (token: string) => mockVerifyMagicLink(token),
  },
  setToken: (token: string) => mockSetToken(token),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AppContext.Provider value={{ user: null, setUser }}>
      {children}
    </AppContext.Provider>
  );
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders email input and submit button', () => {
    render(<AuthPage />, { wrapper: Wrapper });

    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Magic Link' })).toBeInTheDocument();
  });

  it('submits email and transitions to check-inbox step', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent' });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Magic Link' }));

    expect(mockRequestMagicLink).toHaveBeenCalledWith('test@example.com');
    expect(await screen.findByText(/check your inbox for/i)).toBeInTheDocument();
  });

  it('shows dev verify button when dev token is returned', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent', _dev: { token: 'dev-token-123', url: '/verify' } });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Magic Link' }));

    expect(await screen.findByRole('button', { name: 'Verify (Dev)' })).toBeInTheDocument();
  });

  it('verifies the dev token and signs the user in', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent', _dev: { token: 'dev-token-123', url: '/verify' } });
    mockVerifyMagicLink.mockResolvedValue({
      token: 'session-token',
      user: { id: 'u-1', email: 'test@example.com', displayName: 'Test User' },
    });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Magic Link' }));
    await user.click(await screen.findByRole('button', { name: 'Verify (Dev)' }));

    expect(mockVerifyMagicLink).toHaveBeenCalledWith('dev-token-123');
    expect(mockSetToken).toHaveBeenCalledWith('session-token');
    expect(setUser).toHaveBeenCalledWith({
      id: 'u-1',
      email: 'test@example.com',
      displayName: 'Test User',
    });
    expect(window.location.pathname).toBe('/');
  });

  it('shows error on failed magic link request', async () => {
    mockRequestMagicLink.mockRejectedValue(new Error('Invalid email'));
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'bad@test.com');
    await user.click(screen.getByRole('button', { name: 'Send Magic Link' }));

    expect(await screen.findByText(/Invalid email/)).toBeInTheDocument();
  });

  it('returns to the email step from the check-inbox step', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent' });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'test@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Magic Link' }));

    await screen.findByText(/check your inbox/i);
    await user.click(screen.getByRole('button', { name: '← Back' }));

    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
  });
});
