-- Migration 106 — Aperçu de lien (Open Graph) pour les statuts du fil d'actu.
-- JSONB : { url, title, description, image, site_name }. NULL si pas de lien
-- ou métadonnées non récupérables.
ALTER TABLE status_posts ADD COLUMN IF NOT EXISTS link_preview JSONB;
