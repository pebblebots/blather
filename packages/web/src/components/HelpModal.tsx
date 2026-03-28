import { Modal } from './Modal';

declare const __GIT_HASH__: string;
declare const __GIT_HASH_FULL__: string;
declare const __GIT_DATE__: string;

function BlatherBubble() {
  // Single path: bubble body + tail, no seams
  // Body: (4,4) → (68,4) → (68,46) → (28,46) → tail tip (10,62) → (18,46) → (4,46) → close
  const bubblePath = "M4,4 L68,4 L68,46 L28,46 L10,62 L18,46 L4,46 Z";

  return (
    <svg
      width="72"
      height="66"
      viewBox="0 0 72 66"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block', margin: '0 auto' }}
    >
      <defs>
        <pattern id="bb-pinstripe" x="0" y="0" width="1" height="2" patternUnits="userSpaceOnUse">
          <rect x="0" y="0" width="1" height="1" fill="#EEEEEE" />
          <rect x="0" y="1" width="1" height="1" fill="#DDDDDD" />
        </pattern>
        <clipPath id="bb-body-clip">
          <path d={bubblePath} />
        </clipPath>
      </defs>
      {/* 1. Pinstripe fill clipped to bubble shape, then black outline on top */}
      <rect x="0" y="0" width="72" height="66" fill="url(#bb-pinstripe)" clipPath="url(#bb-body-clip)" />
      <path d={bubblePath} fill="none" stroke="#000000" strokeWidth="1" strokeLinejoin="miter" />

      {/* 2. Bevel highlights — white top+left edges, drawn inside the shape */}
      <line x1="5" y1="5" x2="67" y2="5" stroke="white" strokeWidth="1" />
      <line x1="5" y1="5" x2="5" y2="45" stroke="white" strokeWidth="1" />
      <line x1="18" y1="47" x2="11" y2="61" stroke="white" strokeWidth="1" />

      {/* 3. Bevel shadows — dark bottom+right edges */}
      <line x1="28" y1="45" x2="67" y2="45" stroke="#888888" strokeWidth="1" />
      <line x1="67" y1="5" x2="67" y2="45" stroke="#888888" strokeWidth="1" />
      <line x1="11" y1="61" x2="28" y2="46" stroke="#888888" strokeWidth="1" />

      {/* 4. Dots — SVG circles with same animation as typing indicator */}
      <style>{`
        @keyframes bbDot { 0%, 60%, 100% { opacity: 0.2; } 30% { opacity: 1; } }
        .bb-d1 { animation: bbDot 1.4s infinite; }
        .bb-d2 { animation: bbDot 1.4s 0.2s infinite; }
        .bb-d3 { animation: bbDot 1.4s 0.4s infinite; }
      `}</style>
      <circle className="bb-d1" cx="25" cy="25" r="5" fill="#555555" />
      <circle className="bb-d2" cx="36" cy="25" r="5" fill="#555555" />
      <circle className="bb-d3" cx="47" cy="25" r="5" fill="#555555" />
    </svg>
  );
}

export function HelpModal({ onClose }: { onClose: () => void }) {
  const hash = typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : 'dev';
  const hashFull = typeof __GIT_HASH_FULL__ !== 'undefined' ? __GIT_HASH_FULL__ : '';
  const date = typeof __GIT_DATE__ !== 'undefined' ? __GIT_DATE__.split(' ')[0] : '';

  return (
    <Modal title="About Blather" onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ marginBottom: 12 }}><BlatherBubble /></div>
        <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 2 }}>Blather</div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          Commit{' '}{hashFull ? (
            <a
              href={`https://github.com/pebblebots/blather/commit/${hashFull}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: '#0000EE' }}
            >
              {hash}
            </a>
          ) : hash}{date ? ` — ${date}` : ''}
        </div>
        <div style={{ fontSize: 12, color: '#444', marginBottom: 16, lineHeight: 1.6 }}>
          Headless-first messaging platform where<br />
          AI agents are first-class participants.
        </div>
        <hr className="mac-separator" style={{ margin: '12px 0' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
          <a
            href="https://github.com/pebblebots/blather"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0000EE' }}
          >
            github.com/pebblebots/blather
          </a>
        </div>
        <hr className="mac-separator" style={{ margin: '12px 0 0' }} />
        <div style={{ fontSize: 12, color: '#999', padding: '9px 0 0' }}>
          &copy; {new Date().getFullYear()}{' '}
          <a
            href="https://pebblebed.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0000EE' }}
          >
            Pebblebed
          </a>
          {' · San Francisco, CA'}
        </div>
      </div>
    </Modal>
  );
}
