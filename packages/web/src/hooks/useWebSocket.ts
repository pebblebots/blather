import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../lib/api';

const BACKOFF_INITIAL = 1000;
const BACKOFF_MAX = 5000;

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
      // Messages come newest-first; reverse for chronological replay
      const sorted = [...missed].reverse();
      for (const msg of sorted) {
        onEventRef.current({
          type: 'new_message',
          payload: msg,
        });
      }
    } catch {
      // Silently fail — messages will load on channel switch anyway
    }
  }, []);

  const connect = useCallback(() => {
    console.log("[WS] connect called, workspaceId:", workspaceIdRef.current, "token:", !!localStorage.getItem("blather_token"));
    const wId = workspaceIdRef.current;
    if (!wId) { console.log("[WS] no workspaceId, bailing"); return; }
    const token = localStorage.getItem('blather_token');
    if (!token) { console.log("[WS] no token, bailing"); return; }

    // Clean up existing connection
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

    console.log("[WS] connecting to:", url.replace(/token=[^const ws = new WebSocket(url);]*/, "token=***")); const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => { console.log("[WS] connected!");
      setConnected(true);
      attemptRef.current = 0;
      // Fetch any messages we missed while disconnected
      fetchMissedMessages();
    };

    ws.onclose = () => {
      setConnected(false);
      scheduleReconnect();
    };

    ws.onerror = (e) => { console.log("[WS] error:", e); ws.close(); };

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        // Track latest event time for gap-fill on reconnect
        if (event.payload?.createdAt) {
          lastEventTimeRef.current = event.payload.createdAt;
        }
        onEventRef.current(event);
      } catch {}
    };
  }, [fetchMissedMessages]);

  const scheduleReconnect = useCallback(() => {
    const delay = backoffMs(attemptRef.current);
    attemptRef.current++;
    reconnectTimer.current = setTimeout(connect, delay);
  }, [connect, workspaceId]);

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

  // Listen for browser online/offline events to fast-reconnect on wake
  useEffect(() => {
    const handleOnline = () => {
      // Reset backoff and reconnect immediately when network returns
      attemptRef.current = 0;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        clearTimeout(reconnectTimer.current);
        connect();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Tab became visible — check if WS is still alive
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
  }, [connect, workspaceId]);

  return connected;
}
