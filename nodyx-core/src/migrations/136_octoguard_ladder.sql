-- Migration 136 : le barème des sanctions (OctoGuard 2, lot 4b, CDC §E4i).
--
-- Règle de langue (§E4i) : on enregistre la STRUCTURE, jamais une phrase. Aucune
-- colonne de texte rédigé par le serveur ; « Barème, étape 2 » se construit à
-- l'affichage. Seul `reason` est du texte, et c'est celui qu'un HUMAIN a tapé.

-- Réglages : une seule ligne. Rien d'autre que ce que montre la maquette.
CREATE TABLE IF NOT EXISTS octoguard_ladder_settings (
  id                INT         PRIMARY KEY DEFAULT 1,
  -- 4 étapes, chacune une valeur de la liste fermée (services/octoguard/ladder.ts)
  steps             TEXT[]      NOT NULL DEFAULT ARRAY['warn', 'mute_1h', 'mute_24h', 'ban_7d'],
  forget_days       INT         NOT NULL DEFAULT 30,
  -- Éteinte par défaut : elle n'a de sens qu'à deux personnes ayant le droit d'exclure
  double_validation BOOLEAN     NOT NULL DEFAULT FALSE,
  updated_by        UUID        REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT octoguard_ladder_settings_singleton CHECK (id = 1),
  CONSTRAINT octoguard_ladder_settings_four_steps CHECK (array_length(steps, 1) = 4),
  CONSTRAINT octoguard_ladder_settings_forget CHECK (forget_days IN (30, 60, 90))
);
INSERT INTO octoguard_ladder_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Historique : chaque étape appliquée, proposée, refusée, tombée ou annulée.
CREATE TABLE IF NOT EXISTS octoguard_ladder (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step            SMALLINT    NOT NULL CHECK (step BETWEEN 1 AND 4),
  sanction        TEXT        NOT NULL,
  status          TEXT        NOT NULL CHECK (status IN ('applied', 'pending', 'refused', 'expired', 'undone')),
  actor_id        UUID        REFERENCES users(id) ON DELETE SET NULL,   -- NULL = OctoGuard
  second_id       UUID        REFERENCES users(id) ON DELETE SET NULL,   -- second avis (accord ou refus)
  undone_by       UUID        REFERENCES users(id) ON DELETE SET NULL,
  reason          TEXT,                                                  -- tapé par un humain, ou NULL
  report_id       UUID        REFERENCES reports(id) ON DELETE SET NULL,
  report_category VARCHAR(32),
  rule_id         UUID,
  mute_id         UUID,
  warn_id         UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at      TIMESTAMPTZ,
  undone_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_octoguard_ladder_user ON octoguard_ladder (user_id, created_at DESC);
-- Une seule demande en attente de second avis par membre
CREATE UNIQUE INDEX IF NOT EXISTS uq_octoguard_ladder_one_pending ON octoguard_ladder (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_octoguard_ladder_pending ON octoguard_ladder (created_at) WHERE status = 'pending';
