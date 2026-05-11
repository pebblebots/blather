-- Add meta jsonb column to messages for orchestrator/system-tagged messages.
--
-- Use cases:
--   { kind: 'huddle-bootstrap', hidden: true } — huddle starter prompts that
--     should fire WS events to agents but NOT show up in the channel UI.
--
-- Generic schema so future system-message kinds don't need their own column.
ALTER TABLE messages ADD COLUMN meta JSONB;
