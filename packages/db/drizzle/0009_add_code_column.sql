-- Add code column to magic_tokens table for 6-digit verification
ALTER TABLE magic_tokens ADD COLUMN IF NOT EXISTS code varchar(6);
