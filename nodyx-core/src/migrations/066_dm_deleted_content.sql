-- Migration 066 : allow empty content for soft-deleted DM messages
-- The CHECK constraint from migration 031 blocks content='' on delete.
-- Relax it: empty content is only allowed when deleted_at IS NOT NULL.

ALTER TABLE dm_messages DROP CONSTRAINT IF EXISTS dm_messages_content_check;

ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_content_check
  CHECK (
    deleted_at IS NOT NULL
    OR char_length(content) BETWEEN 1 AND 20000
  );
