-- Migration 077 — Backup system (spec 014-backup-system, Phase 1 MVP)
--
-- Three tables :
--   backups            : one row per archive on disk, indexed by created_at DESC
--   backup_settings    : singleton config row for auto-backup scheduler (Phase 2)
--   backup_audit_log   : every sensitive action (create, restore, download, delete,
--                        verify, settings_change) with IP + user-agent — anti-exfiltration
--                        if the instance gets compromised, the admin must be able to see
--                        whether an attacker downloaded a backup.

-- ─── Table : backups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backups (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename        TEXT NOT NULL,
  size_bytes      BIGINT NOT NULL,
  nodyx_version   TEXT NOT NULL,
  format_version  INTEGER NOT NULL DEFAULT 1,
  contents        JSONB NOT NULL,                          -- { db: true, uploads: true, config: true }
  stats           JSONB NOT NULL,                          -- snapshot at creation time (users, threads, messages...)
  label           TEXT,                                    -- free text, eg. "before v2.4 migration"
  encrypted       BOOLEAN NOT NULL DEFAULT FALSE,
  checksum        TEXT NOT NULL,                           -- sha256 hex of the archive
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  source          TEXT NOT NULL DEFAULT 'manual',          -- 'manual' | 'scheduled' | 'pre-restore'
  protected       BOOLEAN NOT NULL DEFAULT FALSE,          -- pre-restore snapshots = protected for 24h
  expires_at      TIMESTAMPTZ                              -- NULL = no expiry; pre-restore snapshots set this to NOW() + 24h
);

CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_source     ON backups(source, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_protected  ON backups(protected) WHERE protected = TRUE;

-- ─── Table : backup_settings (singleton) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_settings (
  id                       INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- enforce singleton
  auto_enabled             BOOLEAN NOT NULL DEFAULT FALSE,
  auto_frequency           TEXT NOT NULL DEFAULT 'daily',                 -- 'daily' | 'weekly' | 'monthly'
  auto_hour_utc            INTEGER NOT NULL DEFAULT 3 CHECK (auto_hour_utc BETWEEN 0 AND 23),
  auto_minute_utc          INTEGER NOT NULL DEFAULT 0 CHECK (auto_minute_utc BETWEEN 0 AND 59),
  auto_day_of_week         INTEGER CHECK (auto_day_of_week IS NULL OR auto_day_of_week BETWEEN 0 AND 6),
  auto_day_of_month        INTEGER CHECK (auto_day_of_month IS NULL OR auto_day_of_month BETWEEN 1 AND 28),
  retention_count          INTEGER NOT NULL DEFAULT 10 CHECK (retention_count BETWEEN 1 AND 50),
  include_uploads_default  BOOLEAN NOT NULL DEFAULT TRUE,
  encryption_passphrase    TEXT,                                          -- argon2id hash, never stored in clear
  passphrase_acknowledged  BOOLEAN NOT NULL DEFAULT FALSE,
  notify_email             TEXT,                                          -- optional alert recipient
  notify_on_success        BOOLEAN NOT NULL DEFAULT FALSE,
  notify_on_failure        BOOLEAN NOT NULL DEFAULT TRUE,
  consecutive_failures     INTEGER NOT NULL DEFAULT 0,                    -- counter for repeated alerts
  low_disk_threshold_gb    INTEGER NOT NULL DEFAULT 5 CHECK (low_disk_threshold_gb >= 1),
  low_disk_alerted_at      TIMESTAMPTZ,                                   -- anti-spam for disk alerts
  last_auto_run_at         TIMESTAMPTZ,
  last_auto_status         TEXT CHECK (last_auto_status IN ('success', 'failed') OR last_auto_status IS NULL),
  last_auto_error          TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO backup_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ─── Table : backup_audit_log ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  backup_id   UUID REFERENCES backups(id) ON DELETE SET NULL,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,                       -- 'create' | 'restore' | 'delete' | 'download' | 'verify' | 'settings_change'
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB,                               -- action-specific context (label, dry_run, target_id...)
  status      TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_backup_audit_created_at ON backup_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_audit_user       ON backup_audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_audit_backup     ON backup_audit_log(backup_id, created_at DESC);
