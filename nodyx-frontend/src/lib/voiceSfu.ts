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
  | 'recovering'  // réseau perdu : auto-reconnexion en cours
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

/** Un écran/cam distant reçu via le SFU (rendu par un <video> côté UI). */
export interface SfuScreen { producerId: string; userId: string; stream: MediaStream }
/** Écrans distants reçus (screenshare P2). Le mapping userId → socketId (roster)
 *  pour l'UI mesh se fait côté voice.ts, comme pour les stats de la bascule. */
export const sfuScreensStore:     Writable<SfuScreen[]>        = writable([])
/** MON écran en cours de partage (aperçu local), null si je ne partage pas. */
export const sfuLocalScreenStore: Writable<MediaStream | null> = writable(null)

export interface SfuAuditRow {
  participant: string
  direction:   string
  iceState:    string
  local:       string   // ip:port local
  remote:      string   // ip:port distant (l'IP du pair)
  proto:       string
  recvKbps:    number
  sendKbps:    number
  lossRecv:    number   // 0..1
  lossSent:    number
}
export const sfuAuditStore: Writable<SfuAuditRow[]> = writable([])

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
  screenProducer: import('mediasoup-client').types.Producer | null
  screenStream:  MediaStream | null
  /** Le SON de mon écran partagé (onglet, jeu, vidéo), s'il a été capturé. */
  screenAudioProducer: import('mediasoup-client').types.Producer | null
  /** Son d'écran reçu AVANT l'image du même partageur (l'ordre d'arrivée des deux
   *  flux n'est pas garanti) : on le garde ici et on l'attache dès que l'image
   *  arrive, sinon il serait perdu. */
  pendingScreenAudio: Map<string, MediaStreamTrack>
  consumers:     Map<string, import('mediasoup-client').types.Consumer>
  audioEls:      Map<string, HTMLAudioElement>
  offNewProducer: (() => void) | null
  maintain:      ReturnType<typeof setInterval> | null
  onVisibility:  (() => void) | null
}

let _session: Session | null = null

/** Salon inscrit côté daemon (survit à l'échec de session : le leave doit
 *  TOUJOURS pouvoir partir, sinon fantôme jusqu'au disconnect du socket). */
let _joinedChannel: string | null = null
/** Tentatives d'auto-reconnexion consécutives (remis à 0 quand la session
 *  redevient active). Au-delà de MAX_RECOVER, on abandonne vraiment. */
let _recoverAttempts = 0
const MAX_RECOVER = 4

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

// ── Survie en veille mobile (le verrouillage écran suspend l'onglet) ─────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _wakeLock: any = null

