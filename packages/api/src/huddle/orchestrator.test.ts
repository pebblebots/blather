import { describe, it, expect } from "vitest";
import {
  buildAgentPrompt,
  computeNudgeDelayMs,
  type AgentState,
} from "./orchestrator.js";

function makeAgent(overrides: Partial<AgentState> = {}): AgentState {
  return {
    userId: "user-aura",
    displayName: "aura",
    bio: "Internet culture and tech trends researcher.",
    lastSpoke: 0,
    messageCount: 0,
    pendingNudge: false,
    ...overrides,
  };
}

describe("buildAgentPrompt — identity injection (T#179 follow-up)", () => {
  const aura = makeAgent();
  const code = makeAgent({
    userId: "user-code",
    displayName: "code",
    bio: "Builder and engineer.",
  });
  const dill = makeAgent({
    userId: "user-dill",
    displayName: "dilligence",
    bio: "Deal diligence and red-flag detection.",
  });

  it("asserts first-person identity up front", () => {
    const prompt = buildAgentPrompt(
      aura,
      "intro huddle",
      "the culture angle",
      null,
      [aura, code, dill],
    );
    // Identity line must appear before the topic line.
    const identityIdx = prompt.indexOf("You are aura.");
    const topicIdx = prompt.indexOf("Huddle topic:");
    expect(identityIdx).toBeGreaterThan(-1);
    expect(topicIdx).toBeGreaterThan(-1);
    expect(identityIdx).toBeLessThan(topicIdx);
  });

  it("explicitly forbids impersonating other participants", () => {
    const prompt = buildAgentPrompt(
      aura,
      "intro huddle",
      "the culture angle",
      null,
      [aura, code, dill],
    );
    expect(prompt).toContain("never impersonate another participant");
  });

  it("includes the agent's bio when present", () => {
    const prompt = buildAgentPrompt(
      aura,
      "intro huddle",
      "the culture angle",
      null,
      [aura, code],
    );
    expect(prompt).toContain(
      "Your expertise: Internet culture and tech trends researcher.",
    );
  });

  it("omits the expertise phrase when bio is null", () => {
    const anon = makeAgent({ userId: "u-x", displayName: "anon", bio: null });
    const prompt = buildAgentPrompt(anon, "t", "a", null, [anon]);
    expect(prompt).not.toContain("Your expertise:");
  });

  it("includes a pre-flight identity nudge", () => {
    const prompt = buildAgentPrompt(
      aura,
      "intro huddle",
      "the culture angle",
      null,
      [aura, code, dill],
    );
    // Must remind the model to prefer its own workspace persona over the
    // participant list when inferring who "I" is.
    expect(prompt).toMatch(/SOUL\.md|IDENTITY\.md/);
    expect(prompt).toMatch(/your own persona/i);
  });

  it("lists the OTHER agents as debate partners", () => {
    const prompt = buildAgentPrompt(
      aura,
      "intro huddle",
      "the culture angle",
      null,
      [aura, code, dill],
    );
    expect(prompt).toContain("debating with code and dilligence");
    // aura is NOT listed as her own debate partner.
    expect(prompt).not.toContain("debating with aura");
  });

  it("skips the partners line when aura is the only agent", () => {
    const prompt = buildAgentPrompt(aura, "t", "a", null, [aura]);
    expect(prompt).not.toContain("debating with");
  });

  it("includes the starter seed when provided", () => {
    const prompt = buildAgentPrompt(
      aura,
      "intro huddle",
      "the culture angle",
      "who's actually going to use this in 5 years?",
      [aura, code],
    );
    expect(prompt).toContain(
      'A provocative seed to react to: "who\'s actually going to use this in 5 years?"',
    );
  });

  it("omits the starter seed line when starter is null", () => {
    const prompt = buildAgentPrompt(aura, "t", "a", null, [aura, code]);
    expect(prompt).not.toContain("provocative seed");
  });

  it("keeps the 1-2 sentence brevity instruction", () => {
    const prompt = buildAgentPrompt(aura, "t", "a", null, [aura, code]);
    expect(prompt).toContain("1-2 sentences MAX");
  });

  it("keeps the mention prefix for compatibility with huddle dispatch", () => {
    const prompt = buildAgentPrompt(
      aura,
      "intro huddle",
      "the culture angle",
      null,
      [aura, code],
    );
    // The orchestrator posts the prompt as a message in the huddle
    // channel; the `@<name>` prefix triggers the agent's inbound router.
    expect(prompt.startsWith("@aura")).toBe(true);
  });

  it("includes the one-message-per-nudge turn-discipline rule (fix #3)", () => {
    const prompt = buildAgentPrompt(
      makeAgent(),
      "intro huddle",
      "the culture angle",
      null,
      [makeAgent(), makeAgent({ userId: "u-c", displayName: "code" })],
    );
    expect(prompt).toContain("ONE message per nudge");
    expect(prompt).toMatch(/addresses you by name/i);
  });

  it("reproduces the T#179 regression shape", () => {
    // Regression: prior to this fix, the prompt for aura began with
    // "@aura — Huddle topic" and contained no "You are aura." anchor.
    // Aura (cold-spawned, fresh session, Kimi K2.6 model) hallucinated
    // a generic engineer identity in response.
    //
    // After the fix, the prompt MUST contain the identity anchor BEFORE
    // the huddle topic, even when there's no bio.
    const agent = makeAgent({
      userId: "u-test",
      displayName: "aura",
      bio: null,
    });
    const prompt = buildAgentPrompt(
      agent,
      "introduce yourselves",
      "the culture angle",
      null,
      [
        agent,
        makeAgent({ userId: "u-c", displayName: "code", bio: null }),
      ],
    );
    expect(prompt).toMatch(/You are aura\./);
    const identityIdx = prompt.indexOf("You are aura.");
    const topicIdx = prompt.indexOf("Huddle topic:");
    expect(identityIdx).toBeLessThan(topicIdx);
  });
});

