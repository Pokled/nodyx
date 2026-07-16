/**
 * Nodyx Voice — WebRTC P2P audio manager
 *
 * Architecture Phase 2 : mesh direct via Socket.IO signaling
 * Architecture Phase 3 : remplacer le transport Socket.IO par DHT/libp2p
 */
import { writable, derived, get } from 'svelte/store'
import type { Socket } from 'socket.io-client'
import { voiceSettingsStore, getPeerVolume, type VoiceSettings } from './voiceSettings'
import { p2pManager } from './p2p'
import * as bascule from './voiceBascule'
export { voiceSettingsStore } from './voiceSettings'
export type { VoiceSettings } from './voiceSettings'

// ── Bascule mesh↔SFU (§17-B) : mode du canal côté client ──────────────────────
// 'mesh' par défaut. Passe à 'switching'/'sfu' UNIQUEMENT sur événement serveur
// (qui n'arrive que si VOICE_SFU_AUTO est actif). Tant que c'est 'mesh', tous les
// chemins mesh ci-dessous sont strictement ceux d'avant.
type ChannelMode = 'mesh' | 'switching' | 'sfu'
let _channelMode: ChannelMode = 'mesh'

// ── ICE Configuration ─────────────────────────────────────────────
// Priority: dynamic servers from voice:init (nodyx-turn) > static env vars (legacy coturn).

// Fallback STUN servers used only when nodyx-turn is not configured.
import {
  PUBLIC_TURN_URL,
  PUBLIC_TURN_USERNAME,
  PUBLIC_TURN_CREDENTIAL,
} from '$env/static/public'

// Dynamic ICE servers received from nodyx-core via voice:init.
// null = not received yet. [] = received but nodyx-turn not configured.
let _dynamicIceServers: RTCIceServer[] | null = null

function getIceServers(): RTCIceServer[] {
  // Dynamic creds from nodyx-turn (set on voice:init)
  if (_dynamicIceServers !== null && _dynamicIceServers.length > 0) {
    return _dynamicIceServers
  }
  // Legacy static env vars (backward-compat with coturn)
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }]
  if (PUBLIC_TURN_URL) {
    servers.push({
      urls:       PUBLIC_TURN_URL,
      username:   PUBLIC_TURN_USERNAME   || undefined,
      credential: PUBLIC_TURN_CREDENTIAL || undefined,
    })
  }
  return servers
}

// ── Types ─────────────────────────────────────────────────────────

export interface VoicePeer {
  socketId:  string
  userId:    string
  username:  string
  avatar:    string | null
  stream:    MediaStream | null
  speaking:  boolean
  iceState:  RTCIceConnectionState | null
  seatIndex: number
}

export interface VoiceState {
  active:       boolean
  channelId:    string | null
  muted:        boolean
  deafened:     boolean
  pttMode:      boolean
  peers:        VoicePeer[]
  mySpeaking:   boolean
  mySeatIndex:  number | null
}

// ── Stores ────────────────────────────────────────────────────────

export const voiceStore = writable<VoiceState>({
  active:       false,
  channelId:    null,
  muted:        false,
  deafened:     false,
  pttMode:      false,
  peers:        [],
  mySpeaking:   false,
  mySeatIndex:  null,
})

// Niveau micro 0–100, mis à jour par startLocalVAD
export const inputLevel = writable<number>(0)

export const isInVoice    = derived(voiceStore, s => s.active)
export const voicePeers   = derived(voiceStore, s => s.peers)
export const voiceChannel = derived(voiceStore, s => s.channelId)

// ── Peer stats ────────────────────────────────────────────────────

export interface PeerStats {
  rtt:            number | null  // ms — votre RTT vers ce peer
  theirRtt:       number | null  // ms — leur RTT (ils le broadcastent)
  packetLoss:     number | null  // %
  jitter:         number | null  // ms
  connectionType: 'relay' | 'direct' | 'sfu' | 'unknown'  // 'sfu' = via le serveur SFU (pas du P2P)
}

export type NetQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

export const peerStatsStore = writable<Map<string, PeerStats>>(new Map())

// Set briefly when the server rejects a voice:join (channel full)
export const voiceFullStore = writable<{ channelId: string; max: number } | null>(null)

// Set when a moderator kicks the local user out of a voice channel.
// UI consumers display a toast then clear the store.
export const voiceKickedStore = writable<{ channelId: string; by: string } | null>(null)

// ── Screen share stores ────────────────────────────────────────────
export const screenShareStore  = writable<boolean>(false)
export const localScreenStore  = writable<MediaStream | null>(null)
export const remoteScreenStore = writable<Map<string, MediaStream>>(new Map())

// ── Voice channel member roster (populated by socket voice:channel_update) ──
export interface VoiceChannelMember { userId: string; username: string; avatar: string | null }
export const voiceChannelMembersStore = writable<Record<string, VoiceChannelMember[]>>({})

// ── Voice join/leave toast events ────────────────────────────────────────────
export interface VoiceEvent { id: string; username: string; avatar: string | null; action: 'join' | 'leave'; channelName: string }
export const voiceEventsStore = writable<VoiceEvent[]>([])

export function getQuality(stats: PeerStats | undefined): NetQuality {
  if (!stats) return 'unknown'
  const rtt  = stats.rtt ?? stats.theirRtt
  const loss = stats.packetLoss ?? 0
  if (rtt === null) return 'unknown'
  if (rtt < 60  && loss < 1) return 'excellent'
  if (rtt < 120 && loss < 3) return 'good'
  if (rtt < 250 && loss < 8) return 'fair'
  return 'poor'
}

// ── Stats polling internals ───────────────────────────────────────

const _statsIntervals    = new Map<string, ReturnType<typeof setInterval>>()
const _prevPackets       = new Map<string, { received: number; lost: number }>()
// High packet-loss relay failover: track consecutive high-loss readings per peer.
// After 3 consecutive polls (≈6s) above the threshold, try relay-only ICE restart.
const _highLossCount     = new Map<string, number>()
const _relayRestartDone  = new Set<string>()
const HIGH_LOSS_THRESHOLD = 25   // %
const HIGH_LOSS_POLLS     = 3    // consecutive readings before relay restart

async function _pollStats(socketId: string, channelId: string): Promise<void> {
  const pc = _peerConns.get(socketId)
  if (!pc) return
  try {
    const stats = await pc.getStats()
    let rtt: number | null = null
    let packetLoss: number | null = null
    let jitter: number | null = null
    let connectionType: PeerStats['connectionType'] = 'unknown'

    for (const r of stats.values()) {
      // RTT + connexion type depuis la paire ICE active
      if (r.type === 'candidate-pair' && r.nominated) {
        if (r.currentRoundTripTime != null)
          rtt = Math.round(r.currentRoundTripTime * 1000)
        const local = stats.get(r.localCandidateId)
        if (local?.candidateType === 'relay') connectionType = 'relay'
        else if (local?.candidateType)        connectionType = 'direct'
      }
      // Perte de paquets + jitter depuis inbound-rtp audio
      if (r.type === 'inbound-rtp' && r.kind === 'audio') {
        if (r.jitter != null) jitter = Math.round(r.jitter * 1000)
        const prev = _prevPackets.get(socketId)
        const received = r.packetsReceived ?? 0
        const lost     = r.packetsLost     ?? 0
        if (prev) {
          const dRec  = received - prev.received
          const dLost = Math.max(0, lost - prev.lost) // guard against counter reset
          const total = dRec + dLost
          if (total > 0) packetLoss = Math.round((dLost / total) * 1000) / 10
        }
        _prevPackets.set(socketId, { received, lost })
      }
    }

    peerStatsStore.update(map => {
      const cur = map.get(socketId) ?? { rtt: null, theirRtt: null, packetLoss: null, jitter: null, connectionType: 'unknown' }
      map.set(socketId, { ...cur, rtt, packetLoss, jitter, connectionType })
      return new Map(map)
    })

    // Broadcast notre propre RTT aux autres peers
    if (rtt !== null && _socket) {
      _socket.emit('voice:stats', { channelId, rtt })
    }

    // ── High-loss relay failover ────────────────────────────────────
    // If packet loss stays above threshold for HIGH_LOSS_POLLS consecutive polls
    // (~6s) AND TURN relay is configured, switch the connection to relay-only.
    if (packetLoss !== null && connectionType !== 'relay') {
      if (packetLoss > HIGH_LOSS_THRESHOLD) {
        _highLossCount.set(socketId, (_highLossCount.get(socketId) ?? 0) + 1)
        const count = _highLossCount.get(socketId)!
        if (count >= HIGH_LOSS_POLLS && !_relayRestartDone.has(socketId)
            && _dynamicIceServers && _dynamicIceServers.length > 0) {
          _relayRestartDone.add(socketId)
          _highLossCount.delete(socketId)
          console.warn(`[voice] sustained ${packetLoss}% loss for ${socketId.slice(0,6)} — relay restart`)
          _attemptRelayRestart(socketId, channelId)
        }
      } else {
        _highLossCount.delete(socketId)
      }
    }
  } catch { /* peer déconnecté */ }
}