async function acquireWakeLock(): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any
    if (nav.wakeLock && typeof document !== 'undefined' && document.visibilityState === 'visible') {
      _wakeLock = await nav.wakeLock.request('screen')
    }
  } catch { /* non supporté / refusé : tant pis, pas bloquant */ }
}
function releaseWakeLock(): void {
  try { _wakeLock?.release?.() } catch { /* déjà libéré */ }
  _wakeLock = null
}
function setMediaSession(active: boolean): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ms = (navigator as any).mediaSession
    if (!ms) return
    if (active) {
      ms.metadata = new MediaMetadata({ title: 'Session vocale', artist: 'Nodyx SFU' })
      ms.playbackState = 'playing'
    } else {
      ms.playbackState = 'none'
    }
  } catch { /* pas supporté */ }
}

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
  _joinedChannel = channelId

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
        // 'failed' = terminal (changement de réseau, VPN…). On ne tombe PLUS en
        // erreur : on tente une reconnexion transparente (comme l'ICE restart
        // du mesh). 'disconnected' est souvent transitoire → on laisse vivre.
        if (state === 'failed') void maybeRecover(`transport ${direction} en échec`)
      })
    }

    const sendTransport = device.createSendTransport(join.sendTransportParams as never)
    wireTransport(sendTransport, 'send')
    sendTransport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
      // `kind` = nature média ('audio'|'video'). Le "kind SFU" distingue en plus la
      // SOURCE via appData (transmis tel quel par mediasoup-client) : le son de
      // l'écran est de l'audio, mais ce n'est pas le micro, et le spectateur doit
      // pouvoir le rattacher à l'image plutôt que le prendre pour une voix.
      const source = (appData as { source?: string } | undefined)?.source
      const sfuKind = kind === 'audio'
        ? (source === 'screenaudio' ? 'screenaudio' : 'audio')
        : (source === 'cam' ? 'cam' : 'screen')
      log(`→ produce ${sfuKind} (rtpParameters au SFU)`)
      emitAck(sock, 'voice:sfu_produce', { channelId, kind: sfuKind, rtpParameters })
        .then(r => r.ok
          ? (log(`✓ producer ${String(r.producerId).slice(0, 8)}…`), callback({ id: String(r.producerId) }))
          : errback(new Error(String(r.error))))
    })

    const recvTransport = device.createRecvTransport(join.recvTransportParams as never)
    wireTransport(recvTransport, 'recv')

    _session = {
      channelId, device, sendTransport, recvTransport,
      micTrack: null, producer: null,
      screenProducer: null, screenStream: null,
      screenAudioProducer: null, pendingScreenAudio: new Map(),
      consumers: new Map(), audioEls: new Map(), offNewProducer: null,
      maintain: null, onVisibility: null,
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
        if (isOwnProducer(_session, pub.producer)) continue // ni mon micro, ni mon écran
        await consumeOne(sock, pub.producer, pub.owner, pub.kind)
      }
    }
    const onNewProducer = (data: { channelId: string; producerId: string; kind: string; userId: string }) => {
      if (!_session || data.channelId !== _session.channelId) return
      log(`nouveau flux annoncé par ${data.userId}`)
      void consumeOne(sock, data.producerId, data.userId, data.kind)
    }
    sock.on('voice:sfu_new_producer', onNewProducer)
    // Arrêt net d'un flux (ex. le partageur stoppe son écran) : on ferme le
    // consumer et on retire l'écran tout de suite, sans attendre la réconciliation.
    const onProducerClosed = (data: { channelId: string; producerId: string; userId: string }) => {
      if (!_session || data.channelId !== _session.channelId) return
      log(`flux de ${data.userId} fermé → retrait`)
      closeConsumerFor(_session, data.producerId)
    }
    sock.on('voice:sfu_producer_closed', onProducerClosed)
    _session.offNewProducer = () => {
      sock.off('voice:sfu_new_producer', onNewProducer)
      sock.off('voice:sfu_producer_closed', onProducerClosed)
    }

    // Maintenance périodique (5 s) : heartbeat (anti-éviction) + réconciliation
    // des flux (ferme les consumers dont le producer a disparu = fantômes ;
    // rattrape aussi une annonce new_producer manquée). Auto-guérison.
    _session.maintain = setInterval(() => { void maintainTick() }, 5000)

    // Garder la session vivante quand l'écran se verrouille / l'onglet passe en
    // arrière-plan (grand classique mobile : l'onglet est suspendu → coupure).
    void acquireWakeLock()
    setMediaSession(true)
    const onVisibility = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      void acquireWakeLock() // le wake lock est relâché quand l'onglet est masqué
      void maintainTick() // reprise instantanée + détection d'éviction au retour
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility)
    _session.onVisibility = onVisibility

    _recoverAttempts = 0
    sfuPhaseStore.set('active')
    log('══ SESSION SFU ACTIVE ══')
  } catch (e) {
    fail(`établissement : ${(e as Error).message}`)
  }
}

const _consuming = new Set<string>()

// Overlap bascule (§17-B) : callback appelé quand un flux SFU COMMENCE À JOUER
// (par userId). La bascule s'en sert pour couper le mesh de cette personne au
// même instant (crossfade par personne = zéro coupure, sans son différé qui se
// ferait bloquer par la politique autoplay des navigateurs, surtout mobile).
let _onConsumerPlaying: ((userId: string) => void) | null = null
export function sfuSetConsumerPlayingCallback(cb: ((userId: string) => void) | null): void {
  _onConsumerPlaying = cb
}

// Stats SFU : compteurs de paquets précédents par flux (producerId), pour calculer
// la perte en delta entre deux relevés (même méthode que le mesh).
const _sfuPrevPackets = new Map<string, { received: number; lost: number }>()

