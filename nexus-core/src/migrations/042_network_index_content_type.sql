-- Migration 042 — network_index multi-type (Gossip Protocol)
-- Étend network_index pour indexer aussi les événements du calendrier,
-- pas seulement les threads de forum.
-- Active le Gossip Protocol : chaque instance peut recevoir des données
-- de ses pairs liés sans passer par le directory central.

-- Type de contenu : thread (forum) ou event (calendrier)
ALTER TABLE network_index ADD COLUMN IF NOT EXISTS content_type VARCHAR(20) NOT NULL DEFAULT 'thread'
  CHECK (content_type IN ('thread', 'event'));

-- Colonnes spécifiques aux événements
ALTER TABLE network_index ADD COLUMN IF NOT EXISTS starts_at  TIMESTAMPTZ;
ALTER TABLE network_index ADD COLUMN IF NOT EXISTS ends_at    TIMESTAMPTZ;
ALTER TABLE network_index ADD COLUMN IF NOT EXISTS location   TEXT;
ALTER TABLE network_index ADD COLUMN IF NOT EXISTS is_cancelled BOOLEAN NOT NULL DEFAULT false;

-- content_id généralise thread_id pour les deux types
-- Pour les threads : content_id = thread_id
-- Pour les events  : content_id = event_id (UUID de l'instance source)
ALTER TABLE network_index ADD COLUMN IF NOT EXISTS content_id UUID;

-- Contrainte UNIQUE sur (instance_slug, content_type, content_id)
-- remplace l'ancienne (instance_slug, thread_id)
ALTER TABLE network_index DROP CONSTRAINT IF EXISTS network_index_instance_slug_thread_id_key;
ALTER TABLE network_index ADD CONSTRAINT network_index_unique_content
  UNIQUE (instance_slug, content_type, content_id);

-- Index FTS dédié aux événements futurs
CREATE INDEX IF NOT EXISTS network_index_events_starts ON network_index(starts_at)
  WHERE content_type = 'event' AND is_cancelled = false;

-- Remplir content_id depuis thread_id pour les entrées existantes
UPDATE network_index SET content_id = thread_id WHERE content_id IS NULL AND thread_id IS NOT NULL;
