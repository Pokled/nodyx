-- Migration 056 : table honeypot_hits
-- Enregistre toutes les tentatives d'accès aux endpoints pièges

CREATE TABLE IF NOT EXISTS honeypot_hits (
  id          SERIAL PRIMARY KEY,
  incident_id TEXT        NOT NULL,
  ip          TEXT        NOT NULL,
  path        TEXT        NOT NULL,
  method      TEXT        NOT NULL DEFAULT 'GET',
  user_agent  TEXT,
  headers     JSONB,
  country     TEXT,
  city        TEXT,
  isp         TEXT,
  org         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS honeypot_hits_ip_idx         ON honeypot_hits (ip);
CREATE INDEX IF NOT EXISTS honeypot_hits_created_at_idx ON honeypot_hits (created_at DESC);
