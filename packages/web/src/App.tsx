import { useState, useEffect } from 'react';
import { AppContext, type User } from './lib/store';
import { AuthPage } from './pages/AuthPage';
import { MainPage } from './pages/MainPage';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if we have a stored token/user
    const token = localStorage.getItem('blather_token');
    if (!token) { setChecking(false); return; }

    // Try to validate by fetching workspaces (any authed endpoint)
    fetch('/api/workspaces', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error();
        // We don't have a /me endpoint, so just mark as logged in with minimal user
        const stored = localStorage.getItem('blather_user');
        if (stored) setUser(JSON.parse(stored));
        else { localStorage.removeItem('blather_token'); }
      })
      .catch(() => { localStorage.removeItem('blather_token'); })
      .finally(() => setChecking(false));
  }, []);

  const handleSetUser = (u: User | null) => {
    setUser(u);
    if (u) localStorage.setItem('blather_user', JSON.stringify(u));
    else { localStorage.removeItem('blather_user'); localStorage.removeItem('blather_token'); }
  };

  if (checking) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-gray-400">Loading...</div>;
  }

  return (
    <AppContext.Provider value={{ user, setUser: handleSetUser }}>
      {user ? <MainPage /> : <AuthPage />}
    </AppContext.Provider>
  );
}