/** Un de MES producers (micro ou écran) ? Sert à ne jamais consommer ses propres
 *  flux (les publications listent TOUT le salon, moi compris). Le broadcast
 *  new_producer exclut déjà l'émetteur, mais pas la liste des publications. */
function isOwnProducer(s: Session, producerId: string): boolean {
  return producerId === s.producer?.id
    || producerId === s.screenProducer?.id
    || producerId === s.screenAudioProducer?.id
}

/** Ferme et oublie le consumer d'un flux (audio OU écran) : par réconciliation
 *  (producer disparu) ou par arrêt net (voice:sfu_producer_closed). Idempotent. */
function closeConsumerFor(s: Session, producerId: string): void {
  const consumer = s.consumers.get(producerId)
  if (consumer) {
    // Si c'était le SON d'un écran, il vit dans le MediaStream de cette image : on
    // l'en retire, sinon la balise <video> resterait avec une piste morte.
    const track = consumer.track
    for (const sc of get(sfuScreensStore)) {
      if (sc.stream.getTracks().includes(track)) {
        try { sc.stream.removeTrack(track) } catch { /* flux déjà démonté */ }
      }
    }
    for (const [uid, t] of s.pendingScreenAudio) {
      if (t === track) s.pendingScreenAudio.delete(uid)
    }
    try { consumer.close() } catch { /* déjà fermé */ }
    s.consumers.delete(producerId)
  }
  const el = s.audioEls.get(producerId)
  if (el) { try { el.pause(); el.srcObject = null } catch { /* mort */ } s.audioEls.delete(producerId) }
  sfuConsumersStore.update(l => l.filter(c => c.producerId !== producerId))
  sfuScreensStore.update(l => l.filter(x => x.producerId !== producerId))
}

async function consumeOne(sock: Socket, producerId: string, userId: string, kind: string): Promise<void> {
  const s = _session
  if (!s) return
  // Relecture 2026-07-06 : la liste publications et l'annonce new_producer
  // peuvent se croiser → sans garde EN VOL, double consume = double audio.
  if (s.consumers.has(producerId) || _consuming.has(producerId)) return
  _consuming.add(producerId)
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

    sfuConsumersStore.update(list => [...list, { consumerId: consumer.id, producerId, userId, kind }])

    if (kind === 'screenaudio') {
      // Le SON de l'écran d'un partageur. On le met dans le MÊME MediaStream que son
      // IMAGE : il sort alors de la balise <video> avec elle, donc volume, coupure et
      // cycle de vie suivent l'image sans plomberie séparée.
      const screen = get(sfuScreensStore).find(x => x.userId === userId)
      if (screen) {
        screen.stream.addTrack(consumer.track)
        log(`✓ son de l'écran de ${userId} rattaché à son image`)
      } else {
        // L'ordre d'arrivée des deux flux n'est pas garanti : si le son précède
        // l'image, on le garde et on l'attachera quand l'image arrivera.
        s.pendingScreenAudio.set(userId, consumer.track)
        log(`son de l'écran de ${userId} reçu avant l'image : mis de côté`)
      }
    } else if (params.kind === 'video') {
      // Écran/cam : pas de <audio>. On expose le flux (rendu par un <video> UI).
      const stream = new MediaStream([consumer.track])
      // Son de l'écran arrivé en premier ? On le rattache maintenant.
      const waiting = s.pendingScreenAudio.get(userId)
      if (waiting) {
        stream.addTrack(waiting)
        s.pendingScreenAudio.delete(userId)
        log(`✓ son de l'écran de ${userId} rattaché (il attendait l'image)`)
      }
      sfuScreensStore.update(l => [...l.filter(x => x.producerId !== producerId), { producerId, userId, stream }])
      // Le consumer vidéo est servi EN PAUSE par le serveur : on ne le reprend
      // qu'ICI, une fois créé et branché. Sinon la keyframe partirait avant que le
      // décodeur n'existe → écran noir jusqu'à la suivante (le clignotement). La
      // reprise redemande une keyframe, cette fois à un décodeur prêt.
      const rs = await emitAck(sock, 'voice:sfu_resume', { channelId: s.channelId, consumerId: consumer.id })
      if (!rs.ok) log(`⚠ reprise du flux vidéo : ${rs.error}`)
      log(`✓ écran de ${userId} reçu`)
    } else {
      // Audio : un <audio> par flux, détaché du DOM.
      const el = new Audio()
      el.srcObject = new MediaStream([consumer.track])
      el.autoplay = true
      s.audioEls.set(producerId, el)
      void el.play().catch(err => log(`⚠ autoplay : ${err.message}`))
      log(`✓ flux de ${userId} en lecture`)
      // Overlap bascule : ce flux AUDIO joue → couper le mesh audio de la personne
      // au même instant (crossfade par personne, zéro coupure). Vidéo = hors-sujet.
      _onConsumerPlaying?.(userId)
    }
  } catch (e) {
    log(`✘ consume : ${(e as Error).message}`)
  } finally {
    _consuming.delete(producerId)
  }
}

