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
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}
