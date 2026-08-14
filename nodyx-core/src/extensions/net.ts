// Le proxy réseau des extensions.
//
// Ce n'est PAS un `fetch` générique derrière une liste blanche. C'est une porte
// bornée par ce que le manifeste déclare et que l'admin a accepté, et la
// différence se voit à l'écran de permissions : « peut lire les fiches
// publiques TMDB (GET /3/movie/...) » plutôt que « accès réseau ».
//
// Deux principes portent tout le module.
//
// 1. On valide l'ADRESSE OBTENUE, pas le nom demandé. Vérifier le nom avant de
//    résoudre ne protège de rien : le rebinding DNS est l'attaque de référence,
//    et un nom public qui résout en adresse privée est le contournement
//    classique. On résout, on juge l'adresse, puis on se connecte À CETTE
//    ADRESSE.
//
// 2. Le SERVEUR possède la recette d'injection du secret. L'extension nomme le
//    secret, elle ne choisit ni l'en-tête ni sa destination : sinon elle
//    demanderait `X-Peu-Importe: <secret>` vers un hôte qu'elle contrôle et le
//    récupérerait indirectement.
//
// cf SPECS/NODYX_SDK_CDC.md §6.4, NODYX_SDK_SECURITY.md §4.4

import { NETWORK } from './limits'
import { classifyHost } from './manifest'

export type NetError =
  | 'HOST_NOT_ALLOWED' | 'HOST_FORBIDDEN' | 'METHOD_NOT_ALLOWED' | 'PATH_NOT_ALLOWED'
  | 'PORT_NOT_ALLOWED' | 'SCHEME_NOT_ALLOWED' | 'PRIVATE_ADDRESS' | 'INVALID_ARGUMENT'
  | 'TOO_MANY_REDIRECTS' | 'RESPONSE_TOO_LARGE' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_ERROR'

export interface NetRule {
  methods: string[]
  paths:   string[]
  /** Port non standard declare au manifeste. Absent = port par defaut du schema. */
  port?:   number
  secret?: string
  rate?:   string
}

/** Ce que l'admin a accordé, hôte par hôte. */
export type GrantedNetwork = Record<string, NetRule>

export type NetCheck<T> =
  | { ok: true;  value: T }
  | { ok: false; code: NetError; message: string }

const fail = (code: NetError, message: string): NetCheck<never> => ({ ok: false, code, message })

/** Un préfixe de chemin déclaré, avec `*` en fin, autorise ses descendants. */
export function pathAllowed(pathname: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p.endsWith('*')) return pathname.startsWith(p.slice(0, -1))
    return pathname === p
  })
}

export interface AllowedTarget {
  url:    URL
  host:   string
  rule:   NetRule
  method: string
}

/**
 * Vérifie une cible contre ce que l'admin a accordé.
 *
 * Purement lexical : aucune résolution ici. La vérification d'adresse se fait
 * juste avant la connexion, et à chaque redirection.
 */
export function checkTarget(rawUrl: unknown, rawMethod: unknown, granted: GrantedNetwork): NetCheck<AllowedTarget> {
  if (typeof rawUrl !== 'string' || rawUrl.length > 2048) return fail('INVALID_ARGUMENT', 'URL absente ou trop longue')

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return fail('INVALID_ARGUMENT', 'URL invalide')
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('SCHEME_NOT_ALLOWED', 'seuls http et https sortent')
  }

  const host = url.hostname.toLowerCase()
  const rule = granted[host]
  if (!rule) return fail('HOST_NOT_ALLOWED', `l'hôte ${host} n'a pas été accordé à cette extension`)

  // Un port non declare est refuse : declarer un hote n'ouvre pas toutes ses
  // portes, et un service d'administration vit souvent juste a cote. Mais un
  // port PEUT se declarer, sinon un service d'intranet serait injoignable.
  const defaultPort = url.protocol === 'https:' ? '443' : '80'
  const allowedPort = rule.port ? String(rule.port) : defaultPort
  if ((url.port || defaultPort) !== allowedPort) {
    return fail('PORT_NOT_ALLOWED', `le port ${url.port || defaultPort} n'a pas été déclaré pour ${host}`)
  }

  const klass = classifyHost(host)
  if (klass === 'forbidden') {
    return fail('HOST_FORBIDDEN', 'cette cible est la machine de l\'instance elle même')
  }

  const method = String(rawMethod ?? 'GET').toUpperCase()
  if (!rule.methods.map((m) => m.toUpperCase()).includes(method)) {
    return fail('METHOD_NOT_ALLOWED', `la méthode ${method} n'a pas été déclarée pour ${host}`)
  }

  if (!pathAllowed(url.pathname, rule.paths)) {
    return fail('PATH_NOT_ALLOWED', `le chemin ${url.pathname} sort de ce qui a été déclaré pour ${host}`)
  }

  return { ok: true, value: { url, host, rule, method } }
}

