-- Migration 083 : flag d'archivage pour les instances mortes du directory
--
-- Sémantique :
--   - status (active/pending/suspended) = état métier voulu par l'admin
--   - archived_at NOT NULL = l'instance n'a pas pingé depuis longtemps
--     (généralement > 30j), l'admin a décidé de la retirer de la vue principale
--
-- On garde la row (historique des slugs, possibilité de réveil), mais elle
-- est exclue de la carte et de la liste principale d'Olympus.

ALTER TABLE directory_instances ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_directory_instances_archived
  ON directory_instances(archived_at)
  WHERE archived_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_directory_instances_active
  ON directory_instances(last_seen DESC NULLS LAST)
  WHERE archived_at IS NULL;
