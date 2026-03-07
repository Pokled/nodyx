-- Migration 033 — Instances liées par utilisateur (Galaxy Bar)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS linked_instances TEXT[] NOT NULL DEFAULT '{}';