/**
 * Bascule la connexion vers relay-only (iceTransportPolicy: 'relay') sans
 * couper l'audio. Utilise setConfiguration() + ICE restart pour forcer le
 * chemin TURN, contournant les VPN et firewalls qui dégradent le chemin direct.
 */
function _attemptRelayRestart(socketId: string, channelId: string): void {
  const pc = _peerConns.get(socketId)
  if (!pc || pc.connectionState === 'closed') return
  // Only the initiator sends the re-offer (avoid collision)
  if (!_initiatorMap.get(socketId)) return
  if (pc.signalingState !== 'stable') return
  try {
    pc.setConfiguration({
      iceServers:          _dynamicIceServers ?? [],
      iceTransportPolicy:  'relay',
    })
    pc.createOffer({ iceRestart: true })
      .then(offer => {
        if (pc.signalingState !== 'stable') return
        return pc.setLocalDescription(offer).then(() => {
          _socket?.emit('voice:offer', { to: socketId, sdp: pc.localDescription, channelId })
          console.info(`[voice] relay restart offer sent to ${socketId.slice(0,6)}`)
        })
      })
      .catch(e => console.warn('[voice] relay restart failed:', e))
  } catch (e) {
    console.warn('[voice] setConfiguration (relay) failed:', e)
  }
}

function _startStatsPolling(socketId: string, channelId: string): void {
  _stopStatsPolling(socketId)
  // Premier poll rapide, puis toutes les 2s
  _pollStats(socketId, channelId)
  _statsIntervals.set(socketId, setInterval(() => _pollStats(socketId, channelId), 2000))
}

function _stopStatsPolling(socketId: string): void {
  const t = _statsIntervals.get(socketId)
  if (t) { clearInterval(t); _statsIntervals.delete(socketId) }
  _prevPackets.delete(socketId)
  _highLossCount.delete(socketId)
  _relayRestartDone.delete(socketId)
  peerStatsStore.update(map => { map.delete(socketId); return new Map(map) })
}

// ── Internal state ────────────────────────────────────────────────

let _socket:           Socket | null = null
let _localStream:      MediaStream | null = null   // flux brut getUserMedia
let _processedStream:  MediaStream | null = null   // flux traité → WebRTC
let _screenStream:     MediaStream | null = null
let _peerConns:        Map<string, RTCPeerConnection> = new Map()
let _iceQueues:        Map<string, RTCIceCandidateInit[]> = new Map()
// Perfect negotiation: track which side sent the first offer (initiator = polite peer),
// and serialize concurrent onOffer calls with a per-peer lock.
const _initiatorMap:   Map<string, boolean> = new Map()  // true = this side is initiator (polite)
const _offerLocks:     Map<string, boolean> = new Map()  // true = onOffer in progress for this peer

// ── Local audio chain ─────────────────────────────────────────────
//
// Topologie fixe (nœuds toujours câblés, on joue sur les paramètres) :
//
//   getUserMedia (raw)
//     → [optionnel] RNNoise AudioWorklet   (IA, @jitsi/rnnoise-wasm)
//     → BiquadFilter  highpass 80 Hz       (toggle via frequency)
//     → BiquadFilter  peaking  200 Hz      (Mode Broadcast — coupe boue)
//     → BiquadFilter  peaking  3000 Hz     (Mode Broadcast — présence)
//     → BiquadFilter  highshelf 8000 Hz    (Mode Broadcast — air)
//     → GainNode                           (volume micro)
//     → MediaStreamDestinationNode         → WebRTC (track stable)

interface LocalChain {
  ctx:       AudioContext
  hp:        BiquadFilterNode
  eqMud:     BiquadFilterNode
  eqPres:    BiquadFilterNode
  eqAir:     BiquadFilterNode
  gain:      GainNode
  analyser:  AnalyserNode        // tap passif sur gain — partagé avec le VAD local
  noiseGate: AudioWorkletNode | null  // null si worklet non supporté ou désactivé
  dest:      MediaStreamAudioDestinationNode
}

let _localChain: LocalChain | null = null

async function _buildLocalChain(rawStream: MediaStream): Promise<MediaStream> {
  _teardownLocalChain()

  const s   = get(voiceSettingsStore)
  // latencyHint: 'interactive' → demande au navigateur le plus petit buffer possible.
  // Réduit la latence de traitement audio local de ~50-100ms à ~10-20ms.
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' })
  // AudioContext peut démarrer en état 'suspended' hors geste utilisateur
  // → forcer la reprise pour garantir que dest.stream produit bien de l'audio
  if (ctx.state === 'suspended') await ctx.resume()

  // Source
  const source: AudioNode = ctx.createMediaStreamSource(rawStream)

  // ── RNNoise WASM (optionnel) ─────────────────────────────────────
  let head: AudioNode = source
  if (s.rnnoiseEnabled) {
    try {
      // Import dynamique — ne plante pas si le package n'est pas installé
      const { createRNNoiseProcessor } = await import('@jitsi/rnnoise-wasm' as any)
      const rnn = await createRNNoiseProcessor(ctx)
      source.connect(rnn)
      head = rnn
    } catch {
      console.debug('[voice] RNNoise non disponible — suppression native active')
    }
  }

  // ── Noise Gate AudioWorklet (optionnel) ──────────────────────────
  // Coupe le signal sous le seuil entre les prises de parole.
  // Insérée APRÈS RNNoise (signal déjà nettoyé) et AVANT le HPF.
  let noiseGate: AudioWorkletNode | null = null
  if (s.noiseGateEnabled) {
    try {
      await ctx.audioWorklet.addModule('/audio/noise-gate-processor.js')
      const threshLinear = Math.pow(10, s.noiseGateThreshold / 20)
      noiseGate = new AudioWorkletNode(ctx, 'nodyx-noise-gate', {
        parameterData: { threshold: threshLinear },
      })
      head.connect(noiseGate)
      head = noiseGate
      console.debug(`[voice] NoiseGate actif @ ${s.noiseGateThreshold} dBFS`)
    } catch {
      noiseGate = null
      console.debug('[voice] NoiseGate AudioWorklet non disponible')
    }
  }

  // ── Filtre passe-haut 80 Hz ──────────────────────────────────────
  // "Désactivé" = fréquence à 10 Hz (laisse tout passer)
  const hp         = ctx.createBiquadFilter()
  hp.type          = 'highpass'
  hp.frequency.value = s.highPassEnabled ? 80 : 10
  hp.Q.value       = 0.7

  // ── Mode Broadcast : 3 filtres EQ ───────────────────────────────
  // gain.value = 0 → bypass transparent
  const intensity = s.broadcastModeEnabled ? s.broadcastIntensity : 0

  const eqMud = ctx.createBiquadFilter()
  eqMud.type          = 'peaking'
  eqMud.frequency.value = 200
  eqMud.Q.value       = 1.0
  eqMud.gain.value    = -3 * intensity   // coupe la boue / nasalité

  const eqPres = ctx.createBiquadFilter()
  eqPres.type          = 'peaking'
  eqPres.frequency.value = 3000
  eqPres.Q.value       = 1.5
  eqPres.gain.value    = 4 * intensity   // clarté / intelligibilité

  const eqAir = ctx.createBiquadFilter()
  eqAir.type          = 'highshelf'
  eqAir.frequency.value = 8000
  eqAir.gain.value    = 3 * intensity   // "air" / brillance

  // ── Gain micro ───────────────────────────────────────────────────
  const gain      = ctx.createGain()
  gain.gain.value = s.micGain

  // ── Analyser (tap passif) — partagé avec startLocalVAD ──────────
  // Branché en parallèle sur gain, aucune sortie connectée.
  // Fonctionne même si son output n'est pas câblé (getByteFrequencyData toujours actif).
  // Évite de créer un second AudioContext dans startLocalVAD.
  const analyser       = ctx.createAnalyser()
  analyser.fftSize     = 512
  analyser.smoothingTimeConstant = 0.3

  // ── Destination → track stable pour WebRTC ───────────────────────
  const dest = ctx.createMediaStreamDestination()

  // Câblage principal
  head.connect(hp)
  hp.connect(eqMud)
  eqMud.connect(eqPres)
  eqPres.connect(eqAir)
  eqAir.connect(gain)
  gain.connect(dest)

  // Tap analyser (parallèle, passif — ne modifie pas le signal WebRTC)
  gain.connect(analyser)

  // Chrome suspend les AudioContexts sans connexion à ctx.destination.
  // Un GainNode à 0 vers la sortie système garde le contexte actif (silencieux pour l'utilisateur).
  const keepAlive = ctx.createGain()
  keepAlive.gain.value = 0
  gain.connect(keepAlive)
  keepAlive.connect(ctx.destination)

  _localChain = { ctx, hp, eqMud, eqPres, eqAir, gain, analyser, noiseGate, dest }
  return dest.stream
}

