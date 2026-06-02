// ─── Streamer Hub — audit log ───────────────────────────────────────────────
// Pattern aligné sur backup_audit_log : on logge toute action sensible avec
// IP, user agent, statut et metadata. En cas de compromission, l'admin doit
// pouvoir savoir qui a déclenché quoi (cf §12.5 spec).

import { db } from '../../config/database'

export type AuditAction =
  | 'connect_twitch'
  | 'disconnect_twitch'
  | 'refresh_token'
  | 'token_decrypt_failed'
  | 'eventsub_subscribe'
  | 'eventsub_revoked'
  | 'hmac_invalid'
  | 'config_obs'
  | 'generate_extension'
  | 'chat_relay_sent'
  | 'chat_relay_queued'
  | 'chat_relay_dropped'
  | 'chat_relay_queue_overflow'
  | 'channel_update'
  | 'channel_update_failed'
  | 'vod_marker_created'
  | 'poll_created'
  | 'poll_create_failed'
  | 'poll_ended'
  | 'prediction_created'
  | 'prediction_create_failed'
  | 'prediction_patched'
  | 'reward_created'
  | 'reward_create_failed'
  | 'reward_updated'
  | 'reward_deleted'
  | 'unlink_twitch_viewer_admin'
  | 'chat_timer_created'
  | 'chat_timer_updated'
  | 'chat_timer_deleted'
  | 'chat_timer_send_now'
  | 'chat_command_created'
  | 'chat_command_updated'
  | 'chat_command_deleted'
  | 'deck_created'
  | 'deck_updated'
  | 'deck_revoked'
  | 'deck_action_executed'
  | 'audio_track_added'
  | 'audio_track_updated'
  | 'audio_track_deleted'

export interface AuditEntry {
  action:    AuditAction
  status:    'success' | 'failed'
  userId?:   string | null
  ipAddress?: string | null
  metadata?: Record<string, unknown>
  error?:    string | null
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO streamer_audit_log
        (user_id, action, ip_address, metadata, status, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.userId ?? null,
        entry.action,
        entry.ipAddress ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.status,
        entry.error ?? null,
      ],
    )
  } catch (err) {
    // L'audit ne doit JAMAIS faire échouer l'action principale. Si on n'arrive
    // pas à logger, on remonte l'incident dans les logs serveur classiques
    // mais on continue.
    console.error('[streamer/audit] failed to insert audit row', err)
  }
}
