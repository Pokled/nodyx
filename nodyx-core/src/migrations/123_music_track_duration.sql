-- ─── Durée d'un morceau ────────────────────────────────────────────────────
--
-- Affichée avant même de lancer la lecture (mm:ss), comme n'importe quel
-- service d'écoute sérieux. Extraite une fois à l'upload (music-metadata),
-- jamais recalculée à la volée.

ALTER TABLE music_tracks ADD COLUMN IF NOT EXISTS duration_seconds INT;