function _teardownLocalChain(): void {
  if (_localChain) {
    try { _localChain.ctx.close() } catch { /* ignore */ }
    _localChain = null
  }
}

/** Mettre à jour la chaîne locale en temps réel (pas de re-négociation WebRTC).
 *  Si le changement nécessite un rebuild (RNNoise toggle), on fait un replaceTrack. */
export async function updateLocalAudio(patch: Partial<VoiceSettings>): Promise<void> {
  voiceSettingsStore.update(s => ({ ...s, ...patch }))
  if (!_localChain) return

  const s = get(voiceSettingsStore)

  // Changements instantanés (pas de rebuild) ─────────────────────
  _localChain.gain.gain.value         = s.micGain
  _localChain.hp.frequency.value      = s.highPassEnabled ? 80 : 10
  const intensity = s.broadcastModeEnabled ? s.broadcastIntensity : 0
  _localChain.eqMud.gain.value        = -3 * intensity
  _localChain.eqPres.gain.value       =  4 * intensity
  _localChain.eqAir.gain.value        =  3 * intensity

  // Mise à jour du seuil du noise gate en temps réel (si actif)
  if ('noiseGateThreshold' in patch && _localChain.noiseGate) {
    const threshLinear = Math.pow(10, s.noiseGateThreshold / 20)
    _localChain.noiseGate.parameters.get('threshold')
      ?.setTargetAtTime(threshLinear, _localChain.ctx.currentTime, 0.01)
  }

  // Toggle RNNoise ou NoiseGate → rebuild + replaceTrack ──────────
  if (('rnnoiseEnabled' in patch || 'noiseGateEnabled' in patch) && _localStream) {
    const newStream = await _buildLocalChain(_localStream)
    _processedStream = newStream
    const newTrack  = newStream.getAudioTracks()[0]
    for (const [, pc] of _peerConns) {
      const sender = pc.getSenders().find(s => s.track?.kind === 'audio')
      if (sender && newTrack) {
        sender.replaceTrack(newTrack).catch(e =>
          console.warn('[voice] replaceTrack failed', e)
        )
      }
    }
  }
}

// Reconnect handler — stored as named ref so it can be properly removed
let _onSocketReconnect: (() => void) | null = null

// ── AudioContext keep-alive ───────────────────────────────────────
// Chrome peut suspendre l'AudioContext quand l'onglet passe en arrière-plan.
// On reprend dès que l'onglet redevient visible.
let _visibilityHandler: (() => void) | null = null

function _startContextKeepAlive(): void {
  _stopContextKeepAlive()
  _visibilityHandler = () => {
    if (document.visibilityState !== 'visible') return
    if (_localChain?.ctx.state === 'suspended') {
      _localChain.ctx.resume().catch(() => {})
    }
    if (_peerVADCtx?.state === 'suspended') {
      _peerVADCtx.resume().catch(() => {})
    }
  }
  document.addEventListener('visibilitychange', _visibilityHandler)
}

function _stopContextKeepAlive(): void {
  if (_visibilityHandler) {
    document.removeEventListener('visibilitychange', _visibilityHandler)
    _visibilityHandler = null
  }
}

// ── Peer audio chains ─────────────────────────────────────────────
//
// Chaîne de traitement pour chaque peer entrant :
//
//   MediaStream
//     → MediaStreamAudioSourceNode
//     → BiquadFilter (high-pass 80 Hz)   — élimine ronflements / basse fréquence
//     → DynamicsCompressor               — auto-level, empêche les saturations
//     → GainNode                         — volume par peer (0–2)
//     → AnalyserNode                     — VAD (indicateur "parle")
//     → MediaStreamDestinationNode
//     → <audio>.srcObject                — lecture finale (politique autoplay friendly)

interface PeerAudio {
  audioEl:     HTMLAudioElement
  source:      MediaStreamAudioSourceNode | null  // référence explicite pour disconnect()
  analyser:    AnalyserNode | null
  vadInterval: ReturnType<typeof setInterval>
}

const _peerAudio = new Map<string, PeerAudio>()

// ── Shared AudioContext for all peer VAD ──────────────────────────
// Un seul contexte partagé pour tous les peers (vs un par peer).
// Chrome limite à 6 AudioContexts/origine — avec 5 peers + localChain on atteignait la limite.
// Créé au premier peer, fermé seulement dans leaveVoice().
let _peerVADCtx: AudioContext | null = null

function _getOrCreatePeerVADCtx(): AudioContext {
  if (!_peerVADCtx || _peerVADCtx.state === 'closed') {
    _peerVADCtx = new AudioContext({ sampleRate: 48000 })
    _peerVADCtx.resume().catch(() => {})
  }
  return _peerVADCtx
}

function createPeerAudio(socketId: string, stream: MediaStream): void {
  destroyPeerAudio(socketId)

  // ── Lecture directe — fonctionne sur TOUS les navigateurs (Chrome, Firefox, iOS Safari)
  // NE PAS router via MediaStreamDestinationNode : l'AudioContext peut être suspendu
  // hors d'un geste utilisateur, rendant dest.stream silencieux.
  const audioEl     = new Audio()
  audioEl.srcObject = stream
  audioEl.autoplay  = true
  // Volume mémorisé pour CET utilisateur (par userId → survit refresh/reconnexion)
  const peer = get(voiceStore).peers.find(p => p.socketId === socketId)
  audioEl.volume    = peer?.userId ? getPeerVolume(peer.userId) / 100 : 1.0
  if (_currentSinkId) void _applySink(audioEl)   // adopte la sortie choisie (haut-parleur)
  audioEl.play().catch(() => {
    // Chrome desktop bloque l'autoplay si le contexte geste-utilisateur a expiré.
    // On réessaie au prochain clic ou frappe clavier (une seule fois suffit).
    const retry = () => audioEl.play().catch(() => {})
    document.addEventListener('click',   retry, { once: true })
    document.addEventListener('keydown', retry, { once: true })
  })

  // ── AudioContext partagé pour VAD (niveau d'entrée → indicateur "parle")
  // Réutilise _peerVADCtx (un seul contexte pour tous les peers) au lieu d'en créer un par peer.
  // Si le contexte est suspendu, on perd juste l'indicateur visuel — l'audio joue quand même.
  let source:  MediaStreamAudioSourceNode | null = null
  let analyser: AnalyserNode | null = null
  try {
    const ctx = _getOrCreatePeerVADCtx()
    source   = ctx.createMediaStreamSource(stream)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.3
    source.connect(analyser)
    // Pas de connexion à ctx.destination ni à MediaStreamDestination —
    // le son sort déjà via audioEl.srcObject = stream
  } catch {
    source   = null
    analyser = null
  }

  const data = new Uint8Array(analyser?.frequencyBinCount ?? 0)
  const vadInterval = setInterval(() => {
    if (!analyser) return
    analyser.getByteFrequencyData(data)
    const avg      = data.reduce((a, b) => a + b, 0) / data.length
    const speaking = avg > 10
    voiceStore.update(s => ({
      ...s,
      peers: s.peers.map(p => p.socketId === socketId ? { ...p, speaking } : p),
    }))
  }, 100)

  _peerAudio.set(socketId, { audioEl, source, analyser, vadInterval })
}

// ── Sortie audio (Android : écouteur <-> haut-parleur via setSinkId) ─────────
// Sur mobile, dès qu'un micro tourne, le système route le son vers l'ÉCOUTEUR
// (mode « appel »), d'où l'obligation de coller le téléphone à l'oreille.
// setSinkId permet de rediriger vers le haut-parleur. On applique le choix à TOUS
// les <audio> de lecture (voix + son d'écran) et on le mémorise pour que les
// éléments créés ensuite l'adoptent. iOS n'expose pas ça : le bouton n'apparaît
// que si setSinkId existe (Android/desktop).
export const audioOutputStore = writable<{ supported: boolean; onSpeaker: boolean }>({
  supported: false, onSpeaker: false,
})
let _currentSinkId = ''                                   // '' = sortie système par défaut
const _extraSinkEls = new Set<HTMLMediaElement>()         // éléments hors roster (son d'écran)

function _sinkSupported(): boolean {
  return typeof HTMLMediaElement !== 'undefined'
    && typeof (HTMLMediaElement.prototype as unknown as { setSinkId?: unknown }).setSinkId === 'function'
}

