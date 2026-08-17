// ─── Ce que le cœur écrit dans ses journaux ──────────────────────────────────
//
// LE PROBLÈME (mesuré le 2026-08-17, APRÈS le correctif #587). L'application
// connaissait enfin la vraie adresse du visiteur, mais elle ne la journalisait
// toujours pas :
//
//     {"req":{"method":"GET","url":"/api/v1/...","remoteAddress":"127.0.0.1"}}
//
// Le sérialiseur par défaut de Fastify écrit `req.raw.socket.remoteAddress`,
// c'est-à-dire le PROXY, jamais `request.ip`. Derrière Cloudflare, cette valeur
// vaut toujours `127.0.0.1`.
//
// POURQUOI ÇA COMPTE AU-DELÀ DU CONFORT. Ces journaux sont la source prévue pour
// la détection comportementale (CrowdSec). Branchés dessus en l'état, ils
// n'auraient permis de bannir personne : tout le trafic hostile serait apparu
// comme venant de la machine elle-même. Le défaut se serait manifesté par « rien
// ne se déclenche jamais », c'est-à-dire par un silence, la panne la plus longue
// à diagnostiquer.
//
// Corollaire utile : une fois ces journaux corrects, il devient inutile
// d'activer la journalisation d'accès de Caddy — donc inutile de toucher à sa
// configuration vivante, dont le CLAUDE.md rappelle qu'un rechargement fait
// tomber le HTTPS de nodyx.org.
//
// CE QU'ON NE JOURNALISE PAS. Ni corps de requête, ni cookies, ni en-tête
// d'autorisation. Un journal de sécurité qui aspire les corps devient lui-même
// une fuite de données : mots de passe en clair sur /auth/login, contenu de
// messages privés, jetons. La règle est de journaliser ce qui sert à défendre le
// service, pas ce que l'utilisateur écrit.

import type { FastifyRequest, FastifyReply, FastifyServerOptions } from 'fastify'
import { getClientIp } from '../utils/clientIp'

/** Les en-têtes qu'on conserve : utiles au diagnostic, sans contenu sensible. */
const ENTETES_UTILES = ['user-agent', 'referer', 'origin', 'content-type'] as const

/**
 * Les en-têtes d'usurpation d'adresse, conservés parce qu'ils sont un SIGNAL.
 *
 * Mesure du 17/08 : 14 adresses envoient systématiquement ces sept en-têtes
 * ensemble, tous annonçant `127.0.0.1`, soit 1369 tentatives d'usurper l'adresse
 * de bouclage. Leur présence conjointe est une empreinte d'outillage plus stable
 * que l'adresse elle-même — la faute de frappe de `x-forwared` comprise.
 */
const ENTETES_USURPATION = [
  'x-originating-ip', 'x-client-ip', 'true-client-ip', 'x-forwared',
  'x-azure-clientip', 'x-azure-socketip', 'x-host', 'x-real-ip',
] as const

function entetesRetenus(request: FastifyRequest): Record<string, string> {
  const out: Record<string, string> = {}
  for (const n of ENTETES_UTILES) {
    const v = request.headers[n]
    if (typeof v === 'string') out[n] = v.slice(0, 300)
  }
  const usurpation = ENTETES_USURPATION.filter((n) => request.headers[n] !== undefined)
  if (usurpation.length) out['_usurpation'] = usurpation.join(',')
  return out
}

/**
 * Options de journalisation à passer à `Fastify({ logger })`.
 *
 * `ip` est l'adresse RÉELLE du visiteur, résolue par `getClientIp` : en-tête cru
 * seulement si le pair TCP est un proxy de confiance. `peer` reste l'adresse de
 * la socket, gardée séparément — vérité réseau et vérité applicative sont deux
 * colonnes, jamais fusionnées.
 */
export function buildLoggerOptions(): FastifyServerOptions['logger'] {
  return {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      // Ceinture et bretelles : même si un sérialiseur changeait, ces chemins
      // ne sortiraient pas.
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body',
        'res.headers["set-cookie"]',
      ],
      remove: true,
    },
    serializers: {
      req(brut: unknown) {
        const request = brut as FastifyRequest
        return {
          method: request.method,
          url: request.url,
          host: request.headers.host,
          // L'ADRESSE DU VISITEUR. Ne jamais remplacer par
          // `request.raw.socket.remoteAddress` : c'est le défaut d'origine.
          ip: getClientIp(request),
          // La vérité paquet, conservée à part.
          peer: request.socket?.remoteAddress,
          headers: entetesRetenus(request),
        }
      },
      res(brut: unknown) {
        const reply = brut as FastifyReply
        return { statusCode: reply.statusCode }
      },
    },
  }
}
