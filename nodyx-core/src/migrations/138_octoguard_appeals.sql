-- Migration 138 : contester une décision (OctoGuard 2, lot 8, D23 et D33-D35).
--
-- Règle de langue (§E4i) : on enregistre la STRUCTURE. Les seuls textes sont ceux
-- qu'un HUMAIN a tapés : le mot du membre qui conteste, la réponse de l'équipe.

-- ─── 1. La trace durable des sourdines ──────────────────────────────────────
-- `chat_mutes` ne garde que les sourdines en cours : le ménage les SUPPRIME à
-- l'expiration (purgeExpiredMutes), une levée aussi (removeMute). Une sourdine de
-- 10 minutes ne serait plus contestable 11 minutes après. Cette table en garde la
-- trace, alimentée par un déclencheur : aucune façon de poser ou d'ôter une
-- sourdine ne peut l'oublier, ni aujourd'hui ni demain.

-- La règle qui a posé la sourdine (applyMute la connaissait déjà, sans la ranger)
ALTER TABLE chat_mutes ADD COLUMN IF NOT EXISTS rule_id UUID REFERENCES octoguard_automod_rules(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS octoguard_mute_log (
  id          UUID        PRIMARY KEY,                                    -- = chat_mutes.id
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id  UUID,
  reason      TEXT,                                                       -- tapé par un humain, ou NULL
  applied_by  UUID        REFERENCES users(id) ON DELETE SET NULL,        -- NULL = OctoGuard
  rule_id     UUID        REFERENCES octoguard_automod_rules(id) ON DELETE SET NULL,
  applied_at  TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ,
  -- Quand la sourdine a quitté chat_mutes. Avant expires_at : levée plus tôt.
  ended_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_octoguard_mute_log_user ON octoguard_mute_log (user_id, applied_at DESC);

CREATE OR REPLACE FUNCTION octoguard_mute_log_insert() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO octoguard_mute_log (id, user_id, channel_id, reason, applied_by, rule_id, applied_at, expires_at)
  VALUES (NEW.id, NEW.user_id, NEW.channel_id, NEW.reason, NEW.applied_by, NEW.rule_id, NEW.applied_at, NEW.expires_at)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END
$fn$;

CREATE OR REPLACE FUNCTION octoguard_mute_log_delete() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  UPDATE octoguard_mute_log SET ended_at = NOW() WHERE id = OLD.id AND ended_at IS NULL;
  RETURN OLD;
END
$fn$;

DROP TRIGGER IF EXISTS trg_octoguard_mute_log_insert ON chat_mutes;
CREATE TRIGGER trg_octoguard_mute_log_insert AFTER INSERT ON chat_mutes
  FOR EACH ROW EXECUTE FUNCTION octoguard_mute_log_insert();
DROP TRIGGER IF EXISTS trg_octoguard_mute_log_delete ON chat_mutes;
CREATE TRIGGER trg_octoguard_mute_log_delete AFTER DELETE ON chat_mutes
  FOR EACH ROW EXECUTE FUNCTION octoguard_mute_log_delete();

-- Les sourdines en cours au moment de la migration
INSERT INTO octoguard_mute_log (id, user_id, channel_id, reason, applied_by, rule_id, applied_at, expires_at)
SELECT id, user_id, channel_id, reason, applied_by, rule_id, applied_at, expires_at FROM chat_mutes
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Les contestations ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS octoguard_appeals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision_type     TEXT        NOT NULL CHECK (decision_type IN ('warn', 'mute')),
  decision_id       UUID        NOT NULL,
  -- L'auteur de la décision, figé au dépôt : il ne pourra pas trancher.
  -- decided_by_engine distingue « OctoGuard » d'un compte supprimé depuis.
  decided_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  decided_by_engine BOOLEAN     NOT NULL,
  message           TEXT        NOT NULL CHECK (char_length(message) BETWEEN 10 AND 1000),
  status            TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'overturned')),
  handled_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  handled_at        TIMESTAMPTZ,
  reply             TEXT        CHECK (reply IS NULL OR char_length(reply) <= 500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- D23 : une contestation par décision
  CONSTRAINT uq_octoguard_appeals_decision UNIQUE (decision_type, decision_id)
);
CREATE INDEX IF NOT EXISTS idx_octoguard_appeals_open ON octoguard_appeals (created_at) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_octoguard_appeals_user ON octoguard_appeals (user_id, created_at DESC);
