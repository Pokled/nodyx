-- Migration 073 — network_index: thread_id nullable
-- Les events gossipés n'ont pas de thread_id, seuls les threads en ont un.
ALTER TABLE network_index ALTER COLUMN thread_id DROP NOT NULL;
