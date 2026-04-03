import { Hono } from "hono";
import { createReadStream, existsSync, mkdirSync, statSync } from "fs";
import { writeFile } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { ReadableStream } from "stream/web";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";
import { supabase, ATTACHMENT_BUCKET } from "../storage.js";

const UPLOAD_DIR = process.env.BLATHER_UPLOAD_DIR || join(process.env.HOME || "/home/code", "blather", "uploads");
const TTS_DIR = process.env.BLATHER_TTS_DIR || join(UPLOAD_DIR, "tts");
const MAX_SIZE = 10 * 1024 * 1024; // 10MB — tightened from 25MB
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "video/mp4", "video/webm",
  "application/pdf", "text/plain",
]);
const MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
};

function ensureDirectory(path: string) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
}

function isInvalidFilename(filename: string) {
  return filename.includes("..") || filename.includes("/");
}

function createFileResponse(filePath: string, contentType: string) {
  const stat = statSync(filePath);
  const stream = createReadStream(filePath);

  return new Response(ReadableStream.from(stream as any) as any, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(stat.size),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

ensureDirectory(UPLOAD_DIR);
ensureDirectory(TTS_DIR);

export const uploadRoutes = new Hono<Env>();

// Upload requires auth
uploadRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "No file uploaded" }, 400);
  }

  const f = file as File;
  if (f.size > MAX_SIZE) {
    return c.json({ error: `File too large (max ${Math.round(MAX_SIZE / 1024 / 1024)}MB)` }, 400);
  }
  if (!ALLOWED_TYPES.has(f.type)) {
    return c.json({ error: `Content type not allowed: ${f.type}` }, 400);
  }

  const ext = extname(f.name) || "";
  const uniqueName = `${randomUUID()}${ext}`;

  // Try Supabase Storage first, fall back to filesystem
  if (supabase) {
    const arrayBuffer = await f.arrayBuffer();
    const { data, error } = await supabase.storage
      .from(ATTACHMENT_BUCKET)
      .upload(uniqueName, arrayBuffer, {
        contentType: f.type,
        cacheControl: "31536000",
        upsert: false,
      });

    if (error) {
      console.error("[upload] Supabase upload error:", error.message);
      return c.json({ error: "Upload failed" }, 500);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(ATTACHMENT_BUCKET)
      .getPublicUrl(uniqueName);

    return c.json({
      url: urlData.publicUrl,
      filename: f.name,
      contentType: f.type,
      size: f.size,
    }, 201);
  }

  // Fallback: filesystem storage
  const filePath = join(UPLOAD_DIR, uniqueName);
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(filePath, buffer);
  const url = `/uploads/${uniqueName}`;
  return c.json({ url, filename: f.name, contentType: f.type, size: f.size }, 201);
});


// Serve TTS audio files
uploadRoutes.get("/tts/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (isInvalidFilename(filename)) {
    return c.json({ error: "Invalid filename" }, 400);
  }
  const filePath = join(TTS_DIR, filename);
  if (!existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }

  return createFileResponse(filePath, "audio/mpeg");
});

// Serve uploaded files (no auth needed for viewing)
uploadRoutes.get("/:filename", async (c) => {
  const filename = c.req.param("filename");
  if (isInvalidFilename(filename)) {
    return c.json({ error: "Invalid filename" }, 400);
  }
  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const ext = extname(filename).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  return createFileResponse(filePath, contentType);
});
