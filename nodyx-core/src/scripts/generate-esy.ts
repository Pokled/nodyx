/**
 * NODYX — Générateur de clé ESY (instance.esy)
 *
 * Depuis le 23/09, `instance.esy` est aussi généré AUTOMATIQUEMENT au
 * démarrage du serveur s'il est absent (src/index.ts → ensureEsyKeyExists()).
 * Ce script manuel reste utile pour l'inspecter/regénérer explicitement en
 * dehors du cycle de boot (ex: avant un premier déploiement, en CI).
 *
 * Usage :
 *   npx ts-node src/scripts/generate-esy.ts
 *   ou après build : node dist/scripts/generate-esy.js
 *
 * Idempotent : si le fichier existe déjà, le script s'arrête.
 */

import { ensureEsyKeyExists, resolveEsyKeyPath } from '../utils/esyKeyGen'

function main() {
  const bold  = (s: string) => `\x1b[1m${s}\x1b[0m`
  const green = (s: string) => `\x1b[32m${s}\x1b[0m`
  const cyan  = (s: string) => `\x1b[36m${s}\x1b[0m`
  const red   = (s: string) => `\x1b[31m${s}\x1b[0m`

  console.log()
  console.log(bold(cyan('  ╔══════════════════════════════════════╗')))
  console.log(bold(cyan('  ║   NODYX — Générateur de clé ESY v1   ║')))
  console.log(bold(cyan('  ╚══════════════════════════════════════╝')))
  console.log()

  const result = ensureEsyKeyExists()

  if (!result.created) {
    console.log(green('  ✓ instance.esy existe déjà — aucune action.'))
    console.log(`  → ${resolveEsyKeyPath()}`)
    console.log()
    return
  }

  console.log(green('  ✓ instance.esy généré avec succès !'))
  console.log()
  console.log(`  Chemin      : ${bold(result.path)}`)
  console.log(`  Fingerprint : ${bold(result.fingerprint ?? '?')}`)
  console.log()
  console.log(red('  ⚠  IMPORTANT : ne jamais committer instance.esy dans Git !'))
  console.log(red('  ⚠  Sauvegarder ce fichier — si perdu, les DMs chiffrés deviennent'))
  console.log(red('     illisibles (la couche ESY ne peut plus être inversée).'))
  console.log()
}

main()
