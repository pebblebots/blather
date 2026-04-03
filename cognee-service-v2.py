"""
Cognee Memory Service for Blather agents (v2).

Enhanced with temporal context disambiguation to prevent planning-vs-completion contamination.

Key improvements:
- Detects temporal markers (plan to, will, going to, have done, completed, etc.)
- Adds explicit temporal context to stored memories
- Improves query matching to respect temporal boundaries

Endpoints:
  POST /ingest  — ingest a message for an agent
  POST /query   — semantic search across agent memory
  GET  /health  — health check
"""
import os
import sys
import asyncio
import logging
import re
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cognee-service-v2")

# ── Config ──

DB_URL = os.environ.get("DATABASE_URL", "postgresql://blather:blather-dev@localhost:5432/blather")
COGNEE_ENABLED = bool(os.environ.get("LLM_API_KEY"))
COGNEE_DATA_DIR = "/home/code/blather/cognee-data"

# ── Temporal Context Detection ──

# Patterns that indicate planning/future intent
PLANNING_PATTERNS = [
    r'\b(?:plan|plans|planning|planned)\s+to\b',
    r'\b(?:going|gonna)\s+to\b',
    r'\b(?:will|would|should|might|may|could)\s+(?:\w+\s+){0,3}(?:invest|acquire|build|launch|hire|expand|partner|develop)',
    r'\b(?:next|upcoming|future|proposed)\s+(?:quarter|month|year|round|investment)',
    r'\b(?:considering|exploring|evaluating|discussing)\b',
    r'\b(?:potential|possible|candidate|target)\s+(?:investment|acquisition|partner)',
    r'\bif\s+(?:we|they)\b',  # conditional statements
    r'\b(?:hoping|aiming|targeting|intending)\s+to\b',
    r'\b(?:roadmap|timeline|schedule|pipeline)\b',
    r'\byet\s+to\b',
    r'\bstill\s+need\s+to\b',
]

# Patterns that indicate completion/past action  
COMPLETION_PATTERNS = [
    r'\b(?:have|has|had)\s+(?:\w+\s+){0,2}(?:invested|acquired|built|launched|hired|expanded|partnered|developed)',
    r'\b(?:did|done|finished|completed|closed|announced|signed)\b',
    r'\b(?:successfully|already)\s+(?:\w+\s+){0,2}(?:invested|acquired|built|launched)',
    r'\bwas\s+(?:\w+\s+){0,2}(?:completed|closed|announced|launched)',
    r'\b(?:last|previous)\s+(?:quarter|month|year|round)',
    r'\b(?:as\s+of|since)\s+\d',
    r'\b(?:confirmed|official|final|executed)\b',
    r'\bPort(?:folio|Co)\b.*\b(?:investment|round|funding)\b',  # portfolio company references
]

# Patterns that are present tense but contextually completion
PRESENT_COMPLETION_PATTERNS = [
    r'\b(?:our|the)\s+investment\s+in\b',
    r'\b(?:portfolio|invested)\s+company\b',
    r'\bis\s+(?:live|operational|in\s+production|generating\s+revenue)\b',
]

def detect_temporal_context(text: str) -> str:
    """
    Analyze text to determine temporal context.
    Returns: 'planning', 'completion', 'present', or 'neutral'
    """
    text_lower = text.lower()
    
    # Check for planning indicators
    for pattern in PLANNING_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return 'planning'
    
    # Check for completion indicators
    for pattern in COMPLETION_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return 'completion'
            
    # Check for present-completion indicators
    for pattern in PRESENT_COMPLETION_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return 'completion'
    
    # Check for present/ongoing indicators
    if re.search(r'\b(?:is|are|currently)\s+(?:\w+\s+){0,2}(?:doing|working|building|developing)', text_lower):
        return 'present'
    
    return 'neutral'

