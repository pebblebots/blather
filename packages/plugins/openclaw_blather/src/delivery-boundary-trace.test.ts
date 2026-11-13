import { describe, expect, it } from "vitest";
import { createDeliveryBoundaryTrace } from "./delivery-boundary-trace.js";

describe("T#190 opt-in callback/send trace", () => {
  it("correlates two finals and records actual send outcome without exposing text", () => {
    const trace = createDeliveryBoundaryTrace("inbound-1");
    const first = trace.callback({ text: "secret narration" }, { kind: "final" }, { deliver: true, text: "secret narration" });
    trace.sendResult(first, "succeeded", "123e4567-e89b-12d3-a456-426614174000");
    trace.callback({ text: "secret answer" }, { kind: "final" }, {
      deliver: false, reason: "duplicate_final", suppressedIndex: 1,
    });
    const result = trace.summary();
    expect(trace.shouldLog()).toBe(true);
    expect(result.events.map((event) => event.decision)).toEqual(["approved", "duplicate_final"]);
    expect(result.events[0].send).toBe("succeeded");
    expect(result.events[0].messageId).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(result.events[0].digest).not.toBe(result.events[1].digest);
    expect(JSON.stringify(result)).not.toMatch(/secret|narration|answer/);
  });

  it("distinguishes failed transport from approval", () => {
    const trace = createDeliveryBoundaryTrace("inbound-2");
    const ordinal = trace.callback({ text: "reply" }, { kind: "final" }, { deliver: true, text: "reply" });
    trace.sendResult(ordinal, "failed", "server error containing secret");
    expect(trace.summary()).toMatchObject({ failures: 1, suppressed: 0 });
    expect(trace.summary().events[0]).toMatchObject({ send: "failed", decision: "approved" });
    expect(JSON.stringify(trace.summary())).not.toContain("server error");
  });

  it("bounds events and ignores arbitrary message IDs", () => {
    const trace = createDeliveryBoundaryTrace("inbound-3");
    for (let i = 0; i < 40; i++) {
      const ordinal = trace.callback(`payload-${i}`, { kind: "final" }, { deliver: true, text: `payload-${i}` });
      trace.sendResult(ordinal, "succeeded", "not-a-uuid/private-data");
    }
    expect(trace.summary().events).toHaveLength(32);
    expect(trace.summary().omittedCallbacks).toBe(8);
    expect(trace.summary().events[0].messageId).toBeUndefined();
    expect(trace.shouldLog()).toBe(false);
  });
});
