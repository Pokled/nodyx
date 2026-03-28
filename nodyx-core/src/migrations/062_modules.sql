-- 062_modules.sql
-- Module system: persistent registry of all Nodyx modules.
-- Each module has an enabled state and optional JSON config.
-- The seed data uses ON CONFLICT DO NOTHING — admin toggles are never overwritten on restart.

CREATE TABLE IF NOT EXISTS modules (
  id           TEXT        PRIMARY KEY,
  family       TEXT        NOT NULL CHECK (family IN ('core', 'community', 'website', 'integration')),
  enabled      BOOLEAN     NOT NULL DEFAULT false,
  config       JSONB       NOT NULL DEFAULT '{}',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Homepage widget layout (for future website-family modules)
CREATE TABLE IF NOT EXISTS homepage_layout (
  id        SERIAL  PRIMARY KEY,
  zone      TEXT    NOT NULL CHECK (zone IN ('hero', 'main', 'sidebar', 'footer')),
  module_id TEXT    NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  position  INTEGER NOT NULL DEFAULT 0,
  config    JSONB   NOT NULL DEFAULT '{}',
  UNIQUE(zone, module_id)
);

-- ── Seed ──────────────────────────────────────────────────────────────────────
-- Core modules are always enabled and cannot be toggled by the admin.
-- Community/website/integration modules default to false (opt-in).
-- Existing instances keep their current state (ON CONFLICT DO NOTHING).

INSERT INTO modules (id, family, enabled) VALUES
  -- core (non-disableable)
  ('auth',              'core',        true),
  ('members',           'core',        true),
  ('forum',             'core',        true),
  ('admin',             'core',        true),
  ('settings',          'core',        true),

  -- community tools
  ('chat',              'community',   true),
  ('voice',             'community',   true),
  ('canvas',            'community',   false),
  ('jukebox',           'community',   false),
  ('calendar',          'community',   true),
  ('polls',             'community',   true),
  ('wiki',              'community',   false),
  ('files',             'community',   false),
  ('dm',                'community',   true),
  ('announcements',     'community',   true),
  ('leaderboard',       'community',   false),
  ('tasks',             'community',   true),

  -- website widgets (public face)
  ('hero',              'website',     false),
  ('news',              'website',     false),
  ('events-public',     'website',     false),
  ('gallery',           'website',     false),
  ('members-showcase',  'website',     false),
  ('newsletter',        'website',     false),
  ('map',               'website',     false),
  ('faq',               'website',     false),
  ('contact',           'website',     false),
  ('sponsors',          'website',     false),
  ('stats',             'website',     false),

  -- integrations
  ('rss-import',        'integration', false),
  ('webhook',           'integration', false),
  ('ical-sync',         'integration', false)
ON CONFLICT (id) DO NOTHING;
