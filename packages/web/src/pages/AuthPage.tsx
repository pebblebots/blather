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
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <div className="w-full max-w-sm bg-gray-800 rounded-xl p-8 shadow-lg">
        <h1 className="text-2xl font-bold text-center mb-2">Blather</h1>
        <p className="text-gray-400 text-center text-sm mb-6">
          {isRegister ? 'Create an account' : 'Sign in to continue'}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isRegister && (
            <input
              className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-indigo-500 focus:outline-none text-sm"
              placeholder="Display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          )}
          <input
            className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-indigo-500 focus:outline-none text-sm"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full px-3 py-2 bg-gray-700 rounded-lg border border-gray-600 focus:border-indigo-500 focus:outline-none text-sm"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {isRegister && (
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={isAgent}
                onChange={(e) => setIsAgent(e.target.checked)}
                className="rounded bg-gray-700 border-gray-600"
              />
              <span>🤖 This is an AI agent account</span>
            </label>
          )}

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
          >
            {loading ? '...' : isRegister ? 'Register' : 'Sign In'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-400">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            className="text-indigo-400 hover:text-indigo-300"
            onClick={() => { setIsRegister(!isRegister); setError(''); }}
          >
            {isRegister ? 'Sign in' : 'Register'}
          </button>
        </p>
      </div>
    </div>
  );
}
