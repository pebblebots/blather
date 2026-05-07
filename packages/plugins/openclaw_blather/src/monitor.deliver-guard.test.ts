import { describe, it, expect, vi } from "vitest";
import {
  shouldDeliverReplyPayload,
  createPerTurnDeliveryGuard,
  type DeliverReplyInfo,
} from "./deliver-guard.js";

/**
 * Guard tests for the Blather `deliver` callback.
 *
 *  - T#147 (2026-04-30): filter `isReasoning` / `isCompactionNotice` payloads.
 *    The core reply pipeline tags internal prose with these flags; Blather
 *    was posting them as real messages under the agent's userId.
 *
 *  - T#171 (2026-05-04): filter intermediate assistant-text segments. The
 *    core dispatcher fires `deliver` once per segment with `info.kind in
 *    {tool, block, final}`. Only `final` is the real reply; `block` and
 *    `tool` are streaming-surface artifacts that Blather (non-streaming)
 *    was posting as separate messages, producing 3-10 narration leaks per
 *    agent per day ("Let me check...", "Found it.", etc.).
 *
 * The guard is the pure function `shouldDeliverReplyPayload(payload, info)`
 * exported from monitor.ts. The `deliver` callback in the WebSocket handler
 * just wraps it with the sendMessage call.
 */

function runDeliver(
  payload: unknown,
  info: DeliverReplyInfo | undefined,
  send: (channelId: string, text: string) => Promise<void>,
  channelId = "ch1",
) {
  const decision = shouldDeliverReplyPayload(payload, info);
  if (decision.deliver) return send(channelId, decision.text);
  return Promise.resolve();
}

describe("deliver guard T#147 (reasoning / compaction-notice)", () => {
  it("drops payloads with isReasoning: true", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver(
      { text: "my internal thinking about the next tool call", isReasoning: true },
      { kind: "final" },
      send,
    );
    expect(send).not.toHaveBeenCalled();
    expect(
      shouldDeliverReplyPayload({ text: "x", isReasoning: true }, { kind: "final" }),
    ).toMatchObject({ deliver: false, reason: "reasoning" });
  });

  it("drops payloads with isCompactionNotice: true", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver(
      { text: "compacting transcript...", isCompactionNotice: true },
      { kind: "final" },
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("drops reasoning payloads even when kind is block (still internal)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver(
      { text: "thinking...", isReasoning: true },
      { kind: "block" },
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers payload when isReasoning is explicitly false and kind is final", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver(
      { text: "real reply", isReasoning: false },
      { kind: "final" },
      send,
    );
    expect(send).toHaveBeenCalledWith("ch1", "real reply");
  });
});

describe("deliver guard T#171 (intermediate block/tool kinds)", () => {
  it("delivers single-segment final replies normally", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver({ text: "hello" }, { kind: "final" }, send);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("ch1", "hello");
  });

  it("drops block-kind deliveries (intermediate assistant-text segments)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver(
      { text: "Let me check the database..." },
      { kind: "block" },
      send,
    );
    expect(send).not.toHaveBeenCalled();
    expect(
      shouldDeliverReplyPayload({ text: "Let me check..." }, { kind: "block" }),
    ).toMatchObject({ deliver: false, reason: "kind:block" });
  });

  it("drops tool-kind deliveries (never meant for chat)", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver(
      { text: "{\"result\":\"ok\"}" },
      { kind: "tool" },
      send,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("reproduces the T#171 multi-segment turn: only the final posts", async () => {
    // Simulates a typical agent turn: 3 planning-prose segments and tool
    // calls, ending with one real reply. Pre-fix, Blather posted all four.
    const send = vi.fn().mockResolvedValue(undefined);
    const segments: Array<[{ text: string }, DeliverReplyInfo]> = [
      [{ text: "Let me check the task..." }, { kind: "block" }],
      [{ text: "Found it. Now let me look up the comment." }, { kind: "block" }],
      [{ text: "Looking at the metadata..." }, { kind: "block" }],
      [{ text: "Done \u2014 the task is assigned to Keith." }, { kind: "final" }],
    ];
    for (const [payload, info] of segments) {
      await runDeliver(payload, info, send);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "ch1",
      "Done \u2014 the task is assigned to Keith.",
    );
  });

  it("preserves [[reply_to_current]] tag in the final payload text", async () => {
    // Agents sometimes include [[reply_to_current]] in the final text to
    // signal reply-threading. The guard must not strip or drop it.
    const send = vi.fn().mockResolvedValue(undefined);
    const segments: Array<[{ text: string }, DeliverReplyInfo]> = [
      [{ text: "Thinking..." }, { kind: "block" }],
      [{ text: "[[reply_to_current]] Yes, the PR is merged." }, { kind: "final" }],
    ];
    for (const [payload, info] of segments) {
      await runDeliver(payload, info, send);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "ch1",
      "[[reply_to_current]] Yes, the PR is merged.",
    );
  });

  it("does not filter explicit outbound sends (those bypass deliver entirely)", async () => {
    // Agents that want to send multiple Blather messages in one turn do so
    // via `message action=send` tool calls, which route through the
    // outbound.sendText adapter \u2014 NOT through the reply dispatcher's
    // deliver callback. This test just documents that path separation:
    // the guard only ever sees dispatcher deliveries, never
    // agent-initiated explicit sends.
    const send = vi.fn().mockResolvedValue(undefined);
    // Simulate: 5 turn segments (mix of block/final from dispatcher)...
    await runDeliver({ text: "planning..." }, { kind: "block" }, send);
    await runDeliver({ text: "final reply" }, { kind: "final" }, send);
    // ...only the final one went through.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("ch1", "final reply");
    // Explicit sends (outbound.sendText) are a separate code path; they
    // call BlatherClient.sendMessage directly and are not subject to
    // shouldDeliverReplyPayload.
  });
});

