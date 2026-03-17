-- Migration 050: Hub extensions for directory_instances
-- Adds admin_email, geolocation, and block metadata

ALTER TABLE directory_instances
  ADD COLUMN IF NOT EXISTS admin_email   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS lat           FLOAT,
  ADD COLUMN IF NOT EXISTS lng           FLOAT,
  ADD COLUMN IF NOT EXISTS geo_city      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS blocked_reason TEXT,
  ADD COLUMN IF NOT EXISTS blocked_at    TIMESTAMPTZ;

INSERT INTO schema_migrations (version) VALUES ('050') ON CONFLICT DO NOTHING;