async function _applySink(el: HTMLMediaElement): Promise<void> {
  try { await (el as unknown as { setSinkId(id: string): Promise<void> }).setSinkId(_currentSinkId) }
  catch { /* device parti / non supporté : on ignore */ }
}

/** Enregistre un <audio> hors roster (ex. son d'écran) pour qu'il suive la sortie. */
export function registerSinkElement(el: HTMLMediaElement): () => void {
  _extraSinkEls.add(el)
  if (_currentSinkId) void _applySink(el)
  return () => { _extraSinkEls.delete(el) }
}

/** Disponibilité du bouton : setSinkId présent (Android/desktop, pas iOS). */
export async function refreshAudioOutputs(): Promise<void> {
  audioOutputStore.update(s => ({ ...s, supported: _sinkSupported() }))
}

/** Cherche l'id d'une sortie dont le libellé matche, sinon ''. */
async function _findOutput(re: RegExp): Promise<string> {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices()
    const outs = devs.filter(d => d.kind === 'audiooutput')
    const match = outs.find(d => re.test(d.label))
    if (match) return match.deviceId
    // Repli : une sortie qui n'est ni « default » ni « communications » est
    // souvent le haut-parleur sur Android.
    const other = outs.find(d => d.deviceId !== 'default' && d.deviceId !== 'communications')
    return other?.deviceId ?? ''
  } catch { return '' }
}

/** Bascule écouteur <-> haut-parleur, appliqué à toutes les sorties de lecture. */
export async function toggleSpeaker(): Promise<boolean> {
  const cur = get(audioOutputStore)
  const toSpeaker = !cur.onSpeaker
  _currentSinkId = toSpeaker ? await _findOutput(/speaker|haut.?parleur/i) : ''
  for (const node of _peerAudio.values()) await _applySink(node.audioEl)
  for (const el of _extraSinkEls) await _applySink(el)
  audioOutputStore.set({ supported: cur.supported, onSpeaker: toSpeaker })
  return toSpeaker
}

function destroyPeerAudio(socketId: string): void {
  const node = _peerAudio.get(socketId)
  if (node) {
    clearInterval(node.vadInterval)
    node.audioEl.pause()
    node.audioEl.srcObject = null
    // Déconnecter les nœuds du contexte partagé — ne pas fermer le contexte lui-même
    // (_peerVADCtx est fermé une seule fois dans leaveVoice)
    try { node.source?.disconnect()  } catch { /* déjà déconnecté */ }
    try { node.analyser?.disconnect() } catch { /* déjà déconnecté */ }
    _peerAudio.delete(socketId)
  }
  _stopStatsPolling(socketId)
}

export function setPeerVolume(socketId: string, value: number): void {
  const node = _peerAudio.get(socketId)
  if (node) {
    // audioEl.volume : 0 = muet, 1 = nominal (clamped to [0, 1])
    node.audioEl.volume = Math.min(1, Math.max(0, value))
  }
}

// ── Opus SDP tuning ───────────────────────────────────────────────

function applyOpusTuning(sdp: string, bitrateKbps = 64, peerCount = 0): string {
  const rtpMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/)
  if (!rtpMatch) return sdp
  const pt     = rtpMatch[1]
  const bpsStr = String(bitrateKbps * 1000)

  // ── DTX adaptatif au nombre de participants (P0 mesh, cf SPECS/NODYX_SFU_CDC.md §5) ──
  // À faible effectif (≤4 autres) on garde le réglage d'origine, optimisé jitter :
  //   cbr=1 (bitrate constant → paquets identiques, jitter buffer stable) + usedtx=0.
  //   C'est parfait à 2-4, on n'y touche pas.
  // Au-delà du seuil mesh (>4 participants), chacun uploade son flux ×(N-1) : l'upload
  //   devient le facteur limitant. On active alors la DTX (silence = quasi zéro trafic)
  //   et on passe en VBR (cbr et usedtx sont incompatibles). Gain majeur en watch-party
  //   où la plupart des gens écoutent sans parler. Le SFU lèvera ensuite cette contrainte.
  const largeCall = peerCount >= 4   // 4 autres + moi = 5 participants (seuil SFU §4)

  // ── fmtp Opus ───────────────────────────────────────────────────────────────
  // useinbandfec=1 : récupération de paquets perdus sans retransmission (latence stable).
  // stereo=0 : mono — divise la bande passante, suffisant pour la voix.
  const opusParams = {
    maxaveragebitrate: bpsStr,
    maxplaybackrate:   '48000',
    useinbandfec:      '1',
    usedtx:            largeCall ? '1' : '0',
    cbr:               largeCall ? '0' : '1',
    stereo:            '0',
    'sprop-stereo':    '0',
  }

  const fmtpLine = `a=fmtp:${pt} ${Object.entries(opusParams).map(([k, v]) => `${k}=${v}`).join(';')}`

  const existingFmtp = new RegExp(`a=fmtp:${pt} [^\r\n]*`)
  let out = existingFmtp.test(sdp)
    ? sdp.replace(existingFmtp, fmtpLine)
    : sdp.replace(`a=rtpmap:${pt} opus/48000/2\r\n`, `a=rtpmap:${pt} opus/48000/2\r\n${fmtpLine}\r\n`)

  // ── ptime : packetisation 20 ms (1 paquet/20ms — standard VoIP) ────────────
  // Garantit des paquets à intervalles réguliers → jitter faible et prévisible.
  if (/a=ptime:\d+/.test(out)) {
    out = out.replace(/a=ptime:\d+/, 'a=ptime:20')
  } else {
    out = out.replace(`a=rtpmap:${pt} opus/48000/2\r\n`, `a=rtpmap:${pt} opus/48000/2\r\na=ptime:20\r\n`)
  }
  if (/a=maxptime:\d+/.test(out)) {
    out = out.replace(/a=maxptime:\d+/, 'a=maxptime:20')
  }

  return out
}

// ── Peer connection factory ───────────────────────────────────────

function createPeerConn(
  remoteSocketId: string,
  channelId: string,
  isInitiator: boolean,
): RTCPeerConnection {
  const iceConfig = getIceServers()
  console.debug(`[ICE config] ${remoteSocketId.slice(0,6)} servers: ${iceConfig.length}`)
  const pc = new RTCPeerConnection({
    iceServers: iceConfig,
    // Pré-collecte 2 candidats (dont relay TURN) avant de démarrer ICE
    // → évite que le candidat relay arrive trop tard (après checking→disconnected)
    iceCandidatePoolSize: 2,
  })
  let _iceRestartCount = 0

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState
    console.debug(`[voice] ICE ${remoteSocketId.slice(0, 6)} → ${state}`)
    voiceStore.update(s => ({
      ...s,
      peers: s.peers.map(p =>
        p.socketId === remoteSocketId ? { ...p, iceState: state } : p
      ),
    }))
    if (state === 'connected' || state === 'completed') {
      _iceRestartCount = 0
      _startStatsPolling(remoteSocketId, channelId)
    }
    if (state === 'disconnected') {
      if (_iceRestartCount >= 2) {
        // Already tried twice — give up
        _handlePeerFailure(remoteSocketId, channelId)
        return
      }
      setTimeout(() => {
        if (pc.iceConnectionState !== 'disconnected') return
        _iceRestartCount++
        console.warn(`[voice] ICE ${remoteSocketId.slice(0, 6)} still disconnected — restart attempt ${_iceRestartCount}`)
        try {
          if (isInitiator && pc.signalingState === 'stable') {
            pc.createOffer({ iceRestart: true })
              .then(offer => {
                if (pc.signalingState !== 'stable') return
                return pc.setLocalDescription(offer).then(() => {
                  _socket?.emit('voice:offer', { to: remoteSocketId, sdp: pc.localDescription, channelId })
                })
              })
              .catch(() => { _handlePeerFailure(remoteSocketId, channelId) })
          } else {
            // Non-initiator: wait for re-offer, escalate if nothing happens
            setTimeout(() => {
              if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
                _handlePeerFailure(remoteSocketId, channelId)
              }
            }, 5000)
          }
        } catch { _handlePeerFailure(remoteSocketId, channelId) }
      }, 4000)
    }
    if (state === 'failed') {
      console.warn('[voice] ICE failed — dropping peer or rejoin')
      _handlePeerFailure(remoteSocketId, channelId)
    }
  }

  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      // Log candidate type pour diagnostic ICE
      const type = candidate.type ?? 'unknown'
      const proto = candidate.protocol ?? ''
      // Do NOT log candidate.address — real IPs must not appear in browser console.
      console.debug(`[ICE gather] ${remoteSocketId.slice(0,6)} candidate: ${type} ${proto}`)
      if (_socket) _socket.emit('voice:ice', { to: remoteSocketId, candidate, channelId })
    } else {
      console.debug(`[ICE gather] ${remoteSocketId.slice(0,6)} — gathering complete`)
    }
  }

  pc.ontrack = ({ track, streams }) => {
    const stream = (streams && streams.length > 0) ? streams[0] : new MediaStream([track])

    if (track.kind === 'audio') {
      voiceStore.update(s => ({
        ...s,
        peers: s.peers.map(p =>
          p.socketId === remoteSocketId ? { ...p, stream } : p
        ),
      }))
      createPeerAudio(remoteSocketId, stream)
    } else if (track.kind === 'video') {
      remoteScreenStore.update(map => {
        map.set(remoteSocketId, stream)
        return new Map(map)
      })
      track.onended = () => {
        remoteScreenStore.update(map => { map.delete(remoteSocketId); return new Map(map) })
      }
    }
  }

  if (isInitiator) {
    let makingOffer = false
    pc.onnegotiationneeded = async () => {
      if (makingOffer || pc.signalingState !== 'stable') return
      makingOffer = true
      try {
        const offer = await pc.createOffer()
        if (pc.signalingState !== 'stable') return
        const bitrate  = get(voiceSettingsStore).bitrate
        const tunedSdp = applyOpusTuning(offer.sdp ?? '', bitrate, _peerConns.size)
        await pc.setLocalDescription({ type: 'offer', sdp: tunedSdp })
        _socket?.emit('voice:offer', {
          to:  remoteSocketId,
          sdp: pc.localDescription,
          channelId,
        })
      } catch (e) {
        console.warn('[voice] createOffer error:', e)
      } finally {
        makingOffer = false
      }
    }
  }

  // Utiliser le flux traité (après EQ/compresseur) si disponible
  const outStream = _processedStream ?? _localStream
  if (outStream) {
    for (const track of outStream.getTracks()) {
      pc.addTrack(track, outStream)
    }
  }

  _initiatorMap.set(remoteSocketId, isInitiator)
  _peerConns.set(remoteSocketId, pc)
  return pc
}

