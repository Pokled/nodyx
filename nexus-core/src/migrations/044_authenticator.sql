-- Migration 044 — Nexus Authenticator
-- Tables pour l'authentification cryptographique par challenge-response ECDSA.

-- Appareils enregistrés (clé publique par appareil, par utilisateur)
CREATE TABLE IF NOT EXISTS authenticator_devices (
  id            UUID        PRIMARY KEY,
  user_id       UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         TEXT        NOT NULL,
  public_key    JSONB       NOT NULL,   -- ExportedPublicKey {algorithm, key: JWK}
  device_token  TEXT        UNIQUE NOT NULL,  -- token opaque pour l'API appareil
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_authenticator_devices_user_id ON authenticator_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_authenticator_devices_token   ON authenticator_devices(device_token);

-- Tokens d'enregistrement — générés par l'admin, utilisés une seule fois
CREATE TABLE IF NOT EXISTS authenticator_enrollment_tokens (
  token       TEXT        PRIMARY KEY,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

-- Challenges d'authentification en attente
CREATE TABLE IF NOT EXISTS authenticator_challenges (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge   TEXT        UNIQUE NOT NULL,  -- 32 bytes aléatoires base64
  device_id   UUID        REFERENCES authenticator_devices(id) ON DELETE SET NULL,
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  source_ip   TEXT,
  hub_url     TEXT        NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  session_token TEXT                         -- rempli quand approved
);

CREATE INDEX IF NOT EXISTS idx_authenticator_challenges_device ON authenticator_challenges(device_id);
CREATE INDEX IF NOT EXISTS idx_authenticator_challenges_status ON authenticator_challenges(status);
