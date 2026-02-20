#!/usr/bin/env python3
"""Backfill all messages into agent_memories via direct Postgres inserts.

Cognee's ingest endpoint is too slow for bulk backfill (~minutes per request
due to cognee.cognify). This script inserts directly into agent_memories
which is what the /query endpoint uses for FTS fallback.

The script is idempotent - checks for existing (message_id, agent_id) pairs.
"""
import asyncio
import asyncpg

DB_URL = "postgresql://blather:blather-dev@localhost:5432/blather"

async def main():
    pool = await asyncpg.create_pool(DB_URL, min_size=2, max_size=5)

    # Get channel->agents mapping
    rows = await pool.fetch("""
        SELECT cm.channel_id, cm.user_id
        FROM channel_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE u.is_agent = true
    """)
    channel_agents = {}
    for r in rows:
        channel_agents.setdefault(str(r['channel_id']), []).append(str(r['user_id']))
    print(f"Found agents in {len(channel_agents)} channels")

    # Get existing memories
    existing = await pool.fetch("SELECT message_id, agent_id FROM agent_memories WHERE message_id IS NOT NULL")
    existing_set = {(r['message_id'], r['agent_id']) for r in existing}
    print(f"Found {len(existing_set)} existing memories")

    # Get all messages
    messages = await pool.fetch("""
        SELECT id, channel_id, user_id, content, created_at
        FROM messages
        WHERE content IS NOT NULL AND content != ''
        ORDER BY created_at
    """)
    print(f"Found {len(messages)} messages")

    # Build insert batch
    inserts = []
    for msg in messages:
        ch = str(msg['channel_id'])
        for agent_id in channel_agents.get(ch, []):
            key = (str(msg['id']), agent_id)
            if key not in existing_set:
                inserts.append((agent_id, msg['content'], ch, str(msg['id']), str(msg['user_id']), msg['created_at']))

    print(f"Inserting {len(inserts)} new memory records...")

    if not inserts:
        print("Nothing to do!")
        await pool.close()
        return

    # Batch insert
    async with pool.acquire() as conn:
        result = await conn.executemany(
            """INSERT INTO agent_memories (agent_id, content, channel_id, message_id, user_id, created_at)
               VALUES ($1, $2, $3, $4, $5, $6)""",
            inserts
        )

    print(f"Done! Inserted {len(inserts)} records.")

    # Verify
    count = await pool.fetchval("SELECT count(*) FROM agent_memories")
    msg_count = await pool.fetchval("SELECT count(*) FROM messages")
    print(f"\nVerification: {msg_count} messages, {count} agent_memories")

    await pool.close()

if __name__ == "__main__":
    asyncio.run(main())
