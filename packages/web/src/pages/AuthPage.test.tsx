import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthPage } from './AuthPage';
import { AppContext } from '../lib/store';
import type { ReactNode } from 'react';

afterEach(() => cleanup());

const mockRequestMagicLink = vi.fn();
const mockVerifyMagicLink = vi.fn();
const mockVerifyMagicCode = vi.fn();
const mockSetToken = vi.fn();
const setUser = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    requestMagicLink: (email: string) => mockRequestMagicLink(email),
    verifyMagicLink: (token: string) => mockVerifyMagicLink(token),
    verifyMagicCode: (email: string, code: string) => mockVerifyMagicCode(email, code),
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

/** Navigate to the check-inbox step by submitting an email */
async function goToCheckInbox(user: ReturnType<typeof userEvent.setup>, email = 'test@example.com') {
  await user.type(screen.getByLabelText('Email:'), email);
  await user.click(screen.getByRole('button', { name: 'Send Magic Link' }));
  await screen.findByText(/check your inbox/i);
}

describe('AuthPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('renders email input and submit button', () => {
    render(<AuthPage />, { wrapper: Wrapper });

    expect(screen.getByLabelText('Email:')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Magic Link' })).toBeInTheDocument();
  });

  it('submits email and transitions to check-inbox step', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent' });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user);

    expect(mockRequestMagicLink).toHaveBeenCalledWith('test@example.com');
    expect(screen.getByText(/check your inbox for/i)).toBeInTheDocument();
  });

  it('shows dev verify button when dev token is returned', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, _dev: { token: 'dev-token-123' } });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user);

    expect(screen.getByRole('button', { name: 'Verify (Dev)' })).toBeInTheDocument();
  });

  it('verifies the dev token and signs the user in', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, _dev: { token: 'dev-token-123' } });
    mockVerifyMagicLink.mockResolvedValue({
      token: 'session-token',
      user: { id: 'u-1', email: 'test@example.com', displayName: 'Test User' },
    });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user);
    await user.click(screen.getByRole('button', { name: 'Verify (Dev)' }));

    expect(mockVerifyMagicLink).toHaveBeenCalledWith('dev-token-123');
    expect(mockSetToken).toHaveBeenCalledWith('session-token');
    expect(setUser).toHaveBeenCalledWith({
      id: 'u-1',
      email: 'test@example.com',
      displayName: 'Test User',
    });
    expect(window.location.pathname).toBe('/');
  });

  it('verifies a 6-digit code and signs the user in', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true });
    mockVerifyMagicCode.mockResolvedValue({
      token: 'code-session-token',
      user: { id: 'u-2', email: 'code@example.com', displayName: 'Code User' },
    });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user, 'code@example.com');

    await user.type(screen.getByLabelText('Code:'), '654321');
    await user.click(screen.getByRole('button', { name: 'Verify Code' }));

    expect(mockVerifyMagicCode).toHaveBeenCalledWith('code@example.com', '654321');
    expect(mockSetToken).toHaveBeenCalledWith('code-session-token');
    expect(setUser).toHaveBeenCalledWith({
      id: 'u-2',
      email: 'code@example.com',
      displayName: 'Code User',
    });
  });

  it('disables verify button when code is not exactly 6 digits', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user);

    const verifyBtn = screen.getByRole('button', { name: 'Verify Code' });
    expect(verifyBtn).toBeDisabled();

    await user.type(screen.getByLabelText('Code:'), '12345');
    expect(verifyBtn).toBeDisabled();

    await user.type(screen.getByLabelText('Code:'), '6');
    expect(verifyBtn).toBeEnabled();
  });

  it('strips non-numeric characters from code input', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user);

    const codeInput = screen.getByLabelText('Code:');
    await user.type(codeInput, 'a1b2c3d4e5f6');
    expect(codeInput).toHaveValue('123456');
  });

  it('auto-verifies a token from the URL on mount', async () => {
    window.history.replaceState({}, '', '/?token=url-token-abc');
    mockVerifyMagicLink.mockResolvedValue({
      token: 'url-session-token',
      user: { id: 'u-3', email: 'url@example.com', displayName: 'URL User' },
    });

    render(<AuthPage />, { wrapper: Wrapper });

    // Wait for the async verification to complete
    await screen.findByLabelText('Email:'); // component settles after verify
    expect(mockVerifyMagicLink).toHaveBeenCalledWith('url-token-abc');
    expect(mockSetToken).toHaveBeenCalledWith('url-session-token');
    expect(setUser).toHaveBeenCalledWith({
      id: 'u-3',
      email: 'url@example.com',
      displayName: 'URL User',
    });
  });

  it('falls back to email step when URL token verification fails', async () => {
    window.history.replaceState({}, '', '/?token=bad-token');
    mockVerifyMagicLink.mockRejectedValue(new Error('Token expired'));

    render(<AuthPage />, { wrapper: Wrapper });

    expect(await screen.findByText(/Token expired/)).toBeInTheDocument();
    expect(screen.getByLabelText('Email:')).toBeInTheDocument();
  });

  it('shows error on failed magic link request', async () => {
    mockRequestMagicLink.mockRejectedValue(new Error('Invalid email'));
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByLabelText('Email:'), 'bad@test.com');
    await user.click(screen.getByRole('button', { name: 'Send Magic Link' }));

    expect(await screen.findByText(/Invalid email/)).toBeInTheDocument();
  });

  it('shows error on failed code verification', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true });
    mockVerifyMagicCode.mockRejectedValue(new Error('Invalid code'));
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user);
    await user.type(screen.getByLabelText('Code:'), '000000');
    await user.click(screen.getByRole('button', { name: 'Verify Code' }));

    expect(await screen.findByText(/Invalid code/)).toBeInTheDocument();
  });

  it('returns to the email step from the check-inbox step', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await goToCheckInbox(user);
    await user.click(screen.getByRole('button', { name: '← Back' }));

    expect(screen.getByLabelText('Email:')).toBeInTheDocument();
  });
});
