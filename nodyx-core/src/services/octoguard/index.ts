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
export { hasRE2, compileSafeRegex } from './matchers'

import { reloadRules, getRules } from './cache'
import { hasRE2 } from './matchers'

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
}
