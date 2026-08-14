// Le protocole hôte <-> frame.
//
// C'est le contrat réel : le SDK n'est qu'une commodité posée dessus. Il est
// versionné par `p`, indépendamment de `api` du manifeste, parce que les deux
// évoluent pour des raisons différentes.
//
// Toute enveloppe entrante est validée ici avant d'atteindre quoi que ce soit
// d'autre. Le message vient d'une frame qui exécute du code tiers : c'est une
// entrée hostile par défaut, au même titre qu'un corps de requête HTTP.
// cf SPECS/NODYX_SDK_CDC.md §4.6

import { PROTOCOL_VERSION } from './limits'

export const REQUEST_TYPES = [
  'session.renew',
  'storage.get', 'storage.set', 'storage.delete', 'storage.list',
  'net.fetch',
  'core.get',
  'ui.toast', 'ui.confirm', 'ui.modal',
  'router.push', 'router.replace',
  'host.navigate', 'host.external',
  'surface.resize',
] as const

export type RequestType = typeof REQUEST_TYPES[number]

export const EVENT_TYPES = ['theme', 'locale', 'config', 'route', 'visible', 'session'] as const
export type EventType = typeof EVENT_TYPES[number]

export interface ProtocolRequest {
  p:        number
  id:       string
  ext:      string
  surface:  string
  type:     RequestType
  payload?: unknown
}

export type ProtocolResponse =
  | { p: number; id: string; ok: true;  result: unknown }
  | { p: number; id: string; ok: false; error: { code: string; message: string } }

export interface ProtocolEvent {
  p:        number
  event:    EventType
  payload?: unknown
}

const RE_ID      = /^[A-Za-z0-9_-]{1,64}$/
const RE_EXT     = /^[a-z][a-z0-9-]{2,38}$/
const RE_SURFACE = /^(page|widget:[a-z][a-z0-9-]{0,30})$/

export type ParseResult =
  | { ok: true;  request: ProtocolRequest }
  | { ok: false; code: string; message: string }

/**
 * Valide une enveloppe reçue de la frame.
 *
 * `expected` verrouille l'extension et la surface : une frame ne parle que
 * pour elle même. Sans ce contrôle, une extension pourrait se présenter sous
 * l'identité d'une autre dans ses propres messages, et le pont ferait foi.
 */
export function parseRequest(raw: unknown, expected: { ext: string; surface: string }): ParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'PROTOCOL_MALFORMED', message: 'enveloppe absente ou non objet' }
  }
  const m = raw as Record<string, unknown>

  if (m.p !== PROTOCOL_VERSION) {
    return { ok: false, code: 'PROTOCOL_VERSION', message: `protocole ${String(m.p)} non supporté, cette instance parle ${PROTOCOL_VERSION}` }
  }
  if (typeof m.id !== 'string' || !RE_ID.test(m.id)) {
    return { ok: false, code: 'PROTOCOL_MALFORMED', message: 'identifiant de requête absent ou invalide' }
  }
  if (typeof m.type !== 'string' || !(REQUEST_TYPES as readonly string[]).includes(m.type)) {
    return { ok: false, code: 'PROTOCOL_UNKNOWN_TYPE', message: `type de requête inconnu : ${String(m.type)}` }
  }
  if (typeof m.ext !== 'string' || !RE_EXT.test(m.ext) || m.ext !== expected.ext) {
    return { ok: false, code: 'PROTOCOL_WRONG_EXTENSION', message: 'cette frame ne parle pas pour cette extension' }
  }
  if (typeof m.surface !== 'string' || !RE_SURFACE.test(m.surface) || m.surface !== expected.surface) {
    return { ok: false, code: 'PROTOCOL_WRONG_SURFACE', message: 'cette frame ne parle pas pour cette surface' }
  }

  return { ok: true, request: { p: m.p, id: m.id, ext: m.ext, surface: m.surface, type: m.type as RequestType, payload: m.payload } }
}

export function ok(id: string, result: unknown): ProtocolResponse {
  return { p: PROTOCOL_VERSION, id, ok: true, result }
}

export function err(id: string, code: string, message: string): ProtocolResponse {
  return { p: PROTOCOL_VERSION, id, ok: false, error: { code, message } }
}

export function event(name: EventType, payload?: unknown): ProtocolEvent {
  return { p: PROTOCOL_VERSION, event: name, payload }
}

/**
 * Suit les identifiants déjà consommés, pour refuser un rejeu.
 *
 * Borné : une frame malveillante qui envoie des millions d'identifiants ne
 * doit pas faire grossir la mémoire de l'hôte indéfiniment. Au delà du
 * plafond, les plus anciens sortent, ce qui est sans danger puisqu'un rejeu
 * tardif d'une requête déjà répondue n'a pas d'intérêt.
 */
export class RequestLedger {
  private readonly seen = new Set<string>()
  constructor(private readonly max = 512) {}

  /** Vrai si l'identifiant est neuf, faux si c'est un rejeu. */
  accept(id: string): boolean {
    if (this.seen.has(id)) return false
    this.seen.add(id)
    if (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value as string
      this.seen.delete(oldest)
    }
    return true
  }
}
