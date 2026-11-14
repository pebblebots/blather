import { describe, expect, it, vi } from "vitest";
import { runWithSettledDelivery } from "./delivery-settlement.js";
import { createPerTurnDeliveryGuard } from "./deliver-guard.js";
import { createDeliveryBoundaryTrace } from "./delivery-boundary-trace.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("T#190 delivery lifecycle", () => {
  it("does not report settled until a queued send finishes", async () => {
    const send = deferred<void>();
    const events: string[] = [];
    const dispatcher = {
      markComplete: vi.fn(() => { events.push("complete"); }),
      waitForIdle: vi.fn(async () => { await send.promise; events.push("settled"); }),
    };
    const result = runWithSettledDelivery(dispatcher, async () => {
      events.push("resolved");
      return { queuedFinal: true };
    }).then((value) => { events.push("summary-safe"); return value; });

    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["resolved", "complete"]);
    send.resolve();
    await expect(result).resolves.toEqual({ queuedFinal: true });
    expect(events).toEqual(["resolved", "complete", "settled", "summary-safe"]);
  });

  it("drains a late failed send before exposing its outcome", async () => {
    const send = deferred<void>();
    const trace = createDeliveryBoundaryTrace("inbound-late-failure");
    const guard = createPerTurnDeliveryGuard();
    const decision = guard.check({ text: "real reply" }, { kind: "final" });
    expect(decision.deliver).toBe(true);
    const ordinal = trace.callback({ text: "real reply" }, { kind: "final" }, decision);
    const dispatcher = {
      markComplete: vi.fn(),
      waitForIdle: vi.fn(async () => {
        await send.promise;
        trace.sendResult(ordinal, "failed"); // core dispatcher catches send failures
      }),
    };
    const result = runWithSettledDelivery(dispatcher, async () => 1);
    expect(trace.shouldLog()).toBe(false);
    send.resolve();
    await result;
    expect(trace.shouldLog()).toBe(true);
    expect(trace.summary().events[0]).toMatchObject({ decision: "approved", send: "failed" });
    expect(guard.approvedFinalCount()).toBe(1);
  });

  it("includes a callback queued behind a delayed first send in the completed record", async () => {
    const send = deferred<void>();
    const trace = createDeliveryBoundaryTrace("inbound-delayed-callback");
    const guard = createPerTurnDeliveryGuard();
    let deliveryChain = Promise.resolve();
    let completed = false;
    const dispatcher = {
      markComplete: vi.fn(() => { completed = true; }),
      waitForIdle: vi.fn(() => deliveryChain),
    };

    const result = runWithSettledDelivery(dispatcher, async () => {
      // Mirror the installed dispatcher's serialized sendChain: resolution
      // returns once finals are queued, before either callback has settled.
      deliveryChain = deliveryChain.then(async () => {
        const first = { text: "intermediate" };
        const decision = guard.check(first, { kind: "final" });
        const ordinal = trace.callback(first, { kind: "final", assistantMessageIndex: 2 }, decision);
        await send.promise;
        trace.sendResult(ordinal, "succeeded", "123e4567-e89b-12d3-a456-426614174000");
      }).then(() => {
        const second = { text: "actual answer" };
        const decision = guard.check(second, { kind: "final" });
        trace.callback(second, { kind: "final", assistantMessageIndex: 3 }, decision);
      });
      return { queuedFinal: true, counts: { final: 2 } };
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(completed).toBe(true);
    expect(trace.summary().callbackCount).toBe(1);
    expect(trace.shouldLog()).toBe(false);
    send.resolve();
    await expect(result).resolves.toMatchObject({ counts: { final: 2 } });
    expect(trace.summary().callbackCount).toBe(2);
    expect(trace.summary().events).toMatchObject([
      { ordinal: 1, assistantMessageIndex: 2, decision: "approved", send: "succeeded" },
      { ordinal: 2, assistantMessageIndex: 3, decision: "duplicate_final" },
    ]);
    expect(trace.shouldLog()).toBe(true);
    expect(guard.suppressedFinalCount()).toBe(1);
  });

  it("marks complete and drains even when resolution rejects", async () => {
    const dispatcher = { markComplete: vi.fn(), waitForIdle: vi.fn(async () => {}) };
    await expect(runWithSettledDelivery(dispatcher, async () => {
      throw new Error("resolver failed");
    })).rejects.toThrow("resolver failed");
    expect(dispatcher.markComplete).toHaveBeenCalledOnce();
    expect(dispatcher.waitForIdle).toHaveBeenCalledOnce();
  });
});
