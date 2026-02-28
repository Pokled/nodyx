-- Migration 014: Directory instances table
-- Stores registered Nexus instances for the public directory

CREATE TABLE IF NOT EXISTS directory_instances (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(63) NOT NULL UNIQUE,
  url TEXT NOT NULL,
  description TEXT,
  language VARCHAR(10) DEFAULT 'fr',
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'inactive', 'banned')),
  token VARCHAR(64) NOT NULL UNIQUE,
  subdomain TEXT,
  cloudflare_record_id TEXT,
  last_ping TIMESTAMPTZ,
  member_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_directory_instances_slug ON directory_instances(slug);
CREATE INDEX IF NOT EXISTS idx_directory_instances_status ON directory_instances(status);
CREATE INDEX IF NOT EXISTS idx_directory_instances_last_ping ON directory_instances(last_ping);

INSERT INTO schema_migrations (version) VALUES ('014') ON CONFLICT DO NOTHING;
