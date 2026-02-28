/**
 * Nexus Voice — WebRTC P2P audio manager
 *
 * Architecture Phase 2 : mesh direct via Socket.IO signaling
 * Architecture Phase 3 : remplacer le transport Socket.IO par DHT/libp2p
 */
import { writable, derived, get } from 'svelte/store'
import type { Socket } from 'socket.io-client'
import { voiceSettingsStore, type VoiceSettings } from './voiceSettings'
export { voiceSettingsStore } from './voiceSettings'
export type { VoiceSettings } from './voiceSettings'

// ── ICE Configuration ─────────────────────────────────────────────

const BASE_STUN: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
]

// Nexus self-hosted TURN relay
// TCP en premier : les mappings NAT TCP durent 30+ min vs ~3 min pour UDP
// → évite les micro-déconnexions liées au timeout NAT UDP de la BBOX
const FALLBACK_TURN: RTCIceServer = {
  urls: [
    // IP LAN : pour les clients sur le même réseau que le serveur TURN
    // (sans ça, le hairpin NAT bloque l'allocation relay via l'IP publique)
    'turn:192.168.1.100:3478',
    // IP publique : pour les clients externes
    'turn:pokled.ddns.net:3478',
  ],
  username:   'guest',
  credential: 'changeme',
}

let _extraIceServers: RTCIceServer[] = []

/** Call before joinVoice() to inject TURN credentials from env/settings */
export function configureICE(servers: RTCIceServer[]): void {
  _extraIceServers = servers
  console.debug('[voice] ICE configured with', servers.length, 'extra server(s)')
}

function getIceServers(): RTCIceServer[] {
  // Always include fallback TURN + any env-injected servers
  return [...BASE_STUN, FALLBACK_TURN, ..._extraIceServers]
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
  connectionType: 'relay' | 'direct' | 'unknown'
}

export type NetQuality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

export const peerStatsStore = writable<Map<string, PeerStats>>(new Map())

// ── Screen share stores ────────────────────────────────────────────
export const screenShareStore  = writable<boolean>(false)
export const localScreenStore  = writable<MediaStream | null>(null)
export const remoteScreenStore = writable<Map<string, MediaStream>>(new Map())

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

const _statsIntervals = new Map<string, ReturnType<typeof setInterval>>()
const _prevPackets    = new Map<string, { received: number; lost: number }>()

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
          const dLost = lost     - prev.lost
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
  } catch { /* peer déconnecté */ }
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
  ctx:    AudioContext
  hp:     BiquadFilterNode
  eqMud:  BiquadFilterNode
  eqPres: BiquadFilterNode
  eqAir:  BiquadFilterNode
  gain:   GainNode
  dest:   MediaStreamAudioDestinationNode
}

let _localChain: LocalChain | null = null

