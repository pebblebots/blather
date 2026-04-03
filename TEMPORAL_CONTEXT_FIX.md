# Temporal Context Disambiguation Fix

## Problem

The Cognee indexing system was suffering from **planning-vs-completion contamination**, where stale context was recalled as current state. For example:

- Agent sees: "We plan to invest in CompanyX"
- Query: "What companies have we invested in?"
- **Wrong result**: Returns CompanyX (planning statement treated as completion)

This contamination occurred because the memory system didn't distinguish between temporal contexts when indexing and retrieving memories.

## Root Cause

1. **No temporal markers**: Messages were indexed without temporal context
2. **Semantic confusion**: "plan to invest" and "have invested" are semantically similar
3. **Context collapse**: Time-sensitive nuances were lost during ingestion
4. **Query blindness**: Queries didn't filter by temporal appropriateness

## Solution

### Enhanced Cognee Service (v2)

**File**: `cognee-service-v2.py`

**Key improvements**:

1. **Temporal Context Detection**
   - Patterns for planning: "plan to", "will", "going to", "considering"
   - Patterns for completion: "have invested", "did", "successfully", "closed"
   - Patterns for present: "currently", "is working", "are building"
   - Neutral classification for ambiguous content

2. **Enriched Content Storage**
   ```
   Original: "We plan to invest in CompanyX"
   Enriched: "[PLANNED/FUTURE][2026-04-03] [from:user123 ch:investments] We plan to invest in CompanyX"
   ```

3. **Temporal-Aware Queries**
   - Query analysis to determine intent
   - Context filtering during retrieval
   - Planning queries avoid completion results and vice versa

4. **Enhanced Database Schema**
   ```sql
   ALTER TABLE agent_memories ADD COLUMN enriched_content TEXT;
   ALTER TABLE agent_memories ADD COLUMN temporal_context TEXT;
   ```

### Migration Script

**File**: `migrate-temporal-context.py`

- Backfills existing records with temporal context
- Analyzes historical messages to classify them
- Updates database schema safely
- Creates optimized indexes

### Test Suite

**File**: `test-temporal-context.py`

Comprehensive validation covering:
- Temporal context detection accuracy
- Memory ingestion with enrichment
- Query filtering to prevent contamination
- End-to-end contamination prevention

## Usage

### 1. Deploy the Enhanced Service

```bash
# Backup current service
cp cognee-service.py cognee-service-v1-backup.py

# Run migration (updates database schema)
python migrate-temporal-context.py

# Deploy enhanced service
cp cognee-service-v2.py cognee-service.py
# Restart your service manager (pm2, systemd, etc.)
```

### 2. Validate the Fix

```bash
# Run test suite
python test-temporal-context.py

# Manual validation
curl -X POST http://localhost:3002/ingest \
  -H "Content-Type: application/json" \
  -d '{"agentId": "test", "text": "We plan to invest in Alpha Corp"}'

curl -X POST http://localhost:3002/query \
  -H "Content-Type: application/json" \
  -d '{"agentId": "test", "query": "what companies have we invested in"}'

# Alpha Corp should NOT appear in results
```

### 3. Debug Temporal Detection

```bash
# Test temporal context detection
curl http://localhost:3002/debug/temporal/We%20plan%20to%20invest%20in%20CompanyX
# Returns: {"temporal_context": "planning", ...}

curl http://localhost:3002/debug/temporal/We%20have%20invested%20in%20CompanyY  
# Returns: {"temporal_context": "completion", ...}
```

## Technical Details

### Temporal Context Categories

| Context | Indicators | Example |
|---------|------------|---------|
| `planning` | plan to, will, going to, considering | "We plan to invest in X" |
| `completion` | have done, successfully, closed | "We invested in Y last month" |
| `present` | currently, is working, are building | "X is building their platform" |
| `neutral` | No temporal markers | "Market research on AI" |

### Query Filtering Logic

- **Planning queries** ("what are we considering?") → Filter to `planning` + `neutral`
- **Completion queries** ("what have we invested in?") → Filter to `completion` + `present` + `neutral`
- **Neutral queries** → No filtering (show all contexts)

### Enrichment Format

```
[TEMPORAL_MARKER][DATE] [CONTEXT] Original message

Examples:
[PLANNED/FUTURE][2026-04-03] [from:alice ch:investments] We plan to invest in CompanyX
[COMPLETED/PAST][2026-04-02] [from:bob ch:portfolio] Successfully closed investment in CompanyY
```

## Benefits

1. **Eliminates contamination**: Planning statements don't pollute completion queries
2. **Temporal awareness**: Agents understand the difference between intent and reality
3. **Better decision making**: Clearer context leads to more accurate responses
4. **Backward compatible**: Existing queries work, just with better results
5. **Debuggable**: Clear markers show how content was classified

## Monitoring

Check these metrics post-deployment:

- **False positives**: Planning results in completion queries (should be ~0%)
- **False negatives**: Missing legitimate completions (monitor carefully)
- **Classification accuracy**: Use debug endpoint to validate detection
- **Query performance**: New indexes should maintain speed

## Rollback Plan

If issues arise:

```bash
# Restore v1 service
cp cognee-service-v1-backup.py cognee-service.py
# Restart service

# Database remains compatible (new columns are optional)
# Can re-run migration later
```

---

**Status**: ✅ Ready for deployment  
**Risk**: Low (backward compatible, includes rollback plan)  
**Impact**: High (eliminates a major source of agent confusion)