/** Audit réseau du salon (owner/admin) : aplatit les WebRtcTransportStat en
 *  lignes lisibles (IP:port réelles du pair, état ICE, débit, perte). */
export async function sfuAudit(channelId: string): Promise<void> {
  const sock = get(socketStore)
  if (!sock) return
  const res = await emitAck(sock, 'voice:sfu_audit', channelId)
  if (!res.ok) { log(`✘ audit : ${res.error}`); sfuAuditStore.set([]); return }
  const rows: SfuAuditRow[] = []
  for (const t of (res.transports as Record<string, unknown>[] ?? [])) {
    const stat = (((t.stats as Record<string, unknown>)?.stats) as Record<string, unknown>[] ?? [])[0] ?? {}
    const tuple = (stat.iceSelectedTuple ?? null) as Record<string, unknown> | null
    const fmt = (ip: unknown, port: unknown) => (ip != null ? `${ip}:${port}` : '—')
    rows.push({
      participant: String(t.participant ?? '?'),
      direction:   String(t.direction ?? '?'),
      iceState:    String(stat.iceState ?? 'new'),
      local:       tuple ? fmt(tuple.localAddress, tuple.localPort) : '—',
      remote:      tuple ? fmt(tuple.remoteIp, tuple.remotePort) : '—',
      proto:       tuple ? String(tuple.protocol ?? '') : '',
      recvKbps:    Math.round(Number(stat.recvBitrate ?? 0) / 1000),
      sendKbps:    Math.round(Number(stat.sendBitrate ?? 0) / 1000),
      lossRecv:    Number(stat.rtpPacketLossReceived ?? 0),
      lossSent:    Number(stat.rtpPacketLossSent ?? 0),
    })
  }
  sfuAuditStore.set(rows)
  log(`audit : ${rows.length} transport(s)`)
}

/** Battement de maintenance : heartbeat (garde vivant) PUIS réconciliation.
 *  Si le heartbeat revient "évincé" (une autre session — autre onglet/appareil
 *  — a pris le relais, ou TTL), on s'arrête net SANS rejoindre : rejoindre
 *  volerait la session à l'autre onglet → ping-pong infini. */
async function maintainTick(): Promise<void> {
  const sk = get(socketStore)
  if (!sk || !_session) return
  const hb = await emitAck(sk, 'voice:sfu_heartbeat', _session.channelId)
  if (!_session) return // session fermée entre-temps
  if (!hb.ok) {
    // Erreurs transitoires (réseau/daemon) → on ne coupe pas, ça se rétablira.
    const transient = ['sfu_unreachable', 'sfu_disabled', 'rate_limited']
    const err = String(hb.error ?? '')
    if (!transient.includes(err) && !err.includes('timeout')) {
      supersede('session reprise ailleurs (autre onglet ou appareil)')
      return
    }
  }
  await reconcile(sk)
}

/** Une AUTRE session a pris notre place : on s'arrête proprement, sans rejoindre
 *  (contrairement à maybeRecover). Libère tout (wake lock, timers, transports). */
function supersede(reason: string): void {
  log(`⚑ ${reason}`)
  cleanup()
  _joinedChannel = null
  _recoverAttempts = 0
  sfuErrorStore.set(reason)
  sfuPhaseStore.set('error')
}

/** Réconcilie les consumers locaux avec les publications réelles du salon :
 *  ferme ceux dont le producer a disparu (fantôme), consomme les nouveaux. */
