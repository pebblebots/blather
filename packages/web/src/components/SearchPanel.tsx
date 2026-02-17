import { useState, useCallback, useRef, useEffect } from "react";
import { api } from "../lib/api";

interface SearchPanelProps {
  workspaceId: string;
  onNavigate: (channelId: string, messageId: string) => void;
  onClose: () => void;
}

export function SearchPanel({ workspaceId, onNavigate, onClose }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(
    (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setSearched(false);
        return;
      }
      setLoading(true);
      setSearched(true);
      api
        .searchMessages({ q: q.trim(), workspaceId, limit: 30 })
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    },
    [workspaceId]
  );

  const handleChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 350);
  };

  const highlight = (text: string, q: string) => {
    if (!q.trim()) return text;
    const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    const parts = text.split(re);
    return parts.map((p, i) =>
      re.test(p) ? (
        <span key={i} style={{ background: "#FFFF00", fontWeight: "bold" }}>
          {p}
        </span>
      ) : (
        p
      )
    );
  };

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 60,
        background: "rgba(0,0,0,0.25)",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="mac-window"
        style={{
          width: 520,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: 0,
        }}
      >
        <div className="mac-titlebar">
          <div className="mac-close-box" onClick={onClose} style={{ cursor: "pointer" }} />
          <div style={{ flex: 1, textAlign: "center" }}>🔍 Search Messages</div>
        </div>

        <div style={{ padding: 8, borderBottom: "1px solid #999" }}>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search messages..."
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "4px 6px",
              fontFamily: "Geneva, Chicago, monospace",
              fontSize: 12,
              border: "2px inset #BBBBBB",
              background: "#FFFFFF",
              outline: "none",
            }}
          />
        </div>

        <div className="mac-inset" style={{ flex: 1, overflow: "auto", margin: 4 }}>
          {loading && (
            <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "#999" }}>
              Searching...
            </div>
          )}
          {!loading && searched && results.length === 0 && (
            <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "#999" }}>
              No results found.
            </div>
          )}
          {!loading &&
            results.map((r) => (
              <div
                key={r.id}
                onClick={() => onNavigate(r.channelId, r.id)}
                style={{
                  padding: "6px 8px",
                  borderBottom: "1px solid #DDDDDD",
                  cursor: "pointer",
                  fontSize: 12,
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#E8E8FF")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "transparent")}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontWeight: "bold", fontSize: 11 }}>
                    {r.userName}
                    {r.userIsAgent && " [BOT]"}
                    <span style={{ fontWeight: "normal", color: "#666", marginLeft: 6 }}>
                      #{r.channelName}
                    </span>
                  </span>
                  <span style={{ fontSize: 10, color: "#999" }}>{fmtTime(r.createdAt)}</span>
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: "#333",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 480,
                  }}
                >
                  {highlight(r.content.length > 200 ? r.content.slice(0, 200) + "…" : r.content, query)}
                </div>
              </div>
            ))}
          {!loading && !searched && (
            <div style={{ padding: 12, textAlign: "center", fontSize: 11, color: "#999" }}>
              Type to search across all channels.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
