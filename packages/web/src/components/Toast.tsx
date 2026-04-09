import { createContext, useContext, useState, useCallback, useRef, useEffect, type ReactNode } from 'react';

/* ─── types ─── */
type ToastType = 'error' | 'info' | 'success';

interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

/* ─── context ─── */
const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}

/* ─── provider ─── */
const AUTO_DISMISS_MS = 3000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'error') => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={containerStyle}>
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDismiss={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ─── single toast ─── */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setExiting(true), AUTO_DISMISS_MS - 300);
    const removeTimer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, [toast.id, onDismiss]);

  const accent = accentColors[toast.type];
  const icon = icons[toast.type];

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        ...itemStyle,
        borderLeftColor: accent,
        opacity: exiting ? 0 : 1,
        transition: 'opacity 300ms ease-out',
      }}
      onClick={() => onDismiss(toast.id)}
    >
      <span style={{ marginRight: 6, fontSize: 11, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, wordBreak: 'break-word' }}>{toast.message}</span>
    </div>
  );
}

/* ─── styles ─── */
const accentColors: Record<ToastType, string> = {
  error: '#CC0000',
  info: '#336699',
  success: '#339933',
};

const icons: Record<ToastType, string> = {
  error: '⚠',
  info: 'ℹ',
  success: '✓',
};

const containerStyle: React.CSSProperties = {
  position: 'fixed',
  bottom: 16,
  right: 16,
  zIndex: 99999,
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  pointerEvents: 'none',
  maxWidth: 320,
};

const itemStyle: React.CSSProperties = {
  pointerEvents: 'auto',
  background: '#FFFFF0',
  border: '1px solid #000000',
  borderLeft: '3px solid #CC0000',
  boxShadow: '2px 2px 0 #000000',
  padding: '6px 10px',
  fontFamily: "Monaco, 'IBM Plex Mono', monospace",
  fontSize: 11,
  lineHeight: '16px',
  color: '#333333',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'flex-start',
};
