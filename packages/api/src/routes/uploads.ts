import { Hono } from "hono";
import { createReadStream, existsSync, mkdirSync, statSync } from "fs";
import { writeFile } from "fs/promises";
import { join, extname } from "path";
import { randomUUID } from "crypto";
import { ReadableStream } from "stream/web";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";

const UPLOAD_DIR = join(process.env.HOME || "/home/code", "blather", "uploads");
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp",
  "application/pdf", "text/plain",
]);

// Ensure uploads dir exists
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

export const uploadRoutes = new Hono<Env>();

// Upload requires auth
uploadRoutes.post("/", authMiddleware, async (c) => {
  const body = await c.req.parseBody();
  const file = body["file"];
  if (!file || typeof file === "string") {
    return c.json({ error: "No file uploaded" }, 400);
  }

  // file is a File object
  const f = file as File;
  if (f.size > MAX_SIZE) {
    return c.json({ error: "File too large (max 10MB)" }, 400);
  }
  if (!ALLOWED_TYPES.has(f.type)) {
    return c.json({ error: `Content type not allowed: ${f.type}` }, 400);
  }

  const ext = extname(f.name) || "";
  const uniqueName = `${randomUUID()}${ext}`;
  const filePath = join(UPLOAD_DIR, uniqueName);
  const buffer = Buffer.from(await f.arrayBuffer());
  await writeFile(filePath, buffer);

  const url = `/uploads/${uniqueName}`;
  return c.json({ url, filename: f.name, contentType: f.type, size: f.size }, 201);
});

// Serve uploaded files (no auth needed for viewing)
uploadRoutes.get("/:filename", async (c) => {
  const filename = c.req.param("filename");
  // Prevent path traversal
  if (filename.includes("..") || filename.includes("/")) {
    return c.json({ error: "Invalid filename" }, 400);
  }
  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) {
    return c.json({ error: "File not found" }, 404);
  }

  const stat = statSync(filePath);
  const ext = extname(filename).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
    ".gif": "image/gif", ".webp": "image/webp",
    ".pdf": "application/pdf", ".txt": "text/plain",
  };
  const contentType = mimeMap[ext] || "application/octet-stream";

  const stream = createReadStream(filePath);
  return new Response(
    ReadableStream.from(stream as any) as any,
    {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(stat.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    }
  );
});
