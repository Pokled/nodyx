// ─── Garde anti-SSRF partagée ────────────────────────────────────────────────
//
// Avant ce fichier (trouvé en audit de stabilité, F-055, 2026-09-11) : trois
// implémentations indépendantes de la détection d'IP privée existaient
// (chat.ts, linkPreview.ts, directory.ts), déjà divergées entre elles. La
// version de directory.ts (validation des URLs d'instances fédérées, la
// surface la plus exposée puisqu'alimentée par d'autres instances) était la
// SEULE des trois à ne faire aucune résolution DNS : elle jugeait la chaîne du
// hostname littéral, jamais l'adresse réellement résolue. Un domaine qui
// pointe vers une IP privée au moment de la connexion (DNS rebinding) passait
// donc la validation, alors que chat.ts s'en protège explicitement depuis
// l'incident qui l'a fait naître.
//
// Ce module consolide sur la version la plus complète (chat.ts : IPv4-mappé-
// IPv6 en notation décimale ET hexadécimale, IPv6 ULA/link-local/documentation)
// et y ajoute le seul contrôle que linkPreview.ts avait en plus
// (multicast/réservé, a >= 224).

import dns from 'dns/promises'
import net from 'net'
import http from 'http'
import https from 'https'
import type { LookupFunction } from 'net'

/** Une adresse IP (v4 ou v6) est-elle privée, loopback, link-local ou réservée ? */
export function isPrivateIp(ip: string): boolean {
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1) — bypass critique
  const mapped4 = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)
  if (mapped4) return isPrivateIp(mapped4[1])
  // IPv4-in-IPv6 hex notation (e.g. ::ffff:7f00:0001 = 127.0.0.1)
  const mapped4hex = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i)
  if (mapped4hex) {
    const a = parseInt(mapped4hex[1], 16)
    const b = parseInt(mapped4hex[2], 16)
    const ipv4 = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`
    return isPrivateIp(ipv4)
  }

  // IPv6 loopback, ULA, link-local, plage de documentation
  if (ip === '::1' || ip === '::') return true
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true  // fc00::/7 (ULA)
  if (ip.startsWith('fe80')) return true                        // link-local
  if (ip.startsWith('2001:db8')) return true                    // documentation (RFC 3849)

  // IPv4
  if (!net.isIPv4(ip)) return false
  const parts = ip.split('.').map(Number)
  const [a, b] = parts
  return (
    a === 10 ||                          // 10.0.0.0/8
    a === 127 ||                         // 127.0.0.0/8 loopback
    a === 0 ||                           // 0.0.0.0/8
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
    (a === 192 && b === 168) ||          // 192.168.0.0/16
    (a === 169 && b === 254) ||          // 169.254.0.0/16 link-local (cloud metadata)
    (a === 100 && b >= 64 && b <= 127) || // 100.64.0.0/10 shared address space (CGNAT)
    a >= 224                             // multicast (224-239) + réservé (240-255)
  )
}

/**
 * Résout le hostname UNE FOIS et retourne l'IP résolue si sûre, null sinon.
 * On retourne l'IP pour que l'appelant l'utilise directement pour la
 * connexion (anti-DNS-rebinding) : re-résoudre plus tard laisserait le temps
 * à un attaquant de changer la réponse DNS entre la vérification et l'usage.
 */
export async function resolveSsrfSafe(hostname: string): Promise<string | null> {
  // Adresse IP directe — valider sans DNS
  if (net.isIP(hostname)) return isPrivateIp(hostname) ? null : hostname
  try {
    const { address } = await dns.lookup(hostname)
    return isPrivateIp(address) ? null : address
  } catch {
    return null
  }
}

// ─── Requête sortante sûre (webhook, images recollées) ──────────────────────
//
// Trouvé le 11/11/2026 : le webhook d'OctoGuard POSTait vers n'importe quelle
// adresse (dont 127.0.0.1:2019, l'API d'administration de Caddy, partagée par
// toutes les instances du serveur), et la recopie des images collées dans le
// forum ou les tâches allait chercher n'importe quelle adresse fournie par un
// membre, redirections comprises. Les deux contournaient la garde ci-dessus.
//
// Le contrôle se fait AU MOMENT DE LA CONNEXION, dans la résolution DNS même
// (option `lookup` de http.request) : l'adresse vérifiée est celle à laquelle
// on se connecte, aucun rebinding possible entre les deux. Aucune redirection
// n'est suivie ici : l'appelant décide, et chaque saut repasse par la garde.


/** Jamais joignable, même avec le réseau local autorisé (D36). */
const FORBIDDEN = new net.BlockList()
for (const [a, p] of [['0.0.0.0', 8], ['127.0.0.0', 8], ['169.254.0.0', 16], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) {
  FORBIDDEN.addSubnet(a, p, 'ipv4')
}
for (const [a, p] of [['::', 128], ['::1', 128], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8], ['2001:db8::', 32], ['100::', 64]] as const) {
  FORBIDDEN.addSubnet(a, p, 'ipv6')
}
/** Le réseau local : interdit par défaut, permis par l'admin du SERVEUR (D36). */
const PRIVATE = new net.BlockList()
for (const [a, p] of [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['100.64.0.0', 10]] as const) PRIVATE.addSubnet(a, p, 'ipv4')
PRIVATE.addSubnet('fc00::', 7, 'ipv6')

/** Les adresses IPv6 qui emballent une IPv4 (NAT64, 6to4) : on juge l'IPv4 dedans. */
function embeddedV4(ip: string): string | null {
  const m = ip.toLowerCase().match(/^64:ff9b::(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/)
  if (m) {
    if (m[1]) return m[1]
    const a = parseInt(m[2], 16), b = parseInt(m[3], 16)
    return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`
  }
  const s = ip.toLowerCase().match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/)
  if (s) { const a = parseInt(s[1], 16), b = parseInt(s[2], 16); return `${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}` }
  return null
}