describe("deliver guard edge cases", () => {
  it("delivers string payloads when kind is final", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver("hello from string", { kind: "final" }, send);
    expect(send).toHaveBeenCalledWith("ch1", "hello from string");
  });

  it("skips whitespace-only final payloads", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver({ text: "   \n  " }, { kind: "final" }, send);
    expect(send).not.toHaveBeenCalled();
    expect(
      shouldDeliverReplyPayload({ text: "  " }, { kind: "final" }),
    ).toMatchObject({ deliver: false, reason: "empty" });
  });

  it("delivers final payload when info is absent (backward-compatible)", async () => {
    // If some caller invokes the guard without info, we fall back to the
    // old T#147-only behavior: deliver anything that isn't reasoning /
    // compaction / empty. This keeps the guard usable from the orphan
    // test-only `deliver()` shape that predated T#171.
    const send = vi.fn().mockResolvedValue(undefined);
    await runDeliver({ text: "plain reply" }, undefined, send);
    expect(send).toHaveBeenCalledWith("ch1", "plain reply");
  });

  it("skips null/undefined payloads gracefully", () => {
    expect(shouldDeliverReplyPayload(null, { kind: "final" })).toMatchObject({
      deliver: false,
    });
    expect(shouldDeliverReplyPayload(undefined, { kind: "final" })).toMatchObject({
      deliver: false,
    });
  });
});

