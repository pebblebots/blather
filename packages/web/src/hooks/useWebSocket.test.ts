import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWebSocket } from './useWebSocket';
import { api } from '../lib/api';

// Mock api.getMessages for missed-message recovery
vi.mock('../lib/api', () => ({
  api: { getMessages: vi.fn(async () => []) },
}));

// Mock wsUrl to return a predictable base
vi.mock('../lib/urls', () => ({
  wsUrl: (path: string) => `ws://localhost:3000${path}`,
}));

// ── Minimal WebSocket mock ──

type Handler = ((ev: any) => any) | null;

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: Handler = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;

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
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('connects with token', () => {
    renderHook(() => useWebSocket(vi.fn()));
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('token=test-jwt');
  });

  it('does not connect without a token', () => {
    localStorage.clear();
    renderHook(() => useWebSocket(vi.fn()));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it('returns connected=true after open', () => {
    const { result } = renderHook(() => useWebSocket(vi.fn()));
    expect(result.current).toBe(false);

    act(() => MockWebSocket.instances[0].simulateOpen());
    expect(result.current).toBe(true);
  });

  it('returns connected=false after close', () => {
    const { result } = renderHook(() => useWebSocket(vi.fn()));
    act(() => MockWebSocket.instances[0].simulateOpen());
    expect(result.current).toBe(true);

    act(() => MockWebSocket.instances[0].simulateClose());
    expect(result.current).toBe(false);
  });

  it('calls onEvent when message is received', () => {
    const onEvent = vi.fn();
    renderHook(() => useWebSocket(onEvent));
    act(() => MockWebSocket.instances[0].simulateOpen());

    const event = { type: 'message.created', payload: { id: 'm-1', content: 'hi' } };
    act(() => MockWebSocket.instances[0].simulateMessage(event));

    expect(onEvent).toHaveBeenCalledWith(event);
  });

  it('schedules reconnect with exponential backoff on close', () => {
    renderHook(() => useWebSocket(vi.fn()));
    const ws0 = MockWebSocket.instances[0];
    act(() => ws0.simulateOpen());

    act(() => ws0.simulateClose());
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(999));
    expect(MockWebSocket.instances).toHaveLength(1);

    act(() => vi.advanceTimersByTime(1));
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('reconnects on tab visibility change when disconnected', () => {
    renderHook(() => useWebSocket(vi.fn()));
    const ws0 = MockWebSocket.instances[0];
    act(() => ws0.simulateOpen());
    // Simulate a stale WS that silently died (no close event fired)
    ws0.onclose = null;
    ws0.readyState = MockWebSocket.CLOSED;

    const countBefore = MockWebSocket.instances.length;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    // At least one new connection should have been created
    expect(MockWebSocket.instances.length).toBeGreaterThan(countBefore);
  });

  it('cleans up WebSocket on unmount', () => {
    const { unmount } = renderHook(() => useWebSocket(vi.fn()));
    const ws = MockWebSocket.instances[0];
    act(() => ws.simulateOpen());

    unmount();
    expect(ws.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('fetches and replays missed messages on connect', async () => {
    vi.mocked(api.getMessages).mockResolvedValueOnce([
      { id: 'm-2', createdAt: '2026-03-25T10:01:00.000Z' },
      { id: 'm-1', createdAt: '2026-03-25T10:00:30.000Z' },
    ] as any[]);

    const onEvent = vi.fn();
    renderHook(() => useWebSocket(onEvent, 'ch-1'));

    // Deliver a message first to seed lastEventTime, then open triggers fetchMissedMessages
    act(() => {
      MockWebSocket.instances[0].simulateMessage({
        type: 'message.created',
        data: { id: 'seed', createdAt: '2026-03-25T10:00:00.000Z' },
      });
      MockWebSocket.instances[0].simulateOpen();
    });

    await vi.waitFor(() => {
      expect(api.getMessages).toHaveBeenCalledWith('ch-1', 100, '2026-03-25T10:00:00.000Z');
    });

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'message.created',
      data: { id: 'seed', createdAt: '2026-03-25T10:00:00.000Z' },
    });
    expect(onEvent).toHaveBeenNthCalledWith(2, {
      type: 'message.created',
      data: { id: 'm-1', createdAt: '2026-03-25T10:00:30.000Z' },
    });
    expect(onEvent).toHaveBeenNthCalledWith(3, {
      type: 'message.created',
      data: { id: 'm-2', createdAt: '2026-03-25T10:01:00.000Z' },
    });
  });
});
