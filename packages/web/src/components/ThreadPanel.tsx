import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';
import { MarkdownText } from './MarkdownText';

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
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface Props {
  channelId: string;
  parentMessage: any;
  usersMap: Map<string, { displayName: string; isAgent: boolean }>;
  currentUserId?: string;
  onClose: () => void;
  newReplyFromWs?: any;
}

export function ThreadPanel({ channelId, parentMessage, usersMap, currentUserId, onClose, newReplyFromWs }: Props) {
  const [replies, setReplies] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const processedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    api.getThreadReplies(channelId, parentMessage.id).then((r) => {
      setReplies(r);
      r.forEach((m: any) => processedIds.current.add(m.id));
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
    }).catch(() => {});
  }, [channelId, parentMessage.id]);

  // Handle new replies from WebSocket
  useEffect(() => {
    if (!newReplyFromWs) return;
    if (newReplyFromWs.threadId === parentMessage.id && !processedIds.current.has(newReplyFromWs.id)) {
      processedIds.current.add(newReplyFromWs.id);
      setReplies((prev) => [...prev, newReplyFromWs]);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }, [newReplyFromWs, parentMessage.id]);

  const handleSend = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      const msg = await api.sendThreadReply(channelId, trimmed, parentMessage.id);
      if (!processedIds.current.has(msg.id)) {
        processedIds.current.add(msg.id);
        setReplies((prev) => [...prev, msg]);
      }
      setText('');
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e: any) {
      alert(e.message || 'Failed to send reply');
    } finally {
      setSending(false);
    }
  };

  const renderMessage = (msg: any, isParent = false) => {
    const user = usersMap.get(msg.userId) || msg.user || { displayName: msg.userId?.slice(0, 8), isAgent: false };
    const nickColor = getNickColor(msg.userId);
    return (
      <div key={msg.id} style={{
        padding: '3px 4px',
        lineHeight: 1.6,
        background: isParent ? '#F5F0E8' : 'transparent',
        borderBottom: isParent ? '1px solid #CCCCCC' : 'none',
        marginBottom: isParent ? 4 : 0,
      }}>
        <span style={{ color: '#999999', fontSize: 11 }}>[{formatTime(msg.createdAt)}]</span>
        {' '}
        <span style={{ fontWeight: 'bold', color: nickColor, fontSize: 12 }}>&lt;{user.displayName}&gt;</span>
        {user.isAgent && <span style={{ fontWeight: 'bold', color: '#666666', fontSize: 11 }}> [BOT]</span>}
        {' '}
        <MarkdownText text={msg.content} />
      </div>
    );
  };

  return (
    <div style={{
      width: 320,
      display: 'flex',
      flexDirection: 'column',
      borderLeft: '1px solid #999999',
      background: '#FFFFFF',
      flexShrink: 0,
    }}>
      {/* Title bar */}
      <div className="mac-titlebar" style={{ fontSize: 11 }}>
        <div className="mac-close-box" style={{ width: 10, height: 10, cursor: 'pointer' }} onClick={onClose} />
        <div style={{ flex: 1, textAlign: 'center' }}>💬 Thread</div>
      </div>

      {/* Messages */}
      <div className="mac-inset" style={{
        flex: 1,
        overflowY: 'auto',
        fontSize: 12,
        fontFamily: "Monaco, 'IBM Plex Mono', monospace",
        margin: 4,
        padding: 4,
      }}>
        {renderMessage(parentMessage, true)}
        <div style={{ fontSize: 10, color: '#999999', padding: '4px 0 2px', textAlign: 'center' }}>
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </div>
        {replies.map((r) => renderMessage(r))}
        <div ref={endRef} />
      </div>

      {/* Reply input */}
      <div style={{ borderTop: '1px solid #CCCCCC', padding: 4, display: 'flex', gap: 4 }}>
        <input
          className="mac-input"
          style={{ flex: 1, fontSize: 12, fontFamily: "Monaco, 'IBM Plex Mono', monospace" }}
          placeholder="Reply in thread..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <button
          className="mac-btn-primary"
          style={{ minWidth: 50, fontSize: 11 }}
          disabled={!text.trim() || sending}
          onClick={handleSend}
        >
          {sending ? '⏳' : 'Reply'}
        </button>
      </div>
    </div>
  );
}
