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
    <div className="min-h-screen flex items-center justify-center bg-cream">
      <div className="w-full max-w-sm border border-border bg-surface p-8">
        <pre className="text-center text-sm text-secondary mb-2">┌─────────────────────┐</pre>
        <h1 className="text-xl font-bold text-center mb-1 font-mono tracking-tight">BLATHER</h1>
        <pre className="text-center text-sm text-secondary mb-4">└─────────────────────┘</pre>
        <p className="text-secondary text-center text-sm mb-6 font-mono">
          {isRegister ? '> create account_' : '> authenticate_'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <div>
              <label className="block text-xs text-secondary mb-1 font-mono">display_name:</label>
              <input
                className="w-full px-3 py-2 bg-cream border border-border focus:border-accent focus:outline-none text-sm font-mono"
                placeholder="your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </div>
          )}
          <div>
            <label className="block text-xs text-secondary mb-1 font-mono">email:</label>
            <input
              className="w-full px-3 py-2 bg-cream border border-border focus:border-accent focus:outline-none text-sm font-mono"
              type="email"
              placeholder="user@domain.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs text-secondary mb-1 font-mono">password:</label>
            <input
              className="w-full px-3 py-2 bg-cream border border-border focus:border-accent focus:outline-none text-sm font-mono"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {isRegister && (
            <label className="flex items-center gap-2 text-sm text-secondary cursor-pointer font-mono">
              <input
                type="checkbox"
                checked={isAgent}
                onChange={(e) => setIsAgent(e.target.checked)}
                className="accent-accent"
              />
              <span>[agent] this is an AI agent account</span>
            </label>
          )}

          {error && <p className="text-error text-sm font-mono">ERR: {error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-accent hover:bg-accent-light text-surface disabled:opacity-50 font-mono text-sm border border-accent transition-colors"
          >
            {loading ? '...' : isRegister ? '[ REGISTER ]' : '[ LOGIN ]'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-secondary font-mono">
          {isRegister ? 'have an account?' : 'need an account?'}{' '}
          <button
            className="text-accent hover:text-accent-light underline"
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
          >
            {isRegister ? 'login' : 'register'}
          </button>
        </p>
      </div>
    </div>
  );
}