async function reconcile(sock: Socket): Promise<void> {
  const s = _session
  if (!s) return
  const pubs = await emitAck(sock, 'voice:sfu_publications', s.channelId)
  if (!pubs.ok || !Array.isArray(pubs.publications)) return
  const list = pubs.publications as { producer: string; owner: string; kind: string }[]
  const live = new Set(list.map(p => p.producer))
  // fermer les fantômes (producer disparu des publications)
  for (const [producerId] of [...s.consumers]) {
    if (!live.has(producerId)) {
      closeConsumerFor(s, producerId)
      log(`flux ${producerId.slice(0, 8)}… disparu → consumer fermé`)
    }
  }
  // consommer les nouveaux (rattrapage d'une annonce manquée)
  for (const pub of list) {
    if (isOwnProducer(s, pub.producer)) continue
    if (!s.consumers.has(pub.producer) && !_consuming.has(pub.producer)) {
      await consumeOne(sock, pub.producer, pub.owner, pub.kind)
    }
  }
}

export function sfuSetMuted(muted: boolean): void {
  if (_session?.micTrack) {
    _session.micTrack.enabled = !muted
    sfuMutedStore.set(muted)
    log(muted ? 'micro coupé' : 'micro ouvert')
  }
}

/** Contraintes de capture, alignées sur celles du mesh (l'utilisateur choisit sa
 *  surface, sa qualité et son fps : le chemin SFU doit les honorer pareil). */
export interface SfuScreenShareOptions {
  displaySurface?: string
  width?:          number
  height?:         number
  frameRate?:      number
  maxBitrate?:     number
  contentHint?:    'motion' | 'detail'
  /** Flux DÉJÀ capturé à republier tel quel (migration d'un partage mesh en cours
   *  vers l'SFU au moment de la bascule). Sans ça il faudrait rouvrir le sélecteur
   *  d'écran, ce que le navigateur refuse hors geste utilisateur : le partage
   *  mourrait à la bascule. */
  existingStream?: MediaStream
}

/** Partager son écran via le SFU (P2). getDisplayMedia → produce vidéo (VP8) sur
 *  le sendTransport existant (à côté du micro). Une seule couche en v1 (le
 *  simulcast arrive après). Retourne le flux local (aperçu) ou null si annulé.
 *  Le partage passe par le SFU : un seul upload, le serveur recopie à chacun. */
