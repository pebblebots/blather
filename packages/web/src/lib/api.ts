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

  getMessages: (channelId: string, limit = 50, after?: string, before?: string) =>
    request<any[]>(`/channels/${channelId}/messages?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ''}`),

  sendMessage: (channelId: string, content: string) =>
    request<any>(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),

  getWorkspaceMembers: (workspaceId: string) =>
    request<any[]>(`/workspaces/${workspaceId}/members`),

  getOrCreateDM: (workspaceId: string, userId: string) =>
    request<any>(`/workspaces/${workspaceId}/dm`, { method: 'POST', body: JSON.stringify({ userId }) }),

  inviteMember: (channelId: string, userId: string) =>
    request<any>(`/channels/${channelId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),

  deleteChannel: (channelId: string) =>
    request<any>(`/channels/${channelId}`, { method: 'DELETE' }),

  archiveChannel: (channelId: string) =>
    request<any>(`/channels/${channelId}/archive`, { method: 'PATCH' }),

  sendTyping: (channelId: string) =>
    request<{ ok: boolean }>(`/channels/${channelId}/typing`, { method: 'POST' }),

  editMessage: (channelId: string, messageId: string, content: string) =>
    request<any>(`/channels/${channelId}/messages/${messageId}`, { method: 'PATCH', body: JSON.stringify({ content }) }),

  deleteMessage: (channelId: string, messageId: string) =>
    request<any>(`/channels/${channelId}/messages/${messageId}`, { method: 'DELETE' }),

  getChannelMembers: (channelId: string) =>
    request<any[]>(`/channels/${channelId}/members`),

  searchMessages: (params: { q: string; workspaceId: string; channelId?: string; userId?: string; before?: string; after?: string; limit?: number }) => {
    const p = new URLSearchParams({ q: params.q, workspaceId: params.workspaceId });
    if (params.channelId) p.set("channelId", params.channelId);
    if (params.userId) p.set("userId", params.userId);
    if (params.before) p.set("before", params.before);
    if (params.after) p.set("after", params.after);
    if (params.limit) p.set("limit", String(params.limit));
    return request<any[]>(`/messages/search?${p}`);
  },
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

// Tasks
export const taskApi = {
  list: (workspaceId: string, filters?: { status?: string; priority?: string; assigneeId?: string }) => {
    const params = new URLSearchParams({ workspaceId });
    if (filters?.status) params.set('status', filters.status);
    if (filters?.priority) params.set('priority', filters.priority);
    if (filters?.assigneeId) params.set('assigneeId', filters.assigneeId);
    return request<any[]>(`/tasks?${params}`);
  },
  create: (data: { workspaceId: string; title: string; description?: string; priority?: string; assigneeId?: string }) =>
    request<any>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { title?: string; description?: string | null; priority?: string; status?: string; assigneeId?: string | null }) =>
    request<any>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
};
