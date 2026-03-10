-- Migration 046: Admin audit log
-- Tracks all significant admin actions for accountability

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id      UUID NOT NULL,
  actor_username VARCHAR(50) NOT NULL,
  action        VARCHAR(50) NOT NULL,
  target_type   VARCHAR(30),
  target_id     TEXT,
  target_label  TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_id_idx   ON admin_audit_log (actor_id);
