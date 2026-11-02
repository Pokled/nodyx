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
import { triggerWebhook, buildWebhookPayload } from './webhook'
import type { ActionLogEntry } from './types'

/**
 * Fire-and-forget : la fonction retourne immédiatement, l'INSERT DB tourne
 * en arrière-plan. Le pipeline ne paye pas la latence du log.
 *
 * Garantie : ne throw jamais (try/catch global enveloppe l'INSERT).
 * Cf. bench v2.1.1 §C.2.4 : sans fire-and-forget, p95 explose à ~13ms
 * sous charge à cause de la sérialisation des INSERT.
 *
 * Signature `void` (pas Promise<void>) : les callers n'ont pas besoin
 * d'awaiter, et c'est explicite que le log est non-bloquant.
 */
export function logOctoGuardAction(entry: ActionLogEntry): void {
  if (!entry.action.startsWith('octoguard.')) {
    console.warn(`[octoguard:logger] action without 'octoguard.' prefix: ${entry.action}`)
  }

  // Exécution asynchrone non bloquante. Le caller continue immédiatement.
  void (async () => {
    try {
      await db.query(
        // Action d'un humain via OctoGuard (sourdine posée à la main) : le
        // journal porte son nom ; sinon c'est OctoGuard lui-même.
        `INSERT INTO admin_audit_log
           (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
         VALUES ($7::uuid, COALESCE((SELECT username FROM users WHERE id = $7::uuid), $1), $2, $3, $4, $5, $6)`,
        [
          'octoguard:auto',
          entry.action,
          entry.target_type,
          entry.target_id,
          entry.target_label,
          JSON.stringify(entry.metadata ?? {}),
          entry.actor_id ?? null,
        ]
      )
    } catch (err) {
      console.warn('[octoguard:logger] INSERT admin_audit_log failed:', err)
      // ne pas throw : le pipeline continue
    }
  })()

  // Webhook out (Module 5) : fire-and-forget, push dans queue Redis.
  // Si le webhook est désactivé en config, c'est un no-op silencieux.
  triggerWebhook(buildWebhookPayload({
    action:       entry.action,
    target_type:  entry.target_type,
    target_id:    entry.target_id,
    target_label: entry.target_label,
    metadata:     entry.metadata,
  }))
}
