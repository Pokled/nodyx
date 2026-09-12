-- ─── Note de licence par défaut ───────────────────────────────────────────────
--
-- Retaper la meme note de licence a chaque nouvelle categorie (meme studio,
-- meme jeu, meme outil) est une friction reelle, vecue en session (5 fois de
-- suite a la main). Une note par defaut, reglee une fois pour l'instance,
-- est appliquee automatiquement a la creation d'une categorie (modifiable
-- ensuite comme n'importe quelle note de licence existante).

ALTER TABLE communities ADD COLUMN IF NOT EXISTS music_default_license_note TEXT;