// ── Rejoin scheduling (throttled) ─────────────────────────────────

/** Retourne true si au moins un peer (autre que excludeSocketId) est connecté */
function _hasOtherConnectedPeer(excludeSocketId: string): boolean {
  for (const [sid, pc] of _peerConns) {
    if (sid === excludeSocketId) continue
    const s = pc.iceConnectionState
    if (s === 'connected' || s === 'completed') return true
  }
  return false
}

/** Supprime proprement UN peer défaillant sans toucher aux autres */
function _dropPeer(socketId: string): void {
  destroyPeerAudio(socketId)
  const pc = _peerConns.get(socketId)
  pc?.close()
  _peerConns.delete(socketId)
  _iceQueues.delete(socketId)
  _initiatorMap.delete(socketId)
  _offerLocks.delete(socketId)
  voiceStore.update(s => ({
    ...s,
    peers: s.peers.filter(p => p.socketId !== socketId),
  }))
}

/**
 * Si d'autres peers sont actifs : supprime seulement le peer défaillant.
 * Sinon : planifie un rejoin complet de la room.
 */
function _handlePeerFailure(socketId: string, channelId: string): void {
  if (_hasOtherConnectedPeer(socketId)) {
    console.debug(`[voice] peer ${socketId.slice(0, 6)} failed — dropping without full rejoin`)
    _dropPeer(socketId)
  } else {
    _scheduleRejoin(channelId)
  }
}

let _rejoinTimer: ReturnType<typeof setTimeout> | null = null
function _scheduleRejoin(channelId: string): void {
  if (_rejoinTimer) return
  _rejoinTimer = setTimeout(() => {
    _rejoinTimer = null
    _doRejoin(channelId)
  }, 1500)
}

function _doRejoin(channelId: string): void {
  if (!_socket || !get(voiceStore).active) return
  console.debug('[voice] Rejoining voice room:', channelId)

  _socket.emit('voice:leave', channelId)

  for (const [sid, pc] of _peerConns) {
    destroyPeerAudio(sid)
    pc.close()
  }
  _peerConns.clear()
  _iceQueues.clear()

  voiceStore.update(s => ({ ...s, peers: [], mySeatIndex: null }))

  _socket.emit('voice:join', channelId)

  stopLocalVAD()
  startLocalVAD(channelId)
}

// ── ICE candidate queue helpers ───────────────────────────────────

async function flushICEQueue(socketId: string, pc: RTCPeerConnection): Promise<void> {
  const queue = _iceQueues.get(socketId) ?? []
  _iceQueues.delete(socketId)
  for (const candidate of queue) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch { /* stale */ }
  }
}

// ── Local VAD (Voice Activity Detection) ─────────────────────────
//
// Réutilise l'AnalyserNode déjà présent dans _localChain (tap sur gain).
// Aucun AudioContext supplémentaire créé — élimine le double-contexte.

let _localVADInterval: ReturnType<typeof setInterval> | null = null

function startLocalVAD(channelId: string): void {
  stopLocalVAD()
  if (!_localChain) return
  // frequencyBinCount = fftSize / 2 = 256 — taille constante quelque soit la chaîne
  const data = new Uint8Array(_localChain.analyser.frequencyBinCount)
  let lastSpeaking = false
  _localVADInterval = setInterval(() => {
    // Déréférencement dynamique : si la chaîne est reconstruite (toggle RNNoise),
    // on utilise automatiquement le nouvel analyser sans recréer l'interval.
    if (!_localChain) return
    _localChain.analyser.getByteFrequencyData(data)
    const avg      = data.reduce((a, b) => a + b, 0) / data.length
    const level    = Math.min(100, Math.round(avg * 2.5))
    inputLevel.set(level)
    const speaking = avg > 12
    voiceStore.update(s => ({ ...s, mySpeaking: speaking }))
    if (speaking !== lastSpeaking) {
      lastSpeaking = speaking
      _socket?.emit('voice:speaking', { channelId, speaking })
    }
  }, 100)
}

function stopLocalVAD(): void {
  if (_localVADInterval) {
    clearInterval(_localVADInterval)
    _localVADInterval = null
  }
  inputLevel.set(0)
}

// ── Public API ────────────────────────────────────────────────────

export async function joinVoice(channelId: string, socket: Socket): Promise<void> {
  if (!window.isSecureContext) throw new Error('INSECURE')

  try {
    const perm = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    if (perm.state === 'denied') throw new Error('DENIED')
  } catch (e: any) {
    if (e.message === 'DENIED') throw e
  }

  try {
    _localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl:  true,
        channelCount:     1,
        sampleRate:       48000,
      },
      video: false,
    })
  } catch (e: any) {
    const name = e?.name ?? ''
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') throw new Error('DENIED')
    if (name === 'NotFoundError') throw new Error('NOTFOUND')
    if (name === 'NotReadableError') throw new Error('BUSY')
    throw new Error('DENIED')
  }

  // Construire la chaîne de traitement audio locale avant de rejoindre
  _processedStream = await _buildLocalChain(_localStream)

  _socket = socket

  socket.on('voice:init',        onVoiceInit)
  socket.on('voice:peer_joined', onPeerJoined)
  socket.on('voice:peer_left',   onPeerLeft)
  socket.on('voice:offer',       onOffer)
  socket.on('voice:answer',      onAnswer)
  socket.on('voice:ice',         onICE)
  socket.on('voice:speaking',    onSpeaking)
  socket.on('voice:stats',       onPeerStats)
  socket.on('voice:full',        onVoiceFull)
  socket.on('voice:kicked',      onKicked)
  socket.on('voice:mode',        onVoiceModeEvent)   // bascule §17-B (dormant si flag off)
  socket.on('voice:sfu_commit',  onSfuCommitEvent)
  _channelMode = 'mesh'                               // repart toujours de mesh

  _onSocketReconnect = () => {
    console.debug('[voice] Socket reconnected — rejoining voice room')
    _doRejoin(channelId)
  }
  socket.on('connect', _onSocketReconnect)

  socket.emit('voice:join', channelId)

  voiceStore.set({
    active: true, channelId, muted: false, deafened: false,
    pttMode: false, peers: [], mySpeaking: false, mySeatIndex: null,
  })

  startLocalVAD(channelId)
  _startContextKeepAlive()
}

