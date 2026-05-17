/**
 * Logger des actions OctoGuard automatiques.
 * Conforme à SESSION-B-CDC §3.3.
 *
 * Pas de table dédiée : on écrit directement dans `admin_audit_log`
 * existante avec `actor_id = NULL` et `actor_username = 'octoguard:auto'`.
 *
 * Cette fonction est volontairement isolée du helper `logAction()` de
 * `routes/admin.ts` (qui exige actor_id non-null et fait un SELECT
 * username). On ne touche pas à l'existant.
 *
 * Jamais throw : try/catch global, on log seulement un warning console
 * si l'INSERT échoue, le pipeline OctoGuard continue.
 */

import { db } from '../../config/database'
import type { ActionLogEntry } from './types'

export async function logOctoGuardAction(entry: ActionLogEntry): Promise<void> {
  if (!entry.action.startsWith('octoguard.')) {
    console.warn(`[octoguard:logger] action without 'octoguard.' prefix: ${entry.action}`)
  }
  try {
    await db.query(
      `INSERT INTO admin_audit_log
         (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
       VALUES (NULL, $1, $2, $3, $4, $5, $6)`,
      [
        'octoguard:auto',
        entry.action,
        entry.target_type,
        entry.target_id,
        entry.target_label,
        JSON.stringify(entry.metadata ?? {}),
      ]
    )
  } catch (err) {
    console.warn('[octoguard:logger] INSERT admin_audit_log failed:', err)
    // ne pas throw : le pipeline continue
  }
}
