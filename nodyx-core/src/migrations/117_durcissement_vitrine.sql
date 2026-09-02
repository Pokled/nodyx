-- ─── Durcissement de la vitrine publique et des catégories d'annonce ────────
--
-- Incident « nerti » du 2026-09-01 : un compte `member` standard, sans aucune
-- faille d'authentification, a fait remonter un fil de spam
--   1. en tête de la page d'accueil (widgets « fils récents » et « vitrine ») ;
--   2. dans l'index de recherche global nodyx.org (network_index), propageable
--      aux instances pairs.
-- Cause : n'importe qui peut écrire dans « 📣 Annonces », et trois surfaces
-- publiques affichent les fils sur la seule fraîcheur, sans rôle ni curation.
--
-- Cette migration pose les colonnes. La logique vit dans le code applicatif
-- (routes/forums, routes/instance, scheduler). Voir
-- SPECS/NODYX_DURCISSEMENT_VITRINE_CDC.md.
--
-- RÉTRO-COMPATIBILITÉ : toutes les colonnes ont un défaut inerte. Une instance
-- tierce qui déploie ce schéma sans le code correspondant garde le comportement
-- actuel (`post_min_role = 'member'` partout, `showcased_at` ignoré).

-- ── 1. Permission d'écriture par catégorie ─────────────────────────────────
--
-- Rôle minimum pour OUVRIR un fil dans la catégorie. 'member' = tout le monde,
-- c'est le défaut : aucune catégorie existante ne change de comportement.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS post_min_role TEXT NOT NULL DEFAULT 'member'
    CHECK (post_min_role IN ('member', 'moderator', 'admin', 'owner'));

COMMENT ON COLUMN categories.post_min_role IS
  'Rôle minimum requis pour ouvrir un fil dans cette catégorie. '
  'member (défaut) = tout le monde. Contrôlé côté back dans POST /forums/threads '
  'et côté front dans le sélecteur de catégorie.';

-- Verrou de la catégorie d'annonces. Le slug est globalement unique
-- (categories_slug_unique), donc sur nodyx.org ceci ne touche qu'une ligne.
-- Sur une instance tierce qui a aussi un slug « annonces », le verrouiller sur
-- « admin » est un défaut sain pour une catégorie d'annonces officielles ;
-- l'admin peut le rouvrir depuis le panneau. Aucune ligne touchée si le slug
-- n'existe pas.
UPDATE categories SET post_min_role = 'admin' WHERE slug = 'annonces';

-- ── 2. Curation explicite de la vitrine ───────────────────────────────────
--
-- Les surfaces « éditoriales » (homepage showcase, /threads/featured par
-- catégorie, annonce à l'annuaire fédéré) ne prendront plus « les fils récents »
-- mais uniquement les fils explicitement mis en avant par un admin.
-- On garde `is_featured` (booléen déjà là) comme critère ; `showcased_at`
-- donne l'ordre d'affichage stable et la date de mise en avant.
ALTER TABLE threads
  ADD COLUMN IF NOT EXISTS showcased_at TIMESTAMPTZ;

COMMENT ON COLUMN threads.showcased_at IS
  'Horodatage de la dernière mise en avant (is_featured = true posé par un '
  'admin). NULL = jamais mis en avant. Sert de clé de tri des surfaces vitrine.';

-- Backfill : les fils déjà featured conservent leur mise en avant et un ordre
-- cohérent (à défaut de mieux, leur date de dernière modification).
UPDATE threads
SET showcased_at = COALESCE(showcased_at, updated_at)
WHERE is_featured = true
  AND showcased_at IS NULL;

-- ── 3. Cible utile pour le bannissement d'IP ──────────────────────────────
--
-- `users.registration_ip` vaut 127.0.0.1 pour tous : l'inscription passe par le
-- proxy de rendu serveur. Résultat, « bannir l'IP » dans le panneau admin est
-- silencieusement sans effet (le code refuse les adresses loopback). On capte
-- désormais la vraie adresse (via getClientIp / cf-connecting-ip) au login.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_seen_ip INET;

COMMENT ON COLUMN users.last_seen_ip IS
  'Dernière adresse publique observée au login (getClientIp). Peuplée à partir '
  'du 2026-09. Sert de repli quand registration_ip est loopback pour le ban IP.';

-- ── 4. Rognage des pseudos ────────────────────────────────────────────────
--
-- `username` n'était pas trim() à l'inscription. Le compte « nerti » s'appelle
-- « nerti » avec une espace finale : sa page profil publique renvoie 404 et les
-- recherches par pseudo exact le ratent. On rogne l'existant, en laissant de
-- côté le cas rare où le rognage créerait une collision (l'admin tranchera).
UPDATE users u
SET username = btrim(u.username)
WHERE u.username <> btrim(u.username)
  AND NOT EXISTS (
    SELECT 1 FROM users x
    WHERE x.id <> u.id AND x.username = btrim(u.username)
  );
