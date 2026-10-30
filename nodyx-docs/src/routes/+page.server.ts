import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PageServerLoad } from './$types'

// Les chiffres de l'accueil sont lus EN DIRECT, jamais écrits à la main : la
// page d'avant affichait « v1.9.5 » et « 53 migrations » des mois après (12/10/2026).
// Mis en cache côté serveur : l'API GitHub sans jeton n'autorise que 60 requêtes
// par heure, et une page d'accueil ne doit pas la vider. Une source qui ne
// répond pas renvoie null, et le chiffre n'est simplement pas affiché.

const DUREE_MS = 15 * 60 * 1000

// La version affichée est celle DÉPLOYÉE, lue dans VERSION (source unique,
// docs/RELEASE.md), relue à chaque requête : elle change avec le déploiement,
// sans cache ni redémarrage. Avant, seule l'API GitHub (cache de 15 min, quota
// partagé par tout le serveur) la donnait : après la sortie de la 2.13.0 il a
// fallu redémarrer la page à la main, et ce n'était pas la première fois.
// GitHub reste le repli si le fichier est introuvable.
function versionDeployee(): string | null {
  for (const fichier of [process.env.NODYX_VERSION_FILE, resolve(process.cwd(), '../VERSION')]) {
    if (!fichier) continue
    try {
      const v = readFileSync(fichier, 'utf8').trim()
      if (/^\d+\.\d+\.\d+/.test(v)) return `v${v}`
    } catch { /* fichier absent : on tente le suivant */ }
  }
  return null
}
const cache = new Map<string, { quand: number; valeur: unknown }>()

async function lire<T>(cle: string, url: string, extraire: (json: any) => T | null): Promise<T | null> {
  const memo = cache.get(cle)
  if (memo && Date.now() - memo.quand < DUREE_MS) return memo.valeur as T | null
  let valeur: T | null = null
  try {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'nodyx.dev' },
      signal: AbortSignal.timeout(3000),
    })
    if (r.ok) valeur = extraire(await r.json())
  } catch { /* source indisponible : on n'affiche rien */ }
  // Un échec garde la dernière bonne valeur connue plutôt que de l'effacer.
  if (valeur === null && memo) return memo.valeur as T | null
  cache.set(cle, { quand: Date.now(), valeur })
  return valeur
}

export const load: PageServerLoad = async () => {
  const [version, instances, traduction] = await Promise.all([
    versionDeployee() ?? lire('version', 'https://api.github.com/repos/Pokled/nodyx/releases/latest',
      (j) => (typeof j?.tag_name === 'string' ? j.tag_name : null)),
    lire('instances', 'https://nodyx.org/api/directory',
      (j) => (typeof j?.total === 'number' ? j.total : Array.isArray(j?.instances) ? j.instances.length : null)),
    lire('traduction', 'https://nodyx.org/translate/progress.json',
      (j) => {
        const langues = Array.isArray(j?.languages) ? j.languages.length : null
        return langues ? { langues, completes: typeof j.completeCount === 'number' ? j.completeCount : null } : null
      }),
  ])
  return { version, instances, traduction }
}
