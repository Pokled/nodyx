-- Migration 057 : 2FA TOTP
-- Ajoute le support TOTP (RFC 6238) sur les comptes utilisateurs

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_secret  TEXT;
