import { type CSSProperties, type ReactNode, useId } from 'react';

type ModalProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(221,221,221,0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 50,
};

const windowStyle: CSSProperties = {
  width: 380,
};

const titleStyle: CSSProperties = {
  flex: 1,
  textAlign: 'center',
};

const contentStyle: CSSProperties = {
  padding: 16,
};

const closeButtonStyle: CSSProperties = {
  padding: 0,
};

export function Modal({ title, onClose, children }: ModalProps) {
  const titleId = useId();

  return (
    <div data-testid="modal-overlay" style={overlayStyle} onClick={onClose}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="mac-window"
        role="dialog"
        style={windowStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mac-titlebar">
          <button aria-label="Close modal" className="mac-close-box" onClick={onClose} style={closeButtonStyle} type="button" />
          <div id={titleId} style={titleStyle}>{title}</div>
        </div>
        <div style={contentStyle}>
          {children}
        </div>
      </div>
    </div>
  );
}
