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

import { reloadRules, getRules } from './cache'
import { hasRE2 } from './matchers'
import { startMutePurgeWorker } from './mutes'
import { ensureOctoGuardBotUser } from './welcome'
import { migrateEnvPatternsToDB } from './envMigration'

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
  if (!isOctoGuardEnabled()) {
    console.log('[octoguard] disabled (OCTOGUARD_ENABLED!=true)')
    return
  }

  if (hasRE2()) {
    console.log('[octoguard] regex DoS protection: re2 native engine active')
  } else {
    console.warn('[octoguard] re2 not installed, falling back to native RegExp + safe-regex admission check. Regex DoS protection is reduced.')
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

  // Démarrer le worker de purge des mutes expirés (Module 6).
  // Le worker est non-blocking grâce à unref().
  startMutePurgeWorker()

  // Pré-créer le user fantôme OctoGuard pour qu'il soit prêt quand le
  // premier welcome est déclenché (Module 2).
  await ensureOctoGuardBotUser().catch(err =>
    console.warn('[octoguard] ensureOctoGuardBotUser at boot failed (non-fatal):', err)
  )
}
