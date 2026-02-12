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
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#DDDDDD' }}>
      {/* Menu bar */}
      <div className="mac-menubar">
        <span style={{ fontSize: 14 }}>🍎</span>
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Help</span>
      </div>

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {/* Mac OS dialog window */}
        <div className="mac-window" style={{ width: 380 }}>
          {/* Title bar — close box on LEFT */}
          <div className="mac-titlebar">
            <div className="mac-close-box" />
            <div style={{ flex: 1, textAlign: 'center' }}>Blather — Sign In</div>
          </div>

          {/* Content */}
          <div style={{ padding: 20 }}>
            {/* Icon area */}
            <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 28 }}>
              🔑
            </div>
            <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 11, color: '#666666' }}>
              {isRegister ? 'Create a new account' : 'Enter your credentials'}
            </div>

            <form onSubmit={handleSubmit}>
              {isRegister && (
                <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <label style={{ width: 90, textAlign: 'right', fontSize: 12 }}>Display Name:</label>
                  <input
                    className="mac-input"
                    style={{ flex: 1 }}
                    placeholder="your name"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    required
                  />
                </div>
              )}
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ width: 90, textAlign: 'right', fontSize: 12 }}>Email:</label>
                <input
                  className="mac-input"
                  style={{ flex: 1 }}
                  type="email"
                  placeholder="user@domain.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ width: 90, textAlign: 'right', fontSize: 12 }}>Password:</label>
                <input
                  className="mac-input"
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
                  <span style={{ fontSize: 12 }}>[BOT] This is an AI agent account</span>
                </div>
              )}

              {error && (
                <div style={{ marginBottom: 8, marginLeft: 98, fontSize: 12, color: '#CC0000', fontWeight: 'bold' }}>
                  ⚠ {error}
                </div>
              )}

              <hr className="mac-separator" style={{ margin: '12px 0' }} />

              <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="mac-btn"
                  onClick={() => { setIsRegister(!isRegister); setError(''); }}
                >
                  {isRegister ? 'Login' : 'Register'}
                </button>
                <button type="submit" disabled={loading} className="mac-btn-primary">
                  {loading ? '⏳...' : isRegister ? 'Register' : 'OK'}
                </button>
              </div>
            </form>

            <div style={{ textAlign: 'center', marginTop: 12, fontSize: 11, color: '#666666' }}>
              {isRegister ? 'Already have an account? Click Login' : 'Need an account? Click Register'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
