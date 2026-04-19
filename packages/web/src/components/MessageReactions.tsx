import { useState, useRef, useEffect, useCallback, type KeyboardEvent as ReactKeyboardEvent } from "react";
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
const FULL_GRID_COLS = 8;

export function EmojiPicker({ onSelect, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [search, setSearch] = useState("");
  const [showFull, setShowFull] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  // Ref mirror so synchronous key handlers see the latest index even when state
  // updates from fireEvent/onFocus haven't flushed yet.
  const focusedIndexRef = useRef(0);
  focusedIndexRef.current = focusedIndex;

  // Capture the element that had focus before the picker opened so we can restore on close.
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      // Restore focus to the trigger when unmounting (only if it's still in the DOM).
      const t = triggerRef.current;
      if (t && document.contains(t) && typeof t.focus === "function") {
        t.focus();
      }
    };
    // Run once on mount/unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Outside click closes picker.
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

  const items: Array<{ emoji: string; label: string }> = showFull
    ? filtered.map((e) => ({ emoji: e.emoji, label: e.name }))
    : QUICK_EMOJIS.map((e) => ({ emoji: e, label: e }));

  // Reset buttonRefs size to match items on each render.
  buttonRefs.current = buttonRefs.current.slice(0, items.length);

  // Clamp focusedIndex when the item count changes (search filter, mode switch).
  useEffect(() => {
    if (focusedIndex >= items.length) {
      setFocusedIndex(items.length > 0 ? items.length - 1 : 0);
    }
  }, [items.length, focusedIndex]);

  // Roving tabindex: imperatively focus the active cell when it changes,
  // but only if focus is already inside the picker (avoid stealing focus from search input).
  useEffect(() => {
    if (!ref.current) return;
    const active = document.activeElement;
    const focusIsInGrid = active?.getAttribute("role") === "gridcell" && ref.current.contains(active);
    if (focusIsInGrid) {
      buttonRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex, showFull]);

  const selectAt = useCallback(
    (idx: number) => {
      const item = items[idx];
      if (!item) return;
      onSelect(item.emoji);
      onClose();
    },
    [items, onSelect, onClose]
  );

  const onGridKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (items.length === 0) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
      return;
    }
    const cols = showFull ? FULL_GRID_COLS : items.length; // compact: single row
    const last = items.length - 1;
    // Prefer DOM focus as source of truth; fall back to ref (React state mirror).
    const activeIdx = buttonRefs.current.findIndex((b) => b === document.activeElement);
    const currentIdx = activeIdx >= 0 ? activeIdx : focusedIndexRef.current;
    let next = currentIdx;

    switch (e.key) {
      case "ArrowRight":
        next = currentIdx === last ? 0 : currentIdx + 1;
        break;
      case "ArrowLeft":
        next = currentIdx === 0 ? last : currentIdx - 1;
        break;
      case "ArrowDown": {
        if (!showFull) return; // compact mode is a single row
        const candidate = currentIdx + cols;
        next = candidate > last ? currentIdx : candidate;
        break;
      }
      case "ArrowUp": {
        if (!showFull) return;
        const candidate = currentIdx - cols;
        next = candidate < 0 ? currentIdx : candidate;
        break;
      }
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      case "Enter":
      case " ": // Space
        e.preventDefault();
        e.stopPropagation();
        selectAt(currentIdx);
        return;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    setFocusedIndex(next);
    buttonRefs.current[next]?.focus();
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown" || e.key === "Enter") {
      if (items.length > 0) {
        e.preventDefault();
        setFocusedIndex(0);
        buttonRefs.current[0]?.focus();
      }
    }
  };

  // In compact mode focus the first quick emoji on mount so keyboard users land somewhere useful.
  // In full mode autoFocus on the search input keeps typing intuitive.
  useEffect(() => {
    if (!showFull) {
      // Delay one frame so the button has rendered.
      const raf = requestAnimationFrame(() => buttonRefs.current[0]?.focus());
      return () => cancelAnimationFrame(raf);
    }
  }, [showFull]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Emoji picker"
      aria-modal="false"
      onKeyDown={(e) => {
        // Top-level Escape handler works even if focus isn't on grid/input.
        if (e.key === "Escape") { e.preventDefault(); onClose(); }
      }}
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
        <div
          role="grid"
          aria-label="Quick emoji reactions"
          aria-rowcount={1}
          aria-colcount={QUICK_EMOJIS.length}
          onKeyDown={onGridKeyDown}
          style={{ display: "flex", gap: 2, alignItems: "center" }}
        >
          {QUICK_EMOJIS.map((e, i) => (
            <button
              key={e}
              ref={(el) => { buttonRefs.current[i] = el; }}
              role="gridcell"
              aria-label={e}
              aria-colindex={i + 1}
              tabIndex={focusedIndex === i ? 0 : -1}
              onClick={() => { onSelect(e); onClose(); }}
              onFocus={() => setFocusedIndex(i)}
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
            onClick={() => { setShowFull(true); setFocusedIndex(0); }}
            aria-label="Show all emojis"
            tabIndex={0}
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
            onChange={(e) => { setSearch(e.target.value); setFocusedIndex(0); }}
            onKeyDown={onSearchKeyDown}
            autoFocus
            aria-label="Search emoji"
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
            role="grid"
            aria-label="Emoji grid"
            aria-rowcount={Math.max(1, Math.ceil(filtered.length / FULL_GRID_COLS))}
            aria-colcount={FULL_GRID_COLS}
            onKeyDown={onGridKeyDown}
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${FULL_GRID_COLS}, 1fr)`,
              gap: 1,
              maxHeight: 180,
              overflowY: "auto",
            }}
          >
            {filtered.map((e: EmojiEntry, i: number) => {
              const rowIdx = Math.floor(i / FULL_GRID_COLS) + 1;
              const colIdx = (i % FULL_GRID_COLS) + 1;
              return (
                <button
                  key={`${e.emoji}-${i}`}
                  ref={(el) => { buttonRefs.current[i] = el; }}
                  role="gridcell"
                  aria-label={e.name}
                  aria-rowindex={rowIdx}
                  aria-colindex={colIdx}
                  tabIndex={focusedIndex === i ? 0 : -1}
                  onClick={() => { onSelect(e.emoji); onClose(); }}
                  onFocus={() => setFocusedIndex(i)}
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
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
