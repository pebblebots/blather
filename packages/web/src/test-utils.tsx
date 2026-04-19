import { render as rtlRender, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { ToastProvider } from './components/Toast';

/**
 * All app-level providers every test render should have.
 * Keep this small: add only context providers whose absence would throw.
 *
 * T#145: useToast() throws if not wrapped. Every component that renders the
 * toast-consuming tree (MessageInput, MessageList, Modals, TaskPanel,
 * ThreadPanel, MainPage, …) must render under ToastProvider.
 */
export function AllProviders({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

/**
 * Drop-in replacement for @testing-library/react's render that wraps in
 * AllProviders. Accepts an optional `wrapper` that will be composed *inside*
 * AllProviders so callers can keep using their own per-test wrappers
 * (e.g. AppContext.Provider) without losing toast support.
 */
export function render(ui: ReactElement, options?: RenderOptions) {
  const UserWrapper = options?.wrapper;
  const Wrapper = UserWrapper
    ? ({ children }: { children: ReactNode }) => (
        <AllProviders>
          <UserWrapper>{children}</UserWrapper>
        </AllProviders>
      )
    : AllProviders;
  return rtlRender(ui, { ...options, wrapper: Wrapper });
}

// Re-export everything else from RTL so tests can do a single import.
export * from '@testing-library/react';
