"""
Cognee Memory Service for Blather agents.

Provides semantic memory via Cognee when LLM_API_KEY is available,
falls back to Postgres full-text search otherwise.

Endpoints:
  POST /ingest  — ingest a message for an agent
  POST /query   — semantic search across agent memory
  GET  /health  — health check
"""
import os
import sys
import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cognee-service")

# ── Config ──

DB_URL = os.environ.get("DATABASE_URL", "postgresql://blather:blather-dev@localhost:5432/blather")
COGNEE_ENABLED = bool(os.environ.get("LLM_API_KEY"))
COGNEE_DATA_DIR = "/home/code/blather/cognee-data"

# ── Models ──

class Metadata(BaseModel):
    channelId: Optional[str] = None
    messageId: Optional[str] = None
    userId: Optional[str] = None
    timestamp: Optional[str] = None

class IngestRequest(BaseModel):
    agentId: str
    text: str
    metadata: Optional[Metadata] = None

class QueryRequest(BaseModel):
    agentId: str
    query: str
    limit: int = 5

# ── Postgres fallback (full-text search) ──

import asyncpg

pool: Optional[asyncpg.Pool] = None

INIT_SQL = """
CREATE TABLE IF NOT EXISTS agent_memories (
    id SERIAL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    channel_id TEXT,
    message_id TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ts_content TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);
CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_ts ON agent_memories USING GIN(ts_content);
"""

async def init_pg():
    global pool
    pool = await asyncpg.create_pool(DB_URL, min_size=1, max_size=5)
    async with pool.acquire() as conn:
        await conn.execute(INIT_SQL)
    logger.info("Postgres memory table ready")

async def pg_ingest(agent_id: str, text: str, metadata: Metadata = None):
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO agent_memories (agent_id, content, channel_id, message_id, user_id)
               VALUES ($1, $2, $3, $4, $5)""",
            agent_id,
            text,
            metadata.channelId if metadata else None,
            metadata.messageId if metadata else None,
            metadata.userId if metadata else None,
        )

async def pg_query(agent_id: str, query: str, limit: int = 5):
    async with pool.acquire() as conn:
        # Try full-text search first, fall back to ILIKE
        rows = await conn.fetch(
            """SELECT content, channel_id, user_id, created_at,
                      ts_rank(ts_content, plainto_tsquery('english', $2)) AS rank
               FROM agent_memories
               WHERE agent_id = $1
                 AND ts_content @@ plainto_tsquery('english', $2)
               ORDER BY rank DESC
               LIMIT $3""",
            agent_id, query, limit
        )
        if not rows:
            # Fallback: simple ILIKE
            rows = await conn.fetch(
                """SELECT content, channel_id, user_id, created_at, 0.0 AS rank
                   FROM agent_memories
                   WHERE agent_id = $1 AND content ILIKE '%' || $2 || '%'
                   ORDER BY created_at DESC
                   LIMIT $3""",
                agent_id, query, limit
            )
        return [
            {
                "text": r["content"],
                "channelId": r["channel_id"],
                "userId": r["user_id"],
                "timestamp": r["created_at"].isoformat() if r["created_at"] else None,
                "score": float(r["rank"]),
            }
            for r in rows
        ]

# ── Cognee backend (when LLM key available) ──

async def cognee_ingest(agent_id: str, text: str, metadata: Metadata = None):
    import cognee
    dataset = f"agent_{agent_id.replace('-', '_')}"
    enriched = text
    if metadata:
        parts = []
        if metadata.userId: parts.append(f"from:{metadata.userId}")
        if metadata.channelId: parts.append(f"ch:{metadata.channelId}")
        if parts: enriched = f"[{' '.join(parts)}] {text}"
    await cognee.add(enriched, dataset)
    try:
        await cognee.cognify(dataset)
    except Exception as e:
        logger.warning(f"cognify failed: {e}")

async def cognee_query(agent_id: str, query: str, limit: int = 5):
    import cognee
    from cognee import SearchType
    dataset = f"agent_{agent_id.replace('-', '_')}"
    try:
        results = await cognee.search(SearchType.INSIGHTS, query_text=query, datasets=[dataset])
        out = []
        for r in (results or [])[:limit]:
            out.append({"text": str(r)} if not isinstance(r, dict) else r)
        return out
    except Exception:
        try:
            results = await cognee.search(SearchType.CHUNKS, query_text=query, datasets=[dataset])
            return [{"text": str(r)} for r in (results or [])[:limit]]
        except Exception:
            return []

# ── App ──

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Always init Postgres (used as fallback and for raw storage)
    await init_pg()
    if COGNEE_ENABLED:
        try:
            os.environ["ENABLE_BACKEND_ACCESS_CONTROL"] = "false"
            os.environ.setdefault("DATA_ROOT_DIRECTORY", f"{COGNEE_DATA_DIR}/data")
            os.environ.setdefault("SYSTEM_ROOT_DIRECTORY", f"{COGNEE_DATA_DIR}/system")
            import cognee
            await cognee.run_migrations()
            logger.info("Cognee enabled with LLM backend")
        except Exception as e:
            logger.warning(f"Cognee init failed, using Postgres only: {e}")
            globals()["COGNEE_ENABLED"] = False  # noqa
    else:
        logger.info("No LLM_API_KEY — using Postgres full-text search only")
    yield
    if pool:
        await pool.close()

app = FastAPI(title="Cognee Memory Service", lifespan=lifespan)

@app.get("/health")
async def health():
    return {"status": "ok", "backend": "cognee" if COGNEE_ENABLED else "postgres-fts"}

@app.post("/ingest")
async def ingest(req: IngestRequest):
    try:
        # Always store in Postgres for durability
        await pg_ingest(req.agentId, req.text, req.metadata)
        # Also ingest into Cognee if available
        if COGNEE_ENABLED:
            try:
                await cognee_ingest(req.agentId, req.text, req.metadata)
            except Exception as e:
                logger.warning(f"Cognee ingest failed (pg ok): {e}")
        return {"status": "ok", "agentId": req.agentId}
    except Exception as e:
        logger.error(f"Ingest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/query")
async def query(req: QueryRequest):
    try:
        if COGNEE_ENABLED:
            try:
                results = await cognee_query(req.agentId, req.query, req.limit)
                if results:
                    return {"results": results, "agentId": req.agentId, "backend": "cognee"}
            except Exception:
                pass
        # Fallback to Postgres
        results = await pg_query(req.agentId, req.query, req.limit)
        return {"results": results, "agentId": req.agentId, "backend": "postgres-fts"}
    except Exception as e:
        logger.error(f"Query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3002)
