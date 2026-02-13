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
  requestMagicLink: (email: string) =>
    request<{ ok: boolean; message: string; _dev?: { token: string; url: string } }>('/auth/magic', { method: 'POST', body: JSON.stringify({ email }) }),

  verifyMagicLink: (token: string) =>
    request<{ token: string; user: any }>('/auth/magic/verify', { method: 'POST', body: JSON.stringify({ token }) }),

  register: (data: { email: string; password: string; displayName: string; isAgent?: boolean }) =>
    request<{ token: string; user: any }>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: any }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  getWorkspaces: () => request<any[]>('/workspaces'),

  createWorkspace: (data: { name: string; slug: string; allowedDomains?: string[] }) =>
    request<any>('/workspaces', { method: 'POST', body: JSON.stringify(data) }),

  getChannels: (workspaceId: string) => request<any[]>(`/workspaces/${workspaceId}/channels`),

  createChannel: (workspaceId: string, data: { name: string; slug: string; topic?: string; channelType?: string; isDefault?: boolean }) =>
    request<any>(`/workspaces/${workspaceId}/channels`, { method: 'POST', body: JSON.stringify(data) }),

  getMessages: (channelId: string, limit = 50) =>
    request<any[]>(`/channels/${channelId}/messages?limit=${limit}`),

  sendMessage: (channelId: string, content: string) =>
    request<any>(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),

  getWorkspaceMembers: (workspaceId: string) =>
    request<any[]>(`/workspaces/${workspaceId}/members`),

  getOrCreateDM: (workspaceId: string, userId: string) =>
    request<any>(`/workspaces/${workspaceId}/dm`, { method: 'POST', body: JSON.stringify({ userId }) }),
};

// Unread tracking
export const unreadApi = {
  markRead: (channelId: string) =>
    request<{ ok: boolean }>(`/channels/${channelId}/read`, { method: 'POST' }),

  getUnreadCounts: (workspaceId: string) =>
    request<Record<string, number>>(`/workspaces/${workspaceId}/unread`),
};

// Presence
export const presenceApi = {
  getPresence: (workspaceId: string) =>
    request<{ userId: string; status: string }[]>(`/workspaces/${workspaceId}/presence`),
};