export function leaveVoice(): void {
  const { channelId } = get(voiceStore)
  if (channelId && _socket) {
    _socket.emit('voice:leave', channelId)
  }
  // Si on était passé sur l'SFU (bascule), quitter aussi la session SFU. Idempotent
  // en mesh pur (aucune session SFU ⇒ no-op). Puis on repart de mesh.
  void bascule.basculeLeaveSfu()
  _stopSfuStatsPolling()
  _stopSfuScreenMirror()
  _channelMode = 'mesh'

  if (_socket) {
    _socket.off('voice:init',        onVoiceInit)
    _socket.off('voice:peer_joined', onPeerJoined)
    _socket.off('voice:peer_left',   onPeerLeft)
    _socket.off('voice:offer',       onOffer)
    _socket.off('voice:answer',      onAnswer)
    _socket.off('voice:ice',         onICE)
    _socket.off('voice:speaking',    onSpeaking)
    _socket.off('voice:stats',       onPeerStats)
    _socket.off('voice:full',        onVoiceFull)
    _socket.off('voice:kicked',      onKicked)
    _socket.off('voice:mode',        onVoiceModeEvent)
    _socket.off('voice:sfu_commit',  onSfuCommitEvent)
    if (_onSocketReconnect) {
      _socket.off('connect', _onSocketReconnect)
      _onSocketReconnect = null
    }
  }

  if (_rejoinTimer) { clearTimeout(_rejoinTimer); _rejoinTimer = null }
  _stopContextKeepAlive()

  for (const [sid, pc] of _peerConns) {
    destroyPeerAudio(sid)
    pc.close()
  }
  _peerConns.clear()
  _iceQueues.clear()

  stopLocalVAD()

  _localStream?.getTracks().forEach(t => t.stop())
  _localStream = null
  _teardownLocalChain()
  _processedStream = null

  // Fermer le contexte VAD partagé (tous les peers ont déjà été détruits ci-dessus)
  if (_peerVADCtx) {
    _peerVADCtx.close().catch(() => {})
    _peerVADCtx = null
  }

  _screenStream?.getTracks().forEach(t => t.stop())
  _screenStream = null
  screenShareStore.set(false)
  localScreenStore.set(null)
  remoteScreenStore.set(new Map())

  _socket = null

  inputLevel.set(0)
  voiceStore.set({
    active: false, channelId: null, muted: false, deafened: false,
    pttMode: false, peers: [], mySpeaking: false, mySeatIndex: null,
  })
}

// Moderator action: ask the server to kick a peer out of the current voice channel.
// Authorization is enforced server-side; the client merely emits.
export function kickPeer(targetSocketId: string): void {
  const { channelId } = get(voiceStore)
  if (!channelId || !_socket) return
  _socket.emit('voice:kick', { channelId, targetSocketId })
}

export function toggleMute(): void {
  if (!_localStream) return
  const track = _localStream.getAudioTracks()[0]
  if (!track) return
  track.enabled = !track.enabled
  voiceStore.update(s => ({ ...s, muted: !track.enabled }))
}

export function toggleDeafen(): void {
  voiceStore.update(s => {
    const deafened = !s.deafened
    // Mute/unmute all peer audio elements
    for (const [, node] of _peerAudio) {
      node.audioEl.muted = deafened
    }
    return { ...s, deafened }
  })
}

export function togglePTTMode(): void {
  voiceStore.update(s => {
    const pttMode = !s.pttMode
    if (_localStream) {
      const track = _localStream.getAudioTracks()[0]
      if (track) track.enabled = !pttMode
    }
    return { ...s, pttMode, muted: pttMode }
  })
}

export function startPTT(): void {
  if (!_localStream) return
  const track = _localStream.getAudioTracks()[0]
  if (!track) return
  track.enabled = true
  voiceStore.update(s => ({ ...s, muted: false }))
}

export function stopPTT(): void {
  if (!_localStream) return
  const track = _localStream.getAudioTracks()[0]
  if (!track) return
  track.enabled = false
  voiceStore.update(s => ({ ...s, muted: true }))
}

// ── Screen sharing ────────────────────────────────────────────────

export type DisplaySurface = 'monitor' | 'window' | 'browser'
export type ShareQuality  = '720p' | '1080p' | '4k'
export type ShareFps      = 15 | 30 | 60

// ── Plafond de bitrate du partage d'écran (P0 mesh, cf SPECS/NODYX_SFU_CDC.md §6) ──
// Sans plafond, l'encodeur peut monter à plusieurs Mbps par pair ; en mesh l'uploader
// paie ×(N-1) → le mur. On borne l'envoi selon la qualité et le fps choisis. Le SFU
// (à venir) remplacera ce plafond fixe par du simulcast adaptatif par spectateur.
function screenShareMaxBitrate(quality: ShareQuality, fps: ShareFps): number {
  const base     = quality === '4k' ? 8_000_000 : quality === '1080p' ? 3_000_000 : 1_500_000
  const fpsScale = fps >= 60 ? 1.5 : fps <= 15 ? 0.6 : 1
  return Math.round(base * fpsScale)
}

async function capScreenShareBitrate(
  sender: RTCRtpSender,
  quality: ShareQuality,
  fps: ShareFps,
): Promise<void> {
  try {
    const params = sender.getParameters()
    // Certains navigateurs renvoient des encodings vides avant la 1re négociation.
    if (!params.encodings || params.encodings.length === 0) {
      params.encodings = [{}]
    }
    params.encodings[0].maxBitrate = screenShareMaxBitrate(quality, fps)
    await sender.setParameters(params)
  } catch (e) {
    console.warn('[voice] cap screen-share bitrate failed', e)
  }
}

/** Ce navigateur peut-il capturer un écran ?
 *
 *  Sur ANDROID et iOS, la réponse est NON, et ce n'est pas un manque de Nodyx :
 *  les navigateurs mobiles n'implémentent pas `getDisplayMedia`. La capture d'écran
 *  y passe par une API système (MediaProjection sur Android) réservée aux
 *  applications natives, jamais exposée aux pages web. AUCUN site ne peut partager
 *  un écran mobile depuis un navigateur.
 *
 *  Sans ce contrôle, l'appel échouait en silence : l'utilisateur cliquait, rien ne
 *  se passait, et rien ne lui disait pourquoi. On préfère l'expliquer.
 *  (Regarder un partage, en revanche, marche parfaitement sur mobile.) */
export function screenShareSupported(): boolean {
  return typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
}

export async function startScreenShare(
  displaySurface: DisplaySurface = 'monitor',
  quality: ShareQuality = '1080p',
  fps: ShareFps = 30
): Promise<void> {
  const { channelId } = get(voiceStore)
  if (!channelId || !_socket) return
  if (!screenShareSupported()) {
    console.info('[voice] Partage d\'écran indisponible : ce navigateur ne sait pas capturer un écran (mobile).')
    return
  }

  const w = quality === '4k' ? 3840 : quality === '1080p' ? 1920 : 1280
  const h = quality === '4k' ? 2160 : quality === '1080p' ? 1080 : 720

  // Canal basculé en SFU : le partage passe par le serveur. UN seul upload, qui
  // est recopié à chaque spectateur, au lieu d'une copie PAR spectateur (le mur
  // du mesh vers ~4 personnes). Les stores de l'UI sont alimentés par le miroir
  // SFU, donc la Scène et le salon affichent ça sans rien savoir du changement.
  if (_channelMode === 'sfu') {
    await bascule.basculeStartScreenShare({
      displaySurface,
      width:      w,
      height:     h,
      frameRate:  fps,
      maxBitrate: screenShareMaxBitrate(quality, fps),
    })
    return
  }

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        displaySurface,
        width:     { ideal: w },
        height:    { ideal: h },
        frameRate: { ideal: fps, max: fps },
        cursor:    'always',
      } as any,
      // On capture le SON dès maintenant, même si le mesh ne sait pas le
      // transporter : le canal va basculer en SFU (ci-dessous), et la migration
      // republiera CETTE piste telle quelle. Sans elle, il faudrait rouvrir le
      // sélecteur d'écran après la bascule, ce que le navigateur refuse hors geste
      // utilisateur : le son serait perdu pour toute la session.
      audio: true,
    })

    _screenStream = displayStream
    localScreenStore.set(displayStream)
    screenShareStore.set(true)

    // Le partage d'écran est PRÉCISÉMENT le moment où le mesh s'écroule : le
    // partageur y uploade sa vidéo UNE FOIS PAR SPECTATEUR, et il plafonne vers 4
    // personnes. On demande donc la bascule TOUT DE SUITE, sans attendre un quorum.
    //
    // Le partage démarre quand même en mesh dans la foulée (aucun délai pour
    // l'utilisateur), puis MIGRE vers le SFU au commit, image et son compris, sans
    // rien lui redemander. Si le SFU n'est pas activé pour ce canal, l'event est un
    // no-op : on reste en mesh, exactement comme avant.
    _socket.emit('voice:screenshare_intent', { channelId })

    const videoTrack = displayStream.getVideoTracks()[0]
    videoTrack.onended = () => stopScreenShare()
    // Aide l'encodeur : 60 fps ⇒ probablement du mouvement (jeu) → priorité fluidité ;
    // sinon (slides, code, bureau) → priorité netteté du texte.
    try { videoTrack.contentHint = fps >= 60 ? 'motion' : 'detail' } catch { /* non supporté */ }

    for (const [socketId, pc] of _peerConns) {
      try {
        const sender = pc.addTrack(videoTrack, displayStream)
        await capScreenShareBitrate(sender, quality, fps)
        if (pc.signalingState === 'stable') {
          const offer    = await pc.createOffer()
          const tunedSdp = applyOpusTuning(offer.sdp ?? '', get(voiceSettingsStore).bitrate, _peerConns.size)
          await pc.setLocalDescription({ type: 'offer', sdp: tunedSdp })
          _socket?.emit('voice:offer', { to: socketId, sdp: pc.localDescription, channelId })
        }
      } catch (e) {
        console.warn('[voice] Screen share: addTrack failed for', socketId, e)
      }
    }
  } catch (err: any) {
    if (err.name !== 'NotAllowedError') {
      console.error('[voice] Screen share error:', err)
    }
    screenShareStore.set(false)
    localScreenStore.set(null)
  }
}