def enrich_with_temporal_context(text: str, metadata: Optional['Metadata'] = None) -> str:
    """
    Enrich text with temporal context markers to improve disambiguation.
    """
    temporal_context = detect_temporal_context(text)
    
    # Add temporal prefix based on detected context
    if temporal_context == 'planning':
        prefix = "[PLANNED/FUTURE]"
    elif temporal_context == 'completion':
        prefix = "[COMPLETED/PAST]"
    elif temporal_context == 'present':
        prefix = "[ONGOING/PRESENT]"
    else:
        prefix = "[NEUTRAL]"
    
    # Add timestamp context if available
    timestamp_context = ""
    if metadata and metadata.timestamp:
        timestamp_context = f"[{metadata.timestamp[:10]}]"  # Just the date part
    
    # Build enriched text
    enriched = f"{prefix}{timestamp_context} {text}"
    
    # Add channel/user context if available
    if metadata:
        context_parts = []
        if metadata.userId: context_parts.append(f"from:{metadata.userId}")
        if metadata.channelId: context_parts.append(f"ch:{metadata.channelId}")
        if context_parts:
            enriched = f"[{' '.join(context_parts)}] {enriched}"
    
    return enriched

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

# ── Enhanced Postgres backend ──

import asyncpg

pool: Optional[asyncpg.Pool] = None

INIT_SQL = """
CREATE TABLE IF NOT EXISTS agent_memories (
    id SERIAL PRIMARY KEY,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    enriched_content TEXT NOT NULL,
    temporal_context TEXT NOT NULL DEFAULT 'neutral',
    channel_id TEXT,
    message_id TEXT,
    user_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ts_content TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', enriched_content)) STORED
);
CREATE INDEX IF NOT EXISTS idx_agent_memories_agent ON agent_memories(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_memories_ts ON agent_memories USING GIN(ts_content);
CREATE INDEX IF NOT EXISTS idx_agent_memories_temporal ON agent_memories(temporal_context);
CREATE INDEX IF NOT EXISTS idx_agent_memories_created_at ON agent_memories(created_at DESC);
"""

async def init_pg():
    global pool
    pool = await asyncpg.create_pool(DB_URL, min_size=1, max_size=5)
    async with pool.acquire() as conn:
        await conn.execute(INIT_SQL)
    logger.info("Enhanced Postgres memory table ready")

