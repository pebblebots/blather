import { type ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(221,221,221,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div className="mac-window" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="mac-titlebar">
          <div className="mac-close-box" onClick={onClose} />
          <div style={{ flex: 1, textAlign: 'center' }}>{title}</div>
        </div>
        <div style={{ padding: 16 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
