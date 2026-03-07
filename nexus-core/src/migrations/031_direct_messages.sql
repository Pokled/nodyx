-- ─────────────────────────────────────────────────────────────────────────────
--  031 — Direct Messages
--  Tables : dm_conversations · dm_participants · dm_messages
--  Architecture extensible (prête pour group DM futur)
-- ─────────────────────────────────────────────────────────────────────────────

-- Conversation (enveloppe, sans logique 1:1 hardcodée)
CREATE TABLE IF NOT EXISTS dm_conversations (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Participants (structure N:N, actuellement utilisée en 1:1)
CREATE TABLE IF NOT EXISTS dm_participants (
  conversation_id UUID        NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- Messages
CREATE TABLE IF NOT EXISTS dm_messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content         TEXT        NOT NULL CHECK (char_length(content) BETWEEN 1 AND 10000),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

-- Index performance
CREATE INDEX IF NOT EXISTS idx_dm_participants_user     ON dm_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_dm_messages_conv_date    ON dm_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_messages_sender       ON dm_messages(sender_id);

-- Contrainte unicité 1:1 : une seule conversation par paire d'utilisateurs
-- Implémentée via fonction de recherche côté applicatif (voir dm.ts)
