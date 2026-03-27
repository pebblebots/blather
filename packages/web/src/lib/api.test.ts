import { describe, it, expect, vi, beforeEach } from 'vitest';
import { api, unreadApi, presenceApi, taskApi, setToken, clearToken, uploadFile } from './api';
import { API_BASE_URL } from './urls';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function jsonResponse(data: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

function errorResponse(error: string, status = 400) {
  return Promise.resolve(new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

/** Extract the path portion from the fetch call URL, stripping the API base prefix */
function fetchedPath(callIndex = 0): string {
  const url: string = mockFetch.mock.calls[callIndex][0];
  const parsed = new URL(url);
  const basePath = API_BASE_URL ? new URL(API_BASE_URL).pathname.replace(/\/+$/, '') : '';
  const pathname = basePath && parsed.pathname.startsWith(basePath)
    ? parsed.pathname.slice(basePath.length) || '/'
    : parsed.pathname;
  return pathname + parsed.search;
}

function fetchedOpts(callIndex = 0): RequestInit {
  return mockFetch.mock.calls[callIndex][1] ?? {};
}

function fetchedBody(callIndex = 0): any {
  const body = fetchedOpts(callIndex).body;
  return body ? JSON.parse(body as string) : undefined;
}

describe('API client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    localStorage.clear();
  });

  // ── Auth header ──

  it('includes Authorization header when token is set', async () => {
    setToken('test-jwt');
    mockFetch.mockReturnValue(jsonResponse([]));

    await api.getWorkspaces();

    const headers = fetchedOpts().headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-jwt');
  });

  it('omits Authorization header when no token', async () => {
    clearToken();
    mockFetch.mockReturnValue(jsonResponse([]));

    await api.getWorkspaces();

    const headers = fetchedOpts().headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
  });

  // ── Error handling ──

  it('throws with error message from response body', async () => {
    mockFetch.mockReturnValue(errorResponse('Not found', 404));
    await expect(api.getWorkspaces()).rejects.toThrow('Not found');
  });

  it('throws with HTTP status when body has no error field', async () => {
    mockFetch.mockReturnValue(
      Promise.resolve(new Response('not json', { status: 500 }))
    );
    await expect(api.getWorkspaces()).rejects.toThrow('HTTP 500');
  });

  // ── Auth endpoints ──

  it('requestMagicLink sends POST with email', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true, message: 'sent' }));
    await api.requestMagicLink('test@example.com');
    expect(fetchedPath()).toBe('/auth/magic');
    expect(fetchedOpts().method).toBe('POST');
    expect(fetchedBody()).toEqual({ email: 'test@example.com' });
  });

  it('verifyMagicLink sends POST with token', async () => {
    mockFetch.mockReturnValue(jsonResponse({ token: 'jwt', user: {} }));
    await api.verifyMagicLink('magic-token');
    expect(fetchedPath()).toBe('/auth/magic/verify');
    expect(fetchedBody()).toEqual({ token: 'magic-token' });
  });

  it('register sends POST with user data', async () => {
    mockFetch.mockReturnValue(jsonResponse({ token: 'jwt', user: {} }));
    await api.register({ email: 'a@b.com', password: 'pw', displayName: 'A' });
    expect(fetchedPath()).toBe('/auth/register');
    expect(fetchedBody()).toEqual({ email: 'a@b.com', password: 'pw', displayName: 'A' });
  });

  it('login sends POST with credentials', async () => {
    mockFetch.mockReturnValue(jsonResponse({ token: 'jwt', user: {} }));
    await api.login({ email: 'a@b.com', password: 'pw' });
    expect(fetchedPath()).toBe('/auth/login');
    expect(fetchedBody()).toEqual({ email: 'a@b.com', password: 'pw' });
  });

  // ── Workspace endpoints ──

  it('getWorkspaces sends GET', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.getWorkspaces();
    expect(fetchedPath()).toBe('/workspaces');
    expect(fetchedOpts().method).toBeUndefined(); // default GET
  });

  it('createWorkspace sends POST with data', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.createWorkspace({ name: 'Test', slug: 'test' });
    expect(fetchedPath()).toBe('/workspaces');
    expect(fetchedOpts().method).toBe('POST');
    expect(fetchedBody()).toEqual({ name: 'Test', slug: 'test' });
  });

  it('getChannels sends GET with workspaceId', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.getChannels('ws-1');
    expect(fetchedPath()).toBe('/workspaces/ws-1/channels');
  });

  it('createChannel sends POST', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.createChannel('ws-1', { name: 'general', slug: 'general' });
    expect(fetchedPath()).toBe('/workspaces/ws-1/channels');
    expect(fetchedOpts().method).toBe('POST');
  });

  it('getWorkspaceMembers sends GET', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.getWorkspaceMembers('ws-1');
    expect(fetchedPath()).toBe('/workspaces/ws-1/members');
  });

  it('getOrCreateDM sends POST', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.getOrCreateDM('ws-1', 'u-1');
    expect(fetchedPath()).toBe('/workspaces/ws-1/dm');
    expect(fetchedBody()).toEqual({ userId: 'u-1' });
  });

  // ── Message endpoints ──

  it('getMessages sends GET with pagination params', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.getMessages('ch-1', 20, 'after-cursor', 'before-cursor');
    const path = fetchedPath();
    expect(path).toContain('/channels/ch-1/messages');
    expect(path).toContain('limit=20');
    expect(path).toContain('after=after-cursor');
    expect(path).toContain('before=before-cursor');
  });

  it('sendMessage sends POST with content', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.sendMessage('ch-1', 'hello');
    expect(fetchedPath()).toBe('/channels/ch-1/messages');
    expect(fetchedOpts().method).toBe('POST');
    expect(fetchedBody()).toEqual({ content: 'hello', attachments: undefined });
  });

  it('editMessage sends PATCH', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.editMessage('ch-1', 'msg-1', 'updated');
    expect(fetchedPath()).toBe('/channels/ch-1/messages/msg-1');
    expect(fetchedOpts().method).toBe('PATCH');
    expect(fetchedBody()).toEqual({ content: 'updated' });
  });

  it('deleteMessage sends DELETE', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.deleteMessage('ch-1', 'msg-1');
    expect(fetchedPath()).toBe('/channels/ch-1/messages/msg-1');
    expect(fetchedOpts().method).toBe('DELETE');
  });

  // ── Reaction endpoints ──

  it('addReaction sends POST with emoji', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.addReaction('ch-1', 'msg-1', '👍');
    expect(fetchedPath()).toBe('/channels/ch-1/messages/msg-1/reactions');
    expect(fetchedOpts().method).toBe('POST');
    expect(fetchedBody()).toEqual({ emoji: '👍' });
  });

  it('removeReaction sends DELETE with emoji', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.removeReaction('ch-1', 'msg-1', '👍');
    expect(fetchedPath()).toBe('/channels/ch-1/messages/msg-1/reactions');
    expect(fetchedOpts().method).toBe('DELETE');
  });

  // ── Channel members ──

  it('getChannelMembers sends GET', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.getChannelMembers('ch-1');
    expect(fetchedPath()).toBe('/channels/ch-1/members');
  });

  // ── Messages around ──

  it('getMessagesAround sends GET with around and limit params', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.getMessagesAround('ch-1', 'msg-center', 25);
    const path = fetchedPath();
    expect(path).toContain('/channels/ch-1/messages');
    expect(path).toContain('around=msg-center');
    expect(path).toContain('limit=25');
  });

  // ── Thread endpoints ──

  it('getThreadReplies sends GET', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.getThreadReplies('ch-1', 'msg-1');
    expect(fetchedPath()).toContain('/channels/ch-1/messages/msg-1/replies');
  });

  it('sendThreadReply sends POST with threadId', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.sendThreadReply('ch-1', 'reply text', 'thread-1');
    expect(fetchedBody()).toEqual({ content: 'reply text', threadId: 'thread-1', attachments: undefined });
  });

  // ── Channel actions ──

  it('inviteMember sends POST', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.inviteMember('ch-1', 'u-1');
    expect(fetchedPath()).toBe('/channels/ch-1/members');
    expect(fetchedBody()).toEqual({ userId: 'u-1' });
  });

  it('deleteChannel sends DELETE', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.deleteChannel('ch-1');
    expect(fetchedPath()).toBe('/channels/ch-1');
    expect(fetchedOpts().method).toBe('DELETE');
  });

  it('archiveChannel sends PATCH', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await api.archiveChannel('ch-1');
    expect(fetchedPath()).toBe('/channels/ch-1/archive');
    expect(fetchedOpts().method).toBe('PATCH');
  });

  it('sendTyping sends POST', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await api.sendTyping('ch-1');
    expect(fetchedPath()).toBe('/channels/ch-1/typing');
    expect(fetchedOpts().method).toBe('POST');
  });

  // ── Search ──

  it('searchMessages sends GET with query params', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await api.searchMessages({ q: 'hello', workspaceId: 'ws-1', channelId: 'ch-1', limit: 10 });
    const path = fetchedPath();
    expect(path).toContain('/messages/search');
    expect(path).toContain('q=hello');
    expect(path).toContain('workspaceId=ws-1');
    expect(path).toContain('channelId=ch-1');
    expect(path).toContain('limit=10');
  });

  // ── Unread API ──

  it('markRead sends POST', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await unreadApi.markRead('ch-1');
    expect(fetchedPath()).toBe('/channels/ch-1/read');
    expect(fetchedOpts().method).toBe('POST');
  });

  it('getUnreadCounts sends GET', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await unreadApi.getUnreadCounts('ws-1');
    expect(fetchedPath()).toBe('/workspaces/ws-1/unread');
  });

  // ── Presence API ──

  it('getPresence sends GET', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await presenceApi.getPresence('ws-1');
    expect(fetchedPath()).toBe('/workspaces/ws-1/presence');
  });

  // ── Task API ──

  it('taskApi.list sends GET with filters', async () => {
    mockFetch.mockReturnValue(jsonResponse([]));
    await taskApi.list('ws-1', { status: 'done', priority: 'urgent' });
    const path = fetchedPath();
    expect(path).toContain('/tasks');
    expect(path).toContain('workspaceId=ws-1');
    expect(path).toContain('status=done');
    expect(path).toContain('priority=urgent');
  });

  it('taskApi.create sends POST', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await taskApi.create({ workspaceId: 'ws-1', title: 'Fix bug' });
    expect(fetchedPath()).toBe('/tasks');
    expect(fetchedOpts().method).toBe('POST');
    expect(fetchedBody()).toEqual({ workspaceId: 'ws-1', title: 'Fix bug' });
  });

  it('taskApi.update sends PATCH', async () => {
    mockFetch.mockReturnValue(jsonResponse({}));
    await taskApi.update('t-1', { status: 'done' });
    expect(fetchedPath()).toBe('/tasks/t-1');
    expect(fetchedOpts().method).toBe('PATCH');
  });

  it('taskApi.delete sends DELETE', async () => {
    mockFetch.mockReturnValue(jsonResponse({ ok: true }));
    await taskApi.delete('t-1');
    expect(fetchedPath()).toBe('/tasks/t-1');
    expect(fetchedOpts().method).toBe('DELETE');
  });

  // ── Token helpers ──

  it('setToken stores token in localStorage', () => {
    setToken('my-token');
    expect(localStorage.getItem('blather_token')).toBe('my-token');
  });

  it('clearToken removes token from localStorage', () => {
    setToken('my-token');
    clearToken();
    expect(localStorage.getItem('blather_token')).toBeNull();
  });

  // ── Upload ──

  it('uploadFile sends FormData via XMLHttpRequest', async () => {
    const mockXhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      upload: { onprogress: null as any },
      onload: null as any,
      onerror: null as any,
      status: 200,
      responseText: JSON.stringify({ url: '/f.png', filename: 'f.png', contentType: 'image/png', size: 42 }),
    };
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => mockXhr));

    setToken('upload-jwt');
    const file = new File(['data'], 'f.png', { type: 'image/png' });
    const promise = uploadFile(file);

    // Simulate success
    mockXhr.onload!();
    const result = await promise;

    expect(mockXhr.open).toHaveBeenCalledWith('POST', expect.stringContaining('/uploads'));
    expect(mockXhr.setRequestHeader).toHaveBeenCalledWith('Authorization', 'Bearer upload-jwt');
    expect(result).toEqual({ url: '/f.png', filename: 'f.png', contentType: 'image/png', size: 42 });

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch); // restore fetch mock
  });

  it('uploadFile rejects on XHR error', async () => {
    const mockXhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      upload: { onprogress: null as any },
      onload: null as any,
      onerror: null as any,
      status: 0,
      responseText: '',
    };
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => mockXhr));

    const file = new File(['data'], 'f.png', { type: 'image/png' });
    const promise = uploadFile(file);

    mockXhr.onerror!();
    await expect(promise).rejects.toThrow('Upload failed');

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('uploadFile calls onProgress callback', async () => {
    const mockXhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      send: vi.fn(),
      upload: { onprogress: null as any },
      onload: null as any,
      onerror: null as any,
      status: 200,
      responseText: JSON.stringify({ url: '/f.png', filename: 'f.png', contentType: 'image/png', size: 42 }),
    };
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => mockXhr));

    const onProgress = vi.fn();
    const file = new File(['data'], 'f.png', { type: 'image/png' });
    const promise = uploadFile(file, onProgress);

    // Simulate progress event
    mockXhr.upload.onprogress({ lengthComputable: true, loaded: 50, total: 100 } as any);
    expect(onProgress).toHaveBeenCalledWith(50);

    mockXhr.onload!();
    await promise;

    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
  });
});
