import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { AppContext, useApp, type User } from './store';

const testUser: User = {
  id: 'u-1',
  email: 'test@example.com',
  displayName: 'Test User',
  avatarUrl: null,
  isAgent: false,
};

function Wrapper({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  return (
    <AppContext.Provider value={{ user, setUser }}>
      {children}
    </AppContext.Provider>
  );
}

describe('store', () => {
  it('provides null user by default', () => {
    const { result } = renderHook(() => useApp(), { wrapper: Wrapper });
    expect(result.current.user).toBeNull();
  });

  it('setUser updates the user state', () => {
    const { result } = renderHook(() => useApp(), { wrapper: Wrapper });
    act(() => result.current.setUser(testUser));
    expect(result.current.user).toEqual(testUser);
  });

  it('setUser(null) clears the user', () => {
    const { result } = renderHook(() => useApp(), { wrapper: Wrapper });
    act(() => result.current.setUser(testUser));
    act(() => result.current.setUser(null));
    expect(result.current.user).toBeNull();
  });

  it('default context has no-op setUser', () => {
    // Without a provider wrapper, the default context value is used
    const { result } = renderHook(() => useApp());
    expect(result.current.user).toBeNull();
    // Should not throw
    act(() => result.current.setUser(testUser));
    // Default setUser is no-op, so user stays null
    expect(result.current.user).toBeNull();
  });
});
