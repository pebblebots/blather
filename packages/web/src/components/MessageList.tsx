import { MarkdownText } from "./MarkdownText";
import { useEffect, useRef, useCallback } from "react";

interface Msg {
  id: string;
  userId: string;
  content: string;
  createdAt: string;
  user?: { displayName: string; isAgent: boolean };
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
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

interface Props {
  messages: Msg[];
  usersMap: Map<string, { displayName: string; isAgent: boolean }>;
  onLoadOlder?: () => void;
  isLoadingOlder?: boolean;
  hasMoreOlder?: boolean;
}

export function MessageList({ messages, usersMap, onLoadOlder, isLoadingOlder, hasMoreOlder }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const isRestoringScroll = useRef(false);
  const prevMsgCountRef = useRef<number>(0);

  // Auto-scroll to bottom on new messages (only if already near bottom)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const newCount = messages.length;
    const oldCount = prevMsgCountRef.current;

    // If messages were prepended (older loaded), restore scroll position
    if (isRestoringScroll.current) {
      const newScrollHeight = el.scrollHeight;
      const diff = newScrollHeight - prevScrollHeightRef.current;
      el.scrollTop = diff;
      isRestoringScroll.current = false;
      prevMsgCountRef.current = newCount;
      return;
    }

    // Otherwise scroll to bottom if near bottom or first load
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    if (isNearBottom || oldCount === 0) {
      endRef.current?.scrollIntoView({ behavior: oldCount === 0 ? "auto" : "smooth" });
    }

    prevMsgCountRef.current = newCount;
  }, [messages.length]);

  // Scroll-to-top detection
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el || isLoadingOlder || !hasMoreOlder || !onLoadOlder) return;

    if (el.scrollTop < 50) {
      prevScrollHeightRef.current = el.scrollHeight;
      isRestoringScroll.current = true;
      onLoadOlder();
    }
  }, [isLoadingOlder, hasMoreOlder, onLoadOlder]);

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
      style={{ flex: 1, overflowY: "auto", padding: 6, fontSize: 12, fontFamily: "Monaco, IBM Plex Mono, monospace", margin: 4 }}
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
        return (
          <div key={msg.id} style={{ padding: "1px 2px", lineHeight: 1.6 }}>
            <span style={{ color: "#999999" }}>[{formatTime(msg.createdAt)}]</span>
            {" "}
            <span style={{ fontWeight: "bold", color: nickColor }}>&lt;{user.displayName}&gt;</span>
            {user.isAgent && <span style={{ fontWeight: "bold", color: "#666666" }}> [BOT]</span>}
            {" "}
            <MarkdownText text={msg.content} />
          </div>
        );
      })}
      <div ref={endRef} />
    </div>
  );
}
