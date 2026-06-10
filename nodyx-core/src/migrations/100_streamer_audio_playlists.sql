-- ─── Streamer Hub — Soundboard playlists ────────────────────────────────────
-- Un streamer veut grouper ses sons par contexte (intro, discussion, dev,
-- hype, jingles…) plutôt que de tout avoir dans une liste plate. On stocke
-- les playlists séparément des tracks, avec une table de jonction
-- streamer_audio_playlist_tracks (migration 101). Un track peut appartenir
-- à plusieurs playlists (un même jingle d'intro peut être dans "Intro" et
-- "Favoris").
--
-- Visibilité :
--   - 'private' : visible uniquement par le propriétaire (admin) (défaut)
--   - 'public'  : exposée sur la page publique /soundboard pour les viewers
--                 (filtres par playlist en pills au-dessus de la lib)
--
-- color : hex #RRGGBB optionnel, utilisé pour l'accent visuel de la pill
-- (admin sidebar + page publique). NULL = défaut violet Nodyx.
--
-- position : tri manuel des playlists dans la sidebar admin. Pas d'unique
-- car le réordonnage côté UI peut temporairement créer des doublons avant
-- la mise à jour finale par lots.

CREATE TABLE IF NOT EXISTS streamer_audio_playlists (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  color         VARCHAR(7) CHECK (color IS NULL OR color ~ '^#[0-9a-fA-F]{6}$'),
  visibility    TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (owner_user_id, name)
);

-- Sidebar admin : liste des playlists d'un owner, triées par position.
CREATE INDEX IF NOT EXISTS idx_streamer_audio_playlists_owner
  ON streamer_audio_playlists (owner_user_id, position ASC);

-- Page publique : récupération rapide des playlists publiques d'un owner.
-- Index partiel pour ne pas peser quand 95% des playlists sont privées.
CREATE INDEX IF NOT EXISTS idx_streamer_audio_playlists_public
  ON streamer_audio_playlists (owner_user_id, position ASC)
  WHERE visibility = 'public';
