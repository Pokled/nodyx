// ─── L'adresse du visiteur, une seule fois, au même endroit ──────────────────
//
// LE PROBLÈME (mesuré le 2026-08-17). Depuis le 2026-08-08, le trafic de
// nodyx.org arrive par un tunnel Cloudflare. Celui-ci envoie `CF-Connecting-IP`
// mais PAS `X-Forwarded-For`. Or Fastify calcule `request.ip` à partir de
// X-Forwarded-For : absent, il se rabat sur l'adresse du socket, c'est-à-dire
// le proxy local. Résultat, `request.ip` valait `127.0.0.1` pour TOUS les
// visiteurs externes.
//
// Ce que ça cassait, tel que constaté en base et dans Redis :
//   - honeypot_hits : 100 % de loopback depuis le 9 août, 0 attaquant identifié
//   - une SEULE clé de limitation, `nodyx:rate:127.0.0.1` : tous les visiteurs
//     partageaient le même seau, donc un seul attaquant pouvait renvoyer 429 à
//     tout le site
//   - users.registration_ip, reported_ips, authenticator_challenges : idem
//
// LA RÈGLE. Un en-tête n'est croyable que s'il vient d'un proxy à nous. On
// regarde donc le PAIR TCP réel, que rien ne peut usurper :
//
//   pair de confiance   -> on lit CF-Connecting-IP, puis request.ip (que Fastify
//                          a déjà dérivé de X-Forwarded-For contre la liste de
//                          confiance), puis X-Real-IP
//   pair quelconque     -> on ignore TOUS les en-têtes et on renvoie le pair
//
// Sans la seconde branche, n'importe qui joignant le cœur en direct s'attribuerait
// l'adresse de son choix et contournerait limitation, bannissements et pot de
// miel. C'est exactement la faille refermée en #494, à ne pas rouvrir.
//
// GARDE-FOU SUPPLÉMENTAIRE : une adresse privée ou loopback lue dans un en-tête
// est refusée. Elle ne peut pas désigner un visiteur d'Internet, et on a observé
// dans les données une adresse Cloudflare (`2a06:98c0:3600::103`) remontée comme
// si c'était un client.

import ipaddr from 'ipaddr.js'
import type { FastifyRequest } from 'fastify'

/** Plages Cloudflare — même source que `config/trustedProxies.ts`. */
const CLOUDFLARE_CIDRS = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
].map((c) => ipaddr.parseCIDR(c))

/** Ce que `ipaddr.range()` renvoie pour une adresse qui n'est pas d'Internet. */
const PLAGES_NON_PUBLIQUES = new Set([
  'unspecified', 'broadcast', 'loopback', 'linkLocal', 'carrierGradeNat',
  'private', 'reserved', 'uniqueLocal', 'ipv4Mapped', 'rfc6145', 'rfc6052',
  '6to4', 'teredo',
])

function parse(valeur: string): ipaddr.IPv4 | ipaddr.IPv6 | null {
  const v = valeur.trim()
  if (!v) return null
  try {
    const adr = ipaddr.parse(v)
    // `::ffff:1.2.3.4` doit être jugé sur sa partie IPv4, pas sur l'enveloppe.
    if (adr.kind() === 'ipv6' && (adr as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (adr as ipaddr.IPv6).toIPv4Address()
    }
    return adr
  } catch {
    return null
  }
}

/** Une adresse d'Internet : ni privée, ni loopback, ni réservée. */
function estPubliquementRoutable(valeur: string): boolean {
  const adr = parse(valeur)
  if (!adr) return false
  if (PLAGES_NON_PUBLIQUES.has(adr.range())) return false
  // Un edge Cloudflare n'est pas un visiteur : c'est notre propre infrastructure.
  return !estCloudflare(adr)
}

function estCloudflare(adr: ipaddr.IPv4 | ipaddr.IPv6): boolean {
  for (const cidr of CLOUDFLARE_CIDRS) {
    // `match` lève si les familles diffèrent : on compare à famille égale.
    if (cidr[0].kind() === adr.kind() && adr.match(cidr as never)) return true
  }
  return false
}

/**
 * Le pair TCP est-il un proxy à nous ? Seul lui a le droit de nous dire qui est
 * le visiteur. Rien dans une requête ne permet de falsifier cette valeur.
 */
export function pairDeConfiance(pair: string | undefined): boolean {
  const adr = parse(pair ?? '')
  if (!adr) return false
  const plage = adr.range()
  if (plage === 'loopback' || plage === 'private' || plage === 'uniqueLocal' || plage === 'linkLocal') {
    return true
  }
  return estCloudflare(adr)
}

/**
 * L'adresse du visiteur, ou l'adresse du pair quand rien de crédible n'est
 * disponible. Ne renvoie jamais de chaîne vide : les appelants s'en servent
 * comme clé de limitation et comme colonne en base.
 */
export function getClientIp(request: FastifyRequest): string {
  const pair = request.socket?.remoteAddress ?? ''

  if (pairDeConfiance(pair)) {
    const entete = (n: string): string | undefined => {
      const v = request.headers[n]
      const brut = Array.isArray(v) ? v[0] : v
      // X-Forwarded-For peut porter plusieurs adresses : la première est le
      // visiteur, les suivantes sont les proxys traversés.
      return brut?.split(',')[0]?.trim()
    }

    // 1. Le tunnel Cloudflare : la seule source fiable sur ce chemin.
    const cf = entete('cf-connecting-ip')
    if (cf && estPubliquementRoutable(cf)) return cf

    // 2. Fastify a déjà remonté X-Forwarded-For contre la liste de confiance
    //    (`config/trustedProxies.ts`) : on ne refait pas ce travail.
    if (request.ip && estPubliquementRoutable(request.ip)) return request.ip

    // 3. Dernier recours, posé par certains proxys en frontal.
    const reel = entete('x-real-ip')
    if (reel && estPubliquementRoutable(reel)) return reel
  }

  // Pair inconnu, ou aucun en-tête crédible : on ne croit que le socket. C'est
  // aussi le cas normal des appels internes du rendu serveur, en loopback.
  return request.ip || pair || '0.0.0.0'
}
