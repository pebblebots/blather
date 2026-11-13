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

  it("marks complete and drains even when resolution rejects", async () => {
    const dispatcher = { markComplete: vi.fn(), waitForIdle: vi.fn(async () => {}) };
    await expect(runWithSettledDelivery(dispatcher, async () => {
      throw new Error("resolver failed");
    })).rejects.toThrow("resolver failed");
    expect(dispatcher.markComplete).toHaveBeenCalledOnce();
    expect(dispatcher.waitForIdle).toHaveBeenCalledOnce();
  });
});