export async function sfuStartScreenShare(opts: SfuScreenShareOptions = {}): Promise<MediaStream | null> {
  const s = _session
  if (!s) { log('⚠ pas de session SFU active'); return null }
  if (s.screenProducer) { log('⚠ partage déjà en cours'); return get(sfuLocalScreenStore) }

  const fps = opts.frameRate ?? 30
  let display: MediaStream
  if (opts.existingStream) {
    // Migration d'un partage mesh en cours : on republie la piste déjà capturée.
    display = opts.existingStream
    log('→ republication de l\'écran déjà partagé (migration mesh → SFU)')
  } else {
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: opts.displaySurface,
          width:     opts.width  ? { ideal: opts.width }  : undefined,
          height:    opts.height ? { ideal: opts.height } : undefined,
          frameRate: { ideal: fps, max: fps },
          cursor:    'always',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        // On DEMANDE le son de l'écran (onglet, jeu, vidéo). Le navigateur propose
        // alors une case « partager le son » dans son sélecteur. L'utilisateur peut
        // la refuser, et certaines surfaces (une fenêtre isolée) n'en ont pas :
        // dans ce cas il n'y a simplement pas de piste audio, et le partage se fait
        // en silence comme avant. Rien ne doit dépendre de sa présence.
        audio: true,
      })
    } catch (e) {
      log(`partage annulé : ${(e as Error).message}`) // l'utilisateur a fermé le sélecteur
      return null
    }
  }

  const track = display.getVideoTracks()[0]
  if (!track) { display.getTracks().forEach(t => t.stop()); log('✘ aucune piste vidéo'); return null }

  // Aide l'encodeur : 60 fps ⇒ du mouvement (jeu) → fluidité ; sinon (slides,
  // code, bureau) → netteté du texte. Même heuristique que le mesh.
  try { track.contentHint = opts.contentHint ?? (fps >= 60 ? 'motion' : 'detail') } catch { /* non supporté */ }

  // ── SIMULCAST (CDC §6) ──────────────────────────────────────────────────────
  //
  // Le partageur émet PLUSIEURS qualités en parallèle ; le SFU sert à CHAQUE
  // spectateur celle que SON lien supporte. Avec une couche unique, c'est le plus
  // faible qui impose sa limite : il décroche, ou tout le monde descend avec lui.
  //
  // ⚠ HISTOIRE, pour ne pas re-payer : le simulcast a été retiré (PR #261) après
  // avoir mesuré qu'un spectateur ne recevait aucune vidéo. C'ÉTAIT UNE FAUSSE
  // ACCUSATION. Le vrai coupable était un client PÉRIMÉ (cache mobile) : le serveur
  // sert la vidéo EN PAUSE et attend une demande de reprise, qu'un vieux client
  // n'envoie jamais. Le flux serait resté fermé AVEC OU SANS simulcast. Le retrait
  // n'avait d'ailleurs rien réparé : seul le client frais l'a fait.
  //
  // Deux garde-fous tirés de cet épisode :
  //  1. on s'en tient STRICTEMENT à la forme recommandée par mediasoup
  //     (`scaleResolutionDownBy` + `maxBitrate`). Pas de `rid` (mediasoup-client les
  //     attribue), pas de `scalabilityMode` : `S1T3` est la notation INTERNE de
  //     mediasoup alors que le NAVIGATEUR attend la notation WebRTC (`L1T3`), et une
  //     valeur invalide casse la publication des couches ;
  //  2. si le navigateur refuse les couches, on publie en UNE couche plutôt que
  //     RIEN. Un supplément ne doit jamais coûter la fonction principale.
  //
  // Vérifiable : le daemon expose `currentLayers` par spectateur (/v1/subscriptions).
  const high = opts.maxBitrate ?? 2_500_000
  const encodings = [
    { scaleResolutionDownBy: 4, maxBitrate: Math.round(high / 8) },
    { scaleResolutionDownBy: 2, maxBitrate: Math.round(high / 3) },
    { scaleResolutionDownBy: 1, maxBitrate: high },
  ]

  try {
    s.screenStream = display
    // Démarrer l'encodeur assez haut : sinon il rampe depuis un débit minuscule et
    // l'image reste molle plusieurs secondes.
    const codecOptions = { videoGoogleStartBitrate: 1000 }
    const appData = { source: 'screen' }
    try {
      s.screenProducer = await s.sendTransport.produce({ track, appData, encodings, codecOptions })
      log(`✓ écran publié au SFU (${encodings.length} couches)`)
    } catch (e) {
      // REPLI : le navigateur refuse les couches ? On partage quand même, en une
      // seule. Perdre le simulcast est regrettable ; perdre le partage entier, non.
      log(`⚠ simulcast refusé (${(e as Error).message}) : repli sur une seule couche`)
      s.screenProducer = await s.sendTransport.produce({
        track, appData, encodings: [{ maxBitrate: high }], codecOptions,
      })
      log('✓ écran publié au SFU (1 couche, sans simulcast)')
    }
    // Le bouton « Arrêter le partage » natif du navigateur termine la piste.
    track.onended = () => { void sfuStopScreenShare() }
    sfuLocalScreenStore.set(display)

    // Le SON de l'écran, s'il y en a un (l'utilisateur a coché « partager le son »,
    // et la surface choisie en a). C'est un BONUS : s'il échoue, on garde l'image.
    // Un supplément ne doit JAMAIS coûter la fonction principale.
    const soundTrack = display.getAudioTracks()[0]
    if (soundTrack) {
      try {
        s.screenAudioProducer = await s.sendTransport.produce({
          track: soundTrack,
          appData: { source: 'screenaudio' },
        })
        log('✓ son de l\'écran publié')
      } catch (e) {
        log(`⚠ son de l'écran non publié (${(e as Error).message}) : l'image reste partagée`)
        s.screenAudioProducer = null
      }
    } else {
      log('partage sans son (non coché, ou surface sans audio)')
    }
    return display
  } catch (e) {
    display.getTracks().forEach(t => t.stop())
    s.screenStream = null
    s.screenProducer = null
    log(`✘ publication écran : ${(e as Error).message}`)
    return null
  }
}