describe("computeNudgeDelayMs — TTS-aware nudge pacing (fix #1)", () => {
  // Deterministic RNG for the jitter component.
  const zeroRng = () => 0;
  const maxRng = () => 0.9999999;

  it("enforces the 6s minimum floor when TTS is short or absent", () => {
    expect(computeNudgeDelayMs(0, zeroRng)).toBe(6000);
    expect(computeNudgeDelayMs(2000, zeroRng)).toBe(6000);
    expect(computeNudgeDelayMs(4999, zeroRng)).toBe(6000);
  });

  it("extends beyond the floor when TTS ran longer than 5s", () => {
    // 8s audio + 1s pad = 9s floor, no jitter.
    expect(computeNudgeDelayMs(8000, zeroRng)).toBe(9000);
    // 15s audio + 1s pad = 16s floor.
    expect(computeNudgeDelayMs(15000, zeroRng)).toBe(16000);
  });

  it("adds up to 3s of jitter on top of the floor", () => {
    // 8s TTS + 1s pad = 9s floor. Max jitter pushes to ~12s.
    const delay = computeNudgeDelayMs(8000, maxRng);
    expect(delay).toBeGreaterThanOrEqual(9000);
    expect(delay).toBeLessThanOrEqual(12000);
  });

  it("jitter also applies to the 6s floor case", () => {
    // Short audio, max jitter → 6s + ~3s = ~9s.
    const delay = computeNudgeDelayMs(1000, maxRng);
    expect(delay).toBeGreaterThanOrEqual(6000);
    expect(delay).toBeLessThanOrEqual(9000);
  });

  it("returns an integer millisecond value", () => {
    const delay = computeNudgeDelayMs(7777, () => 0.3333);
    expect(Number.isInteger(delay)).toBe(true);
  });

  it("defaults to Math.random when no rng is passed", () => {
    // Sanity: invoked with defaults produces a value in a plausible range.
    const delay = computeNudgeDelayMs(5000);
    expect(delay).toBeGreaterThanOrEqual(6000);
    // 5000+1000=6000 floor, +<=3000 jitter → max 9000.
    expect(delay).toBeLessThanOrEqual(9000);
  });

  it("regression: 30-word reply at ~150wpm produces ~12s audio, nudge waits >=13s", () => {
    // ~12s TTS duration → 12000 + 1000 = 13000 floor.
    const delay = computeNudgeDelayMs(12000, zeroRng);
    expect(delay).toBe(13000);
    // Pre-fix behaviour (15000 + random*5000) could fire the nudge
    // during audio playback; post-fix the floor guarantees audio
    // finishes + 1s buffer before the next speaker is prompted.
  });
});
