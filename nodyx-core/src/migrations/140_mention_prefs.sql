-- 140 — Mentions : les réglages de la personne mentionnée (SPECS/NODYX_MENTIONS_CDC.md, D54-D55, lot M3a)
--
-- Sans ligne : réglages par défaut (tout le monde peut me mentionner, pas d'heures calmes).
-- Une mise en sourdine ne se dévoile JAMAIS à la personne mise en sourdine.

CREATE TABLE IF NOT EXISTS user_mention_prefs (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  who         TEXT NOT NULL DEFAULT 'all' CHECK (who IN ('all', 'following', 'team')),
  quiet_start SMALLINT CHECK (quiet_start BETWEEN 0 AND 1439),   -- minutes depuis minuit, NULL = pas d'heures calmes
  quiet_end   SMALLINT CHECK (quiet_end BETWEEN 0 AND 1439),
  quiet_tz    TEXT,                                               -- fuseau IANA du navigateur au moment du réglage
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_mention_mutes (
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, muted_user_id),
  CHECK (user_id <> muted_user_id)
);
