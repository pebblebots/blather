-- Add agents table and agent_api_keys table
-- Note: is_agent column on users already exists in schema

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  display_name TEXT,
  bio TEXT,
  personality JSONB DEFAULT '{}'::jsonb,
  model TEXT,
  heartbeat_interval INTEGER DEFAULT 1800,
  memory_config JSONB DEFAULT '{}'::jsonb,
  instance_host TEXT,
  gateway_token TEXT,
  status TEXT DEFAULT 'registered',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS agents_workspace_id_idx ON agents(workspace_id);
CREATE INDEX IF NOT EXISTS agents_user_id_idx ON agents(user_id);
