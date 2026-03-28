import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { uploadFile } from '../lib/api';
import { EMOJI_DATA } from './emojiData';

interface AttachedFile {
  file: File;
  preview?: string;
  uploading: boolean;
  progress: number;
  uploaded?: { url: string; filename: string; contentType: string; size: number };
  error?: string;
}

interface MessageInputProps {
  onSend: (content: string, attachments?: { url: string; filename: string; contentType: string; size: number }[]) => void;
  onTyping?: () => void;
  disabled?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function isImage(type: string): boolean {
  return type.startsWith('image/');
}

// Detect mobile/touch devices where Enter should insert newline, not send
function isMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth < 768);
}

export function MessageInput({ onSend, onTyping, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const lastTypingSent = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const isMobile = useMemo(() => isMobileDevice(), []);

  // Double-tap Enter to send on mobile
  const lastEnterAt = useRef<number>(0);
  const DOUBLE_TAP_MS = 400;

  // Emoji picker state
  const [emojiQuery, setEmojiQuery] = useState<string | null>(null);
  const [emojiSelectedIdx, setEmojiSelectedIdx] = useState(0);
  const emojiListRef = useRef<HTMLDivElement>(null);

  // Auto-grow textarea height
  const adjustHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px'; // ~6 rows max
  }, []);

  // Find the colon-triggered query from current text and cursor position
  const updateEmojiQuery = useCallback((value: string, cursorPos: number) => {
    // Look backwards from cursor for an unmatched ':'
    const before = value.slice(0, cursorPos);
    const colonIdx = before.lastIndexOf(':');
    if (colonIdx === -1) {
      setEmojiQuery(null);
      return;
    }
    const afterColon = before.slice(colonIdx + 1);
    // Must not contain spaces or additional colons, and must be at least 1 char
    if (afterColon.includes(' ') || afterColon.includes(':') || afterColon.length < 1) {
      setEmojiQuery(null);
      return;
    }
    setEmojiQuery(afterColon.toLowerCase());
    setEmojiSelectedIdx(0);
  }, []);

  const filteredEmojis = useMemo(() => {
    if (!emojiQuery) return [];
    return EMOJI_DATA.filter(e =>
      e.name.includes(emojiQuery) || (e.keywords && e.keywords.some(k => k.includes(emojiQuery)))
    ).slice(0, 10);
  }, [emojiQuery]);

  const insertEmoji = useCallback((emoji: string) => {
    const input = inputRef.current;
    if (!input) return;
    const cursorPos = input.selectionStart ?? text.length;
    const before = text.slice(0, cursorPos);
    const colonIdx = before.lastIndexOf(':');
    if (colonIdx === -1) return;
    const newText = text.slice(0, colonIdx) + emoji + text.slice(cursorPos);
    setText(newText);
    setEmojiQuery(null);
    // Restore focus and cursor position
    requestAnimationFrame(() => {
      input.focus();
      const newPos = colonIdx + emoji.length;
      input.setSelectionRange(newPos, newPos);
      adjustHeight();
    });
  }, [text, adjustHeight]);

  // Scroll selected emoji into view (children[0] is the header, items start at [1])
  useEffect(() => {
    if (emojiListRef.current) {
      const selected = emojiListRef.current.children[emojiSelectedIdx + 1] as HTMLElement;
      if (selected) selected.scrollIntoView({ block: 'nearest' });
    }
  }, [emojiSelectedIdx]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    updateEmojiQuery(val, e.target.selectionStart ?? val.length);
    requestAnimationFrame(() => adjustHeight());
    if (onTyping && val.length > 0) {
      const now = Date.now();
      if (now - lastTypingSent.current > 3000) {
        lastTypingSent.current = now;
        onTyping();
      }
    }
  }, [onTyping, updateEmojiQuery, adjustHeight]);

  const addFiles = useCallback((newFiles: FileList | File[]) => {
    const arr = Array.from(newFiles);
    const attached: AttachedFile[] = arr.map((file) => {
      const af: AttachedFile = { file, uploading: true, progress: 0 };
      if (isImage(file.type)) {
        af.preview = URL.createObjectURL(file);
      }
      return af;
    });

    setFiles((prev) => [...prev, ...attached]);

    attached.forEach((af) => {
      uploadFile(af.file, (pct) => {
        setFiles((prev) => prev.map((f) => f.file === af.file ? { ...f, progress: pct } : f));
      }).then((result) => {
        setFiles((prev) => prev.map((f) => f.file === af.file ? { ...f, uploading: false, uploaded: result } : f));
      }).catch((err) => {
        setFiles((prev) => prev.map((f) => f.file === af.file ? { ...f, uploading: false, error: err.message } : f));
      });
    });
  }, []);

  const removeFile = (file: File) => {
    setFiles((prev) => {
      const f = prev.find((a) => a.file === file);
      if (f?.preview) URL.revokeObjectURL(f.preview);
      return prev.filter((a) => a.file !== file);
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    const uploadedAttachments = files.filter((f) => f.uploaded).map((f) => f.uploaded!);
    const stillUploading = files.some((f) => f.uploading);
    if (stillUploading) return;
    if (!trimmed && uploadedAttachments.length === 0) return;

    onSend(trimmed, uploadedAttachments.length > 0 ? uploadedAttachments : undefined);
    setText('');
    setEmojiQuery(null);
    // Reset textarea height after clearing
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
    files.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview); });
    setFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Emoji picker navigation
    if (emojiQuery !== null && filteredEmojis.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setEmojiSelectedIdx(prev => (prev - 1 + filteredEmojis.length) % filteredEmojis.length);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setEmojiSelectedIdx(prev => (prev + 1) % filteredEmojis.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        insertEmoji(filteredEmojis[emojiSelectedIdx].emoji);
        return;
      }
    }
    if (e.key === 'Escape') {
      if (emojiQuery !== null) {
        setEmojiQuery(null);
        return;
      }
    }
    if (e.key === 'Enter') {
      if (isMobile) {
        // Mobile: double-tap Enter sends, single Enter inserts newline
        const now = Date.now();
        if (now - lastEnterAt.current < DOUBLE_TAP_MS) {
          e.preventDefault();
          lastEnterAt.current = 0;
          // Remove the newline from the first Enter before sending
          const cleaned = text.replace(/\n$/, '');
          const trimmed = cleaned.trim();
          const uploadedAttachments = files.filter((f) => f.uploaded).map((f) => f.uploaded!);
          if (trimmed || uploadedAttachments.length > 0) {
            onSend(trimmed, uploadedAttachments.length > 0 ? uploadedAttachments : undefined);
            setText('');
            setEmojiQuery(null);
            if (inputRef.current) inputRef.current.style.height = 'auto';
            files.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview); });
            setFiles([]);
          }
          return;
        }
        lastEnterAt.current = now;
        // First tap: let the newline insert naturally
      } else {
        // Desktop: Enter sends, Shift+Enter inserts newline
        if (!e.shiftKey) {
          e.preventDefault();
          handleSubmit(e);
        }
      }
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  }, [addFiles]);

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  const anyUploading = files.some((f) => f.uploading);

  return (
    <div
      className="safe-area-bottom"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        borderTop: '1px solid #CCCCCC',
        background: dragOver ? '#E8F0FE' : 'transparent',
        transition: 'background 0.15s',
        position: 'relative',
      }}
    >
      {/* Emoji autocomplete popup */}
      {emojiQuery !== null && filteredEmojis.length > 0 && (
        <div
          ref={emojiListRef}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: 4,
            right: 4,
            maxHeight: 220,
            overflowY: 'auto',
            background: '#F5F0E8',
            border: '2px solid #999',
            borderBottom: '2px solid #666',
            borderRight: '2px solid #666',
            borderTop: '2px solid #CCC',
            borderLeft: '2px solid #CCC',
            boxShadow: '2px 2px 0px rgba(0,0,0,0.15), inset 1px 1px 0px #FFF',
            fontFamily: "Monaco, 'IBM Plex Mono', monospace",
            fontSize: 12,
            zIndex: 100,
          }}
        >
          <div style={{
            padding: '2px 6px',
            fontSize: 10,
            color: '#666',
            borderBottom: '1px solid #CCC',
            background: '#EDE8DC',
          }}>
            :{emojiQuery}
          </div>
          {filteredEmojis.map((entry, i) => (
            <div
              key={entry.name + entry.emoji}
              onMouseDown={(e) => {
                e.preventDefault();
                insertEmoji(entry.emoji);
              }}
              onMouseEnter={() => setEmojiSelectedIdx(i)}
              style={{
                padding: '4px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: i === emojiSelectedIdx ? '#C0C0E0' : 'transparent',
                borderBottom: '1px solid #E0D8CC',
              }}
            >
              <span style={{ fontSize: 16 }}>{entry.emoji}</span>
              <span style={{ color: '#333' }}>:{entry.name}:</span>
            </div>
          ))}
        </div>
      )}

      {/* File previews */}
      {files.length > 0 && (
        <div style={{ padding: '4px 4px 0', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {files.map((af, i) => (
            <div
              key={i}
              style={{
                position: 'relative',
                border: '1px solid #CCCCCC',
                borderRadius: 2,
                padding: 3,
                background: '#F5F5F5',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                maxWidth: 200,
                fontSize: 11,
                fontFamily: "Monaco, 'IBM Plex Mono', monospace",
              }}
            >
              {af.preview ? (
                <img src={af.preview} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 2 }} />
              ) : (
                <span style={{ fontSize: 18 }}>📄</span>
              )}
              <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 10 }}>
                  {af.file.name}
                </div>
                <div style={{ fontSize: 9, color: '#999' }}>
                  {formatSize(af.file.size)}
                  {af.uploading && ` · ${af.progress}%`}
                  {af.error && <span style={{ color: '#CC3333' }}> · {af.error}</span>}
                </div>
                {af.uploading && (
                  <div style={{ height: 2, background: '#DDD', marginTop: 1, borderRadius: 1 }}>
                    <div style={{ height: '100%', background: '#3366CC', width: `${af.progress}%`, borderRadius: 1, transition: 'width 0.2s' }} />
                  </div>
                )}
              </div>
              <button
                onClick={() => removeFile(af.file)}
                style={{
                  position: 'absolute', top: -4, right: -4,
                  width: 14, height: 14, borderRadius: 7,
                  border: '1px solid #999', background: '#FFF',
                  fontSize: 8, lineHeight: '12px', textAlign: 'center',
                  cursor: 'pointer', padding: 0,
                }}
              >✕</button>
            </div>
          ))}
        </div>
      )}

      {/* Input row */}
      <form onSubmit={handleSubmit} style={{ padding: 4, display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="mac-btn"
          style={{ minWidth: 0, padding: '2px 6px', fontSize: 14 }}
          title="Attach file"
          disabled={disabled}
        >📎</button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain"
          style={{ display: 'none' }}
          onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }}
        />
        <textarea
          ref={inputRef}
          className="mac-input"
          style={{
            flex: 1,
            fontSize: 12,
            fontFamily: "'Monaco', 'IBM Plex Mono', monospace",
            resize: 'none',
            overflow: 'auto',
          }}
          rows={1}
          placeholder={dragOver ? 'Drop files here...' : 'Type a message...'}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
        />
        <button
          type="submit"
          disabled={disabled || anyUploading || (!text.trim() && files.filter(f => f.uploaded).length === 0)}
          className="mac-btn-primary"
          style={{ minWidth: 60 }}
        >
          {anyUploading ? '⏳' : 'Send'}
        </button>
      </form>
    </div>
  );
}