export type IpClass = 'public' | 'private' | 'forbidden'
export function classifyIp(ip: string): IpClass {
  const fam = net.isIP(ip)
  if (!fam) return 'forbidden'
  const inner = fam === 6 ? embeddedV4(ip) : null
  if (inner) return classifyIp(inner)
  const type = fam === 4 ? 'ipv4' : 'ipv6'
  if (FORBIDDEN.check(ip, type)) return 'forbidden'
  if (PRIVATE.check(ip, type)) return 'private'
  return 'public'
}

/** Le réseau local est-il permis pour CETTE sortie ? Seul l'admin du serveur le décide (variable d'environnement). */
export const webhookAllowsPrivate = (): boolean => process.env.OCTOGUARD_WEBHOOK_ALLOW_PRIVATE === 'true'

export class OutboundBlocked extends Error {
  constructor(public code: 'URL_INVALID' | 'URL_FORBIDDEN' | 'URL_UNRESOLVED', message: string) { super(message) }
}

function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true })
      .then((addrs) => {
        if (!addrs.length) return callback(new OutboundBlocked('URL_UNRESOLVED', 'no address'), '', 4)
        // TOUTES les adresses doivent passer : sinon l'OS pourrait choisir la mauvaise
        for (const a of addrs) {
          const c = classifyIp(a.address)
          if (c === 'forbidden' || (c === 'private' && !allowPrivate)) {
            return callback(new OutboundBlocked('URL_FORBIDDEN', `blocked address for ${hostname}`), '', 4)
          }
        }
        const pick = addrs[0]
        if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: typeof addrs) => void)(null, addrs)
        callback(null, pick.address, pick.family)
      })
      .catch(() => callback(new OutboundBlocked('URL_UNRESOLVED', `cannot resolve ${hostname}`), '', 4))
  }
}

/** Vérifie une adresse SANS s'y connecter (enregistrement d'un webhook). */
export async function checkOutboundUrl(raw: string, opts: { allowPrivate?: boolean } = {}): Promise<URL> {
  let u: URL
  try { u = new URL(raw) } catch { throw new OutboundBlocked('URL_INVALID', 'invalid url') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new OutboundBlocked('URL_INVALID', 'http(s) only')
  if (u.username || u.password) throw new OutboundBlocked('URL_INVALID', 'no credentials in url')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const allowPrivate = !!opts.allowPrivate
  if (host === 'localhost' || host.endsWith('.localhost')) throw new OutboundBlocked('URL_FORBIDDEN', 'localhost')
  if (net.isIP(host)) {
    const c = classifyIp(host)
    if (c === 'forbidden' || (c === 'private' && !allowPrivate)) throw new OutboundBlocked('URL_FORBIDDEN', 'blocked address')
    return u
  }
  await new Promise<void>((resolve, reject) => guardedLookup(allowPrivate)(host, {}, (err) => (err ? reject(err) : resolve())))
  return u
}

export interface SafeResponse { status: number; headers: http.IncomingHttpHeaders; body: Buffer; truncated: boolean }

/**
 * Une requête HTTP(S) dont la cible est vérifiée à la connexion. Jamais de
 * redirection suivie (la réponse 3xx est rendue telle quelle). Corps lu jusqu'à
 * `maxBytes`, temps total borné par `timeoutMs`.
 */
export function safeRequest(raw: string, opts: {
  method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string | Buffer
  timeoutMs?: number; maxBytes?: number; allowPrivate?: boolean
} = {}): Promise<SafeResponse> {
  return (async () => {
    const u = await checkOutboundUrl(raw, { allowPrivate: opts.allowPrivate })
    const host = u.hostname.replace(/^\[|\]$/g, '')
    const allowPrivate = !!opts.allowPrivate
    // Une IP littérale ne passe pas par `lookup` : elle a déjà été jugée ci-dessus
    const lib = u.protocol === 'https:' ? https : http
    const maxBytes = opts.maxBytes ?? 1024 * 1024
    return await new Promise<SafeResponse>((resolve, reject) => {
      const req = lib.request({
        protocol: u.protocol, hostname: host, port: u.port || undefined, path: `${u.pathname}${u.search}`,
        method: opts.method ?? 'GET', headers: opts.headers,
        lookup: net.isIP(host) ? undefined : guardedLookup(allowPrivate),
        servername: net.isIP(host) ? undefined : host,
        agent: false,
      }, (res) => {
        const chunks: Buffer[] = []; let size = 0; let truncated = false
        res.on('data', (c: Buffer) => {
          if (truncated) return
          size += c.length
          if (size > maxBytes) { truncated = true; chunks.push(c.subarray(0, c.length - (size - maxBytes))); res.destroy(); finish(); return }
          chunks.push(c)
        })
        let done = false
        const finish = () => { if (done) return; done = true; clearTimeout(timer); resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks), truncated }) }
        res.on('end', finish)
        res.on('close', finish)
        res.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); reject(e) } })
      })
      const timer = setTimeout(() => req.destroy(Object.assign(new Error('timeout'), { name: 'AbortError' })), opts.timeoutMs ?? 10_000)
      req.on('error', (e) => { clearTimeout(timer); reject(e) })
      if (opts.body !== undefined) req.write(opts.body)
      req.end()
    })
  })()
}
