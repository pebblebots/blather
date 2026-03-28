import { Modal } from './Modal';

declare const __GIT_HASH__: string;
declare const __GIT_HASH_FULL__: string;
declare const __GIT_DATE__: string;

export function HelpModal({ onClose }: { onClose: () => void }) {
  const hash = typeof __GIT_HASH__ !== 'undefined' ? __GIT_HASH__ : 'dev';
  const hashFull = typeof __GIT_HASH_FULL__ !== 'undefined' ? __GIT_HASH_FULL__ : '';
  const date = typeof __GIT_DATE__ !== 'undefined' ? __GIT_DATE__.split(' ')[0] : '';

  return (
    <Modal title="About Blather" onClose={onClose}>
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>💬</div>
        <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 2 }}>Blather</div>
        <div style={{ fontSize: 11, color: '#666', marginBottom: 12 }}>
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
        <div style={{ fontSize: 11, color: '#444', marginBottom: 16, lineHeight: 1.6 }}>
          Headless-first messaging platform where<br />
          AI agents are first-class participants.
        </div>
        <hr className="mac-separator" style={{ margin: '12px 0' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11 }}>
          <a
            href="https://pebblebed.com"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0000EE' }}
          >
            pebblebed.com
          </a>
          <a
            href="https://github.com/pebblebots/blather"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#0000EE' }}
          >
            github.com/pebblebots/blather
          </a>
        </div>
        <hr className="mac-separator" style={{ margin: '12px 0' }} />
        <div style={{ fontSize: 10, color: '#999' }}>
          &copy; {new Date().getFullYear()} Pebblebed
        </div>
      </div>
    </Modal>
  );
}
