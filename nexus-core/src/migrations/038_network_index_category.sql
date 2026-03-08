-- Migration 038 — Ajout category_id dans network_index (pour URL correcte /forum/:category/:thread)
ALTER TABLE network_index ADD COLUMN IF NOT EXISTS category_id UUID;
