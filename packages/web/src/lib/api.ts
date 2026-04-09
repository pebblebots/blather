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
  verifyMagicCode: (email: string, code: string) =>
    request<{ token: string; user: any }>('/auth/magic/verify-code', { method: 'POST', body: JSON.stringify({ email, code }) }),

  login: (data: { email: string; password: string }) =>
    request<{ token: string; user: any }>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  getChannels: () => request<any[]>('/channels'),

  createChannel: (data: { name: string; slug: string; topic?: string; channelType?: string; isDefault?: boolean }) =>
    request<any>('/channels', { method: 'POST', body: JSON.stringify(data) }),

  getMessages: (channelId: string, limit = 50, after?: string, before?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);
    if (before) params.set('before', before);
    return request<any[]>(`/channels/${channelId}/messages?${params}`);
  },

  getMessagesAround: (channelId: string, messageId: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit), around: messageId });
    return request<any[]>(`/channels/${channelId}/messages?${params}`);
  },

  sendMessage: (channelId: string, content: string, attachments?: any[]) =>
    request<any>(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content, attachments }) }),

  getMembers: () =>
    request<any[]>('/members'),

  getOrCreateDM: (userId: string) =>
    request<any>('/channels/dm', { method: 'POST', body: JSON.stringify({ userId }) }),

  inviteMember: (channelId: string, userId: string) =>
    request<any>(`/channels/${channelId}/members`, { method: 'POST', body: JSON.stringify({ userId }) }),

  deleteChannel: (channelId: string) =>
    request<any>(`/channels/${channelId}`, { method: 'DELETE' }),

  archiveChannel: (channelId: string) =>
    request<any>(`/channels/${channelId}/archive`, { method: 'PATCH' }),

  muteChannel: (channelId: string) =>
    request<{ ok: boolean; muted: boolean }>(`/channels/${channelId}/mute`, { method: 'PATCH' }),

  unmuteChannel: (channelId: string) =>
    request<{ ok: boolean; muted: boolean }>(`/channels/${channelId}/unmute`, { method: 'PATCH' }),

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

  getThreadReplies: (channelId: string, messageId: string, limit = 50, after?: string) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (after) params.set('after', after);
    return request<any[]>(`/channels/${channelId}/messages/${messageId}/replies?${params}`);
  },

  sendThreadReply: (channelId: string, content: string, threadId: string, attachments?: any[]) =>
    request<any>(`/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify({ content, threadId, attachments }) }),

  searchMessages: (params: { q: string; channelId?: string; userId?: string; before?: string; after?: string; limit?: number }) => {
    const p = new URLSearchParams({ q: params.q });
    if (params.channelId) p.set("channelId", params.channelId);
    if (params.userId) p.set("userId", params.userId);
    if (params.before) p.set("before", params.before);
    if (params.after) p.set("after", params.after);
    if (params.limit) p.set("limit", String(params.limit));
    return request<any[]>(`/messages/search?${p}`);
  },

  createHuddle: (data: { topic: string; agentIds: string[] }) =>
    request<any>('/huddles', { method: 'POST', body: JSON.stringify(data) }),

  getActiveHuddles: () =>
    request<any[]>('/huddles?status=active'),

  getHuddle: (huddleId: string) =>
    request<any>(`/huddles/${huddleId}`),

  joinHuddle: (huddleId: string) =>
    request<any>(`/huddles/${huddleId}/join`, { method: 'POST' }),

  speak: (huddleId: string, content: string) =>
    request<any>(`/huddles/${huddleId}/speak`, { method: 'POST', body: JSON.stringify({ content }) }),

  endHuddle: (huddleId: string) =>
    request<any>(`/huddles/${huddleId}`, { method: 'DELETE' }),
};

// Unread tracking
export const unreadApi = {
  markRead: (channelId: string) =>
    request<{ ok: boolean }>(`/channels/${channelId}/read`, { method: 'POST' }),

  markAllRead: (type?: 'dm') =>
    request<{ ok: boolean }>(`/channels/read-all${type ? `?type=${type}` : ''}`, { method: 'POST' }),

  getUnreadCounts: () =>
    request<Record<string, number>>('/channels/unread'),
};

// Presence
export const presenceApi = {
  getPresence: () =>
    request<{ userId: string; status: string }[]>('/channels/presence'),
};

// Agent status
export const statusApi = {
  getAll: () =>
    request<Record<string, { text: string; progress?: number; eta?: string }>>('/status'),
};

// Tasks
export const taskApi = {
  list: (filters?: { status?: string; priority?: string; assigneeId?: string }) => {
    const params = new URLSearchParams();
    if (filters?.status) params.set('status', filters.status);
    if (filters?.priority) params.set('priority', filters.priority);
    if (filters?.assigneeId) params.set('assigneeId', filters.assigneeId);
    return request<any[]>(`/tasks?${params}`);
  },
  create: (data: { title: string; description?: string; priority?: string; assigneeId?: string }) =>
    request<any>('/tasks', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { title?: string; description?: string | null; priority?: string; status?: string; assigneeId?: string | null }) =>
    request<any>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
};

// File uploads
export function uploadFile(
  file: File,
  onProgress?: (pct: number) => void
): Promise<{ url: string; filename: string; contentType: string; size: number }> {
  const token = getToken();
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
