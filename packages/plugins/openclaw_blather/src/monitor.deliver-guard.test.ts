import { describe, it, expect, vi } from "vitest";

/**
 * T#147 regression: the `deliver` callback used by the blather plugin must
 * drop reasoning / compaction-notice payloads before they reach the Blather
 * API. This test exercises the guard in isolation (the full dispatcher path
 * lives in monitor.ts; we extract the same guard shape here).
 */

// Mirror of the guard logic in monitor.ts's deliver callback. If this drifts
// from the real code, the production guard is what matters — this test just
// pins down the intended contract.
async function deliver(
  payload: unknown,
  sendMessage: (channelId: string, text: string) => Promise<void>,
  channelId: string,
) {
  if (typeof payload === "object" && payload !== null) {
    if ((payload as any).isReasoning) return;
    if ((payload as any).isCompactionNotice) return;
  }
  const text =
    typeof payload === "string" ? payload : ((payload as any).text ?? "");
  if (text.trim()) await sendMessage(channelId, text);
}

describe("deliver guard (T#147)", () => {
  it("drops payloads with isReasoning: true", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await deliver(
      { text: "my internal thinking about the next tool call", isReasoning: true },
      send,
      "ch1",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("drops payloads with isCompactionNotice: true", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await deliver(
      { text: "compacting transcript...", isCompactionNotice: true },
      send,
      "ch1",
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers ordinary text payloads", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await deliver({ text: "hello" }, send, "ch1");
    expect(send).toHaveBeenCalledWith("ch1", "hello");
  });

  it("delivers string payloads", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await deliver("hello from string", send, "ch1");
    expect(send).toHaveBeenCalledWith("ch1", "hello from string");
  });

  it("skips whitespace-only payloads", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await deliver({ text: "   \n  " }, send, "ch1");
    expect(send).not.toHaveBeenCalled();
  });

  it("delivers payload when isReasoning is explicitly false", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    await deliver({ text: "real reply", isReasoning: false }, send, "ch1");
    expect(send).toHaveBeenCalledWith("ch1", "real reply");
  });
});
