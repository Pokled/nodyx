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
    // Horodatage ISO plutot que l'epoque en millisecondes de pino : GoAccess
    // sait lire une date ISO, pas un entier en millisecondes. Et une ligne de
    // journal lue par un humain gagne a etre datee lisiblement.
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
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

/**
 * Le crochet de fin de requête : UNE ligne par requête, complète.
 *
 * POURQUOI. Fastify en journalise deux : « incoming request » porte l'adresse et
 * l'URL, « request completed » porte le code de statut. Aucune des deux n'est
 * exploitable seule :
 *
 *   - GoAccess a besoin d'adresse + URL + statut sur la MEME ligne ;
 *   - les scénarios HTTP de CrowdSec s'appuient sur les taux de 404, absents de
 *     la ligne qui porte l'URL ;
 *   - et le volume double pour rien (17 Mo de journal en une journée).
 *
 * On désactive donc la journalisation automatique (`disableRequestLogging`) et on
 * émet une ligne unique à la réponse. Volume divisé par deux, et les deux outils
 * deviennent utilisables.
 *
 * MÊMES INTERDITS QUE PLUS HAUT : ni corps, ni cookie, ni autorisation. Un
 * journal d'accès qui aspire les corps devient la fuite qu'il prétend prévenir.
 */
export function journaliserAcces(request: FastifyRequest, reply: FastifyReply, tempsMs: number): void {
  const h = request.headers
  const usurpation = ENTETES_USURPATION.filter((n) => h[n] !== undefined)
  // `ts` : horodatage compact DEDIE a GoAccess, qui refuse les millisecondes et
  // le `Z` de l'ISO (`%x` ne les analyse pas). On garde donc `time` en ISO
  // complet pour les humains et la correlation fine — deux evenements dans la
  // meme seconde restent distinguables — et on ajoute ce champ pour l'outil.
  const d = new Date()
  const p2 = (n: number) => String(n).padStart(2, '0')
  // Deux champs separes : GoAccess veut `%d` pour la date et `%t` pour l'heure.
  // Son `%x` combine exige que les deux formats correspondent au meme jeton, ce
  // qui ne fonctionne pas avec un horodatage ISO.
  const log_date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
  const log_time = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`

  request.log.info(
    {
      log_date,
      log_time,
      // `ip` est l'adresse RÉELLE du visiteur ; `peer` le proxy local. Deux
      // champs distincts : les fusionner, c'est perdre la détection d'usurpation.
      ip: getClientIp(request),
      peer: request.socket?.remoteAddress,
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      duree: Math.round(tempsMs * 100) / 100,
      ua: typeof h['user-agent'] === 'string' ? h['user-agent'].slice(0, 300) : undefined,
      referer: typeof h.referer === 'string' ? h.referer.slice(0, 300) : undefined,
      host: typeof h.host === 'string' ? h.host : undefined,
      // Présence conjointe = empreinte d'outillage (1369 tentatives mesurées).
      usurpation: usurpation.length ? usurpation.join(',') : undefined,
    },
    'access',
  )
}
