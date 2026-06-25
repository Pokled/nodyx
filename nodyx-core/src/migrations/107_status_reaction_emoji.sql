-- Migration 107 — Réactions emoji sur les statuts.
-- Une "résonance" (like) porte désormais un emoji. Une réaction par membre et
-- par post (PK user_id+post_id inchangée), modifiable. likes_count reste le
-- total de réactions toutes emojis confondues.
ALTER TABLE status_likes ADD COLUMN IF NOT EXISTS emoji TEXT NOT NULL DEFAULT '❤️';
