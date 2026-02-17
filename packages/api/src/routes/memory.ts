import { Hono } from "hono";
import type { Env } from "../app.js";
import { authMiddleware } from "../middleware/auth.js";

export const memoryRoutes = new Hono<Env>();
memoryRoutes.use("*", authMiddleware);

// GET /memory/search?agentId=UUID&query=text&limit=5
memoryRoutes.get("/search", async (c) => {
  const agentId = c.req.query("agentId");
  const query = c.req.query("query");
  const limit = parseInt(c.req.query("limit") || "5", 10);

  if (!agentId || !query) {
    return c.json({ error: "agentId and query are required" }, 400);
  }

  try {
    const res = await fetch("http://localhost:3002/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId, query, limit }),
    });
    const data = await res.json();
    return c.json(data);
  } catch (e) {
    return c.json({ error: "Memory service unavailable" }, 503);
  }
});
