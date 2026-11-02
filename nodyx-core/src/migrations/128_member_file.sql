-- 128 : la fiche membre (CDC SPECS/NODYX_MODERATION_CDC.md, E3).
--
-- Notes de modération (D5) : visibles de toute l'équipe, jamais du membre
-- concerné, effacées avec son compte (ON DELETE CASCADE). L'auteur d'une note
-- qui supprime son compte ne fait pas disparaître la note (SET NULL).
CREATE TABLE IF NOT EXISTS member_notes (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  community_id  UUID        NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_id     UUID                 REFERENCES users(id) ON DELETE SET NULL,
  body          TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_member_notes_user ON member_notes (community_id, user_id, created_at DESC);

-- Avertissements posés par l'équipe : qui a averti (les avertissements
-- d'OctoGuard n'ont pas d'auteur humain).
ALTER TABLE octoguard_warns ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Notifications portant un court contenu (le motif d'un avertissement).
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS meta JSONB;
