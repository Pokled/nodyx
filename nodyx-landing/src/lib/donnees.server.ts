// Les données vivantes de start.nodyx.org, lues côté serveur.
//
// Règle de la refonte du 13/10/2026 : rien de simulé. L'ancien site montrait un
// chat scénarisé, une carte de fédération inventée et un faux terminal. Ici,
// chaque chiffre et chaque communauté viennent d'une vraie source, mise en cache
// (l'API GitHub sans jeton plafonne à 60 requêtes par heure). Une source qui ne
// répond pas garde sa dernière bonne valeur, ou n'affiche simplement rien.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface Communaute {
  nom: string
  url: string
  description: string
  membres: number
  langue: string
  logo: string | null
  banniere: string | null
}

export interface Langue {
  code: string
  nom: string
  pct: number
}

export interface Donnees {
  version: string | null
  communautes: Communaute[]
  langues: Langue[]
}

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
      headers: { accept: 'application/json', 'user-agent': 'start.nodyx.org' },
      signal: AbortSignal.timeout(3000),
    })
    if (r.ok) valeur = extraire(await r.json())
  } catch { /* source indisponible */ }
  if (valeur === null && memo) return memo.valeur as T | null
  cache.set(cle, { quand: Date.now(), valeur })
  return valeur
}

/** Une adresse d'image venue de l'annuaire : https seulement, sinon rien. */
function image(u: unknown, base: string): string | null {
  if (typeof u !== 'string' || !u) return null
  try {
    const url = new URL(u, base)
    return url.protocol === 'https:' ? url.href : null
  } catch { return null }
}

export async function chargerDonnees(): Promise<Donnees> {
  const [version, communautes, langues] = await Promise.all([
    versionDeployee() ?? lire('version', 'https://api.github.com/repos/Pokled/nodyx/releases/latest',
      (j) => (typeof j?.tag_name === 'string' ? j.tag_name : null)),
    lire('communautes', 'https://nodyx.org/api/directory', (j) => {
      if (!Array.isArray(j?.instances)) return null
      return j.instances
        .filter((i: any) => typeof i?.name === 'string' && typeof i?.url === 'string' && i.url.startsWith('https://'))
        .map((i: any): Communaute => ({
          nom: i.name.slice(0, 80),
          url: i.url,
          description: typeof i.description === 'string' ? i.description.slice(0, 180) : '',
          membres: typeof i.members === 'number' ? i.members : 0,
          langue: typeof i.language === 'string' ? i.language : '',
          logo: image(i.logo_url, i.url),
          banniere: image(i.banner_url, i.url),
        }))
        .sort((a: Communaute, b: Communaute) => b.membres - a.membres)
    }),
    lire('langues', 'https://nodyx.org/translate/progress.json', (j) => {
      if (!Array.isArray(j?.languages)) return null
      return j.languages
        .filter((l: any) => typeof l?.code === 'string' && typeof l?.pct === 'number')
        .map((l: any): Langue => ({ code: l.code, nom: typeof l.label === 'string' ? l.label : l.code, pct: l.pct }))
        .sort((a: Langue, b: Langue) => b.pct - a.pct)
    }),
  ])
  return { version, communautes: communautes ?? [], langues: langues ?? [] }
}
