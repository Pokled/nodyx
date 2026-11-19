-- Les chartes (lot 7, SPECS/NODYX_OCTOGUARD_V2_CDC.md §E4f et §E4j ; maquette v3
-- validée par Jonathan le 19/11/2026). Deux chartes, un seul moteur : celle des
-- MEMBRES (la porte d'entrée) et celle de l'ÉQUIPE (signée en recevant des droits).
-- D22 : les deux sont ÉTEINTES à l'installation. D15 : on garde la PREUVE d'une
-- signature (date, version, voie), jamais le dessin.

-- Réglages, une ligne par charte. Le brouillon vit ici : on écrit sans rien publier.
CREATE TABLE IF NOT EXISTS charter_settings (
  audience     TEXT PRIMARY KEY CHECK (audience IN ('members', 'team')),
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  pledge_tone  TEXT NOT NULL DEFAULT 'sober' CHECK (pledge_tone IN ('sober', 'fun', 'kids', 'own')),
  pledge_own   TEXT NOT NULL DEFAULT '' CHECK (char_length(pledge_own) <= 200),
  draw_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  draft_html   TEXT NOT NULL DEFAULT '' CHECK (char_length(draft_html) <= 200000),
  updated_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO charter_settings (audience) VALUES ('members'), ('team') ON CONFLICT DO NOTHING;

-- Les versions publiées. « important » : tout le monde re-signe (D16).
CREATE TABLE IF NOT EXISTS charter_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience     TEXT NOT NULL CHECK (audience IN ('members', 'team')),
  version      INTEGER NOT NULL CHECK (version > 0),
  body_html    TEXT NOT NULL CHECK (char_length(body_html) <= 200000),
  important    BOOLEAN NOT NULL DEFAULT FALSE,
  published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audience, version)
);

-- La preuve d'une signature.
CREATE TABLE IF NOT EXISTS charter_signatures (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience  TEXT NOT NULL CHECK (audience IN ('members', 'team')),
  user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version   INTEGER NOT NULL CHECK (version > 0),
  way       TEXT NOT NULL CHECK (way IN ('hand', 'phrase')),
  read_ms   INTEGER NOT NULL DEFAULT 0 CHECK (read_ms >= 0),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audience, user_id, version)
);
CREATE INDEX IF NOT EXISTS charter_signatures_recent ON charter_signatures (audience, signed_at DESC);
CREATE INDEX IF NOT EXISTS charter_signatures_user ON charter_signatures (user_id, audience, version DESC);

-- Une lecture : quand on a ouvert (le chrono se lit sur l'horloge du SERVEUR),
-- jusqu'où on est allé, si on est arrivé en bas. Sert au parcours de l'admin.
CREATE TABLE IF NOT EXISTS charter_views (
  audience    TEXT NOT NULL CHECK (audience IN ('members', 'team')),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version     INTEGER NOT NULL CHECK (version > 0),
  opened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  max_pct     SMALLINT NOT NULL DEFAULT 0 CHECK (max_pct BETWEEN 0 AND 100),
  max_section SMALLINT NOT NULL DEFAULT 0 CHECK (max_section BETWEEN 0 AND 500),
  bottom_at   TIMESTAMPTZ,
  PRIMARY KEY (audience, user_id, version)
);
CREATE INDEX IF NOT EXISTS charter_views_opened ON charter_views (audience, opened_at DESC);

-- Les robots arrêtés : la fausse case cochée, ou tout signé en moins de 3 s.
-- Le compte n'est PAS banni (validé le 19/11) : l'équipe le voit et décide.
CREATE TABLE IF NOT EXISTS charter_bot_stops (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience   TEXT NOT NULL CHECK (audience IN ('members', 'team')),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trap       TEXT NOT NULL CHECK (trap IN ('decoy', 'clock')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS charter_bot_stops_recent ON charter_bot_stops (audience, created_at DESC);
