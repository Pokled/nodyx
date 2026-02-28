-- Migration 014: Directory instances table
-- Stores registered Nexus instances for the public directory

CREATE TABLE IF NOT EXISTS directory_instances (
  id              SERIAL PRIMARY KEY,
  slug            VARCHAR(63)  NOT NULL UNIQUE,
  name            VARCHAR(100) NOT NULL,
  description     TEXT,
  url             TEXT         NOT NULL,
  ip              VARCHAR(45),
  language        VARCHAR(10)  DEFAULT 'fr',
  country         VARCHAR(2),
  theme           VARCHAR(50),
  members         INTEGER      DEFAULT 0,
  online          INTEGER      DEFAULT 0,
  version         VARCHAR(20),
  status          VARCHAR(20)  DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'banned')),
  token           VARCHAR(64)  NOT NULL UNIQUE,
  cloudflare_record_id TEXT,
  last_seen       TIMESTAMPTZ,
  registered_at   TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_directory_instances_slug    ON directory_instances(slug);
CREATE INDEX IF NOT EXISTS idx_directory_instances_status  ON directory_instances(status);
CREATE INDEX IF NOT EXISTS idx_directory_instances_last_seen ON directory_instances(last_seen);

INSERT INTO schema_migrations (version) VALUES ('014') ON CONFLICT DO NOTHING;
