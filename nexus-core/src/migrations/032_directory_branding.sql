-- Migration 032 — Branding (logo + bannière) sur les instances du directory
ALTER TABLE directory_instances
  ADD COLUMN IF NOT EXISTS logo_url   TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS banner_url TEXT DEFAULT NULL;
