-- Add idempotency_key to messages for client-side retry deduplication
ALTER TABLE messages ADD COLUMN idempotency_key UUID;
--> statement-breakpoint

-- Unique constraint: same user + same idempotency key = same message
-- Partial index so NULL keys don't conflict
CREATE UNIQUE INDEX uq_messages_user_idempotency
  ON messages (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
