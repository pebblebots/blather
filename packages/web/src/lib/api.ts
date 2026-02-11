const BASE = import.meta.env.VITE_API_URL || '';

function getToken(): string | null {
  return localStorage.getItem('blather_token');
}

export function setToken(token: string) {
  localStorage.setItem('blather_token', token);
}

export function clearToken() {
  localStorage.removeItem('blather_token');
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as any).error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Auth
export const api = {
  register: (data: { email: string; password: string; displayName: string; isAgent?: boolean }) =>
    request<{ token: string; user: any }>('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: any }>('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  getWorkspaces: () => request<any[]>('/api/workspaces'),

  createWorkspace: (data: { name: string; slug: string }) =>
    request<any>('/api/workspaces', { method: 'POST', body: JSON.stringify(data) }),

  getChannels: (workspaceId: string) => request<any[]>(`/api/workspaces/${workspaceId}/channels`),

  createChannel: (workspaceId: string, data: { name: string; slug: string; topic?: string }) =>
    request<any>(`/api/workspaces/${workspaceId}/channels`, { method: 'POST', body: JSON.stringify(data) }),

  getMessages: (channelId: string, limit = 50) =>
    request<any[]>(`/api/channels/${channelId}/messages?limit=${limit}`),

  sendMessage: (channelId: string, content: string) =>
    request<any>(`/api/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),
};
