-- ─── Compteur de vues (catégorie) et de "j'aime" (morceau) ───────────────────
--
-- Demande explicite : un lien Discord ne peut pas afficher un compteur en
-- direct (l'aperçu Discord est mis en cache au moment du partage, jamais
-- revisité), donc le compteur vit sur la page elle-même, vu une fois qu'on a
-- cliqué. Public, anonyme, aucune identité stockée : un entier qui monte,
-- pas un profil de qui a vu ou aimé quoi.

ALTER TABLE music_categories ADD COLUMN IF NOT EXISTS views INT NOT NULL DEFAULT 0;
ALTER TABLE music_tracks     ADD COLUMN IF NOT EXISTS likes INT NOT NULL DEFAULT 0;
