/**
 * NODYX — Client SFU expérimental (P1 lot 2c, CDC SFU §17)
 *
 * Pilote une session vocale via le SFU (mediasoup) : Device → transports
 * send/recv → produce(micro) → consume des flux publiés.
 *
 * DOCTRINE (parano assumée) :
 * - Ce module N'IMPORTE RIEN de voice.ts (mesh) et ne touche à aucun de ses
 *   stores : les deux mondes sont étanches. Utilisé UNIQUEMENT par la page
 *   labo /admin/sfu-lab tant que le chemin n'est pas prouvé de bout en bout.
 * - SSR-safe : mediasoup-client est importé dynamiquement, jamais au top-level.
 * - Chaque ack a un TIMEOUT (l'UI ne peut pas rester suspendue), chaque étape
 *   est journalisée (store sfuLogStore, la console du labo), chaque échec mène
 *   à l'état 'error' avec nettoyage complet.
 * - Double join impossible, leave/cleanup idempotents.
 */

import { get, writable, type Writable } from 'svelte/store'
import { socket as socketStore } from '$lib/socket'
import type { Socket } from 'socket.io-client'

// ── Types & état observable ───────────────────────────────────────────────────

export type SfuPhase =
  | 'idle'        // rien en cours
  | 'joining'     // voice:sfu_join envoyé
  | 'mesh'        // le salon est en mesh : SFU pas (encore) actif côté daemon
  | 'connecting'  // device + transports en cours d'établissement
  | 'active'      // micro publié, consommation en cours
  | 'error'       // échec (raison dans sfuErrorStore), tout est nettoyé

export interface SfuConsumerInfo {
  consumerId: string
  producerId: string
  userId:     string
  kind:       string
}

export const sfuPhaseStore:     Writable<SfuPhase>          = writable('idle')
export const sfuErrorStore:     Writable<string | null>     = writable(null)
export const sfuLogStore:       Writable<string[]>          = writable([])
export const sfuConsumersStore: Writable<SfuConsumerInfo[]> = writable([])
export const sfuMutedStore:     Writable<boolean>           = writable(false)

