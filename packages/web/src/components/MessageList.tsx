import { MarkdownText } from "./MarkdownText";
import { MessageReactions, EmojiPicker } from "./MessageReactions";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiUrl } from "../lib/urls";

interface Msg {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  user?: { displayName: string; isAgent: boolean };
  attachments?: { url: string; filename: string; contentType: string; size: number }[];
  replyCount?: number;
  reactions?: { id: string; userId: string; emoji: string; createdAt: string }[];
  canvas?: { html: string; title?: string; width?: number; height?: number; version?: number } | null;
}

const NICK_COLORS = [
  "#c41e3a", "#0057b7", "#16a34a", "#9333ea", "#d97706", "#0891b2",
  "#c026d3", "#854d0e", "#4338ca", "#dc2626", "#059669", "#db2777", "#1d4ed8",
];

function getNickColor(userId: string): string {
  const hex = userId.replace(/-/g, "").slice(-8);
  const num = parseInt(hex, 16) >>> 0;
  return NICK_COLORS[num % NICK_COLORS.length];
}

function formatTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}


function isImageType(ct: string): boolean {
  return ct.startsWith("image/");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function AttachmentRenderer({ attachments }: { attachments: { url: string; filename: string; contentType: string; size: number }[] }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: 4 }}>
      {attachments.map((att, i) =>
        isImageType(att.contentType) ? (
          <a key={i} href={apiUrl(att.url)} target="_blank" rel="noopener noreferrer">
            <img
              src={apiUrl(att.url)}
              alt={att.filename}
              style={{
                maxWidth: 300,
                maxHeight: 200,
                borderRadius: 2,
                border: "1px solid #CCCCCC",
                display: "block",
                cursor: "pointer",
              }}
              loading="lazy"
            />
          </a>
        ) : (
          <a
            key={i}
            href={apiUrl(att.url)}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              border: "1px solid #CCCCCC",
              borderRadius: 2,
              background: "#F5F5F5",
              color: "#3366CC",
              textDecoration: "none",
              fontSize: 11,
              fontFamily: "Monaco, IBM Plex Mono, monospace",
            }}
          >
            📄 {att.filename} <span style={{ color: "#999999", fontSize: 10 }}>({formatFileSize(att.size)})</span>
          </a>
        )
      )}
    </div>
  );
}

/** Threshold (ms) below which an update is considered a save artifact, not an edit. */
const EDIT_THRESHOLD_MS = 1000;

function CanvasRenderer({ canvas }: { canvas: { html: string; title?: string; width?: number; height?: number } }) {
  const cspMeta = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:">`; 
  const width = canvas.width || 800;
  const height = canvas.height || 600;
  return (
    <div style={{
      width: width + 18,
      maxWidth: "100%",
      border: "2px solid #000000",
      borderRadius: 6,
      overflow: "hidden",
      marginTop: 4,
      marginBottom: 4,
      background: "#FFFFFF",
      boxShadow: "2px 2px 0 #000000",
    }}>
      <div style={{
        background: "linear-gradient(180deg, #E8E8E8 0%, #C0C0C0 100%)",
        borderBottom: "1px solid #000000",
        padding: "3px 8px",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        fontFamily: "Monaco, IBM Plex Mono, monospace",
        fontWeight: "bold",
        userSelect: "none",
      }}>
        <span style={{ display: "flex", gap: 3 }}>
          <span style={{ color: "#FF5F57" }}>●</span>
          <span style={{ color: "#FEBC2E" }}>●</span>
          <span style={{ color: "#28C840" }}>●</span>
        </span>
        <span style={{ flex: 1, textAlign: "center", color: "#333333" }}>{canvas.title || "Canvas"}</span>
      </div>
      <iframe
        sandbox="allow-scripts"
        srcDoc={cspMeta + canvas.html}
        style={{
          width: width,
          height: height,
          border: "none",
          display: "block",
          maxWidth: "100%",
        }}
      />
    </div>
  );
}