export function stopScreenShare(): void {
  const { channelId } = get(voiceStore)

  // En SFU, c'est le producer SERVEUR qu'il faut fermer (le mesh ne porte aucune
  // piste vidéo dans ce mode). Le miroir remet localScreenStore/screenShareStore
  // à zéro, et les spectateurs voient l'écran disparaître net (voice:sfu_unpublish).
  if (_channelMode === 'sfu') {
    void bascule.basculeStopScreenShare()
    return
  }

  if (_screenStream) {
    _screenStream.getTracks().forEach(t => t.stop())
    _screenStream = null
  }

  screenShareStore.set(false)
  localScreenStore.set(null)

  if (!channelId) return

  for (const [socketId, pc] of _peerConns) {
    const videoSenders = pc.getSenders().filter(s => s.track?.kind === 'video')
    for (const sender of videoSenders) {
      try { pc.removeTrack(sender) } catch { /* ignore */ }
    }
    if (pc.signalingState === 'stable') {
      pc.createOffer()
        .then(offer => pc.setLocalDescription({ type: 'offer', sdp: applyOpusTuning(offer.sdp ?? '', get(voiceSettingsStore).bitrate, _peerConns.size) }))
        .then(() => { _socket?.emit('voice:offer', { to: socketId, sdp: pc.localDescription, channelId }) })
        .catch(() => { /* peer may have disconnected */ })
    }
  }
}

// ── Socket event handlers ─────────────────────────────────────────

function onVoiceInit({ channelId, peers, mySeatIndex, iceServers, mode }: {
  channelId:   string
  peers:       { socketId: string; userId: string; username: string; avatar: string | null; seatIndex: number }[]
  mySeatIndex: number
  iceServers?: RTCIceServer[]
  mode?:       ChannelMode
}): void {
  if (iceServers && iceServers.length > 0) {
    _dynamicIceServers = iceServers
    p2pManager.setIceServers(iceServers)  // share with P2P DataChannel mesh
  }
  for (const [sid, pc] of _peerConns) {
    destroyPeerAudio(sid)
    pc.close()
  }
  _peerConns.clear()
  _iceQueues.clear()
  _initiatorMap.clear()
  _offerLocks.clear()

  const peerList: VoicePeer[] = peers.map(p => ({ ...p, stream: null, speaking: false, iceState: null }))
  voiceStore.update(s => ({ ...s, peers: peerList, mySeatIndex }))

  _channelMode = mode ?? 'mesh'
  if (_channelMode === 'sfu') {
    // Arrivant tardif sur un canal DÉJÀ en SFU (§5) : aucun PC mesh, on rejoint
    // l'SFU directement (lecture immédiate). Le roster ci-dessus reste affiché.
    // Le MIROIR DES ÉCRANS doit démarrer ICI aussi, pas seulement au commit :
    // sans ça, celui qui recharge sa page (ou arrive après la bascule) publie bien
    // son écran au serveur mais rien ne le recopie vers les stores de l'UI, et il
    // ne voit pas non plus l'écran des autres. Rien ne s'affiche, sans la moindre
    // erreur : le flux est au serveur, c'est le pont vers l'UI qui manquait.
    void bascule.basculeJoinDirectSfu(channelId).then(() => {
      _startSfuStatsPolling()
      _startSfuScreenMirror()
    })
  } else {
    for (const peer of peers) {
      createPeerConn(peer.socketId, channelId, true)
    }
    if (_channelMode === 'switching' && _socket) {
      // J'arrive pendant une bascule : mesh (ci-dessus) + établir l'SFU en
      // parallèle ; chaque flux SFU qui démarre coupe le mesh de la personne.
      void bascule.basculeBeginSwitch(_socket, channelId, _meshMutePeerByUserId)
    }
  }
}

function onPeerJoined({ channelId, peer }: {
  channelId: string
  peer: { socketId: string; userId: string; username: string; avatar: string | null; seatIndex: number }
}): void {
  // Race condition : peer_joined peut arriver avant peer_left pour le même userId
  // (reconnexion rapide — le nouveau socket rejoint avant que l'ancien soit évincé)
  const stale = get(voiceStore).peers.find(
    p => p.userId === peer.userId && p.socketId !== peer.socketId
  )
  if (stale) _dropPeer(stale.socketId)

  voiceStore.update(s => {
    if (s.peers.some(p => p.socketId === peer.socketId)) return s
    return { ...s, peers: [...s.peers, { ...peer, stream: null, speaking: false, iceState: null }] }
  })
  // Roster mis à jour ci-dessus dans TOUS les modes. On ne crée un PC mesh que
  // hors SFU : en SFU, le nouveau flux est relayé via l'SFU (voice:sfu_new_producer).
  if (_channelMode !== 'sfu' && !_peerConns.has(peer.socketId)) {
    createPeerConn(peer.socketId, channelId, false)
  }
}

function onPeerLeft({ socketId }: { channelId: string; socketId: string }): void {
  destroyPeerAudio(socketId)
  const pc = _peerConns.get(socketId)
  pc?.close()
  _peerConns.delete(socketId)
  _iceQueues.delete(socketId)
  _initiatorMap.delete(socketId)
  _offerLocks.delete(socketId)
  remoteScreenStore.update(map => { map.delete(socketId); return new Map(map) })
  voiceStore.update(s => ({ ...s, peers: s.peers.filter(p => p.socketId !== socketId) }))
}

// ── Bascule mesh↔SFU (§17-B) : handlers serveur + opérations mesh ──
// Invoqués UNIQUEMENT si le serveur émet voice:mode / voice:sfu_commit (⇒
// VOICE_SFU_AUTO actif). En mesh pur, ces fonctions ne tournent jamais.

function _meshMutePlayback(muted: boolean): void {
  for (const node of _peerAudio.values()) node.audioEl.muted = muted
}

// Crossfade par personne : coupe le mesh de l'utilisateur dont le flux SFU vient
// de commencer à jouer (appelé par voiceSfu via le callback). Le roster fait le
// lien userId → socketId mesh.
function _meshMutePeerByUserId(userId: string): void {
  const peer = get(voiceStore).peers.find(p => p.userId === userId)
  if (!peer) return
  const node = _peerAudio.get(peer.socketId)
  if (node) node.audioEl.muted = true
}

function _meshTeardownConnections(): void {
  // Ferme le MÉDIA mesh (PC + audio), garde la SESSION (roster, micro local,
  // socket, seat). Le média passe désormais par l'SFU. Même geste que le teardown
  // de leaveVoice, mais sans toucher au reste. Le micro mesh, désormais inutilisé,
  // reste ouvert : inoffensif, et on évite de risquer l'état de session.
  for (const [sid, pc] of _peerConns) {
    destroyPeerAudio(sid)
    pc.close()
  }
  _peerConns.clear()
  _iceQueues.clear()
  _initiatorMap.clear()
  _offerLocks.clear()
}

// Stats SFU : un seul poller (pas de PC mesh à interroger). Il relève les stats de
// la session SFU et les mappe sur le roster (userId → socketId) pour alimenter le
// MÊME panneau réseau que le mesh (ping vers le SFU, perte/gigue par personne, type).
let _sfuStatsInterval: ReturnType<typeof setInterval> | null = null
function _startSfuStatsPolling(): void {
  if (_sfuStatsInterval) return
  void _pollSfuStats() // premier relevé immédiat
  _sfuStatsInterval = setInterval(() => void _pollSfuStats(), 2000)
}
function _stopSfuStatsPolling(): void {
  if (_sfuStatsInterval) { clearInterval(_sfuStatsInterval); _sfuStatsInterval = null }
}
async function _pollSfuStats(): Promise<void> {
  const st = await bascule.basculeCollectStats()
  const peers = get(voiceStore).peers
  peerStatsStore.update(map => {
    for (const p of peers) {
      const u = st.perUser.get(p.userId)
      map.set(p.socketId, {
        rtt:            st.rtt,          // mon ping vers le SFU
        theirRtt:       null,            // leur leg vers le SFU : non exposé en v1
        packetLoss:     u?.packetLoss ?? null,
        jitter:         u?.jitter ?? null,
        connectionType: st.connType,
      })
    }
    return new Map(map)
  })
}

