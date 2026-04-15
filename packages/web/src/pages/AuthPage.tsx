import { useState, useEffect } from 'react';
import { api, setToken } from '../lib/api';
import { useApp } from '../lib/store';
import MenuBar from '../components/MenuBar';

type Step = 'email' | 'check-inbox' | 'verify';

export function AuthPage() {
  const { setUser } = useApp();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [devToken, setDevToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Check URL for magic token on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      verifyToken(token);
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const requestMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.requestMagicLink(email);
      // In dev mode, we get the token back
      if (res._dev?.token) {
        setDevToken(res._dev.token);
      }
      setStep('check-inbox');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const verifyToken = async (token: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await api.verifyMagicLink(token);
      setToken(res.token);
      window.history.replaceState({}, '', '/');
      setUser(res.user);
    } catch (err: any) {
      setError(err.message);
      setStep('email');
    } finally {
      setLoading(false);
    }
  };


  const verifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.verifyMagicCode(email, code);
      setToken(res.token);
      window.history.replaceState({}, '', '/');
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
      <MenuBar />

      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="mac-window" style={{ width: 380 }}>
          <div className="mac-titlebar">
            <div className="mac-close-box" />
            <div style={{ flex: 1, textAlign: 'center' }}>Yappers — Sign In</div>
          </div>

          <div style={{ padding: 20 }}>
            {step === 'email' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 28 }}>✉️</div>
                <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 11, color: '#666666' }}>
                  Enter your email to receive a magic sign-in link
                </div>

                <form onSubmit={requestMagicLink}>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ width: 60, textAlign: 'right', fontSize: 12 }}>Email:</label>
                    <input
                      className="mac-input"
                      style={{ flex: 1 }}
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                    />
                  </div>

                  {error && (
                    <div style={{ marginBottom: 8, marginLeft: 68, fontSize: 12, color: '#CC0000', fontWeight: 'bold' }}>
                      ⚠ {error}
                    </div>
                  )}

                  <hr className="mac-separator" style={{ margin: '12px 0' }} />

                  <div style={{ display: 'flex', justifyContent: 'center' }}>
                    <button type="submit" disabled={loading} className="mac-btn-primary">
                      {loading ? '⏳...' : 'Send Magic Link'}
                    </button>
                  </div>
                </form>
              </>
            )}

            {step === 'check-inbox' && (
              <>
                <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 28 }}>📬</div>
                <div style={{ textAlign: 'center', marginBottom: 12, fontSize: 12 }}>
                  Check your inbox for <strong>{email}</strong>
                </div>
                {/* PWA Mode Detection */}
                {window.matchMedia('(display-mode: standalone)').matches ? (
                  <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 11, color: '#666666' }}>
                    Enter the 6-digit code from your email below.
                  </div>
                ) : (
                  <div style={{ textAlign: 'center', marginBottom: 16, fontSize: 11, color: '#666666' }}>
                    Click the link in the email to sign in, or enter the 6-digit code below.
                  </div>
                )}

                {/* Code Input Form */}
                <form onSubmit={verifyCode}>
                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <label style={{ width: 60, textAlign: 'right', fontSize: 12 }}>Code:</label>
                    <input
                      className="mac-input"
                      style={{ flex: 1 }}
                      type="text"
                      placeholder="123456"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, '').slice(0, 10))}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={10}
                      required
                      autoFocus
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                    <button type="submit" disabled={loading || code.length < 6 || code.length > 10} className="mac-btn-primary">
                      {loading ? '⏳...' : 'Verify Code'}
                    </button>
                  </div>
                </form>

                {/* Dev mode: show clickable verify button */}
                {devToken && (
                  <>
                    <hr className="mac-separator" style={{ margin: '12px 0' }} />
                    <div style={{ textAlign: 'center', fontSize: 10, color: '#999', marginBottom: 8 }}>
                      🛠 DEV MODE
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center' }}>
                      <button
                        className="mac-btn-primary"
                        onClick={() => verifyToken(devToken)}
                        disabled={loading}
                      >
                        {loading ? '⏳...' : 'Verify (Dev)'}
                      </button>
                    </div>
                  </>
                )}

                <hr className="mac-separator" style={{ margin: '12px 0' }} />
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <button className="mac-btn" onClick={() => { setStep('email'); setError(''); setCode(''); }}>
                    ← Back
                  </button>
                </div>

                {error && (
                  <div style={{ marginTop: 8, textAlign: 'center', fontSize: 12, color: '#CC0000', fontWeight: 'bold' }}>
                    ⚠ {error}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
