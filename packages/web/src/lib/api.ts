import { apiUrl } from './urls';
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

  const res = await fetch(apiUrl(path), { ...opts, headers });
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
    request<any[]>(`/channels/${channelId}/messages?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`),

  getMessagesAround: (channelId: string, messageId: string, limit = 50) =>
    request<any[]>(`/channels/${channelId}/messages?limit=${limit}&around=${encodeURIComponent(messageId)}`),

  sendMessage: (channelId: string, content: string, attachments?: any[]) =>
    request<any>(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content, attachments }) }),

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

  addReaction: (channelId: string, messageId: string, emoji: string) =>
    request<any>(`/channels/${channelId}/messages/${messageId}/reactions`, { method: 'POST', body: JSON.stringify({ emoji }) }),

  removeReaction: (channelId: string, messageId: string, emoji: string) =>
    request<any>(`/channels/${channelId}/messages/${messageId}/reactions`, { method: 'DELETE', body: JSON.stringify({ emoji }) }),

  getChannelMembers: (channelId: string) =>
    request<any[]>(`/channels/${channelId}/members`),

  getThreadReplies: (channelId: string, messageId: string, limit = 50, after?: string) =>
    request<any[]>(`/channels/${channelId}/messages/${messageId}/replies?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ''}`),

  sendThreadReply: (channelId: string, content: string, threadId: string, attachments?: any[]) =>
    request<any>(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content, threadId, attachments }) }),

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

// File uploads
export async function uploadFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; filename: string; contentType: string; size: number }> {
  const token = localStorage.getItem('blather_token');
    return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/uploads'));
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).error)); }
        catch { reject(new Error(`Upload failed: ${xhr.status}`)); }
      }
    };
    xhr.onerror = () => reject(new Error('Upload failed'));

    const fd = new FormData();
    fd.append('file', file);
    xhr.send(fd);
  });
}
