// Exécution d'un appel sortant d'extension.
//
// La partie délicate est l'épinglage : entre le moment où l'on juge une adresse
// et celui où l'on s'y connecte, un serveur DNS hostile peut changer d'avis.
// C'est le rebinding, et la parade est de faire les deux dans le même geste :
// on fournit à la pile réseau notre propre fonction de résolution, qui valide
// l'adresse et la rend. La connexion part donc vers l'adresse jugée, jamais
// vers une seconde résolution.
//
// Écrit sur `node:http`/`node:https` plutôt que sur `fetch` : la bibliothèque
// standard accepte une fonction `lookup`, ce que `fetch` n'expose pas.
//
// cf SPECS/NODYX_SDK_SECURITY.md §4.4

import http from 'node:http'
import https from 'node:https'
import { lookup as dnsLookup, type LookupOptions } from 'node:dns'
import type { LookupFunction } from 'node:net'
import { NETWORK } from './limits'
import {
  checkTarget, addressAllowed, filterRequestHeaders, filterResponseHeaders,
  applySecret, declaredTooLarge, type GrantedNetwork, type NetError, type SecretRecipe,
} from './net'

export interface ProxyRequest {
  url:     unknown
  method?: unknown
  headers?: unknown
  body?:   unknown
}

export interface ProxyContext {
  granted: GrantedNetwork
  /** Hôtes pour lesquels l'admin a explicitement accepté le réseau privé. */
  allowPrivate: Set<string>
  /** Secrets de l'instance, jamais transmis à l'extension. */
  secrets: Record<string, string>
  recipes?: Record<string, SecretRecipe>
}

export interface ProxyResponse {
  status:  number
  headers: Record<string, string>
  body:    string
}

export type ProxyResult =
  | { ok: true;  response: ProxyResponse }
  | { ok: false; code: NetError; message: string }

const fail = (code: NetError, message: string): ProxyResult => ({ ok: false, code, message })

/**
 * Résolution gardée, passée à la pile réseau.
 *
 * Elle refuse en rendant une erreur, donc la connexion n'est jamais tentée.
 */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return function lookup(
    hostname: string,
    _options: LookupOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
  ) {
    dnsLookup(hostname, { all: false }, (err, address, family) => {
      if (err) return callback(err, '', 0)
      const verdict = addressAllowed(address, allowPrivate)
      if (!verdict.ok) {
        const e = new Error(verdict.message) as NodeJS.ErrnoException
        e.code = 'EPRIVATEADDR'
        return callback(e, '', 0)
      }
      callback(null, address, family)
    })
  }
}

export interface RawResponse {
  status:  number
  headers: Record<string, string | string[] | undefined>
  body:    string
}

/** L'en-tete de redirection, lu a UN SEUL endroit. */
function locationOf(raw: RawResponse): string | null {
  const v = raw.headers.location
  const s = Array.isArray(v) ? v[0] : v
  return typeof s === 'string' && s ? s : null
}

/**
 * Le transport, isole pour etre remplacable EN TEST.
 *
 * La couture est ici, et pas sur le garde d'adresse : remplacer le garde
 * reviendrait a tester un systeme qui n'est pas celui qu'on livre. En
 * remplacant le transport, on eprouve toute l'orchestration (revalidation des
 * redirections, plafond de sauts, injection du secret par saut, traduction des
 * erreurs) pendant que le garde reste exactement celui de production.
 *
 * Ce qui reste non couvert par un test portable : la traversee d'une vraie
 * socket. C'est assume et ecrit, plutot que simule par un faux garde. La
 * machine n'a que la boucle locale et une adresse publique, et la boucle locale
 * est refusee en toute circonstance : c'est precisement la garantie voulue.
 */
export type Transport = (
  url: URL, method: string, headers: Record<string, string>, body: string | null, allowPrivate: boolean,
) => Promise<RawResponse>

