import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { messages, users, channels } from "@blather/db";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireChannelMembership } from "../middleware/channelAccess.js";
import { existsSync, mkdirSync, createReadStream, statSync } from "fs";
import { writeFile } from "fs/promises";
import { join } from "path";
import { ReadableStream } from "stream/web";

const UPLOAD_BASE = process.env.BLATHER_UPLOAD_DIR || join(process.env.HOME || "/home/code", "blather", "uploads");
const TTS_DIR = process.env.BLATHER_TTS_DIR || join(UPLOAD_BASE, "tts");
if (!existsSync(TTS_DIR)) mkdirSync(TTS_DIR, { recursive: true });

export const ttsRoutes = new Hono<Env>();

// Can the caller view the channel a message lives in? Public channels are
// readable by any authenticated user; private/DM channels require membership.
async function canViewChannel(db: any, userId: string, channelId: string | null): Promise<boolean> {
  if (!channelId) return false;
  const [channel] = await db
    .select({ channelType: channels.channelType })
    .from(channels)
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!channel) return false;
  if (channel.channelType === "private" || channel.channelType === "dm") {
    return requireChannelMembership(db, userId, channelId);
  }
  return true;
}

ttsRoutes.post("/:messageId", authMiddleware, async (c) => {
  const { messageId } = c.req.param();
  const db = c.get("db");
  const userId = c.get("userId");

  // Fetch the message and authorize visibility BEFORE doing any work or
  // returning a cached URL. Without this, any authenticated user could mint a
  // TTS capability URL (and trigger an OpenAI call) for a message in a private
  // channel or DM they are not a member of.
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!msg) return c.json({ error: "Message not found" }, 404);

  if (!(await canViewChannel(db, userId, msg.channelId))) {
    return c.json({ error: "Not a member of this channel" }, 403);
  }

  // Check cache (after authorization)
  const outPath = join(TTS_DIR, `${messageId}.mp3`);
  if (existsSync(outPath)) {
    return c.json({ audioUrl: `/uploads/tts/${messageId}.mp3` });
  }

  // Get author voice
  let voice = 'echo';
  if (msg.userId) {
    const [user] = await db.select().from(users).where(eq(users.id, msg.userId)).limit(1);
    voice = user?.voice || 'echo';
  }

  // Truncate
  let text = msg.content || "";
  if (text.length > 4096) {
    text = text.slice(0, 4032) + "\n\n(Message truncated for text to speech)";
  }
  if (!text.trim()) return c.json({ error: "Empty message" }, 400);

  // Call OpenAI TTS
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return c.json({ error: "TTS not configured" }, 500);

  const resp = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "tts-1", voice, input: text }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error("OpenAI TTS error", resp.status, body);
    return c.json({ error: "TTS generation failed" }, 500);
  }

  const arrayBuffer = await resp.arrayBuffer();
  await writeFile(outPath, Buffer.from(arrayBuffer));

  return c.json({ audioUrl: `/uploads/tts/${messageId}.mp3` });
});

// Serve TTS audio files
ttsRoutes.get("/:messageId", async (c) => {
  const { messageId } = c.req.param();
  if (messageId.includes("..") || messageId.includes("/")) {
    return c.json({ error: "Invalid id" }, 400);
  }
  const filePath = join(TTS_DIR, `${messageId}.mp3`);
  if (!existsSync(filePath)) return c.json({ error: "Not found" }, 404);

  const stat = statSync(filePath);
  const stream = createReadStream(filePath);
  return new Response(ReadableStream.from(stream as any) as any, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
});
