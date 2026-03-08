-- Migration 035: IP bans, email bans, registration IP tracking
-- Prevents banned users from creating new accounts via the same IP or email.

-- Store the IP used at registration time
ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_ip INET;

-- Banned IPs: cannot register or login
CREATE TABLE IF NOT EXISTS ip_bans (
  ip          INET        NOT NULL PRIMARY KEY,
  reason      TEXT,
  banned_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  banned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Banned emails/domains: cannot register
-- A row with email = 'yopmail.com' bans the entire domain (prefix match on @)
CREATE TABLE IF NOT EXISTS email_bans (
  email       TEXT        NOT NULL PRIMARY KEY, -- full email OR domain (e.g. 'yopmail.com')
  reason      TEXT,
  banned_by   UUID        REFERENCES users(id) ON DELETE SET NULL,
  banned_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ip_bans_ip ON ip_bans(ip);
