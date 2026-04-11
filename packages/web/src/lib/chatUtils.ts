/**
 * Shared chat display utilities — nick colors and timestamp formatting.
 */

const NICK_COLORS = [
  "#c41e3a", "#0057b7", "#16a34a", "#9333ea", "#d97706", "#0891b2",
  "#c026d3", "#854d0e", "#4338ca", "#dc2626", "#059669", "#db2777", "#1d4ed8",
];

/** Deterministic color from a UUID — strips dashes, hashes last 8 hex chars. */
export function getNickColor(userId: string): string {
  const hex = userId.replace(/-/g, "").slice(-8);
  const num = parseInt(hex, 16) >>> 0;
  return NICK_COLORS[num % NICK_COLORS.length];
}

/** Format an ISO timestamp as HH:MM (24-hour). */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Format an ISO timestamp with smart date context: "Today HH:MM", "Yesterday HH:MM", or "Mon DD HH:MM". */
export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.floor((today.getTime() - msgDay.getTime()) / 86400000);

  if (diffDays === 0) return time;
  if (diffDays === 1) return `Yesterday ${time}`;
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" }) + " " + time;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) + " " + time;
}

/** Get a date key string (YYYY-MM-DD) for grouping messages by day. */
export function getDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format a date key into a human-readable label: "Today", "Yesterday", or a full date. */
export function formatDateLabel(dateKey: string): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(now.getTime() - 86400000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  if (dateKey === today) return "Today";
  if (dateKey === yesterdayKey) return "Yesterday";

  const d = new Date(dateKey + "T00:00:00");
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  return d.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

/** Build a Map<userId, displayName> with disambiguation suffixes for duplicate display names.
 *
 * Disambiguation priority:
 *   1. If display names are unique → use as-is.
 *   2. If display names collide → try email username prefix (e.g. "nicole").
 *   3. If the username prefix also collides (same username, different domains) → use domain suffix (e.g. "pbd.bot").
 *   4. If domain also collides (or no email) → fall back to full email, then short user ID.
 */
export function getDisambiguatedNames(
  members: { id: string; displayName: string; email?: string }[],
): Map<string, string> {
  // Step 1: find which display names are duplicated
  const nameCounts = new Map<string, number>();
  for (const m of members) {
    nameCounts.set(m.displayName, (nameCounts.get(m.displayName) || 0) + 1);
  }

  // For members with a duplicate display name, compute candidate suffix at each level
  // and detect which level is sufficient to make the full label unique.
  const dupes = members.filter((m) => (nameCounts.get(m.displayName) || 0) > 1);

  // Group dupes by displayName so we can check suffix uniqueness within each collision group
  const byDisplayName = new Map<string, typeof dupes>();
  for (const m of dupes) {
    const group = byDisplayName.get(m.displayName) ?? [];
    group.push(m);
    byDisplayName.set(m.displayName, group);
  }

  // Compute the best suffix for each dupe member
  const suffixMap = new Map<string, string>(); // userId → chosen suffix
  for (const group of byDisplayName.values()) {
    // Try username prefix first
    const usernames = group.map((m) => (m.email ? m.email.split('@')[0] : null));
    const usernameUnique = usernames.every(
      (u, i) => u !== null && usernames.indexOf(u) === i,
    );

    if (usernameUnique) {
      for (const m of group) {
        suffixMap.set(m.id, m.email ? m.email.split('@')[0] : m.id.slice(0, 6));
      }
      continue;
    }

    // Usernames collide — try domain suffix
    const domains = group.map((m) => (m.email ? m.email.split('@')[1] ?? null : null));
    const domainUnique = domains.every(
      (d, i) => d !== null && domains.indexOf(d) === i,
    );

    if (domainUnique) {
      for (const m of group) {
        suffixMap.set(m.id, m.email ? m.email.split('@')[1] : m.id.slice(0, 6));
      }
      continue;
    }

    // Domains also collide — use full email, fall back to short ID
    for (const m of group) {
      suffixMap.set(m.id, m.email ?? m.id.slice(0, 6));
    }
  }

  const result = new Map<string, string>();
  for (const m of members) {
    const suffix = suffixMap.get(m.id);
    result.set(m.id, suffix !== undefined ? `${m.displayName} (${suffix})` : m.displayName);
  }
  return result;
}
