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

  // /auth-prefix-aware: AuthPage owns any URL starting with /auth.
  // That covers:
  //   - /auth        → user clicked "Sign in to post"
  //   - /auth/verify → user clicked the magic-link email
  //   - /auth?token  → legacy magic-link query param
  // Without this, /auth/verify falls through to the guest probe and
  // AuthPage's mount-effect never runs, so the token in the URL is
  // silently discarded and the user stays logged out.
  const path = typeof window !== 'undefined' ? window.location.pathname : '';
  const wantsAuthPage = path === '/auth' || path.startsWith('/auth/');

  useEffect(() => {
    const token = localStorage.getItem('blather_token');

    if (!token) {
      // If the user navigated explicitly to /auth, skip the guest probe
      // and render AuthPage immediately. Otherwise try the guest path.
      if (wantsAuthPage) { setChecking(false); return; }

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
        if (stored) {
          setUser(JSON.parse(stored));
          setChecking(false);
        } else {
          // Token validated but no user record — treat as broken state, fall
          // through to the unauth flow (guest probe / AuthPage).
          clearToken();
          tryGuestThenFinish();
        }
      })
      .catch(() => {
        // Token rejected (server says it's invalid/expired). Clear it and
        // re-attempt as an unauth user so guest mode can take over instead
        // of dumping the user on AuthPage.
        clearToken();
        if (wantsAuthPage) { setChecking(false); return; }
        tryGuestThenFinish();
      });

    function tryGuestThenFinish() {
      api.getChannels()
        .then(() => { setUser(GUEST_USER); })
        .catch(() => { /* leave user null → AuthPage */ })
        .finally(() => setChecking(false));
    }
  }, [wantsAuthPage]);

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

  // Render priority:
  //   1. Real signed-in user (not the guest sentinel) → MainPage. AuthPage
  //      success path replaceState's URL back to '/' before calling setUser,
  //      so by the time we re-render with a real user the /auth-pinned
  //      flag is moot — but we still skip it here because the user is
  //      truly signed in regardless of pathname.
  //   2. URL is /auth (and user is null OR guest sentinel) → AuthPage.
  //      Lets a guest click "Sign in to post" and actually reach the form.
  //   3. Have a guest sentinel and not on /auth → MainPage (read-only).
  //   4. Nothing → AuthPage (default).
  const isRealUser = user !== null && user.id !== GUEST_USER_ID;
  const showAuthPage = isRealUser ? false : (wantsAuthPage || !user);

  return (
    <AppContext.Provider value={{ user, setUser: handleSetUser }}>
      <ToastProvider>
        {showAuthPage ? <AuthPage /> : <MainPage />}
      </ToastProvider>
    </AppContext.Provider>
  );
}