function isEdited(msg: Msg): boolean {
  if (!msg.updatedAt || !msg.createdAt) return false;
  return new Date(msg.updatedAt).getTime() - new Date(msg.createdAt).getTime() > EDIT_THRESHOLD_MS;
}

interface Props {
  messages: Msg[];
  usersMap: Map<string, { displayName: string; isAgent: boolean }>;
  currentUserId?: string;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasMoreOlder?: boolean;
  onEditMessage?: (messageId: string, content: string) => void;
  onDeleteMessage?: (messageId: string) => void;
  onOpenThread?: (message: Msg) => void;
  highlightMessageId?: string | null;
  onToggleReaction?: (messageId: string, emoji: string, hasReacted: boolean) => void;
}

export function MessageList({ messages, usersMap, currentUserId, onLoadOlder, isLoadingOlder, hasMoreOlder, onEditMessage, onDeleteMessage, onOpenThread, highlightMessageId, onToggleReaction }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const isRestoringScroll = useRef(false);
  const prevMsgCountRef = useRef<number>(0);
  const [hoveredMsg, setHoveredMsg] = useState<string | null>(null);
  const [editingMsg, setEditingMsg] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [ttsLoadingId, setTtsLoadingId] = useState<string | null>(null);
  const [ttsPlayingId, setTtsPlayingId] = useState<string | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [emojiPickerMsgId, setEmojiPickerMsgId] = useState<string | null>(null);
  const skipAutoScrollRef = useRef(false);

  // Scroll to highlighted message (retry to handle channel switch / render delay)
  useEffect(() => {
    if (!highlightMessageId) return;
    skipAutoScrollRef.current = true;
    setHighlightId(highlightMessageId);
    let attempts = 0;
    const maxAttempts = 20;
    const tryScroll = () => {
      const el = document.getElementById(`msg-${highlightMessageId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(tryScroll, 100);
      }
    };
    // Use setTimeout to let React flush state updates and render new messages
    setTimeout(tryScroll, 50);
    const timer = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightMessageId]);

  const playTts = async (messageId: string) => {
    // Stop any currently playing audio
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
      if (ttsPlayingId === messageId) {
        setTtsPlayingId(null);
        return;
      }
    }
    setTtsPlayingId(null);
    if (ttsLoadingId === messageId) return;
    setTtsLoadingId(messageId);
    try {
      const token = localStorage.getItem('blather_token') || '';
      const res = await fetch(apiUrl(`/tts/${messageId}`), { method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" } });
      if (!res.ok) throw new Error("TTS failed");
      const { audioUrl } = await res.json();
      const audio = new Audio(apiUrl(audioUrl));
      ttsAudioRef.current = audio;
      setTtsPlayingId(messageId);
      audio.onended = () => { setTtsPlayingId(null); ttsAudioRef.current = null; };
      audio.onerror = () => { setTtsPlayingId(null); ttsAudioRef.current = null; };
      await audio.play();
    } catch (e) {
      console.error("TTS error:", e);
    } finally {
      setTtsLoadingId(null);
    }
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const newCount = messages.length;
    const oldCount = prevMsgCountRef.current;
    if (isRestoringScroll.current) {
      const newScrollHeight = el.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      el.scrollTop = diff;
      isRestoringScroll.current = false;
      prevMsgCountRef.current = newCount;
      return;
    }
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if ((isNearBottom || oldCount === 0) && !skipAutoScrollRef.current) {
      endRef.current?.scrollIntoView({ behavior: oldCount === 0 ? "auto" : "smooth" });
    }
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
    }
    prevMsgCountRef.current = newCount;
  }, [messages.length]);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || isLoadingOlder || !hasMoreOlder || !onLoadOlder) return;
    if (el.scrollTop < 50) {
      prevScrollHeightRef.current = el.scrollHeight;
      isRestoringScroll.current = true;
      onLoadOlder();
    }
  }, [isLoadingOlder, hasMoreOlder, onLoadOlder]);

  const startEdit = (msg: Msg) => {
    setEditingMsg(msg.id);
    setEditText(msg.content);
  };

  const cancelEdit = () => {
    setEditingMsg(null);
    setEditText("");
  };

  const submitEdit = (msgId: string) => {
    if (editText.trim() && onEditMessage) {
      onEditMessage(msgId, editText.trim());
    }
    cancelEdit();
  };

  const confirmDelete = (msgId: string) => {
    if (onDeleteMessage) onDeleteMessage(msgId);
    setShowDeleteConfirm(null);
  };

  if (messages.length === 0) {
    return (
      <div className="mac-inset" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "#999999", margin: 4 }}>
        No messages yet. Start the conversation.
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="mac-inset"
      style={{ flex: 1, overflowY: "auto", padding: 6, fontSize: 12, fontFamily: "Monaco, IBM Plex Mono, monospace", margin: 4, position: "relative" }}
    >
      {isLoadingOlder && (
        <div style={{ textAlign: "center", padding: "4px 0", color: "#999999", fontSize: 11 }}>
          ⏳ Loading older messages...
        </div>
      )}
      {!hasMoreOlder && messages.length > 0 && (
        <div style={{ textAlign: "center", padding: "4px 0", color: "#999999", fontSize: 11, fontStyle: "italic" }}>
          — beginning of conversation —
        </div>
      )}
      {messages.map((msg) => {
        const user = usersMap.get(msg.userId) || { displayName: msg.userId.slice(0, 8), isAgent: false };
        const nickColor = getNickColor(msg.userId);
        const isOwn = msg.userId === currentUserId;
        const isHovered = hoveredMsg === msg.id;

        return (
          <div
            key={msg.id}
            id={`msg-${msg.id}`}
            style={{ padding: "1px 2px", lineHeight: 1.6, position: "relative", background: highlightId === msg.id ? "#FFFFAA" : isHovered ? "#F0F0F0" : "transparent", transition: "background 0.5s" }}
            onMouseEnter={() => setHoveredMsg(msg.id)}
            onMouseLeave={() => setHoveredMsg(null)}
          >
            <span style={{ color: "#999999" }}>[{formatTime(msg.createdAt)}]</span>
            {" "}
            <span style={{ fontWeight: "bold", color: nickColor }}>&lt;{user.displayName}&gt;</span>
            {" "}
            {editingMsg === msg.id ? (
              <span style={{ display: "inline" }}>
                <input
                  type="text"
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitEdit(msg.id);
                    if (e.key === "Escape") cancelEdit();
                  }}
                  autoFocus
                  style={{
                    fontFamily: "Monaco, IBM Plex Mono, monospace",
                    fontSize: 12,
                    border: "1px solid #999999",
                    background: "#FFFFFF",
                    padding: "1px 4px",
                    width: "60%",
                    outline: "none",
                  }}
                />
                <span style={{ fontSize: 10, color: "#999999", marginLeft: 4 }}>Enter=save · Esc=cancel</span>
              </span>
            ) : (
              <>
                <MarkdownText text={msg.content} />
                {isEdited(msg) && (
                  <span style={{ fontSize: 10, color: "#999999", marginLeft: 4 }}>(edited)</span>
                )}
                {msg.attachments && msg.attachments.length > 0 && (
                  <AttachmentRenderer attachments={msg.attachments} />
                )}
                {msg.canvas && (
                  <CanvasRenderer canvas={msg.canvas} />
                )}
                {(msg.replyCount ?? 0) > 0 && (
                  <div
                    onClick={() => onOpenThread && onOpenThread(msg)}
                    style={{
                      fontSize: 11,
                      color: '#3366CC',
                      cursor: 'pointer',
                      marginTop: 1,
                      display: 'inline-block',
                    }}
                    onMouseEnter={(e) => (e.target as HTMLElement).style.textDecoration = 'underline'}
                    onMouseLeave={(e) => (e.target as HTMLElement).style.textDecoration = 'none'}
                  >
                    💬 {msg.replyCount} {msg.replyCount === 1 ? 'reply' : 'replies'}
                  </div>
                )}
                {msg.reactions && msg.reactions.length > 0 && onToggleReaction && (
                  <MessageReactions
                    reactions={msg.reactions}
                    currentUserId={currentUserId}
                    onToggleReaction={(emoji) => {
                      const hasReacted = msg.reactions!.some(r => r.emoji === emoji && r.userId === currentUserId);
                      onToggleReaction(msg.id, emoji, hasReacted);
                    }}
                  />
                )}
              </>
            )}
            {/* Hover action buttons */}
            {isHovered && !editingMsg && (
              <span style={{ position: "absolute", right: 4, top: 0, display: "inline-flex", gap: 2 }}>
                {onToggleReaction && (
                  <button
                    onClick={() => setEmojiPickerMsgId(emojiPickerMsgId === msg.id ? null : msg.id)}
                    className="mac-btn"
                    style={{ minWidth: 0, padding: "0 4px", fontSize: 10, borderRadius: 3, lineHeight: "18px" }}
                    title="Add reaction"
                  >😀+</button>
                )}
                {onOpenThread && (
                  <button
                    onClick={() => onOpenThread(msg)}
                    className="mac-btn"
                    style={{ minWidth: 0, padding: "0 4px", fontSize: 10, borderRadius: 3, lineHeight: "18px" }}
                    title="Reply in thread"
                  >💬</button>
                )}
                <button
                    onClick={() => playTts(msg.id)}
                    className="mac-btn"
                    style={{ minWidth: 0, padding: "0 4px", fontSize: 10, borderRadius: 3, lineHeight: "18px" }}
                    title="Play message aloud"
                  >{ttsLoadingId === msg.id ? "⏳" : ttsPlayingId === msg.id ? "🔊" : "🔈"}</button>
                {isOwn && (
                  <>
                    <button
                      onClick={() => startEdit(msg)}
                      className="mac-btn"
                      style={{ minWidth: 0, padding: "0 4px", fontSize: 10, borderRadius: 3, lineHeight: "18px" }}
                      title="Edit message"
                    >✏️</button>
                    <button
                      onClick={() => setShowDeleteConfirm(msg.id)}
                      className="mac-btn"
                      style={{ minWidth: 0, padding: "0 4px", fontSize: 10, borderRadius: 3, lineHeight: "18px" }}
                      title="Delete message"
                    >🗑️</button>
                  </>
                )}
              </span>
            )}
            {/* Emoji picker */}
            {emojiPickerMsgId === msg.id && onToggleReaction && (
              <EmojiPicker
                onSelect={(emoji) => {
                  const hasReacted = (msg.reactions || []).some(r => r.emoji === emoji && r.userId === currentUserId);
                  onToggleReaction(msg.id, emoji, hasReacted);
                  setEmojiPickerMsgId(null);
                }}
                onClose={() => setEmojiPickerMsgId(null)}
              />
            )}
            {/* Delete confirmation */}
            {showDeleteConfirm === msg.id && (
              <div style={{
                position: "absolute", right: 4, top: -2, background: "#FFFFFF",
                border: "2px solid #000000", padding: "4px 8px", fontSize: 11, zIndex: 10,
                boxShadow: "2px 2px 0 #000000",
              }}>
                <div style={{ marginBottom: 4 }}>Delete this message?</div>
                <button
                  onClick={() => confirmDelete(msg.id)}
                  className="mac-btn"
                  style={{ minWidth: 0, padding: "1px 8px", fontSize: 10, marginRight: 4 }}
                >Delete</button>
                <button
                  onClick={() => setShowDeleteConfirm(null)}
                  className="mac-btn"
                  style={{ minWidth: 0, padding: "1px 8px", fontSize: 10 }}
                >Cancel</button>
              </div>
            )}
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
