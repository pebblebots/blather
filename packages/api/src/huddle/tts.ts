import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const TTS_DIR = join(process.env.HOME || "/home/code", "blather", "uploads", "tts");
if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

// ElevenLabs voice mapping
// voice column in DB stores the ElevenLabs voice ID
// Default voice IDs from ElevenLabs library:
const VOICE_MAP: Record<string, string> = {
  // Young, casual, podcast-host energy voices
  "shimmer": "cgSgspJ2msm6clMCkdW9",  // Jessica — young, expressive female (portia)
  "nova": "XrExE9yKIg1WjnnlVkGX",     // Matilda — young, friendly female (aura)
  "alloy": "iP95p4xoKVk53GoZ742B",    // Chris — young, casual male (irma)
  "fable": "nPczCjzI2devNBz1zQrb",    // Brian — young, conversational male (code)
  "onyx": "JBFqnCBsd6RMkjVDRZzb",     // George — young, warm male (dilligence)
  "echo": "iP95p4xoKVk53GoZ742B",     // Chris — young, casual male (default)
};

const DEFAULT_VOICE_ID = "iP95p4xoKVk53GoZ742B"; // Chris

function resolveVoiceId(voice: string): string {
  // If it looks like an ElevenLabs voice ID (long alphanumeric), use directly
  if (voice && voice.length > 15) return voice;
  // Otherwise map from OpenAI voice name
  return VOICE_MAP[voice] || DEFAULT_VOICE_ID;
}

export async function generateTTS(
  text: string,
  voice: string,
  fileId?: string
): Promise<{ audioPath: string; audioUrl: string; duration: number }> {
  const id = fileId || randomUUID();
  const outPath = join(TTS_DIR, `${id}.mp3`);

  // Check cache
  if (existsSync(outPath)) {
    const duration = estimateDuration(text);
    return { audioPath: outPath, audioUrl: `/uploads/tts/${id}.mp3`, duration };
  }

  let inputText = text;
  if (inputText.length > 4096) {
    inputText = inputText.slice(0, 4032) + "\n\n(Message truncated for text to speech)";
  }
  if (!inputText.trim()) {
    throw new Error("Empty text");
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("TTS not configured - no ELEVENLABS_API_KEY");

  const voiceId = resolveVoiceId(voice);

  const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    body: JSON.stringify({
      text: inputText,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.35,
        similarity_boost: 0.75,
        style: 0.5,
        use_speaker_boost: true,
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("ElevenLabs TTS error", resp.status, body);
    throw new Error(`TTS generation failed: ${resp.status}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  await writeFile(outPath, Buffer.from(arrayBuffer));

  const duration = estimateDuration(text);
  console.log(`[TTS] Generated: voice=${voice} (${voiceId}) file=${id}.mp3 duration=${duration.toFixed(1)}s`);
  return { audioPath: outPath, audioUrl: `/uploads/tts/${id}.mp3`, duration };
}

function estimateDuration(text: string): number {
  // Rough estimate: ~150 words per minute for TTS
  const words = text.split(/\s+/).length;
  return Math.max(1, (words / 150) * 60);
}
