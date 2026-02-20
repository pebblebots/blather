import { writeFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

const TTS_DIR = join(process.env.HOME || "/home/code", "blather", "uploads", "tts");
if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("TTS not configured - no OPENAI_API_KEY");

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", voice, input: inputText }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("OpenAI TTS error", resp.status, body);
    throw new Error(`TTS generation failed: ${resp.status}`);
  }

  const arrayBuffer = await resp.arrayBuffer();
  await writeFile(outPath, Buffer.from(arrayBuffer));

  const duration = estimateDuration(text);
  return { audioPath: outPath, audioUrl: `/uploads/tts/${id}.mp3`, duration };
}

function estimateDuration(text: string): number {
  // Rough estimate: ~150 words per minute for TTS
  const words = text.split(/\s+/).length;
  return Math.max(1, (words / 150) * 60);
}
