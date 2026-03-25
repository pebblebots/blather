import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthPage } from './AuthPage';
import { AppContext } from '../lib/store';
import type { ReactNode } from 'react';

afterEach(() => cleanup());

const mockRequestMagicLink = vi.fn();
const mockVerifyMagicLink = vi.fn();

vi.mock('../lib/api', () => ({
  api: {
    requestMagicLink: (...args: any[]) => mockRequestMagicLink(...args),
    verifyMagicLink: (...args: any[]) => mockVerifyMagicLink(...args),
  },
  setToken: vi.fn(),
}));

const setUser = vi.fn();

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <AppContext.Provider value={{ user: null, setUser }}>
      {children}
    </AppContext.Provider>
  );
}

describe('AuthPage', () => {
  it('renders email input and submit button', () => {
    render(<AuthPage />, { wrapper: Wrapper });
    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
    expect(screen.getByText('Send Magic Link')).toBeInTheDocument();
  });

  it('submits email and transitions to check-inbox step', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent' });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'test@example.com');
    await user.click(screen.getByText('Send Magic Link'));

    expect(mockRequestMagicLink).toHaveBeenCalledWith('test@example.com');
    expect(await screen.findByText(/check your inbox/i)).toBeInTheDocument();
  });

  it('shows dev verify button when dev token is returned', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent', _dev: { token: 'dev-token-123', url: '/verify' } });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'test@example.com');
    await user.click(screen.getByText('Send Magic Link'));

    expect(await screen.findByText('Verify (Dev)')).toBeInTheDocument();
  });

  it('shows error on failed magic link request', async () => {
    mockRequestMagicLink.mockRejectedValue(new Error('Invalid email'));
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'bad@test.com');
    await user.click(screen.getByText('Send Magic Link'));

    expect(await screen.findByText(/Invalid email/)).toBeInTheDocument();
  });

  it('has back button from check-inbox step', async () => {
    mockRequestMagicLink.mockResolvedValue({ ok: true, message: 'sent' });
    const user = userEvent.setup();

    render(<AuthPage />, { wrapper: Wrapper });
    await user.type(screen.getByPlaceholderText('you@company.com'), 'test@example.com');
    await user.click(screen.getByText('Send Magic Link'));

    await screen.findByText(/check your inbox/i);
    await user.click(screen.getByText('← Back'));

    expect(screen.getByPlaceholderText('you@company.com')).toBeInTheDocument();
  });
});
