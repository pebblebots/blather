import { useState, useEffect } from 'react';
import { AppContext, type User } from './lib/store';
import { AuthPage } from './pages/AuthPage';
import { MainPage } from './pages/MainPage';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('blather_token');
    if (!token) { setChecking(false); return; }

    fetch(`${import.meta.env.VITE_API_URL || ''}/workspaces`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error();
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
    return <div className="min-h-screen flex items-center justify-center bg-cream text-secondary font-mono">Loading...</div>;
  }

  return (
    <AppContext.Provider value={{ user, setUser: handleSetUser }}>
      {user ? <MainPage /> : <AuthPage />}
    </AppContext.Provider>
  );
}
