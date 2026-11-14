-- 141 — Mentions, lot M3b (SPECS/NODYX_MENTIONS_CDC.md, D53, D55)
--
-- Le fantôme démasqué : quelqu'un te mentionne puis efface lui-même son message dans les
-- 10 minutes. Le FAIT est toujours noté (qui, quand, qui était mentionné) ; le TEXTE ne
-- l'est que si l'admin l'a choisi (instance_settings « mentions_ghost_retention_days » :
-- 0 par défaut, 7, 30 ou 90), et il est effacé au bout de cette durée. Lisible seulement
-- par l'équipe, à partir d'un signalement d'une personne mentionnée.

CREATE TABLE IF NOT EXISTS mention_ghosts (
  message_id  UUID PRIMARY KEY,                 -- message du chat ou réponse du forum (effacés)
  source      TEXT NOT NULL CHECK (source IN ('chat', 'forum')),
  author_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  channel_id  UUID,
  thread_id   UUID,
  content     TEXT,                             -- NULL : texte non gardé, ou durée passée
  mentioned   UUID[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL,             -- écriture du message
  deleted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mention_ghosts_deleted ON mention_ghosts(deleted_at);

-- Rafales (D55) : chacun peut ne pas regrouper les mentions répétées
ALTER TABLE user_mention_prefs ADD COLUMN IF NOT EXISTS bursts BOOLEAN NOT NULL DEFAULT true;
