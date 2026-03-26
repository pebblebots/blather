import { useState, useRef, useEffect } from "react";
import { EMOJI_DATA, type EmojiEntry } from "./emojiData";

interface Reaction {
  id: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

interface Props {
  reactions: Reaction[];
  currentUserId?: string;
  onToggleReaction: (emoji: string) => void;
}

// Group reactions by emoji
function groupReactions(reactions: Reaction[]) {
  const groups: Map<string, { emoji: string; count: number; userIds: string[] }> = new Map();
  for (const r of reactions) {
    const g = groups.get(r.emoji);
    if (g) {
      g.count++;
      g.userIds.push(r.userId);
    } else {
      groups.set(r.emoji, { emoji: r.emoji, count: 1, userIds: [r.userId] });
    }
  }
  return Array.from(groups.values());
}

export function MessageReactions({ reactions, currentUserId, onToggleReaction }: Props) {
  if (!reactions || reactions.length === 0) return null;
  const groups = groupReactions(reactions);

  return (
    <span style={{ display: "inline-flex", gap: 3, marginLeft: 8, verticalAlign: "middle" }}>
      {groups.map((g) => {
        const isActive = currentUserId ? g.userIds.includes(currentUserId) : false;
        return (
          <button
            key={g.emoji}
            onClick={(e) => { e.stopPropagation(); onToggleReaction(g.emoji); }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              padding: "0px 4px",
              fontSize: 11,
              fontFamily: "Monaco, IBM Plex Mono, monospace",
              border: isActive ? "1px solid #3366CC" : "1px solid #CCCCCC",
              borderRadius: 8,
              background: isActive ? "#DDEEFF" : "#F5F0E8",
              cursor: "pointer",
              lineHeight: "18px",
              height: 20,
            }}
            title={`${g.emoji} ${g.count}`}
          >
            <span style={{ fontSize: 12 }}>{g.emoji}</span>
            {g.count > 1 && <span style={{ fontSize: 10, color: "#666666" }}>{g.count}</span>}
          </button>
        );
      })}
    </span>
  );
}

// Compact emoji picker popup
interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
}

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "🤔", "👀", "🔥", "✅"];

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const query = search.toLowerCase();
  const filtered = search
    ? EMOJI_DATA.filter(
        (e) =>
          e.name.includes(query) ||
          e.emoji === search ||
          e.keywords?.some((k) => k.includes(query))
      ).slice(0, 40)
    : EMOJI_DATA.slice(0, 40);

  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        right: 0,
        top: -4,
        transform: "translateY(-100%)",
        background: "#FFFFF0",
        border: "2px solid #000000",
        boxShadow: "2px 2px 0 #000000",
        padding: 6,
        zIndex: 100,
        width: showFull ? 260 : "auto",
        fontFamily: "Monaco, IBM Plex Mono, monospace",
      }}
    >
      {!showFull ? (
        <div style={{ display: "flex", gap: 2, alignItems: "center" }}>
          {QUICK_EMOJIS.map((e) => (
            <button
              key={e}
              onClick={() => { onSelect(e); onClose(); }}
              style={{
                background: "transparent",
                border: "1px solid transparent",
                borderRadius: 3,
                cursor: "pointer",
                fontSize: 16,
                padding: "2px 3px",
                lineHeight: 1,
              }}
              onMouseEnter={(ev) => (ev.currentTarget.style.background = "#EEEEDD")}
              onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
            >
              {e}
            </button>
          ))}
          <button
            onClick={() => setShowFull(true)}
            style={{
              background: "transparent",
              border: "1px solid #CCCCCC",
              borderRadius: 3,
              cursor: "pointer",
              fontSize: 10,
              padding: "2px 4px",
              color: "#666666",
              fontFamily: "Monaco, IBM Plex Mono, monospace",
            }}
          >
            ⋯
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            placeholder="Search emoji..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
            style={{
              width: "100%",
              fontSize: 11,
              fontFamily: "Monaco, IBM Plex Mono, monospace",
              border: "1px solid #999999",
              padding: "2px 4px",
              marginBottom: 4,
              boxSizing: "border-box",
              background: "#FFFFFF",
            }}
          />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: 1,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {filtered.map((e: EmojiEntry, i: number) => (
              <button
                key={`${e.emoji}-${i}`}
                onClick={() => { onSelect(e.emoji); onClose(); }}
                title={`:${e.name}:`}
                style={{
                  background: "transparent",
                  border: "1px solid transparent",
                  borderRadius: 2,
                  cursor: "pointer",
                  fontSize: 16,
                  padding: 2,
                  lineHeight: 1,
                  textAlign: "center",
                }}
                onMouseEnter={(ev) => (ev.currentTarget.style.background = "#EEEEDD")}
                onMouseLeave={(ev) => (ev.currentTarget.style.background = "transparent")}
              >
                {e.emoji}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
