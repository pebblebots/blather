/**
 * Unit tests for the huddle TTS module.
 *
 * We don't hit the real ElevenLabs API in tests — the generateTTS function
 * requires the env var + network access. Instead we pin the HUDDLE_TTS_SPEED
 * constant (exported) and document the range constraint. Integration
 * coverage comes from manual smoke tests after deploy.
 */
import { describe, it, expect } from "vitest";
import { HUDDLE_TTS_SPEED } from "./tts.js";

describe("HUDDLE_TTS_SPEED", () => {
  it("is 1.2 — the max allowed by our ElevenLabs tier", () => {
    // Our account tier (Agents Platform) caps `speed` at [0.7, 1.2].
    // 1.25 and 1.3 were tested and both returned
    // 400 invalid_voice_settings. If ElevenLabs expands the cap upstream,
    // bump this value AND update the comment in tts.ts.
    expect(HUDDLE_TTS_SPEED).toBe(1.2);
  });

  it("stays within the Agents Platform allowed range", () => {
    // Sanity: any non-test edit must keep us inside the tier cap.
    expect(HUDDLE_TTS_SPEED).toBeGreaterThanOrEqual(0.7);
    expect(HUDDLE_TTS_SPEED).toBeLessThanOrEqual(1.2);
  });
});
