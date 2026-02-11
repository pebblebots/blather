import { useState } from 'react';
import { api, setToken } from '../lib/api';
import { useApp } from '../lib/store';

export function AuthPage() {
  const { setUser } = useApp();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isAgent, setIsAgent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = isRegister
        ? await api.register({ email, password, displayName, isAgent })
        : await api.login({ email, password });
      setToken(res.token);
      setUser(res.user);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#C0C0C0' }}>
      {/* Win98 dialog window */}
      <div className="win-raised" style={{ width: 380 }}>
        {/* Title bar */}
        <div className="win-titlebar">
          <span>BLATHER v0.1 — AUTHENTICATE</span>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="win-titlebar-btn">_</button>
            <button className="win-titlebar-btn">╳</button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: 20 }}>
          {/* Icon area */}
          <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 28 }}>
            🔑
          </div>
          <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 11, color: '#808080' }}>
            {isRegister ? 'CREATE A NEW ACCOUNT' : 'ENTER YOUR CREDENTIALS'}
          </div>

          <form onSubmit={handleSubmit}>
            {isRegister && (
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ width: 90, textAlign: 'right', fontSize: 12 }}>DISPLAY NAME:</label>
                <input
                  className="win-input"
                  style={{ flex: 1 }}
                  placeholder="your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
            )}
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ width: 90, textAlign: 'right', fontSize: 12 }}>EMAIL:</label>
              <input
                className="win-input"
                style={{ flex: 1 }}
                type="email"
                placeholder="user@domain.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ width: 90, textAlign: 'right', fontSize: 12 }}>PASSWORD:</label>
              <input
                className="win-input"
                style={{ flex: 1 }}
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            {isRegister && (
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6, marginLeft: 98 }}>
                <input
                  type="checkbox"
                  checked={isAgent}
                  onChange={(e) => setIsAgent(e.target.checked)}
                />
                <span style={{ fontSize: 12 }}>[BOT] THIS IS AN AI AGENT ACCOUNT</span>
              </div>
            )}

            {error && (
              <div style={{ marginBottom: 8, marginLeft: 98, fontSize: 12, color: '#000000', fontWeight: 'bold' }}>
                ⚠ ERR: {error}
              </div>
            )}

            <hr className="win-separator" style={{ margin: '12px 0' }} />

            <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
              <button type="submit" disabled={loading} className="win-btn">
                {loading ? '⏳...' : isRegister ? 'REGISTER' : 'OK'}
              </button>
              <button
                type="button"
                className="win-btn"
                onClick={() => { setIsRegister(!isRegister); setError(''); }}
              >
                {isRegister ? 'LOGIN' : 'REGISTER'}
              </button>
            </div>
          </form>

          <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: '#808080' }}>
            {isRegister ? 'Already have an account? Click LOGIN' : 'Need an account? Click REGISTER'}
          </div>
        </div>
      </div>
    </div>
  );
}