export const once: Transport = function once(url, method, headers, body, allowPrivate) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http
    const req = mod.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port:     url.port || (url.protocol === 'https:' ? 443 : 80),
        path:     url.pathname + url.search,
        method,
        headers:  { ...headers, host: url.host },
        // L'epinglage vit ici : la pile appelle NOTRE resolution.
        lookup:   guardedLookup(allowPrivate),
        servername: url.hostname,          // SNI correct malgre la resolution custom
        timeout:  NETWORK.timeoutMs,
      },
      (res) => {
        if (declaredTooLarge(String(res.headers['content-length'] ?? ''))) {
          res.destroy()
          return reject(Object.assign(new Error('réponse trop grosse'), { code: 'ERESPTOOBIG' }))
        }

        // On coupe DES QU'ON DEPASSE, sans attendre la fin : une réponse sans
        // taille annoncée pourrait couler indéfiniment.
        let size = 0
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > NETWORK.maxResponseBytes) {
            res.destroy()
            return reject(Object.assign(new Error('réponse trop grosse'), { code: 'ERESPTOOBIG' }))
          }
          chunks.push(c)
        })
        res.on('end', () => resolve({
          status:  res.statusCode ?? 0,
          headers: res.headers,
          body:    Buffer.concat(chunks).toString('utf8'),
        }))
        res.on('error', reject)
      },
    )

    req.on('timeout', () => { req.destroy(Object.assign(new Error('délai dépassé'), { code: 'ETIMEDOUT' })) })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

/**
 * Appelle un service tiers au nom d'une extension.
 *
 * Chaque redirection est REVALIDEE intégralement, hôte, méthode, chemin et
 * adresse comprises : une redirection est une nouvelle cible, pas la suite de
 * la précédente. C'est le contournement le plus simple d'une liste blanche.
 */
export async function proxyFetch(input: ProxyRequest, ctx: ProxyContext, transport: Transport = once): Promise<ProxyResult> {
  let target = checkTarget(input.url, input.method, ctx.granted)
  if (!target.ok) return target

  const headers = filterRequestHeaders(input.headers)
  const body = typeof input.body === 'string' ? input.body : null
  if (body && body.length > 64 * 1024) return fail('INVALID_ARGUMENT', 'corps de requête trop gros')

  let hops = 0
  for (;;) {
    const { url, host, rule, method } = target.value

    // Le secret est injecte a CHAQUE saut valide, et seulement pour l'hote qui
    // l'a declare : une redirection vers un autre hote ne l'emporte pas.
    const call = new URL(url.toString())
    const callHeaders = { ...headers }
    applySecret(call, callHeaders, rule.secret ? ctx.secrets[rule.secret] : undefined, ctx.recipes?.[host])

    let raw: RawResponse
    try {
      raw = await transport(call, method, callHeaders, body, ctx.allowPrivate.has(host))
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (code === 'EPRIVATEADDR')  return fail('PRIVATE_ADDRESS', (e as Error).message)
      if (code === 'ERESPTOOBIG')   return fail('RESPONSE_TOO_LARGE', `réponse au delà de ${NETWORK.maxResponseBytes / 1024 / 1024} Mo`)
      if (code === 'ETIMEDOUT')     return fail('UPSTREAM_TIMEOUT', 'le service distant n\'a pas répondu à temps')
      return fail('UPSTREAM_ERROR', 'le service distant est injoignable')
    }

    // Un seul endroit decide qu'il y a redirection : dupliquer l'information
    // dans le transport aurait laisse un champ que tout transport doit penser
    // a remplir, donc un oubli silencieux.
    const location = raw.status >= 300 && raw.status < 400 ? locationOf(raw) : null
    if (!location) {
      return {
        ok: true,
        response: {
          status:  raw.status,
          headers: filterResponseHeaders(Object.entries(raw.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v ?? '')])),
          body:    raw.body,
        },
      }
    }

    if (++hops > NETWORK.maxRedirects) return fail('TOO_MANY_REDIRECTS', `plus de ${NETWORK.maxRedirects} redirections`)

    const next = new URL(location, call).toString()
    target = checkTarget(next, method, ctx.granted)
    if (!target.ok) {
      return fail(target.code, `redirection refusée : ${target.message}`)
    }
  }
}
