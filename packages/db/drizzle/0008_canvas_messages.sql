-- Add canvas JSONB column to messages (nullable, default null)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS canvas JSONB DEFAULT NULL;
