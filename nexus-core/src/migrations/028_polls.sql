BEGIN;

-- ── Polls — sondages communautaires ──────────────────────────────────────────
--
-- Types :
--   choice   → 1 ou plusieurs options (radio ou checkbox)
--   schedule → créneaux Doodle (YES / MAYBE / NO par créneau)
--   ranking  → classement par drag-to-rank

CREATE TABLE polls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id  UUID REFERENCES channels(id) ON DELETE CASCADE,
  title       VARCHAR(500) NOT NULL,
  description TEXT,
  type        VARCHAR(20)  NOT NULL DEFAULT 'choice'
                CHECK (type IN ('choice', 'schedule', 'ranking')),

  -- Options pour le type "choice"
  multiple    BOOLEAN NOT NULL DEFAULT false,  -- plusieurs choix autorisés
  max_choices INTEGER,                         -- null = illimité

  -- Comportement
  anonymous         BOOLEAN NOT NULL DEFAULT false,  -- masque les votants
  show_results      BOOLEAN NOT NULL DEFAULT true,   -- résultats visibles avant vote

  -- Cycle de vie
  closes_at   TIMESTAMPTZ,     -- fermeture automatique
  closed_at   TIMESTAMPTZ,     -- fermeture manuelle
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE poll_options (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id     UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  description TEXT,
  image_url   TEXT,
  date_start  TIMESTAMPTZ,  -- schedule : début du créneau
  date_end    TIMESTAMPTZ,  -- schedule : fin du créneau
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE poll_votes (
  poll_id    UUID NOT NULL REFERENCES polls(id)         ON DELETE CASCADE,
  option_id  UUID NOT NULL REFERENCES poll_options(id)  ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)         ON DELETE CASCADE,

  -- Sémantique par type :
  --   choice   : 1 = sélectionné
  --   schedule : 2 = OUI / 1 = PEUT-ÊTRE / 0 = NON
  --   ranking  : position (1 = premier choix)
  value      SMALLINT NOT NULL DEFAULT 1,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, option_id, user_id)
);

-- Référence du message chat associé au sondage
ALTER TABLE channel_messages ADD COLUMN poll_id UUID REFERENCES polls(id) ON DELETE SET NULL;

-- Index
CREATE INDEX idx_poll_options_poll ON poll_options (poll_id);
CREATE INDEX idx_poll_votes_poll   ON poll_votes   (poll_id);
CREATE INDEX idx_poll_votes_user   ON poll_votes   (poll_id, user_id);
CREATE INDEX idx_channel_msgs_poll ON channel_messages (poll_id) WHERE poll_id IS NOT NULL;

COMMIT;