// ── Miroir des écrans SFU vers les stores de l'UI (P2) ───────────────────────
// En SFU, les écrans arrivent par voiceSfu, clés par userId. L'UI, elle, lit
// remoteScreenStore, clé par socketId. On REFLÈTE donc les uns dans les autres via
// le roster, exactement comme le poller de stats. Résultat : aucun composant d'UI
// à toucher, la Scène et le salon affichent l'SFU comme ils affichaient le mesh.
let _unsubSfuScreens:       (() => void) | null = null
let _unsubSfuLocalScreen:   (() => void) | null = null
let _unsubRosterForScreens: (() => void) | null = null

function _syncSfuScreens(): void {
  const peers = get(voiceStore).peers
  const next  = new Map<string, MediaStream>()
  for (const sc of get(bascule.basculeScreensStore)) {
    const peer = peers.find(p => p.userId === sc.userId)
    if (peer) next.set(peer.socketId, sc.stream)
  }
  // N'émettre QUE si le contenu a réellement changé. On est abonné au roster, qui
  // frémit sans arrêt (parole, niveaux…) : republier une Map neuve à chaque fois
  // ferait re-rendre l'UI et réattacher les <video> pour rien. Or réassigner
  // srcObject réinitialise l'élément (noir jusqu'à la keyframe suivante).
  const cur = get(remoteScreenStore)
  if (cur.size === next.size) {
    let identical = true
    for (const [socketId, stream] of next) {
      if (cur.get(socketId) !== stream) { identical = false; break }
    }
    if (identical) return
  }
  remoteScreenStore.set(next)
}

function _startSfuScreenMirror(): void {
  _stopSfuScreenMirror()
  _unsubSfuScreens = bascule.basculeScreensStore.subscribe(() => _syncSfuScreens())
  // Le roster peut se peupler APRÈS l'arrivée d'un flux : sans ça, le mapping
  // userId → socketId échouerait une fois et l'écran ne s'afficherait jamais.
  _unsubRosterForScreens = voiceStore.subscribe(() => {
    if (_channelMode === 'sfu') _syncSfuScreens()
  })
  _unsubSfuLocalScreen = bascule.basculeLocalScreenStore.subscribe(stream => {
    localScreenStore.set(stream)
    screenShareStore.set(stream !== null)
  })
}

function _stopSfuScreenMirror(): void {
  _unsubSfuScreens?.();       _unsubSfuScreens = null
  _unsubRosterForScreens?.(); _unsubRosterForScreens = null
  _unsubSfuLocalScreen?.();   _unsubSfuLocalScreen = null
}

function onVoiceModeEvent({ channelId, mode }: { channelId: string; mode: 'sfu' | 'mesh' }): void {
  if (mode === 'sfu') {
    if (_channelMode !== 'mesh') return            // déjà en switching/sfu
    _channelMode = 'switching'
    // Garder le mesh + établir l'SFU (lecture immédiate) ; chaque flux SFU coupe
    // le mesh de la personne concernée. Puis confirmer au serveur.
    if (_socket) void bascule.basculeBeginSwitch(_socket, channelId, _meshMutePeerByUserId)
  } else if (mode === 'mesh') {                    // abandon décidé par le serveur
    if (_channelMode === 'switching') {
      _channelMode = 'mesh'
      void bascule.basculeLeaveSfu()               // on lâche l'SFU, le mesh (jamais lâché) reste
      _stopSfuStatsPolling()
      _stopSfuScreenMirror()
    }
  }
}

function onSfuCommitEvent(_payload: { channelId: string }): void {
  _channelMode = 'sfu'
  // Un partage d'écran mesh EN COURS doit suivre la bascule. On capture sa piste
  // AVANT le teardown : le démontage ferme les PC mais ne stoppe pas le flux local,
  // donc on peut le republier tel quel vers l'SFU. Sans ça il faudrait rouvrir le
  // sélecteur d'écran, ce que le navigateur refuse hors geste utilisateur : le
  // partage mourrait à la bascule.
  const meshScreen = _screenStream
  // Instant zéro-coupure : joue l'SFU, coupe puis démonte le mesh.
  bascule.basculeCommit(_meshMutePlayback, _meshTeardownConnections)
  _startSfuStatsPolling()  // le panneau réseau se remplit depuis l'SFU
  _startSfuScreenMirror()  // les écrans SFU alimentent les stores de l'UI
  if (meshScreen) {
    _screenStream = null   // le mesh ne le porte plus, l'SFU prend le relais
    void bascule.basculeStartScreenShare({ existingStream: meshScreen })
  }
}

async function onOffer({ from, sdp, channelId }: { from: string; sdp: RTCSessionDescriptionInit; channelId: string }): Promise<void> {
  // Serialize: drop concurrent onOffer calls for the same peer (they would race on setLocalDescription)
  if (_offerLocks.get(from)) {
    console.debug(`[voice] onOffer from ${from.slice(0,6)} dropped — already processing`)
    return
  }
  _offerLocks.set(from, true)
  try {
    let pc = _peerConns.get(from)
    if (!pc) pc = createPeerConn(from, channelId, false)

    // Perfect negotiation: initiator = polite (rolls back own offer on collision)
    const isPolite       = _initiatorMap.get(from) ?? false
    const offerCollision = pc.signalingState !== 'stable'

    if (offerCollision) {
      if (!isPolite) {
        // Impolite peer ignores the incoming offer — our own offer takes precedence
        console.debug(`[voice] onOffer collision ignored (impolite) for ${from.slice(0,6)}`)
        return
      }
      // Polite peer rolls back its own pending offer to accept the remote's
      await pc.setLocalDescription({ type: 'rollback' })
    }

    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    await flushICEQueue(from, pc)

    // Guard: only answer if we actually have a remote offer pending
    if (pc.signalingState !== 'have-remote-offer') return

    const answer   = await pc.createAnswer()
    const tunedSdp = applyOpusTuning(answer.sdp ?? '', get(voiceSettingsStore).bitrate, _peerConns.size)

    // Final state guard before writing local description
    if (pc.signalingState !== 'have-remote-offer') return

    await pc.setLocalDescription({ type: 'answer', sdp: tunedSdp })
    _socket?.emit('voice:answer', { to: from, sdp: pc.localDescription, channelId })
  } catch (e) {
    console.warn('[voice] onOffer error:', e)
  } finally {
    _offerLocks.set(from, false)
  }
}

async function onAnswer({ from, sdp }: { from: string; sdp: RTCSessionDescriptionInit }): Promise<void> {
  const pc = _peerConns.get(from)
  if (!pc) return
  // Guard: only accept an answer when we actually sent an offer
  if (pc.signalingState !== 'have-local-offer') {
    console.debug(`[voice] onAnswer from ${from.slice(0,6)} ignored — signalingState is '${pc.signalingState}'`)
    return
  }
  try {
    await pc.setRemoteDescription(new RTCSessionDescription(sdp))
    await flushICEQueue(from, pc)
  } catch (e) {
    console.warn('[voice] onAnswer error:', e)
  }
}

async function onICE({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }): Promise<void> {
  const pc = _peerConns.get(from)
  if (!pc || !pc.remoteDescription) {
    const queue = _iceQueues.get(from) ?? []
    queue.push(candidate)
    _iceQueues.set(from, queue)
    return
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate))
  } catch { /* stale */ }
}

function onSpeaking({ socketId, speaking }: { socketId: string; speaking: boolean }): void {
  voiceStore.update(s => ({
    ...s,
    peers: s.peers.map(p => p.socketId === socketId ? { ...p, speaking } : p),
  }))
}

function onPeerStats({ from, rtt }: { from: string; rtt: number | null }): void {
  peerStatsStore.update(map => {
    const cur = map.get(from) ?? { rtt: null, theirRtt: null, packetLoss: null, jitter: null, connectionType: 'unknown' as const }
    map.set(from, { ...cur, theirRtt: rtt })
    return new Map(map)
  })
}

function onVoiceFull({ channelId, max }: { channelId: string; max: number }): void {
  voiceFullStore.set({ channelId, max })
  leaveVoice()
  // Auto-clear the error after 5s
  setTimeout(() => voiceFullStore.set(null), 5000)
}

function onKicked({ channelId, by }: { channelId: string; by: string }): void {
  voiceKickedStore.set({ channelId, by })
  leaveVoice()
  // Auto-clear the toast after 6s
  setTimeout(() => voiceKickedStore.set(null), 6000)
}
