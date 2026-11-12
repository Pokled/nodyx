-- Migration 139 : les webhooks de la communauté (D36 à D39, CDC SPECS/NODYX_WEBHOOKS_CDC.md).
--
-- Plusieurs destinations, chacune de sa SORTE : « public » (annonces de la
-- communauté) ou « team » (alertes de modération). Une destination publique ne
-- reçoit jamais la modération (D39) : contrôlé par le serveur à l'enregistrement
-- et à l'envoi. Les textes envoyés sont rendus au moment de l'envoi, rien n'est
-- rédigé ici.

CREATE TABLE IF NOT EXISTS webhook_destinations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  kind                 TEXT        NOT NULL CHECK (kind IN ('public', 'team')),
  format               TEXT        NOT NULL CHECK (format IN ('ntfy', 'matrix', 'discord', 'slack', 'json')),
  url                  TEXT        NOT NULL CHECK (char_length(url) <= 2048),
  secret               TEXT        CHECK (secret IS NULL OR char_length(secret) BETWEEN 8 AND 256),
  events               TEXT[]      NOT NULL DEFAULT '{}',
  -- Le texte des messages signalés ne part que vers l'équipe (jamais vers le public)
  include_text         BOOLEAN     NOT NULL DEFAULT FALSE,
  options              JSONB       NOT NULL DEFAULT '{}'::jsonb,
  enabled              BOOLEAN     NOT NULL DEFAULT TRUE,
  -- D37 : pause automatique après 10 échecs de suite
  consecutive_failures INT         NOT NULL DEFAULT 0,
  paused_at            TIMESTAMPTZ,
  pause_reason         TEXT,
  created_by           UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT webhook_destinations_text_team_only CHECK (kind = 'team' OR include_text = FALSE)
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id  UUID        NOT NULL REFERENCES webhook_destinations(id) ON DELETE CASCADE,
  delivery_id     UUID        NOT NULL,
  event           TEXT        NOT NULL,
  label           TEXT,                       -- le résumé lisible de l'événement (pour la liste)
  attempt         SMALLINT    NOT NULL DEFAULT 1,
  status          TEXT        NOT NULL CHECK (status IN ('ok', 'retry', 'failed', 'test_ok', 'test_failed')),
  http_status     INT,
  duration_ms     INT,
  error_code      TEXT,
  request_body    TEXT,                       -- tronqué à 8 Ko
  response_body   TEXT,                       -- tronqué à 500 caractères
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_dest ON webhook_deliveries (destination_id, created_at DESC);

-- Reprise de l'ancien webhook d'OctoGuard (une seule adresse) : il devient une
-- destination d'équipe au format JSON, avec toute la modération, comme avant.
INSERT INTO webhook_destinations (name, kind, format, url, secret, events, enabled)
SELECT 'OctoGuard', 'team', 'json', w.url,
       w.secret,
       ARRAY['sanctions', 'reports', 'held', 'appeals', 'ladder', 'og_settings', 'observations'],
       w.enabled
  FROM octoguard_webhook w
 WHERE w.id = 1 AND w.url IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM webhook_destinations WHERE name = 'OctoGuard' AND kind = 'team');