/** Arrêter mon partage d'écran : ferme le producer LOCAL puis prévient le serveur
 *  (voice:sfu_unpublish) pour qu'il ferme le producer SERVEUR → les spectateurs
 *  voient l'écran disparaître immédiatement. Idempotent. */
export async function sfuStopScreenShare(): Promise<void> {
  const s = _session
  if (!s) return
  // L'image ET le son : deux producers, deux fermetures. En oublier un laisserait le
  // son de l'écran continuer chez les spectateurs après l'arrêt du partage.
  const videoId = s.screenProducer?.id ?? null
  const soundId = s.screenAudioProducer?.id ?? null
  try { s.screenProducer?.close() } catch { /* déjà fermé */ }
  try { s.screenAudioProducer?.close() } catch { /* déjà fermé */ }
  s.screenProducer = null
  s.screenAudioProducer = null
  try { s.screenStream?.getTracks().forEach(t => t.stop()) } catch { /* déjà stoppé */ }
  s.screenStream = null
  sfuLocalScreenStore.set(null)

  const sock = get(socketStore)
  if (sock) {
    for (const producerId of [videoId, soundId]) {
      if (producerId) {
        await emitAck(sock, 'voice:sfu_unpublish', { channelId: s.channelId, producerId })
      }
    }
  }
  log('partage d\'écran arrêté')
}

/** Suis-je en train de partager mon écran via le SFU ? */
export function sfuIsScreenSharing(): boolean {
  return _session?.screenProducer != null
}

/** État établi (produce + consume faits) : le bascule attend ça pour voice:sfu_ready. */
export function sfuIsActive(): boolean {
  return _session !== null && get(sfuPhaseStore) === 'active'
}

/** Stats de MA session SFU, pour alimenter le même panneau réseau que le mesh :
 *  - lien vers le SFU (RTT + relais/direct) depuis mon recvTransport ;
 *  - perte + gigue PAR flux (donc par userId) depuis chaque consumer.
 *  Le mapping userId → socketId (roster) se fait côté voice.ts. */
export async function sfuCollectStats(): Promise<{
  rtt: number | null
  connType: 'relay' | 'direct' | 'sfu' | 'unknown'
  perUser: Map<string, { packetLoss: number | null; jitter: number | null }>
}> {
  const out = { rtt: null as number | null, connType: 'unknown' as 'relay' | 'direct' | 'sfu' | 'unknown', perUser: new Map<string, { packetLoss: number | null; jitter: number | null }>() }
  const s = _session
  if (!s) return out
  out.connType = 'sfu' // en SFU le média passe par le serveur : ce n'est PAS du P2P
  // RTT vers le SFU depuis la paire ICE active.
  try {
    const rs = await s.recvTransport.getStats()
    for (const r of rs.values()) {
      if (r.type === 'candidate-pair' && r.nominated && r.currentRoundTripTime != null) {
        out.rtt = Math.round(r.currentRoundTripTime * 1000)
      }
    }
  } catch { /* transport en cours de fermeture : on renvoie ce qu'on a */ }
  // Perte + gigue par flux (par userId) depuis chaque consumer.
  const userOf = new Map<string, string>() // producerId → userId
  for (const c of get(sfuConsumersStore)) userOf.set(c.producerId, c.userId)
  for (const [producerId, consumer] of s.consumers) {
    const userId = userOf.get(producerId)
    if (!userId) continue
    try {
      const cs = await consumer.getStats()
      let packetLoss: number | null = null
      let jitter: number | null = null
      for (const r of cs.values()) {
        if (r.type === 'inbound-rtp' && r.kind === 'audio') {
          if (r.jitter != null) jitter = Math.round(r.jitter * 1000)
          const prev = _sfuPrevPackets.get(producerId)
          const received = r.packetsReceived ?? 0
          const lost = r.packetsLost ?? 0
          if (prev) {
            const dRec = received - prev.received
            const dLost = Math.max(0, lost - prev.lost)
            const total = dRec + dLost
            if (total > 0) packetLoss = Math.round((dLost / total) * 1000) / 10
          }
          _sfuPrevPackets.set(producerId, { received, lost })
        }
      }
      out.perUser.set(userId, { packetLoss, jitter })
    } catch { /* consumer fermé entre-temps : on l'ignore */ }
  }
  return out
}

