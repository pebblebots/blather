import { useState, useEffect } from 'react';
import { AppContext, type User } from './lib/store';
import { api, clearToken } from './lib/api';
import { AuthPage } from './pages/AuthPage';
import { MainPage } from './pages/MainPage';
import { ToastProvider } from './components/Toast';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('blather_token');
    if (!token) { setChecking(false); return; }

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
    if (u) localStorage.setItem('blather_user', JSON.stringify(u));
    else { localStorage.removeItem('blather_user'); clearToken(); }
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
