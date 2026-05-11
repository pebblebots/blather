import { useState, useEffect } from 'react';
import { AppContext, type User } from './lib/store';
import { api, clearToken } from './lib/api';
import { AuthPage } from './pages/AuthPage';
import { MainPage } from './pages/MainPage';
import { ToastProvider } from './components/Toast';

// Guest sentinel — must match GUEST_USER_ID on the server
// (packages/api/src/config/guest-mode.ts) and the GUEST_USER_ID const in
// MainPage.tsx that drives the read-only UI branches.
const GUEST_USER_ID = 'guest:shared';
const GUEST_USER: User = {
  id: GUEST_USER_ID,
  email: 'guest@yappers.world',
  displayName: 'Guest',
  avatarUrl: null,
  isAgent: false,
};

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('blather_token');

    if (!token) {
      // No token — try the guest path. If the server is in GUEST_MODE_VIEW_ONLY,
      // /channels will return 200 with the guest-visible channel set
      // (default: just #general). If it returns 401, guest mode is off and
      // we fall through to the auth page.
      api.getChannels()
        .then(() => { setUser(GUEST_USER); })
        .catch(() => { /* leave user null → AuthPage */ })
        .finally(() => setChecking(false));
      return;
    }

    // Have a token — validate it by fetching channels (which authenticates
    // via the X-API-Key / bearer header and falls through to guest only if
    // the token has been revoked).
    api.getChannels()
      .then(() => {
        const stored = localStorage.getItem('blather_user');
        if (stored) setUser(JSON.parse(stored));
        else clearToken();
      })
      .catch(() => { clearToken(); })
      .finally(() => setChecking(false));
  }, []);

  const handleSetUser = (u: User | null) => {
    setUser(u);
    if (u && u.id !== GUEST_USER_ID) {
      localStorage.setItem('blather_user', JSON.stringify(u));
    } else if (!u) {
      localStorage.removeItem('blather_user');
      clearToken();
    }
    // Guest sentinel: never persisted — next page-load goes through the
    // unauth-token branch above and re-derives guest state from /channels.
  };

  if (checking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#DDDDDD', fontFamily: "'Geneva', 'Helvetica Neue', system-ui, sans-serif", fontSize: 12 }}>
        ⏳ Loading...
      </div>
    );
  }

  return (
    <AppContext.Provider value={{ user, setUser: handleSetUser }}>
      <ToastProvider>
        {user ? <MainPage /> : <AuthPage />}
      </ToastProvider>
    </AppContext.Provider>
  );
}
