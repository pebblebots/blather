import { type ReactNode } from 'react';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 bg-ink/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-surface border border-border p-6 w-full max-w-md font-mono" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold mb-4 uppercase tracking-widest">{title}</h2>
        {children}
      </div>
    </div>
  );
}