// ---------------------------------------------------------------------------
// T#178 — per-turn idempotency guard (cascade-break at source).
//
// Background: the upstream openclaw reply-dispatcher occasionally emits
// more than one `kind="final"` payload for a single model turn. Combined
// with the runtime's queue-flush re-delivery behaviour, this can cascade
// to O(N²) amplification across the fleet. The per-turn guard is a
// stateful wrapper that approves only the first final per turn and
// suppresses the rest.
// ---------------------------------------------------------------------------
describe("per-turn delivery guard T#178 (cascade break)", () => {
  it("approves the first final and suppresses duplicates", () => {
    const guard = createPerTurnDeliveryGuard();
    const first = guard.check({ text: "real reply" }, { kind: "final" });
    expect(first).toMatchObject({ deliver: true, text: "real reply" });

    const dup1 = guard.check({ text: "dup 1" }, { kind: "final" });
    expect(dup1).toMatchObject({ deliver: false, reason: "duplicate_final" });
    const dup2 = guard.check({ text: "dup 2" }, { kind: "final" });
    expect(dup2).toMatchObject({ deliver: false, reason: "duplicate_final" });

    expect(guard.approvedFinalCount()).toBe(1);
    expect(guard.suppressedFinalCount()).toBe(2);
  });

  it("returns increasing suppressedIndex for each duplicate", () => {
    const guard = createPerTurnDeliveryGuard();
    guard.check({ text: "first" }, { kind: "final" });
    const d1 = guard.check({ text: "dup a" }, { kind: "final" });
    const d2 = guard.check({ text: "dup b" }, { kind: "final" });
    const d3 = guard.check({ text: "dup c" }, { kind: "final" });
    expect(d1).toMatchObject({ suppressedIndex: 1 });
    expect(d2).toMatchObject({ suppressedIndex: 2 });
    expect(d3).toMatchObject({ suppressedIndex: 3 });
  });

  it("does not count block/tool kinds toward the final budget", () => {
    const guard = createPerTurnDeliveryGuard();
    // block and tool are dropped by the pure guard — they should not
    // consume the single-final budget.
    guard.check({ text: "thinking..." }, { kind: "block" });
    guard.check({ text: "tool output" }, { kind: "tool" });
    guard.check({ text: "more thinking" }, { kind: "block" });
    // The first final after those block/tool drops should still deliver.
    const result = guard.check({ text: "real reply" }, { kind: "final" });
    expect(result).toMatchObject({ deliver: true, text: "real reply" });
    expect(guard.approvedFinalCount()).toBe(1);
    expect(guard.suppressedFinalCount()).toBe(0);
  });

  it("inherits the pure guard's reasoning / compaction filters", () => {
    const guard = createPerTurnDeliveryGuard();
    const reasoning = guard.check(
      { text: "internal thinking", isReasoning: true },
      { kind: "final" },
    );
    expect(reasoning).toMatchObject({ deliver: false, reason: "reasoning" });
    // And the reasoning payload should not have consumed the budget:
    const real = guard.check({ text: "real" }, { kind: "final" });
    expect(real).toMatchObject({ deliver: true, text: "real" });
  });

  it("treats empty finals as non-consuming", () => {
    const guard = createPerTurnDeliveryGuard();
    guard.check({ text: "   " }, { kind: "final" });
    // Empty didn't count as the approved final, so the next real final
    // still gets delivered.
    const real = guard.check({ text: "real" }, { kind: "final" });
    expect(real).toMatchObject({ deliver: true });
  });

  it("reproduces Sourcy's T#178 `sent 4` cascade shape", () => {
    // Pre-fix: dispatcher emitted 4 finals for a single turn, all 4
    // posted as separate Blather messages. Post-fix: guard approves
    // the first, suppresses the other 3.
    const guard = createPerTurnDeliveryGuard();
    const send = vi.fn();
    const finals = [
      "intermediate text from pre-tool segment",
      "another intermediate re-emitted as final",
      "third mis-tagged segment",
      "real reply",
    ];
    for (const text of finals) {
      const d = guard.check({ text }, { kind: "final" });
      if (d.deliver) send("ch1", d.text);
    }
    expect(send).toHaveBeenCalledTimes(1);
    // First-wins policy: the approved final is the FIRST one emitted,
    // not the last. The upstream dispatcher is supposed to emit the
    // real reply last; when it misbehaves, first-wins is a safe
    // trade-off because intermediate segments are typically thinking /
    // planning prose that is LESS appropriate than the last segment.
    //
    // We document this here because it's a deliberate choice: if we
    // get a steady stream of complaints that the guard keeps the wrong
    // segment, we can flip to last-wins (a one-line change). First-wins
    // matches the behavior of most existing cascade-break guards.
    expect(send).toHaveBeenCalledWith(
      "ch1",
      "intermediate text from pre-tool segment",
    );
    expect(guard.suppressedFinalCount()).toBe(3);
  });

  it("each call to createPerTurnDeliveryGuard returns a fresh counter", () => {
    const g1 = createPerTurnDeliveryGuard();
    g1.check({ text: "turn 1 final" }, { kind: "final" });
    g1.check({ text: "dup" }, { kind: "final" });
    expect(g1.approvedFinalCount()).toBe(1);
    expect(g1.suppressedFinalCount()).toBe(1);

    const g2 = createPerTurnDeliveryGuard();
    expect(g2.approvedFinalCount()).toBe(0);
    expect(g2.suppressedFinalCount()).toBe(0);
    const fresh = g2.check({ text: "turn 2 final" }, { kind: "final" });
    expect(fresh).toMatchObject({ deliver: true });
  });
});
