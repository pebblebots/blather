import { type ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(192,192,192,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
      onClick={onClose}
    >
      <div className="win-raised" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
        <div className="win-titlebar">
          <span>{title.toUpperCase()}</span>
          <div style={{ display: 'flex', gap: 2 }}>
            <button className="win-titlebar-btn" onClick={onClose}>╳</button>
          </div>
        </div>
        <div style={{ padding: 16 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
