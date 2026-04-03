#!/usr/bin/env python3
"""
Migrate existing agent_memories to include temporal context.

This script:
1. Adds the new columns to the existing table
2. Analyzes existing content to detect temporal context
3. Backfills the enriched_content and temporal_context columns
4. Creates the new indexes

Run this after deploying the enhanced cognee service but before switching to it.
"""
import asyncio
import asyncpg
import re
import logging
from typing import Optional

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("temporal-migration")

DB_URL = "postgresql://blather:blather-dev@localhost:5432/blather"

# Copy the temporal detection patterns from the enhanced service
PLANNING_PATTERNS = [
    r'\b(?:plan|plans|planning|planned)\s+to\b',
    r'\b(?:going|gonna)\s+to\b',
    r'\b(?:will|would|should|might|may|could)\s+(?:\w+\s+){0,3}(?:invest|acquire|build|launch|hire|expand|partner|develop)',
    r'\b(?:next|upcoming|future|proposed)\s+(?:quarter|month|year|round|investment)',
    r'\b(?:considering|exploring|evaluating|discussing)\b',
    r'\b(?:potential|possible|candidate|target)\s+(?:investment|acquisition|partner)',
    r'\bif\s+(?:we|they)\b',
    r'\b(?:hoping|aiming|targeting|intending)\s+to\b',
    r'\b(?:roadmap|timeline|schedule|pipeline)\b',
    r'\byet\s+to\b',
    r'\bstill\s+need\s+to\b',
]

COMPLETION_PATTERNS = [
    r'\b(?:have|has|had)\s+(?:\w+\s+){0,2}(?:invested|acquired|built|launched|hired|expanded|partnered|developed)',
    r'\b(?:did|done|finished|completed|closed|announced|signed)\b',
    r'\b(?:successfully|already)\s+(?:\w+\s+){0,2}(?:invested|acquired|built|launched)',
    r'\bwas\s+(?:\w+\s+){0,2}(?:completed|closed|announced|launched)',
    r'\b(?:last|previous)\s+(?:quarter|month|year|round)',
    r'\b(?:as\s+of|since)\s+\d',
    r'\b(?:confirmed|official|final|executed)\b',
    r'\bPort(?:folio|Co)\b.*\b(?:investment|round|funding)\b',
]

PRESENT_COMPLETION_PATTERNS = [
    r'\b(?:our|the)\s+investment\s+in\b',
    r'\b(?:portfolio|invested)\s+company\b',
    r'\bis\s+(?:live|operational|in\s+production|generating\s+revenue)\b',
]

def detect_temporal_context(text: str) -> str:
    """Detect temporal context from text."""
    text_lower = text.lower()
    
    for pattern in PLANNING_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return 'planning'
    
    for pattern in COMPLETION_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return 'completion'
            
    for pattern in PRESENT_COMPLETION_PATTERNS:
        if re.search(pattern, text_lower, re.IGNORECASE):
            return 'completion'
    
    if re.search(r'\b(?:is|are|currently)\s+(?:\w+\s+){0,2}(?:doing|working|building|developing)', text_lower):
        return 'present'
    
    return 'neutral'

def enrich_with_temporal_context(text: str, channel_id: str = None, user_id: str = None, created_at = None) -> str:
    """Enrich text with temporal context markers."""
    temporal_context = detect_temporal_context(text)
    
    if temporal_context == 'planning':
        prefix = "[PLANNED/FUTURE]"
    elif temporal_context == 'completion':
        prefix = "[COMPLETED/PAST]"
    elif temporal_context == 'present':
        prefix = "[ONGOING/PRESENT]"
    else:
        prefix = "[NEUTRAL]"
    
    timestamp_context = ""
    if created_at:
        timestamp_context = f"[{created_at.strftime('%Y-%m-%d')}]"
    
    enriched = f"{prefix}{timestamp_context} {text}"
    
    context_parts = []
    if user_id: context_parts.append(f"from:{user_id}")
    if channel_id: context_parts.append(f"ch:{channel_id}")
    if context_parts:
        enriched = f"[{' '.join(context_parts)}] {enriched}"
    
    return enriched