async def pg_ingest(agent_id: str, text: str, metadata: Metadata = None):
    enriched = enrich_with_temporal_context(text, metadata)
    temporal_context = detect_temporal_context(text)
    
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO agent_memories 
               (agent_id, content, enriched_content, temporal_context, channel_id, message_id, user_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)""",
            agent_id,
            text,
            enriched,
            temporal_context,
            metadata.channelId if metadata else None,
            metadata.messageId if metadata else None,
            metadata.userId if metadata else None,
        )

async def pg_query(agent_id: str, query: str, limit: int = 5):
    """
    Enhanced query with temporal context awareness.
    """
    query_context = detect_temporal_context(query)
    
    async with pool.acquire() as conn:
        # Build query with temporal awareness
        base_query = """
        SELECT content, enriched_content, temporal_context, channel_id, user_id, created_at,
               ts_rank(ts_content, plainto_tsquery('english', $2)) AS rank
        FROM agent_memories
        WHERE agent_id = $1
          AND ts_content @@ plainto_tsquery('english', $2)
        """
        
        # Add temporal context filtering if the query has clear intent
        temporal_filter = ""
        if query_context == 'planning':
            temporal_filter = " AND temporal_context IN ('planning', 'neutral')"
        elif query_context == 'completion':
            temporal_filter = " AND temporal_context IN ('completion', 'present', 'neutral')"
        
        final_query = base_query + temporal_filter + " ORDER BY rank DESC, created_at DESC LIMIT $3"
        
        rows = await conn.fetch(final_query, agent_id, query, limit)
        
        if not rows:
            # Fallback: simple ILIKE with temporal filtering
            fallback_query = """
            SELECT content, enriched_content, temporal_context, channel_id, user_id, created_at, 0.0 AS rank
            FROM agent_memories
            WHERE agent_id = $1 AND enriched_content ILIKE '%' || $2 || '%'
            """ + temporal_filter + " ORDER BY created_at DESC LIMIT $3"
            
            rows = await conn.fetch(fallback_query, agent_id, query, limit)
        
        return [
            {
                "text": r["content"],
                "enriched_text": r["enriched_content"],
                "temporal_context": r["temporal_context"],
                "channelId": r["channel_id"],
                "userId": r["user_id"],
                "timestamp": r["created_at"].isoformat() if r["created_at"] else None,
                "score": float(r["rank"]),
            }
            for r in rows
        ]

# ── Enhanced Cognee backend ──

async def cognee_ingest(agent_id: str, text: str, metadata: Metadata = None):
    import cognee
    dataset = f"agent_{agent_id.replace('-', '_')}"
    enriched = enrich_with_temporal_context(text, metadata)
    
    await cognee.add(enriched, dataset)
    try:
        await cognee.cognify(dataset)
    except Exception as e:
        logger.warning(f"cognify failed: {e}")

async def cognee_query(agent_id: str, query: str, limit: int = 5):
    import cognee
    from cognee import SearchType
    dataset = f"agent_{agent_id.replace('-', '_')}"
    
    # Enrich query with temporal context
    enriched_query = enrich_with_temporal_context(query)
    
    try:
        results = await cognee.search(SearchType.INSIGHTS, query_text=enriched_query, datasets=[dataset])
        out = []
        for r in (results or [])[:limit]:
            result_dict = {"text": str(r)} if not isinstance(r, dict) else r
            # Extract temporal context from result if it's in our enriched format
            if "text" in result_dict and result_dict["text"].startswith("["):
                result_dict["temporal_aware"] = True
            out.append(result_dict)
        return out
    except Exception:
        try:
            results = await cognee.search(SearchType.CHUNKS, query_text=enriched_query, datasets=[dataset])
            return [{"text": str(r), "temporal_aware": True} for r in (results or [])[:limit]]
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
            logger.info("Enhanced Cognee enabled with temporal context awareness")
        except Exception as e:
            logger.warning(f"Cognee init failed, using enhanced Postgres only: {e}")
            globals()["COGNEE_ENABLED"] = False  # noqa
    else:
        logger.info("No LLM_API_KEY — using enhanced Postgres full-text search with temporal context")
    yield
    if pool:
        await pool.close()

app = FastAPI(title="Enhanced Cognee Memory Service v2", lifespan=lifespan)

@app.get("/health")
async def health():
    return {
        "status": "ok", 
        "version": "2.0",
        "backend": "cognee-enhanced" if COGNEE_ENABLED else "postgres-fts-enhanced",
        "features": ["temporal_context_disambiguation", "planning_completion_separation"]
    }

@app.post("/ingest")
async def ingest(req: IngestRequest):
    try:
        # Always store in enhanced Postgres for durability
        await pg_ingest(req.agentId, req.text, req.metadata)
        # Also ingest into enhanced Cognee if available
        if COGNEE_ENABLED:
            try:
                await cognee_ingest(req.agentId, req.text, req.metadata)
            except Exception as e:
                logger.warning(f"Enhanced Cognee ingest failed (enhanced pg ok): {e}")
        
        temporal_context = detect_temporal_context(req.text)
        return {
            "status": "ok", 
            "agentId": req.agentId,
            "detected_temporal_context": temporal_context
        }
    except Exception as e:
        logger.error(f"Enhanced ingest error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/query")
async def query(req: QueryRequest):
    try:
        query_temporal_context = detect_temporal_context(req.query)
        
        if COGNEE_ENABLED:
            try:
                results = await cognee_query(req.agentId, req.query, req.limit)
                if results:
                    return {
                        "results": results, 
                        "agentId": req.agentId, 
                        "backend": "cognee-enhanced",
                        "query_temporal_context": query_temporal_context
                    }
            except Exception:
                pass
        
        # Fallback to enhanced Postgres
        results = await pg_query(req.agentId, req.query, req.limit)
        return {
            "results": results, 
            "agentId": req.agentId, 
            "backend": "postgres-fts-enhanced",
            "query_temporal_context": query_temporal_context
        }
    except Exception as e:
        logger.error(f"Enhanced query error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/debug/temporal/{text}")
async def debug_temporal(text: str):
    """Debug endpoint to test temporal context detection."""
    return {
        "text": text,
        "temporal_context": detect_temporal_context(text),
        "enriched": enrich_with_temporal_context(text),
    }

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=3002)