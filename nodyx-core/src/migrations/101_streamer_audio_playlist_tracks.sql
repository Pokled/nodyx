-- ─── Streamer Hub — Playlist tracks (jonction many-to-many) ──────────────────
-- Lien entre playlists et tracks. Un track peut être dans plusieurs playlists
-- (ex: jingle "Bonjour" dans "Intro" ET "Favoris"). Pas de cascade vers la
-- track elle-même : retirer un track d'une playlist ne supprime pas le track
-- de la bibliothèque, et vice-versa.
--
-- position : ordre du track dans la playlist (drag-to-reorder côté UI admin).
-- Pas d'unique sur (playlist_id, position) pour permettre des swaps en 2 temps
-- sans contrainte intermédiaire violée. La cohérence est garantie par les
-- requêtes UPDATE batch côté service.

CREATE TABLE IF NOT EXISTS streamer_audio_playlist_tracks (
  playlist_id UUID NOT NULL REFERENCES streamer_audio_playlists(id) ON DELETE CASCADE,
  track_id    UUID NOT NULL REFERENCES streamer_audio_library(id)   ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  added_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, track_id)
);

-- Lecture des tracks d'une playlist dans l'ordre (filtre admin + page publique).
CREATE INDEX IF NOT EXISTS idx_streamer_audio_playlist_tracks_order
  ON streamer_audio_playlist_tracks (playlist_id, position ASC);

-- Lecture des playlists auxquelles appartient un track donné (pour afficher
-- "ce track est dans X playlists" dans l'éditeur de track).
CREATE INDEX IF NOT EXISTS idx_streamer_audio_playlist_tracks_track
  ON streamer_audio_playlist_tracks (track_id);
