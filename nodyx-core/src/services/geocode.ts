// « Trouver sur la carte » : un pont entre Nodyx et OpenStreetMap (Nominatim).
//
// Celui qui crée un événement tape un lieu, clique, et les coordonnées se remplissent
// seules (avant : latitude et longitude à chercher ailleurs et recopier à la main).
//
// Règles d'utilisation du service public, respectées à la lettre
// (https://operations.osmfoundation.org/policies/nominatim/) :
//  - 1 requête par seconde AU PLUS pour toute l'instance : file d'attente du cœur ;
//  - jamais de recherche à la frappe (autocomplétion interdite) : la route n'est
//    appelée que sur un clic ;
//  - l'application s'identifie (User-Agent « Nodyx/<version> (+<adresse de l'instance>) »),
//    sans aucune donnée personnelle ;
//  - passage par le serveur et mise en cache : une même recherche n'est jamais renvoyée
//    au service (30 jours en cache) ; le navigateur du membre ne lui parle jamais ;
//  - coupure sans mise à jour : NODYX_GEOCODER=off dans le .env du cœur ;
//  - attribution affichée à côté des résultats (© les contributeurs d'OpenStreetMap).
import { createHash } from 'crypto'
import { redis } from '../config/database'
import { NODYX_VERSION } from '../utils/version'

export interface GeoResult { label: string; lat: number; lng: number; kind: string }

export const GEO_QUERY_MIN = 3
export const GEO_QUERY_MAX = 200
const CACHE_TTL_S = 30 * 86400
const SPACING_MS = 1100            // un peu plus d'une seconde entre deux requêtes
const QUEUE_MAX = 5                // au-delà, « réessaie dans un instant »
const TIMEOUT_MS = 6000

export class GeoError extends Error {
  constructor(public code: 'GEO_DISABLED' | 'GEO_BUSY' | 'GEO_UNAVAILABLE') { super(code) }
}

export function geocoderEnabled(): boolean {
  return (process.env.NODYX_GEOCODER ?? 'nominatim').toLowerCase() !== 'off'
}

function endpoint(): string {
  return (process.env.NODYX_GEOCODER_URL ?? 'https://nominatim.openstreetmap.org').replace(/\/$/, '')
}

export function userAgent(): string {
  const site = (process.env.FRONTEND_URL ?? process.env.SELF_URL ?? '').replace(/\/$/, '')
  return `Nodyx/${NODYX_VERSION}${site ? ` (+${site})` : ''}`
}

/** Espaces réduits, minuscules : « Lille  Grand Palais » et « lille grand palais » = une seule recherche. */
export function normalizeQuery(q: string): string {
  return q.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
}

const LANGS = new Set(['fr', 'en', 'de', 'es', 'pt', 'ru', 'vi', 'zh'])
export const langOf = (raw: unknown): string => {
  const l = String(raw ?? '').slice(0, 2).toLowerCase()
  return LANGS.has(l) ? l : 'en'
}

// ── File d'attente : une requête à la fois, espacées d'au moins SPACING_MS ──
let chain: Promise<unknown> = Promise.resolve()
let waiting = 0
let lastAt = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function throttled<T>(job: () => Promise<T>): Promise<T> {
  if (waiting >= QUEUE_MAX) return Promise.reject(new GeoError('GEO_BUSY'))
  waiting++
  const run = chain.then(async () => {
    const wait = lastAt + SPACING_MS - Date.now()
    if (wait > 0) await sleep(wait)
    lastAt = Date.now()
    return job()
  }).finally(() => { waiting-- })
  chain = run.catch(() => {})
  return run
}

export function _resetGeocoderForTests(): void { chain = Promise.resolve(); waiting = 0; lastAt = 0 }

type Raw = { display_name?: string; lat?: string; lon?: string; type?: string; category?: string; class?: string }

/** Les lieux trouvés pour `query` (5 au plus), depuis le cache ou le service. */
export async function geocodeSearch(query: string, lang: string, fetchImpl: typeof fetch = fetch): Promise<GeoResult[]> {
  if (!geocoderEnabled()) throw new GeoError('GEO_DISABLED')
  const q = normalizeQuery(query)
  const key = `geo:search:${lang}:${createHash('sha256').update(q).digest('hex').slice(0, 32)}`
  try {
    const hit = await redis.get(key)
    if (hit) return JSON.parse(hit) as GeoResult[]
  } catch { /* Redis indisponible : on demande au service, sans cache */ }

  const results = await throttled(async () => {
    const url = `${endpoint()}/search?format=jsonv2&limit=5&addressdetails=0&q=${encodeURIComponent(q)}&accept-language=${lang}`
    let res: Response
    try {
      res = await fetchImpl(url, { headers: { 'User-Agent': userAgent(), Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    } catch { throw new GeoError('GEO_UNAVAILABLE') }
    if (!res.ok) throw new GeoError('GEO_UNAVAILABLE')
    const raw = await res.json().catch(() => null) as Raw[] | null
    if (!Array.isArray(raw)) throw new GeoError('GEO_UNAVAILABLE')
    return raw.flatMap((r): GeoResult[] => {
      const lat = Number(r.lat), lng = Number(r.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return []
      return [{ label: String(r.display_name ?? '').slice(0, 300), lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, kind: String(r.type ?? r.category ?? r.class ?? '').slice(0, 40) }]
    }).slice(0, 5)
  })

  try { await redis.setex(key, CACHE_TTL_S, JSON.stringify(results)) } catch { /* sans cache, tant pis */ }
  return results
}