export async function sfuLeave(): Promise<void> {
  const channel = _session?.channelId ?? _joinedChannel
  log('→ leave + nettoyage complet')
  const sock = get(socketStore)
  cleanup()
  _joinedChannel = null
  _recoverAttempts = 0
  if (sock && channel) await emitAck(sock, 'voice:sfu_leave', channel)
  sfuPhaseStore.set('idle')
  log('✓ session fermée')
}

/** Auto-reconnexion transparente après une perte réseau. Ferme proprement la
 *  session (le serveur évincera l'ancienne via TTL, ou le leave ci-dessous),
 *  attend un backoff, puis rejoint le MÊME salon. Au-delà de MAX_RECOVER
 *  tentatives, on abandonne pour de vrai (fail). */
async function maybeRecover(reason: string): Promise<void> {
  const channel = _session?.channelId ?? _joinedChannel
  const phase = get(sfuPhaseStore)
  // On ne récupère que depuis une session vivante ; pas pendant un leave manuel.
  if (!channel || (phase !== 'active' && phase !== 'recovering')) return
  if (_recoverAttempts >= MAX_RECOVER) {
    fail(`${reason} — abandon après ${MAX_RECOVER} tentatives`)
    return
  }
  _recoverAttempts++
  const attempt = _recoverAttempts
  log(`⟳ ${reason} — reconnexion ${attempt}/${MAX_RECOVER}…`)
  sfuPhaseStore.set('recovering')

  // Ferme l'ancienne session localement + prévient le serveur (leave explicite
  // pour libérer tout de suite, sans attendre le TTL).
  const sock = get(socketStore)
  cleanup()
  if (sock && channel) void emitAck(sock, 'voice:sfu_leave', channel)

  // Backoff : 1s, 2s, 4s, 8s (l'IP met un instant à se stabiliser).
  const backoff = Math.min(1000 * 2 ** (attempt - 1), 8000)
  await new Promise(r => setTimeout(r, backoff))

  // Toujours en reconnexion (pas de leave manuel entre-temps) ? on rejoint.
  if (get(sfuPhaseStore) !== 'recovering') return
  _joinedChannel = channel
  await sfuJoin(channel)
}

function fail(reason: string): void {
  log(`✘ ${reason}`)
  sfuErrorStore.set(reason)
  cleanup()
  // Relecture 2026-07-06 : sans ce leave, un échec en cours de session
  // laissait le participant inscrit côté daemon tant que l'onglet vivait.
  const sock = get(socketStore)
  if (sock && _joinedChannel) {
    void emitAck(sock, 'voice:sfu_leave', _joinedChannel)
    _joinedChannel = null
  }
  sfuPhaseStore.set('error')
}

/** Idempotent : détruit TOUT ce que la session a créé, dans l'ordre inverse. */
function cleanup(): void {
  const s = _session
  _session = null
  if (!s) return
  if (s.maintain) { clearInterval(s.maintain); s.maintain = null }
  if (s.onVisibility && typeof document !== 'undefined') {
    try { document.removeEventListener('visibilitychange', s.onVisibility) } catch { /* ok */ }
  }
  releaseWakeLock()
  setMediaSession(false)
  try { s.offNewProducer?.() } catch { /* déjà off */ }
  for (const el of s.audioEls.values()) {
    try { el.pause(); el.srcObject = null } catch { /* déjà mort */ }
  }
  for (const c of s.consumers.values()) {
    try { c.close() } catch { /* déjà fermé */ }
  }
  try { s.producer?.close() } catch { /* déjà fermé */ }
  try { s.screenProducer?.close() } catch { /* déjà fermé */ }
  try { s.screenAudioProducer?.close() } catch { /* déjà fermé */ }
  s.pendingScreenAudio.clear()
  try { s.micTrack?.stop() } catch { /* déjà stoppé */ }
  try { s.screenStream?.getTracks().forEach(t => t.stop()) } catch { /* déjà stoppé */ }
  try { s.sendTransport.close() } catch { /* déjà fermé */ }
  try { s.recvTransport.close() } catch { /* déjà fermé */ }
  sfuConsumersStore.set([])
  sfuScreensStore.set([])
  sfuLocalScreenStore.set(null)
  sfuMutedStore.set(false)
  sfuAuditStore.set([])
}
