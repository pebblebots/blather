/**
 * T#190: opt-in per-dispatch evidence at the Blather callback/send boundary.
 * Never persist reply bodies or a digest key: a process-local HMAC key prevents
 * dictionary attacks against short, predictable replies in gateway journals.
 * This cannot observe upstream producer/runner payloads and cannot by itself
 * attribute the archived incident to the plugin.
 */
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DeliverReplyInfo, PerTurnDecision } from "./deliver-guard.js";

const digestKey = randomBytes(32);
const MAX_EVENTS = 32;

type BoundaryEvent = {
  ordinal: number;
  kind: string;
  assistantMessageIndex?: number;
  length: number;
  digest: string;
  decision: string;
  send?: "succeeded" | "failed";
  messageId?: string;
};

export function createDeliveryBoundaryTrace(inboundMessageId: string) {
  const dispatchId = randomUUID();
  const events: BoundaryEvent[] = [];
  let callbackCount = 0;
  let suppressed = 0;
  let failures = 0;

  function callback(
    payload: unknown,
    info: (DeliverReplyInfo & { assistantMessageIndex?: number }) | undefined,
    decision: PerTurnDecision,
  ) {
    const ordinal = ++callbackCount;
    if ("reason" in decision && decision.reason === "duplicate_final") suppressed++;
    if (events.length < MAX_EVENTS) {
      const assistantMessageIndex = info?.assistantMessageIndex;
      const text = typeof payload === "string"
        ? payload
        : typeof payload === "object" && payload !== null && "text" in payload &&
          typeof payload.text === "string" ? payload.text : "";
      events.push({
        ordinal,
        kind: info?.kind ?? "unknown",
        ...(typeof assistantMessageIndex === "number" &&
          Number.isSafeInteger(assistantMessageIndex) && assistantMessageIndex >= 0
          ? { assistantMessageIndex }
          : {}),
        length: Buffer.byteLength(text, "utf8"),
        digest: createHmac("sha256", digestKey).update(text).digest("hex").slice(0, 16),
        decision: "reason" in decision ? decision.reason : "approved",
      });
    }
    return ordinal;
  }

  function sendResult(ordinal: number, outcome: "succeeded" | "failed", messageId?: string) {
    if (outcome === "failed") failures++;
    const event = events.find((candidate) => candidate.ordinal === ordinal);
    if (!event) return;
    event.send = outcome;
    // API-generated UUID only; never log a server-supplied arbitrary string.
    if (outcome === "succeeded" && messageId && /^[a-f0-9-]{36}$/i.test(messageId)) {
      event.messageId = messageId;
    }
  }

  function summary() {
    return {
      dispatchId,
      inboundMessageId,
      callbackCount,
      omittedCallbacks: Math.max(0, callbackCount - MAX_EVENTS),
      suppressed,
      failures,
      events,
    };
  }

  return { callback, sendResult, summary, shouldLog: () => suppressed > 0 || failures > 0 };
}
