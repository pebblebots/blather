import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';

// Mock api.getMessages for missed-message recovery
vi.mock('../lib/api', () => ({
  api: { getMessages: vi.fn(async () => []) },
}));

// Mock wsUrl to return a predictable base
vi.mock('../lib/urls', () => ({
  wsUrl: (path: string) => `ws://localhost:3000${path}`,
}));

// ── Minimal WebSocket mock ──

type WsHandler = ((this: WebSocket, ev: any) => any) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: WsHandler = null;
  onclose: WsHandler = null;
  onerror: WsHandler = null;
  onmessage: WsHandler = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code: 1000, reason: '' } as any);
  }

  send(_data: string) {}

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({} as any);
  }

  simulateMessage(data: any) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) } as any);
  }

  simulateClose(code = 1006, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason } as any);
  }
}

describe('useWebSocket', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    localStorage.setItem('blather_token', 'test-jwt');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('connects with token and workspace_id', () => {
    renderHook(() => useWebSocket('ws-1', vi.fn()));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('token=test-jwt');
    expect(MockWebSocket.instances[0].url).toContain('workspace_id=ws-1');
  });

  it('does not connect without a token', () => {
    localStorage.clear();
    renderHook(() => useWebSocket('ws-1', vi.fn()));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('does not connect without a workspaceId', () => {
    renderHook(() => useWebSocket(null, vi.fn()));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('returns connected=true after open', () => {
    const { result } = renderHook(() => useWebSocket('ws-1', vi.fn()));
    expect(result.current).toBe(false);

    act(() => MockWebSocket.instances[0].simulateOpen());
    expect(result.current).toBe(true);
  });

  it('returns connected=false after close', () => {
    const { result } = renderHook(() => useWebSocket('ws-1', vi.fn()));
    act(() => MockWebSocket.instances[0].simulateOpen());
    expect(result.current).toBe(true);

    act(() => MockWebSocket.instances[0].simulateClose());
    expect(result.current).toBe(false);
  });

  it('calls onEvent when message is received', () => {
    const onEvent = vi.fn();
    renderHook(() => useWebSocket('ws-1', onEvent));
    act(() => MockWebSocket.instances[0].simulateOpen());

    const event = { type: 'message.created', payload: { id: 'm-1', content: 'hi' } };
    act(() => MockWebSocket.instances[0].simulateMessage(event));

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('schedules reconnect with exponential backoff on close', () => {
    renderHook(() => useWebSocket('ws-1', vi.fn()));
    const ws0 = MockWebSocket.instances[0];
    act(() => ws0.simulateOpen());

    // First disconnect
    act(() => ws0.simulateClose());
    expect(MockWebSocket.instances).toHaveLength(1);

    // Advance past initial backoff (1000ms + jitter)
    act(() => vi.advanceTimersByTime(2000));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects on tab visibility change when disconnected', () => {
    renderHook(() => useWebSocket('ws-1', vi.fn()));
    const ws0 = MockWebSocket.instances[0];
    act(() => ws0.simulateOpen());
    // Null onclose to prevent reconnect scheduling (simulating a stale WS)
    ws0.onclose = null;
    ws0.readyState = MockWebSocket.CLOSED;

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // Should have created a new connection
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);
  });

  it('cleans up WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket('ws-1', vi.fn()));
    const ws = MockWebSocket.instances[0];
    act(() => ws.simulateOpen());

    unmount();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });
});