function log(msg: string): void {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`
  sfuLogStore.update(l => [...l.slice(-199), line])
}

// ── Session (une seule à la fois, par construction) ───────────────────────────

interface Session {
  channelId:     string
  device:        import('mediasoup-client').types.Device
  sendTransport: import('mediasoup-client').types.Transport
  recvTransport: import('mediasoup-client').types.Transport
  micTrack:      MediaStreamTrack | null
  producer:      import('mediasoup-client').types.Producer | null
  consumers:     Map<string, import('mediasoup-client').types.Consumer>
  audioEls:      Map<string, HTMLAudioElement>
  offNewProducer: (() => void) | null
}

let _session: Session | null = null

// ── Ack avec timeout : l'UI ne reste JAMAIS suspendue ─────────────────────────

const ACK_TIMEOUT_MS = 8_000

type AckResponse = { ok: boolean; error?: string; [k: string]: unknown }

function emitAck(sock: Socket, event: string, payload: unknown): Promise<AckResponse> {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, error: `${event}: timeout (${ACK_TIMEOUT_MS} ms)` }),
      ACK_TIMEOUT_MS,
    )
    try {
      sock.emit(event, payload, (resp: AckResponse) => {
        clearTimeout(timer)
        resolve(resp && typeof resp === 'object' ? resp : { ok: false, error: `${event}: réponse invalide` })
      })
    } catch (e) {
      clearTimeout(timer)
      resolve({ ok: false, error: `${event}: ${(e as Error).message}` })
    }
  })
}

/** Garde-fou : la forme minimale des params transport avant de les donner à
 *  mediasoup-client (échec précoce et lisible plutôt qu'exception interne). */
export function looksLikeTransportParams(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false
  const o = p as Record<string, unknown>
  return typeof o.id === 'string'
    && !!o.iceParameters && !!o.dtlsParameters && Array.isArray(o.iceCandidates)
}

// ── Cycle de vie ──────────────────────────────────────────────────────────────

export async function sfuJoin(channelId: string): Promise<void> {
  if (_session) { log('⚠ session déjà active, join ignoré (leave d\'abord)'); return }
  const sock = get(socketStore)
  if (!sock) { fail('socket non connecté'); return }

  sfuErrorStore.set(null)
  sfuConsumersStore.set([])
  sfuPhaseStore.set('joining')
  log(`→ voice:sfu_join ${channelId.slice(0, 8)}…`)

  const join = await emitAck(sock, 'voice:sfu_join', channelId)
  if (!join.ok) { fail(`join refusé : ${join.error}`); return }

  if (join.mode !== 'sfu') {
    sfuPhaseStore.set('mesh')
    log(`salon en mode ${String(join.mode)} : le SFU n'est pas actif pour ce salon`)
    log('(labo : mettre SFU_MESH_THRESHOLD=0 sur le daemon pour forcer le SFU)')
    return
  }
  log('✓ join accepté, mode SFU')

  if (!looksLikeTransportParams(join.sendTransportParams) || !looksLikeTransportParams(join.recvTransportParams)) {
    fail('paramètres de transport invalides (send/recv)')
    return
  }

  sfuPhaseStore.set('connecting')
  try {
    // SSR-safe + pas de coût tant que le labo n'est pas utilisé.
    const { Device } = await import('mediasoup-client')
    const device = new Device()
    await device.load({ routerRtpCapabilities: join.caps as never })
    log(`✓ device chargé (${device.rtpCapabilities.codecs?.length ?? 0} codecs)`)

    const wireTransport = (
      transport: import('mediasoup-client').types.Transport,
      direction: 'send' | 'recv',
    ) => {
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        log(`→ connect ${direction} (DTLS)`)
        emitAck(sock, 'voice:sfu_connect', { channelId, direction, dtlsParameters })
          .then(r => r.ok ? (log(`✓ ${direction} connecté`), callback()) : errback(new Error(String(r.error))))
      })
      transport.on('connectionstatechange', (state) => {
        log(`transport ${direction} : ${state}`)
        if (state === 'failed') fail(`transport ${direction} en échec ICE/DTLS`)
      })
    }

    const sendTransport = device.createSendTransport(join.sendTransportParams as never)
    wireTransport(sendTransport, 'send')
    sendTransport.on('produce', ({ kind, rtpParameters }, callback, errback) => {
      if (kind !== 'audio') { errback(new Error('labo : audio uniquement')); return }
      log('→ produce audio (rtpParameters au SFU)')
      emitAck(sock, 'voice:sfu_produce', { channelId, kind: 'audio', rtpParameters })
        .then(r => r.ok
          ? (log(`✓ producer ${String(r.producerId).slice(0, 8)}…`), callback({ id: String(r.producerId) }))
          : errback(new Error(String(r.error))))
    })

    const recvTransport = device.createRecvTransport(join.recvTransportParams as never)
    wireTransport(recvTransport, 'recv')

    _session = {
      channelId, device, sendTransport, recvTransport,
      micTrack: null, producer: null,
      consumers: new Map(), audioEls: new Map(), offNewProducer: null,
    }

    // Micro (le clic "Rejoindre" du labo = geste utilisateur → autoplay OK).
    log('→ getUserMedia (micro)')
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    const micTrack = mic.getAudioTracks()[0]
    if (!micTrack) { fail('aucune piste micro'); return }
    _session.micTrack = micTrack
    _session.producer = await sendTransport.produce({ track: micTrack })
    log('✓ micro publié')

    // Flux déjà présents + flux futurs.
    const pubs = await emitAck(sock, 'voice:sfu_publications', channelId)
    if (pubs.ok && Array.isArray(pubs.publications)) {
      log(`${pubs.publications.length} publication(s) existante(s)`)
      for (const pub of pubs.publications as { producer: string; owner: string; kind: string }[]) {
        if (_session.producer && pub.producer === _session.producer.id) continue // pas soi-même
        await consumeOne(sock, pub.producer, pub.owner, pub.kind)
      }
    }
    const onNewProducer = (data: { channelId: string; producerId: string; kind: string; userId: string }) => {
      if (!_session || data.channelId !== _session.channelId) return
      log(`nouveau flux annoncé par ${data.userId}`)
      void consumeOne(sock, data.producerId, data.userId, data.kind)
    }
    sock.on('voice:sfu_new_producer', onNewProducer)
    _session.offNewProducer = () => { sock.off('voice:sfu_new_producer', onNewProducer) }

    sfuPhaseStore.set('active')
    log('══ SESSION SFU ACTIVE ══')
  } catch (e) {
    fail(`établissement : ${(e as Error).message}`)
  }
}

