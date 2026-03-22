-- Migration 061 — Fingerprints enrichis (intelligence CERT)
ALTER TABLE honeypot_fingerprints
  ADD COLUMN IF NOT EXISTS gpu_vendor      TEXT,
  ADD COLUMN IF NOT EXISTS gpu_renderer    TEXT,
  ADD COLUMN IF NOT EXISTS device_memory   REAL,
  ADD COLUMN IF NOT EXISTS languages       TEXT,
  ADD COLUMN IF NOT EXISTS dpr             REAL,
  ADD COLUMN IF NOT EXISTS touch_points    INT,
  ADD COLUMN IF NOT EXISTS connection_type TEXT,
  ADD COLUMN IF NOT EXISTS audio_fp        TEXT,
  ADD COLUMN IF NOT EXISTS fonts_count     INT,
  ADD COLUMN IF NOT EXISTS color_depth     INT,
  ADD COLUMN IF NOT EXISTS behavior_json   JSONB;

-- Table rapports CERT générés
CREATE TABLE IF NOT EXISTS honeypot_cert_reports (
  id           BIGSERIAL    PRIMARY KEY,
  incident_id  TEXT         NOT NULL,
  generated_at TIMESTAMPTZ  DEFAULT NOW(),
  report_json  JSONB        NOT NULL,
  sent_to      TEXT         DEFAULT 'CERT-FR'
);

CREATE INDEX IF NOT EXISTS honeypot_cert_reports_incident_idx ON honeypot_cert_reports (incident_id);
