-- ─── community_assets : bump file_size cap 12 → 50 MB ────────────────────
-- Le soundboard du Streamer Hub ingère des WAV non compressés (10 MB/min en
-- stereo CD), donc 12 MB plafonnait à 1 min. 50 MB couvre une OST courte sans
-- pousser au flush. Aligné avec la limite Fastify multipart côté index.ts.
-- Pour les pistes longues, on conseille mp3/ogg côté UI.

ALTER TABLE community_assets DROP CONSTRAINT IF EXISTS valid_file_size;
ALTER TABLE community_assets ADD CONSTRAINT valid_file_size CHECK (file_size <= 52428800);
