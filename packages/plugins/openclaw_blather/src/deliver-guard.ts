/**
 * Pure filter for the Blather `deliver` callback. Kept in its own module so
 * tests can import it without pulling in the WebSocket client, openclaw
 * plugin-sdk, or any other runtime-only dependency.
 *
 * The guard is exercised in `monitor.deliver-guard.test.ts`.
 */

export type DeliverReplyInfo = { kind: "tool" | "block" | "final" };

export type DeliverDecision =
  | { deliver: false; reason: string }
  | { deliver: true; text: string };

/**
 * Decide whether a reply-dispatcher payload should actually be posted to Blather.
 *
 * Blather is a non-streaming surface: we do not want to post intermediate
 * assistant-text segments as separate messages. The core reply dispatcher
 * emits three kinds of deliveries for a single model turn:
 *
 *   - `tool`  : tool-result surfaces (never sent to chat directly)
 *   - `block` : intermediate assistant-text segments between tool calls
 *               (e.g. "Let me check...", "Found it.", "Now let me try...").
 *               These are useful for streaming channels (Slack/Discord/Matrix)
 *               but leak to Blather as narration-prose. See T#171.
 *   - `final` : the last assistant-text segment of the turn, which is the
 *               actual reply to the user.
 *
 * We also drop reasoning / compaction-notice payloads, whether they arrive as
 * a final or a block (T#147).
 *
 * Return `{ deliver: true, text }` to post, or `{ deliver: false, reason }`
 * to skip. The `reason` is informational and is surfaced via debug logs and
 * tests.
 */
export function shouldDeliverReplyPayload(
  payload: unknown,
  info?: DeliverReplyInfo,
): DeliverDecision {
  // T#147: drop reasoning / compaction-notice payloads regardless of kind.
  if (typeof payload === "object" && payload !== null) {
    if ((payload as any).isReasoning) return { deliver: false, reason: "reasoning" };
    if ((payload as any).isCompactionNotice)
      return { deliver: false, reason: "compactionNotice" };
  }

  // T#171: only the `final` delivery is the agent's real reply. Block
  // deliveries are intermediate assistant-text segments that streaming
  // channels render as a running draft; Blather does not stream, so
  // posting them verbatim produces 3-10 narration leaks per agent per day.
  // Tool deliveries are never meant to reach chat surfaces directly —
  // agents that want to send multiple messages do so via explicit
  // `message action=send` tool calls, which route through the outbound
  // adapter, not through the reply dispatcher.
  if (info && info.kind !== "final") {
    return { deliver: false, reason: `kind:${info.kind}` };
  }

  const text =
    typeof payload === "string" ? payload : ((payload as any)?.text ?? "");
  if (typeof text !== "string" || !text.trim()) {
    return { deliver: false, reason: "empty" };
  }
  return { deliver: true, text };
}
