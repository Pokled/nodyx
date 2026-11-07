/**
 * OctoGuard, modérateur automatique natif Nodyx.
 * Spec : docs/specs/016-Octoguard/016-OctoGuard.md v2.1.1
 * CDC Session B : docs/specs/016-Octoguard/sessions/B-pipeline-cdc.md
 *
 * Principes :
 *  - Désactivé par défaut (OCTOGUARD_ENABLED=false ou absent).
 *  - Aucune politique imposée. L'admin construit son cadre.
 *  - Logs unifiés dans admin_audit_log existant (pas de table dédiée).
 *  - Pipeline timeout sécurité 50ms, jamais bloquer le chat.
 *  - Protection ReDoS via re2 (optionalDep) + safe-regex (admission).
 */

export * from './types'
export { runPipeline, computeExpiresAt } from './pipeline'
export type { PipelineInput } from './pipeline'
export { reloadRules, getRules, clearRules, isLoaded } from './cache'
export { hasRE2, compileSafeRegex, assessPatternSafety } from './matchers'
export type { PatternAssessment } from './matchers'
export { logOctoGuardAction } from './logger'
export {
  isUserMuted, applyMute, removeMute, purgeExpiredMutes,
  invalidateMuteCache, clearMuteCache,
  startMutePurgeWorker, stopMutePurgeWorker,
} from './mutes'
export type { MuteCheckResult, ApplyMuteInput } from './mutes'
export { ensureOctoGuardBotUser, runWelcomeFor } from './welcome'
export { tryHandleCommand, extractCommand } from './commands'
export type { CommandContext, CommandOutcome } from './commands'
export { migrateEnvPatternsToDB } from './envMigration'
export type { MigrationResult as EnvMigrationResult } from './envMigration'
export {
  triggerWebhook, getWebhookConfig, setWebhookConfig,
  invalidateWebhookConfig, startWebhookWorker, stopWebhookWorker,
  buildWebhookPayload,
} from './webhook'
export type { WebhookPayload } from './webhook'

import { reloadRules, getRules } from './cache'
import { hasRE2 } from './matchers'
import { startMutePurgeWorker } from './mutes'
import { startBanExpiryWorker } from './bans'
import { startHeldExpiryWorker } from './held'
import { ensureBaseProfile } from './profile'
import { ensureOctoGuardBotUser } from './welcome'
import { migrateEnvPatternsToDB } from './envMigration'
import { startWebhookWorker } from './webhook'

/** Vrai si OctoGuard est activé via env. Par défaut false. */
export function isOctoGuardEnabled(): boolean {
  return process.env.OCTOGUARD_ENABLED === 'true'
}

/**
 * Init module au démarrage du backend.
 * Appelé depuis src/index.ts juste avant server.listen().
 *
 * - Si désactivé : no-op silencieux.
 * - Si activé : charge les règles + log le mode regex protection.
 * - Fail-safe : si reloadRules() échoue, on démarre en mode dégradé
 *   (table vide) plutôt que de crasher le backend entier.
 */
export async function initOctoGuard(): Promise<void> {
  // Ces deux nettoyages tournent TOUJOURS : sourdines et bannissements
  // temporaires sont aussi posés à la main par l'équipe, OctoGuard allumé ou
  // non (depuis E3, une sourdine s'applique même OctoGuard éteint).
  startMutePurgeWorker()
  startBanExpiryWorker()
  // Contenus retenus sans décision : refusés au bout de 72 h (D17), toujours
  startHeldExpiryWorker()

  // État de la protection contre les expressions piégées, affiché dans tous les cas
  console.log(hasRE2()
    ? '[octoguard] regex DoS protection: re2 native engine active'
    : '[octoguard] re2 NOT installed: regex rules cannot be enabled (see SPECS/NODYX_OCTOGUARD_V2_CDC.md)')

  // Profil de base (CDC OctoGuard 2, E4b) : semé une fois, même OctoGuard
  // éteint, pour que l'admin trouve ses règles prêtes dans l'interface.
  const base = await ensureBaseProfile()
  if (base.seeded || base.updated) console.log(`[octoguard] base profile: ${base.seeded} rule(s) seeded, ${base.updated} updated`)

  if (!isOctoGuardEnabled()) {
    console.log('[octoguard] disabled (OCTOGUARD_ENABLED!=true)')
    return
  }


  try {
    await reloadRules()
    console.log(`[octoguard] initialized with ${getRules().length} active rule(s)`)
  } catch (err) {
    console.warn('[octoguard] reloadRules failed at boot, starting with empty rules cache:', err)
  }

  // Migration one-shot BLOCKED_CONTENT_PATTERNS env → DB si applicable
  // (cf. spec v2.1.1 §Module 1 compatibilité).
  try {
    const migr = await migrateEnvPatternsToDB()
    if (!migr.skipped && migr.imported > 0) {
      // Recharger le cache après migration pour intégrer les nouvelles règles
      await reloadRules()
      console.log(`[octoguard] cache reloaded after env migration (${getRules().length} rules active)`)
    }
  } catch (err) {
    console.warn('[octoguard] envMigration failed (non-fatal):', err)
  }


  // Pré-créer le user fantôme OctoGuard pour qu'il soit prêt quand le
  // premier welcome est déclenché (Module 2).
  await ensureOctoGuardBotUser().catch(err =>
    console.warn('[octoguard] ensureOctoGuardBotUser at boot failed (non-fatal):', err)
  )

  // Démarrer le worker webhook out (Module 5). Tick toutes les 5s,
  // batch jusqu'à 20 events/tick, fire-and-forget POST signé HMAC.
  startWebhookWorker()
}
