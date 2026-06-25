-- Migration 108 — Repartage (reshare) des statuts.
-- Un repartage est un status_post avec reshare_of → l'original. Contenu vide
-- autorisé dans ce cas (repartage simple, sans commentaire).
ALTER TABLE status_posts ADD COLUMN IF NOT EXISTS reshare_of UUID REFERENCES status_posts(id) ON DELETE CASCADE;

ALTER TABLE status_posts DROP CONSTRAINT IF EXISTS status_posts_content_check;
ALTER TABLE status_posts ADD CONSTRAINT status_posts_content_check
  CHECK (char_length(content) >= 1 OR reshare_of IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_status_posts_reshare_of ON status_posts(reshare_of);
