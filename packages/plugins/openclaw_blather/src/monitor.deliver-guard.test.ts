import { describe, it, expect, vi } from "vitest";
import {
  shouldDeliverReplyPayload,
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
