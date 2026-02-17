import { useState, useRef, useCallback } from 'react';
import { uploadFile } from '../lib/api';

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

export function MessageInput({ onSend, onTyping, disabled }: MessageInputProps) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const lastTypingSent = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value);
    if (onTyping && e.target.value.length > 0) {
      const now = Date.now();
      if (now - lastTypingSent.current > 3000) {
        lastTypingSent.current = now;
        onTyping();
      }
    }
  }, [onTyping]);

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

    // Upload each file
    attached.forEach((af, idx) => {
      const startIdx = files.length + idx; // This won't work with stale closure; we use functional updates
      uploadFile(af.file, (pct) => {
        setFiles((prev) => prev.map((f) => f.file === af.file ? { ...f, progress: pct } : f));
      }).then((result) => {
        setFiles((prev) => prev.map((f) => f.file === af.file ? { ...f, uploading: false, uploaded: result } : f));
      }).catch((err) => {
        setFiles((prev) => prev.map((f) => f.file === af.file ? { ...f, uploading: false, error: err.message } : f));
      });
    });
  }, [files.length]);

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

    onSend(trimmed || ' ', uploadedAttachments.length > 0 ? uploadedAttachments : undefined);
    setText('');
    // Clean up previews
    files.forEach((f) => { if (f.preview) URL.revokeObjectURL(f.preview); });
    setFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
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
  const hasErrors = files.some((f) => f.error);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      style={{
        borderTop: '1px solid #CCCCCC',
        background: dragOver ? '#E8F0FE' : 'transparent',
        transition: 'background 0.15s',
      }}
    >
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
      <form onSubmit={handleSubmit} style={{ padding: 4, display: 'flex', gap: 4, alignItems: 'center' }}>
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
        <input
          className="mac-input"
          style={{ flex: 1, fontSize: 12, fontFamily: "'Monaco', 'IBM Plex Mono', monospace" }}
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
