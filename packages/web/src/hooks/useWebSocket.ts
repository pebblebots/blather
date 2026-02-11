import { useEffect, useRef, useState, useCallback } from 'react';

export function useWebSocket(workspaceId: string | null, onEvent: (event: any) => void) {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const connect = useCallback(() => {
    if (!workspaceId) return;
    const token = localStorage.getItem('blather_token');
    if (!token) return;

    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base = import.meta.env.VITE_API_URL
      ? new URL(import.meta.env.VITE_API_URL).host
      : location.host;
    const url = `${proto}//${base}/ws/events?token=${token}&workspace_id=${workspaceId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try { onEvent(JSON.parse(e.data)); } catch {}
    };
  }, [workspaceId, onEvent]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return connected;
}