async def main():
    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)
    
    logger.info("Starting temporal context migration...")
    
    # Step 1: Add new columns if they don't exist
    logger.info("Adding new columns...")
    async with pool.acquire() as conn:
        # Check if columns exist
        columns_exist = await conn.fetch("""
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'agent_memories' 
            AND column_name IN ('enriched_content', 'temporal_context')
        """)
        
        existing_columns = {row['column_name'] for row in columns_exist}
        
        if 'enriched_content' not in existing_columns:
            await conn.execute("ALTER TABLE agent_memories ADD COLUMN enriched_content TEXT")
            logger.info("Added enriched_content column")
        
        if 'temporal_context' not in existing_columns:
            await conn.execute("ALTER TABLE agent_memories ADD COLUMN temporal_context TEXT DEFAULT 'neutral'")
            logger.info("Added temporal_context column")
    
    # Step 2: Backfill existing records
    logger.info("Analyzing and backfilling existing records...")
    
    async with pool.acquire() as conn:
        # Get all records that need backfilling
        records = await conn.fetch("""
            SELECT id, content, channel_id, user_id, created_at
            FROM agent_memories 
            WHERE enriched_content IS NULL OR enriched_content = ''
        """)
        
        logger.info(f"Found {len(records)} records to backfill")
        
        # Process in batches
        batch_size = 100
        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            
            updates = []
            for record in batch:
                temporal_context = detect_temporal_context(record['content'])
                enriched_content = enrich_with_temporal_context(
                    record['content'], 
                    record['channel_id'], 
                    record['user_id'], 
                    record['created_at']
                )
                updates.append((enriched_content, temporal_context, record['id']))
            
            # Batch update
            await conn.executemany("""
                UPDATE agent_memories 
                SET enriched_content = $1, temporal_context = $2 
                WHERE id = $3
            """, updates)
            
            logger.info(f"Processed batch {i//batch_size + 1}/{(len(records) + batch_size - 1)//batch_size}")
    
    # Step 3: Create new indexes
    logger.info("Creating indexes...")
    async with pool.acquire() as conn:
        # Drop old tsvector column and recreate with enriched content
        try:
            await conn.execute("ALTER TABLE agent_memories DROP COLUMN ts_content")
            logger.info("Dropped old ts_content column")
        except:
            pass  # Column might not exist
        
        await conn.execute("""
            ALTER TABLE agent_memories 
            ADD COLUMN ts_content TSVECTOR 
            GENERATED ALWAYS AS (to_tsvector('english', enriched_content)) STORED
        """)
        logger.info("Added new ts_content column based on enriched_content")
        
        # Create indexes
        indexes_to_create = [
            "CREATE INDEX IF NOT EXISTS idx_agent_memories_ts ON agent_memories USING GIN(ts_content)",
            "CREATE INDEX IF NOT EXISTS idx_agent_memories_temporal ON agent_memories(temporal_context)",
            "CREATE INDEX IF NOT EXISTS idx_agent_memories_created_at ON agent_memories(created_at DESC)",
        ]
        
        for idx_sql in indexes_to_create:
            await conn.execute(idx_sql)
            logger.info(f"Created index: {idx_sql.split('idx_')[1].split()[0]}")
    
    # Step 4: Verify migration
    logger.info("Verifying migration...")
    async with pool.acquire() as conn:
        total_count = await conn.fetchval("SELECT count(*) FROM agent_memories")
        enriched_count = await conn.fetchval("SELECT count(*) FROM agent_memories WHERE enriched_content IS NOT NULL AND enriched_content != ''")
        
        context_distribution = await conn.fetch("""
            SELECT temporal_context, count(*) as count
            FROM agent_memories 
            GROUP BY temporal_context
            ORDER BY count DESC
        """)
        
        logger.info(f"Migration complete!")
        logger.info(f"Total records: {total_count}")
        logger.info(f"Records with enriched content: {enriched_count}")
        logger.info("Temporal context distribution:")
        for row in context_distribution:
            logger.info(f"  {row['temporal_context']}: {row['count']}")
    
    await pool.close()
    logger.info("Migration successful! You can now switch to the enhanced cognee service.")

if __name__ == "__main__":
    asyncio.run(main())