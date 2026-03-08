-- Migration 034: Community bans
-- Banned users are removed from community_members and cannot rejoin.

CREATE TABLE IF NOT EXISTS community_bans (
  community_id  UUID        NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES users(id)       ON DELETE CASCADE,
  banned_by     UUID                 REFERENCES users(id)       ON DELETE SET NULL,
  reason        TEXT,
  banned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_community_bans_community ON community_bans(community_id);