// ── Adresses ─────────────────────────────────────────────────────────────────

/** Une adresse IPv4 privée, de bouclage, de lien local, ou réservée. */
export function isPrivateIPv4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  const [a, b] = m.slice(1).map(Number)
  if (a === 10 || a === 127 || a === 0) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true            // lien local, métadonnées d'hébergeur
  if (a === 100 && b >= 64 && b <= 127) return true  // partage d'adresse opérateur
  if (a >= 224) return true                          // multicast, réservé, diffusion
  return false
}

/** Une adresse IPv6 de bouclage, de lien local, unique locale, ou mappée. */
export function isPrivateIPv6(ip: string): boolean {
  const a = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (a === '::1' || a === '::') return true
  if (a.startsWith('fe80:') || a.startsWith('fc') || a.startsWith('fd')) return true
  // Une IPv4 mappée cache une adresse v4 derrière une écriture v6.
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(a)
  if (mapped) return isPrivateIPv4(mapped[1])
  if (a.startsWith('ff')) return true                // multicast
  return false
}

export function isPrivateAddress(ip: string): boolean {
  return ip.includes(':') ? isPrivateIPv6(ip) : isPrivateIPv4(ip)
}

/**
 * Décide si une adresse résolue est joignable.
 *
 * `allowPrivate` vient de l'accord EXPLICITE de l'admin pour cet hôte : une
 * instance en intranet est un usage normal, pas une anomalie. La boucle locale
 * et le lien local, eux, restent refusés même avec cet accord, parce qu'ils
 * visent la machine de l'instance et ses identifiants d'hébergeur.
 */
export function addressAllowed(ip: string, allowPrivate: boolean): NetCheck<string> {
  const v6 = ip.includes(':')
  const loopbackOrLinkLocal = v6
    ? (ip === '::1' || ip === '::' || ip.toLowerCase().startsWith('fe80:'))
    : /^(127\.|169\.254\.|0\.)/.test(ip)

  if (loopbackOrLinkLocal) {
    return fail('PRIVATE_ADDRESS', 'la boucle locale et le lien local ne sont joignables en aucun cas')
  }
  if (isPrivateAddress(ip) && !allowPrivate) {
    return fail('PRIVATE_ADDRESS', `l'adresse ${ip} est privée et cet accès n'a pas été accordé`)
  }
  return { ok: true, value: ip }
}

// ── En-têtes ─────────────────────────────────────────────────────────────────

/** Ce qu'une extension peut envoyer. Court, et volontairement. */
const REQUEST_HEADER_ALLOWLIST = new Set(['accept', 'accept-language', 'content-type'])

/** Ce qu'on rend. Tout le reste est retiré, à commencer par les cookies. */
const RESPONSE_HEADER_ALLOWLIST = new Set([
  'content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'expires',
])

export function filterRequestHeaders(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = k.toLowerCase()
    if (!REQUEST_HEADER_ALLOWLIST.has(key)) continue
    if (typeof v !== 'string' || v.length > 512) continue
    out[key] = v
  }
  return out
}

export function filterResponseHeaders(headers: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of headers) {
    const key = k.toLowerCase()
    if (RESPONSE_HEADER_ALLOWLIST.has(key)) out[key] = v
  }
  return out
}

/**
 * Injecte le secret, selon une recette que le SERVEUR possède.
 *
 * L'extension a nommé le secret au manifeste, elle ne dit ni où il va ni sous
 * quel nom. Aujourd'hui : un en-tête `Authorization: Bearer`, ou un paramètre
 * de requête `api_key` quand l'hôte l'exige. Le choix appartient à la recette,
 * jamais à l'appelant.
 */
export interface SecretRecipe {
  mode:  'bearer' | 'query'
  param?: string
}

export const DEFAULT_RECIPE: SecretRecipe = { mode: 'bearer' }

export function applySecret(
  url: URL,
  headers: Record<string, string>,
  secret: string | undefined,
  recipe: SecretRecipe = DEFAULT_RECIPE,
): void {
  if (!secret) return
  if (recipe.mode === 'query') {
    url.searchParams.set(recipe.param || 'api_key', secret)
    return
  }
  headers.authorization = `Bearer ${secret}`
}

/** Une réponse dont la taille annoncée dépasse déjà le plafond. */
export function declaredTooLarge(contentLength: string | null): boolean {
  if (!contentLength) return false
  const n = Number(contentLength)
  return Number.isFinite(n) && n > NETWORK.maxResponseBytes
}
