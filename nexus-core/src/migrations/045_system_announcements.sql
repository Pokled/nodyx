-- Migration 045: System announcements
-- Admin-created banners visible to all users (maintenance, updates, welcome messages)

CREATE TABLE IF NOT EXISTS system_announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message     TEXT NOT NULL,
  color       VARCHAR(20) NOT NULL DEFAULT 'indigo',
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ
);
