// ─── Version source unique de vérité ────────────────────────────────────────
//
// Priorité de résolution :
//   1. Fichier `VERSION` à la racine du repo (1 ligne, ex: "2.5.0")
//   2. `package.json` de nodyx-core (legacy / fallback)
//   3. "unknown"
//
// La valeur est cachée à l'import. Pour bumper une release, modifier le
// fichier VERSION + les 2 package.json (via scripts/bump-version.sh) puis
// rebuild + restart : la nouvelle version est automatiquement reflétée.
//
// Pourquoi pas `process.env.NODYX_VERSION` :
//   - Le `.env` est écrit à l'install initiale et n'est jamais re-écrit aux
//     upgrades, donc figé. Lire ce fichier menait à des instances qui
//     affichaient une version obsolète alors que le code était à jour.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function resolveVersion(): string {
  // 1. VERSION file (priorité absolue)
  // __dirname = .../nodyx-core/dist/utils ou .../nodyx-core/src/utils selon
  // build vs ts-node. On remonte jusqu'à la racine du repo (nodyx-core/..).
  const candidates = [
    resolve(__dirname, '../../../VERSION'),  // src/utils → repo root
    resolve(__dirname, '../../VERSION'),     // dist/utils → repo root (build flat)
    resolve(process.cwd(), '../VERSION'),    // cwd = nodyx-core/
    resolve(process.cwd(), 'VERSION'),       // cwd = repo root
  ]
  for (const p of candidates) {
    try {
      const v = readFileSync(p, 'utf8').trim()
      if (v.length > 0) return v
    } catch { /* try next */ }
  }

  // 2. package.json (fallback)
  try {
    const pkgPath = resolve(__dirname, '../../package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    if (pkg.version) return pkg.version
  } catch { /* ignore */ }

  return 'unknown'
}

export const NODYX_VERSION: string = resolveVersion()
