-- 127 : la file de signalements (CDC SPECS/NODYX_MODERATION_CDC.md, E2).
--
-- - target_author_id : l'auteur du contenu signalé (ou le membre signalé),
--   pour regrouper, garder le rang et ne jamais le confondre avec le signaleur.
-- - snapshot : le texte du contenu AU MOMENT du signalement. La preuve reste
--   même si l'auteur modifie ou supprime son message ensuite.
-- - target_label / target_link : de quoi afficher et ouvrir le contenu dans
--   la file sans requête par ligne.
-- - claimed_by / claimed_at : qui a pris le dossier en charge (« je regarde »),
--   pour que deux modérateurs ne traitent pas le même en même temps.
-- - reason devient facultatif : le motif (category) suffit, la précision est un plus.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_author_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS snapshot         TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_label     TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_link      TEXT;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS claimed_by       UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS claimed_at       TIMESTAMPTZ;

ALTER TABLE reports ALTER COLUMN reason SET DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_reports_open_target
  ON reports (target_type, target_id) WHERE status = 'open';
