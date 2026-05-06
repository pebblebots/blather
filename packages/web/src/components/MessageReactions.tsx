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
  // Index of the currently-focused emoji button. -1 when the search input has
  // focus (full mode) or nothing is focused yet.
  const [focusIdx, setFocusIdx] = useState(0);

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

  // Size of the focus ring in each mode
  const totalButtons = showFull ? filtered.length : QUICK_EMOJIS.length + 1; // +1 for the … "more" button in quick mode
  const gridCols = 8;

  // Reset focus when switching modes or when search result count changes
  useEffect(() => {
    setFocusIdx(showFull ? -1 : 0);
  }, [showFull]);
  useEffect(() => {
    if (showFull && focusIdx >= filtered.length) setFocusIdx(-1);
  }, [filtered.length, showFull, focusIdx]);

  // Scroll the focused button into view in the grid
  useEffect(() => {
    if (focusIdx < 0 || !ref.current) return;
    const btn = ref.current.querySelector<HTMLButtonElement>(`[data-emoji-idx="${focusIdx}"]`);
    btn?.focus();
  }, [focusIdx]);

  // Key handling — global for the picker
  const onPickerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (!showFull) {
      // Quick row: left/right navigation
      if (e.key === "ArrowRight") {
        e.preventDefault();
        setFocusIdx((i) => Math.min(i + 1, totalButtons - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusIdx((i) => Math.max(i - 1, 0));
      }
      return;
    }
    // Full-grid mode: 8-column grid + search input above it.
    // focusIdx === -1 means search input has focus.
    if (focusIdx === -1 && e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx(0);
      return;
    }
    if (focusIdx < 0) return; // let the search input handle other keys normally
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (focusIdx === 0) setFocusIdx(-1); // back into search
      else setFocusIdx((i) => i - 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusIdx((i) => Math.min(i + gridCols, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (focusIdx < gridCols) setFocusIdx(-1); // out of grid, back to search
      else setFocusIdx((i) => i - gridCols);
    }
  };

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      onKeyDown={onPickerKeyDown}
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
          {QUICK_EMOJIS.map((e, i) => (
            <button
              key={e}
              data-emoji-idx={i}
              aria-label={`Add ${e} reaction`}
              tabIndex={focusIdx === i ? 0 : -1}
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
            data-emoji-idx={QUICK_EMOJIS.length}
            aria-label="Open full emoji picker"
            tabIndex={focusIdx === QUICK_EMOJIS.length ? 0 : -1}
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
                data-emoji-idx={i}
                aria-label={`${e.name} ${e.emoji}`}
                tabIndex={focusIdx === i ? 0 : -1}
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
