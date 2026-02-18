import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api';

const BACKOFF_INITIAL = 1000;
const BACKOFF_MAX = 5000;
const DEBUG = true;
const log = (...args: any[]) => DEBUG && console.log('[WS]', ...args);

function backoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_INITIAL * 2 ** attempt, BACKOFF_MAX);
  const jitter = base * 0.3 * Math.random();
  return base + jitter;
}

export function useWebSocket(
  workspaceId: string | null,
  onEvent: (event: any) => void,
  activeChannelId?: string | null,
) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const attemptRef = useRef(0);
  const lastEventTimeRef = useRef<string | null>(null);
  const activeChannelRef = useRef(activeChannelId);
  const onEventRef = useRef(onEvent);
  const workspaceIdRef = useRef(workspaceId);

  activeChannelRef.current = activeChannelId ?? null;
  onEventRef.current = onEvent;
  workspaceIdRef.current = workspaceId;

  const fetchMissedMessages = useCallback(async () => {
    const chId = activeChannelRef.current;
    const since = lastEventTimeRef.current;
    if (!chId || !since) return;
    try {
      const missed = await api.getMessages(chId, 100, since);
      const sorted = [...missed].reverse();
      log('fetched', sorted.length, 'missed messages');
      for (const msg of sorted) {
        onEventRef.current({ type: 'new_message', payload: msg });
      }
    } catch (e) {
      log('fetchMissedMessages error:', e);
    }
  }, []);

  const connect = useCallback(() => {
    const wId = workspaceIdRef.current;
    if (!wId) { log('no workspaceId, waiting...'); return; }
    const token = localStorage.getItem('blather_token');
    if (!token) { log('no token, bailing'); return; }

    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
    }
    clearTimeout(reconnectTimer.current);

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = import.meta.env.VITE_API_URL
      ? new URL(import.meta.env.VITE_API_URL).host
      : location.host;
    const url = `${proto}//${base}/ws/events?token=${token}&workspace_id=${wId}`;

    log('connecting to', url.replace(/token=[^&]*/, 'token=***'));
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      log('connected');
      setConnected(true);
      attemptRef.current = 0;
      fetchMissedMessages();
    };

    ws.onclose = (e) => {
      log('disconnected, code:', e.code, 'reason:', e.reason);
      setConnected(false);
      scheduleReconnect();
    };

    ws.onerror = (e) => {
      log('error:', e);
      ws.close();
    };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        if (event.payload?.createdAt) {
          lastEventTimeRef.current = event.payload.createdAt;
        }
        onEventRef.current(event);
      } catch {}
    };
  }, [fetchMissedMessages]);

  const scheduleReconnect = useCallback(() => {
    const delay = backoffMs(attemptRef.current);
    log('reconnecting in', Math.round(delay), 'ms (attempt', attemptRef.current + 1 + ')');
    attemptRef.current++;
    reconnectTimer.current = setTimeout(connect, delay);
  }, [connect]);

  // Main connection lifecycle — re-run when workspaceId changes
  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connect, workspaceId]);

  // Fast-reconnect on browser wake / tab focus
  useEffect(() => {
    const handleOnline = () => {
      log('browser online event');
      attemptRef.current = 0;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        clearTimeout(reconnectTimer.current);
        connect();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        log('tab visible, checking connection...');
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          attemptRef.current = 0;
          clearTimeout(reconnectTimer.current);
          connect();
        }
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connect]);

  return connected;
}
