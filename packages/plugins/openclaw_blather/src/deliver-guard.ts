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

// ---------------------------------------------------------------------------
// T#178 — per-turn idempotency guard.
//
// Background: the upstream openclaw reply-dispatcher occasionally emits more
// than one `kind="final"` payload for a single model turn. This can happen
// with Sonnet 4.6 + thinking=low when the turn has mid-tool-loop text that
// gets re-emitted as a final at turn close, among other shapes.
//
// Without a guard, each extra final becomes a separate chat message on
// Blather. Combined with the runtime's queue-flush re-delivery behaviour
// (see T#178 comments), this produces O(N²) cascading amplification across
// the fleet — a single 4-message leak can spiral into 15-20 phantom
// messages and pull three or four agents into a chase.
//
// The guard is a stateful wrapper around the deliver-guard decision: it
// tracks how many finals have been approved for the current turn and
// suppresses the second and onward, logging each suppression for
// observability. Tool/block kinds are unaffected (they're already dropped
// by the pure guard).
//
// Turn boundary is owned by the caller: create a new guard via
// `createPerTurnDeliveryGuard()` per `dispatchReplyFromConfig` call.
// ---------------------------------------------------------------------------

export type PerTurnDecision =
  | DeliverDecision
  | { deliver: false; reason: "duplicate_final"; suppressedIndex: number };

export interface PerTurnDeliveryGuard {
  /** Apply the pure guard plus per-turn final-count idempotency. */
  check: (payload: unknown, info?: DeliverReplyInfo) => PerTurnDecision;
  /** How many finals have been approved for delivery this turn. */
  approvedFinalCount: () => number;
  /** How many finals were suppressed as duplicates this turn. */
  suppressedFinalCount: () => number;
}

/**
 * Create a per-turn delivery guard. Caller must create a fresh guard per
 * `dispatchReplyFromConfig` call (i.e. per inbound message) so counters
 * reset at turn boundaries.
 */
export function createPerTurnDeliveryGuard(): PerTurnDeliveryGuard {
  let approvedFinals = 0;
  let suppressedFinals = 0;

  return {
    check(payload, info) {
      const decision = shouldDeliverReplyPayload(payload, info);
      if (!decision.deliver) return decision;

      // Only finals are counted toward the idempotency check — the pure
      // guard already rejects block/tool kinds.
      if (info?.kind === "final") {
        if (approvedFinals >= 1) {
          suppressedFinals += 1;
          return {
            deliver: false,
            reason: "duplicate_final",
            suppressedIndex: suppressedFinals,
          };
        }
        approvedFinals += 1;
      }

      return decision;
    },
    approvedFinalCount() {
      return approvedFinals;
    },
    suppressedFinalCount() {
      return suppressedFinals;
    },
  };
}

// ---------------------------------------------------------------------------
// T#178 — drop-case recovery.
//
// When the upstream dispatcher emits zero finals for a turn (e.g. qwen on a
// no-tool-call turn), nothing reaches the chat surface and the agent
// appears muted. The model DID produce text — it's just not routed through
// the dispatcher's final-emission path.
//
// Recovery strategy: intercept `getReplyFromConfig` via the `replyResolver`
// parameter on `dispatchReplyFromConfig`, capture the reply result as a
// side effect, and if the dispatcher returns `queuedFinal: false` we post
// the captured text manually.
//
// `extractRecoverableText` pulls a deliverable string out of a reply
// result. Returns null when:
//   - result is empty / null / undefined
//   - all payloads are isReasoning / isCompactionNotice (deliberately
//     suppressed by the existing guards)
//   - all payloads have empty text
//   - the text is a NO_REPLY / silent token (agent deliberately chose not
//     to reply)
//
// Exported for unit testing.
// ---------------------------------------------------------------------------

/** Minimal reply payload shape for recovery. Matches openclaw's ReplyPayload. */
export interface RecoverableReplyPayload {
  text?: string;
  isReasoning?: boolean;
  isCompactionNotice?: boolean;
}

/** Silent / no-reply sentinels the agent may emit to opt out of delivery. */
const SILENT_REPLY_PATTERNS = [
  /^\s*NO_REPLY\s*$/,
  /^\s*HEARTBEAT_OK\s*$/,
];

function isSilentReply(text: string): boolean {
  return SILENT_REPLY_PATTERNS.some((re) => re.test(text));
}

/**
 * Extract a deliverable text string from a reply-resolver result. Returns
 * null when the turn was legitimately silent (NO_REPLY / HEARTBEAT_OK / all
 * reasoning) or had no text payload at all.
 *
 * When multiple payloads are present, returns the LAST non-reasoning
 * payload's text. The last segment is usually the finalized reply; prior
 * segments are typically intermediate planning. This matches the
 * dispatcher's own last-wins semantics for finals.
 */
export function extractRecoverableText(
  result: RecoverableReplyPayload | RecoverableReplyPayload[] | null | undefined,
): string | null {
  if (result === null || result === undefined) return null;
  const payloads = Array.isArray(result) ? result : [result];
  if (payloads.length === 0) return null;

  // Walk backward through payloads looking for the last non-suppressed one.
  for (let i = payloads.length - 1; i >= 0; i -= 1) {
    const p = payloads[i];
    if (!p || typeof p !== "object") continue;
    if (p.isReasoning) continue;
    if (p.isCompactionNotice) continue;
    const text = typeof p.text === "string" ? p.text.trim() : "";
    if (!text) continue;
    if (isSilentReply(text)) return null;
    return text;
  }

  return null;
}

