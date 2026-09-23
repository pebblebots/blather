/**
 * Per-session, in-flight evidence ledger for T#192 (Mode E).
 *
 * Tool hooks originate at plugin registration, while Blather's final-delivery
 * callback lives in the channel monitor. The host supplies the same canonical
 * session key to both surfaces, so this small ledger lets the monitor audit a
 * reply against host-observed tool calls from that one agent turn.
 *
 * It is deliberately ephemeral: this is a diagnostic tagger, not a durable
 * truth store. Each channel turn begins and ends its own ledger entry.
 */

const toolCallsBySession = new Map<string, number>();

export function beginModeEAudit(sessionKey?: string): void {
  if (sessionKey) toolCallsBySession.set(sessionKey, 0);
}

export function recordModeEToolCall(sessionKey?: string): void {
  if (!sessionKey) return;
  const current = toolCallsBySession.get(sessionKey);
  // Ignore a tool call that has no active monitored Blather turn. This keeps
  // unrelated cron/CLI work from being attributed to a later channel reply.
  if (current !== undefined) toolCallsBySession.set(sessionKey, current + 1);
}

export function observedModeEToolCalls(sessionKey?: string): number {
  return sessionKey ? toolCallsBySession.get(sessionKey) ?? 0 : 0;
}

export function endModeEAudit(sessionKey?: string): void {
  if (sessionKey) toolCallsBySession.delete(sessionKey);
}
