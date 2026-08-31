import { describe, expect, it } from "vitest";
import {
  beginModeEAudit,
  endModeEAudit,
  observedModeEToolCalls,
  recordModeEToolCall,
} from "./mode-e-audit.js";

describe("Mode E turn evidence ledger T#192", () => {
  it("counts only tool calls made while a monitored turn is active", () => {
    const session = "agent:main:blather:channel:test";
    recordModeEToolCall(session);
    expect(observedModeEToolCalls(session)).toBe(0);

    beginModeEAudit(session);
    recordModeEToolCall(session);
    recordModeEToolCall(session);
    expect(observedModeEToolCalls(session)).toBe(2);

    endModeEAudit(session);
    expect(observedModeEToolCalls(session)).toBe(0);
  });

  it("keeps concurrent sessions isolated", () => {
    beginModeEAudit("a");
    beginModeEAudit("b");
    recordModeEToolCall("a");
    expect(observedModeEToolCalls("a")).toBe(1);
    expect(observedModeEToolCalls("b")).toBe(0);
    endModeEAudit("a");
    endModeEAudit("b");
  });
});