async function _buildLocalChain(rawStream: MediaStream): Promise<MediaStream> {
  _teardownLocalChain()

  const s   = get(voiceSettingsStore)
  const ctx = new AudioContext({ sampleRate: 48000 })
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

  // ── Destination → track stable pour WebRTC ───────────────────────
  const dest = ctx.createMediaStreamDestination()

  // Câblage
  head.connect(hp)
  hp.connect(eqMud)
  eqMud.connect(eqPres)
  eqPres.connect(eqAir)
  eqAir.connect(gain)
  gain.connect(dest)

  _localChain = { ctx, hp, eqMud, eqPres, eqAir, gain, dest }
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

  // Toggle RNNoise → rebuild + replaceTrack ─────────────────────
  if ('rnnoiseEnabled' in patch && _localStream) {
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
  ctx:         AudioContext | null  // null si la création AudioContext échoue
  analyser:    AnalyserNode | null
  vadInterval: ReturnType<typeof setInterval>
}

const _peerAudio = new Map<string, PeerAudio>()

function createPeerAudio(socketId: string, stream: MediaStream): void {
  destroyPeerAudio(socketId)

  // ── Lecture directe — fonctionne sur TOUS les navigateurs (Chrome, Firefox, iOS Safari)
  // NE PAS router via MediaStreamDestinationNode : l'AudioContext peut être suspendu
  // hors d'un geste utilisateur, rendant dest.stream silencieux.
  const audioEl     = new Audio()
  audioEl.srcObject = stream
  audioEl.autoplay  = true
  audioEl.volume    = 1.0
  audioEl.play().catch(() => { /* résolu au prochain geste utilisateur */ })

  // ── AudioContext uniquement pour VAD (niveau d'entrée → indicateur "parle")
  // Si le contexte est suspendu, on perd juste l'indicateur visuel — l'audio joue quand même.
  let ctx:      AudioContext | null = null
  let analyser: AnalyserNode | null = null
  try {
    ctx = new AudioContext()
    const source = ctx.createMediaStreamSource(stream)
    analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    // Pas de connexion à ctx.destination ni à MediaStreamDestination —
    // le son sort déjà via audioEl.srcObject = stream
    ctx.resume().catch(() => {})
  } catch {
    ctx = null
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

  _peerAudio.set(socketId, { audioEl, ctx, analyser, vadInterval })
}

function destroyPeerAudio(socketId: string): void {
  const node = _peerAudio.get(socketId)
  if (node) {
    clearInterval(node.vadInterval)
    node.audioEl.pause()
    node.audioEl.srcObject = null
    try { node.analyser?.disconnect() } catch { /* déjà déconnecté */ }
    node.ctx?.close().catch(() => {})
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

function applyOpusTuning(sdp: string, bitrateKbps = 64): string {
  const rtpMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/)
  if (!rtpMatch) return sdp
  const pt      = rtpMatch[1]
  const bpsStr  = String(bitrateKbps * 1000)

  const existingFmtp = new RegExp(`a=fmtp:${pt} (.*)`)
  if (existingFmtp.test(sdp)) {
    return sdp.replace(existingFmtp, (_: string, params: string) => {
      const existing = Object.fromEntries(params.split(';').map((p: string) => {
        const idx = p.indexOf('=')
        return idx !== -1 ? [p.slice(0, idx), p.slice(idx + 1)] : [p, '']
      }))
      const merged = {
        ...existing,
        maxaveragebitrate: bpsStr,
        maxplaybackrate:   '48000',
        useinbandfec:      '1',
        usedtx:            '1',
        cbr:               '0',
      }
      return `a=fmtp:${pt} ${Object.entries(merged).map(([k, v]) => v ? `${k}=${v}` : k).join(';')}`
    })
  } else {
    return sdp.replace(
      `a=rtpmap:${pt} opus/48000/2\r\n`,
      `a=rtpmap:${pt} opus/48000/2\r\na=fmtp:${pt} maxaveragebitrate=${bpsStr};maxplaybackrate=48000;useinbandfec=1;usedtx=1;cbr=0\r\n`,
    )
  }
}

// ── Peer connection factory ───────────────────────────────────────

function createPeerConn(
  remoteSocketId: string,
  channelId: string,
  isInitiator: boolean,
): RTCPeerConnection {
  const iceConfig = getIceServers()
  console.debug(`[ICE config] ${remoteSocketId.slice(0,6)} servers:`, iceConfig.map(s => s.urls))
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
      const addr  = candidate.address ?? ''
      console.debug(`[ICE gather] ${remoteSocketId.slice(0,6)} candidate: ${type} ${proto} ${addr}`)
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
        const tunedSdp = applyOpusTuning(offer.sdp ?? '', bitrate)
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

  stopVAD('__local__')
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

type AudioEntry = { ctx: AudioContext; analyser: AnalyserNode; interval: ReturnType<typeof setInterval> }
const _audioCtxMap = new Map<string, AudioEntry>()

function startLocalVAD(channelId: string): void {
  stopVAD('__local__')
  if (!_localStream) return
  try {
    const ctx      = new AudioContext()
    const source   = ctx.createMediaStreamSource(_localStream)
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    let lastSpeaking = false
    const interval = setInterval(() => {
      analyser.getByteFrequencyData(data)
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
    _audioCtxMap.set('__local__', { ctx, analyser, interval })
  } catch { /* ignore */ }
}

function stopVAD(key: string): void {
  const entry = _audioCtxMap.get(key)
  if (entry) {
    clearInterval(entry.interval)
    entry.ctx.close().catch(() => {})
    _audioCtxMap.delete(key)
  }
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
}

export function leaveVoice(): void {
  const { channelId } = get(voiceStore)
  if (channelId && _socket) {
    _socket.emit('voice:leave', channelId)
  }

  if (_socket) {
    _socket.off('voice:init',        onVoiceInit)
    _socket.off('voice:peer_joined', onPeerJoined)
    _socket.off('voice:peer_left',   onPeerLeft)
    _socket.off('voice:offer',       onOffer)
    _socket.off('voice:answer',      onAnswer)
    _socket.off('voice:ice',         onICE)
    _socket.off('voice:speaking',    onSpeaking)
    _socket.off('voice:stats',       onPeerStats)
    if (_onSocketReconnect) {
      _socket.off('connect', _onSocketReconnect)
      _onSocketReconnect = null
    }
  }

  if (_rejoinTimer) { clearTimeout(_rejoinTimer); _rejoinTimer = null }

  for (const [sid, pc] of _peerConns) {
    destroyPeerAudio(sid)
    pc.close()
  }
  _peerConns.clear()
  _iceQueues.clear()

  stopVAD('__local__')

  _localStream?.getTracks().forEach(t => t.stop())
  _localStream = null
  _teardownLocalChain()
  _processedStream = null

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

export async function startScreenShare(displaySurface: DisplaySurface = 'monitor'): Promise<void> {
  const { channelId } = get(voiceStore)
  if (!channelId || !_socket) return

  try {
    const displayStream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface, cursor: 'always' } as any,
      audio: false,
    })

    _screenStream = displayStream
    localScreenStore.set(displayStream)
    screenShareStore.set(true)

    const videoTrack = displayStream.getVideoTracks()[0]
    videoTrack.onended = () => stopScreenShare()

    for (const [socketId, pc] of _peerConns) {
      try {
        pc.addTrack(videoTrack, displayStream)
        if (pc.signalingState === 'stable') {
          const offer    = await pc.createOffer()
          const tunedSdp = applyOpusTuning(offer.sdp ?? '')
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
        .then(offer => pc.setLocalDescription({ type: 'offer', sdp: applyOpusTuning(offer.sdp ?? '') }))
        .then(() => { _socket?.emit('voice:offer', { to: socketId, sdp: pc.localDescription, channelId }) })
        .catch(() => { /* peer may have disconnected */ })
    }
  }
}

// ── Socket event handlers ─────────────────────────────────────────

function onVoiceInit({ channelId, peers, mySeatIndex }: {
  channelId:   string
  peers:       { socketId: string; userId: string; username: string; avatar: string | null; seatIndex: number }[]
  mySeatIndex: number
}): void {
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

  for (const peer of peers) {
    createPeerConn(peer.socketId, channelId, true)
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
  if (!_peerConns.has(peer.socketId)) {
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
    const tunedSdp = applyOpusTuning(answer.sdp ?? '')

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
