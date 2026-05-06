import { describe, it, expect } from "vitest";
import { buildAgentPrompt, type AgentState } from "./orchestrator.js";

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