async function consumeOne(sock: Socket, producerId: string, userId: string, kind: string): Promise<void> {
  const s = _session
  if (!s) return
  if (s.consumers.has(producerId)) return // déjà consommé (annonce + liste peuvent se croiser)
  try {
    const r = await emitAck(sock, 'voice:sfu_consume', {
      channelId: s.channelId, producerId, rtpCapabilities: s.device.rtpCapabilities,
    })
    if (!r.ok) { log(`✘ consume ${producerId.slice(0, 8)}… : ${r.error}`); return }
    const params = r.params as { id: string; producerId: string; kind: 'audio' | 'video'; rtpParameters: never }
    const consumer = await s.recvTransport.consume({
      id: params.id, producerId: params.producerId, kind: params.kind, rtpParameters: params.rtpParameters,
    })
    s.consumers.set(producerId, consumer)

    // Lecture : un <audio> par flux, détaché du DOM (labo audio-only).
    const el = new Audio()
    el.srcObject = new MediaStream([consumer.track])
    el.autoplay = true
    s.audioEls.set(producerId, el)
    void el.play().catch(err => log(`⚠ autoplay : ${err.message}`))

    sfuConsumersStore.update(list => [...list, { consumerId: consumer.id, producerId, userId, kind }])
    log(`✓ flux de ${userId} en lecture`)
  } catch (e) {
    log(`✘ consume : ${(e as Error).message}`)
  }
}

export function sfuSetMuted(muted: boolean): void {
  if (_session?.micTrack) {
    _session.micTrack.enabled = !muted
    sfuMutedStore.set(muted)
    log(muted ? 'micro coupé' : 'micro ouvert')
  }
}

export async function sfuLeave(): Promise<void> {
  const s = _session
  if (!s) { sfuPhaseStore.set('idle'); return }
  log('→ leave + nettoyage complet')
  const sock = get(socketStore)
  cleanup()
  if (sock) await emitAck(sock, 'voice:sfu_leave', s.channelId)
  sfuPhaseStore.set('idle')
  log('✓ session fermée')
}

function fail(reason: string): void {
  log(`✘ ${reason}`)
  sfuErrorStore.set(reason)
  cleanup()
  sfuPhaseStore.set('error')
}

/** Idempotent : détruit TOUT ce que la session a créé, dans l'ordre inverse. */
function cleanup(): void {
  const s = _session
  _session = null
  if (!s) return
  try { s.offNewProducer?.() } catch { /* déjà off */ }
  for (const el of s.audioEls.values()) {
    try { el.pause(); el.srcObject = null } catch { /* déjà mort */ }
  }
  for (const c of s.consumers.values()) {
    try { c.close() } catch { /* déjà fermé */ }
  }
  try { s.producer?.close() } catch { /* déjà fermé */ }
  try { s.micTrack?.stop() } catch { /* déjà stoppé */ }
  try { s.sendTransport.close() } catch { /* déjà fermé */ }
  try { s.recvTransport.close() } catch { /* déjà fermé */ }
  sfuConsumersStore.set([])
  sfuMutedStore.set(false)
}
