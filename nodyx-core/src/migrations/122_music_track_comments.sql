-- ─── Commentaires publics par morceau ─────────────────────────────────────────
--
-- Sert le cas d'usage réel du module : un développeur destinataire (ex.
-- LaPersonne pour Twisted Reality) laisse un avis sur un morceau, sans avoir
-- de compte Nodyx. Public par défaut (aucune modération a priori, comme les
-- vues et les "j'aime"), modérable par l'admin (DELETE /comments/:id).

CREATE TABLE IF NOT EXISTS music_track_comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_id    UUID NOT NULL REFERENCES music_tracks(id) ON DELETE CASCADE,
  author_name VARCHAR(60) NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_music_track_comments_track ON music_track_comments(track_id, created_at DESC);
