/**
 * Nodyx Jukebox — synchronized YouTube player via Socket.IO voice room relay.
 *
 * Transport  : jukebox:update / jukebox:request_sync (relayed by nodyx-core voice socket)
 * Sync model : host emits state { videoId, playing, position, syncedAt }
 *              peers apply position + elapsed time drift on receive
 */
import { writable, get } from 'svelte/store'
import type { Socket } from 'socket.io-client'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JukeboxTrack {
  videoId: string
  title:   string
  addedBy: string
}

export interface JukeboxQueueItem {
  videoId: string
  title:   string
  addedBy: string
  votes:   string[]  // usernames who voted up
}

export type JukeboxRepeat = 'none' | 'track'

export interface JukeboxState {
  track:    JukeboxTrack | null
  playing:  boolean
  position: number   // seconds from video start at syncedAt
  syncedAt: number   // Date.now() when position was captured
  duration: number   // total video duration (0 = unknown)
  queue:    JukeboxQueueItem[]
  history:  JukeboxTrack[]   // last 10 played tracks
  repeat:   JukeboxRepeat
  shuffle:  boolean
}

// ── Stores ────────────────────────────────────────────────────────────────────

const _INIT: JukeboxState = {
  track: null, playing: false, position: 0, syncedAt: 0, duration: 0,
  queue: [], history: [], repeat: 'none', shuffle: false,
}
export const jukeboxStore = writable<JukeboxState>({ ..._INIT })

// Per-user volume + mute — localStorage-backed, never broadcast
function _lsNum(key: string, def: number) {
  if (typeof localStorage === 'undefined') return def
  const v = localStorage.getItem(key)
  return v !== null ? +v : def
}
function _lsBool(key: string, def: boolean) {
  if (typeof localStorage === 'undefined') return def
  const v = localStorage.getItem(key)
  return v !== null ? v === '1' : def
}
export const jukeboxVolume         = writable<number>(_lsNum('jb_vol', 80))
export const jukeboxMuted          = writable<boolean>(_lsBool('jb_muted', false))
export const jukeboxAutoplayBlocked = writable<boolean>(false)

// ── Internal state ────────────────────────────────────────────────────────────

let _socket:    Socket | null = null
let _channelId: string | null = null
let _username:  string        = ''
let _ytPlayer:  any           = null
let _ytReady    = false
let _pendingOp: (() => void) | null = null
let _progressTick: ReturnType<typeof setInterval> | null = null
let _suppressBroadcast = false  // prevents broadcasting during local unblock

// ── YouTube URL parsing ───────────────────────────────────────────────────────

export function parseYouTubeUrl(url: string): string | null {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  )
  return m ? m[1] : null
}

// ── YouTube IFrame API loader ─────────────────────────────────────────────────

function _loadYTApi(): Promise<void> {
  return new Promise(resolve => {
    if ((window as any).YT?.Player) { resolve(); return }
    const prev = (window as any).onYouTubeIframeAPIReady
    ;(window as any).onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') prev()
      resolve()
    }
    if (!document.getElementById('yt-api-script')) {
      const s    = document.createElement('script')
      s.id       = 'yt-api-script'
      s.src      = 'https://www.youtube.com/iframe_api'
      document.head.appendChild(s)
    }
  })
}

export async function mountYTPlayer(containerId: string): Promise<void> {
  if (_ytPlayer) return  // already mounted
  await _loadYTApi()
  return new Promise(resolve => {
    const YT = (window as any).YT
    _ytPlayer = new YT.Player(containerId, {
      width: '200', height: '113',
      playerVars: {
        controls: 0, modestbranding: 1, rel: 0,
        playsinline: 1, mute: 0, origin: window.location.origin,
      },
      events: {
        onReady: () => {
          _ytReady = true
          // Apply saved volume/mute immediately
          const vol   = get(jukeboxVolume)
          const muted = get(jukeboxMuted)
          _ytPlayer.setVolume(vol)
          if (muted) _ytPlayer.mute()
          if (_pendingOp) { _pendingOp(); _pendingOp = null }
          resolve()
        },
        onStateChange: ({ data }: { data: number }) => {
          // PLAYING=1, PAUSED=2 — broadcast state when player changes
          if (data === 1 || data === 2) _broadcastState()
          // ENDED=0 — auto-advance
          if (data === 0) _handleTrackEnd()
        },
      },
    })
  })
}

// ── Volume / Mute (local only, never broadcast) ───────────────────────────────

export function jukeboxSetVolume(v: number): void {
  const vol = Math.max(0, Math.min(100, Math.round(v)))
  jukeboxVolume.set(vol)
  if (typeof localStorage !== 'undefined') localStorage.setItem('jb_vol', String(vol))
  if (!_ytPlayer || !_ytReady) return
  _ytPlayer.setVolume(vol)
  if (vol === 0) _ytPlayer.mute()
  else if (!get(jukeboxMuted)) _ytPlayer.unMute()
}

export function jukeboxToggleMute(): void {
  const muted = !get(jukeboxMuted)
  jukeboxMuted.set(muted)
  if (typeof localStorage !== 'undefined') localStorage.setItem('jb_muted', muted ? '1' : '0')
  if (!_ytPlayer || !_ytReady) return
  if (muted) _ytPlayer.mute()
  else { _ytPlayer.unMute(); _ytPlayer.setVolume(get(jukeboxVolume)) }
}

// Called by user click — clears the autoplay-blocked banner and resumes playback
export function jukeboxUnblock(): void {
  jukeboxAutoplayBlocked.set(false)
  if (!_ytPlayer || !_ytReady) return
  const state = get(jukeboxStore)
  if (state.playing && state.track) {
    const target = _livePosition(state)
    // Suppress broadcast for 3s: loadVideoById triggers onStateChange(1) which calls
    // _broadcastState() with getCurrentTime()≈0 before seek resolves — this would
    // send position=0 to Morty who would rewind to 0 and broadcast back, creating a loop.
    _suppressBroadcast = true
    _ytPlayer.loadVideoById({ videoId: state.track.videoId, startSeconds: Math.floor(target) })
    setTimeout(() => { _suppressBroadcast = false }, 3000)
  }
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

function _livePosition(state: JukeboxState): number {
  if (!state.playing || !state.syncedAt) return state.position
  return state.position + (Date.now() - state.syncedAt) / 1000
}

function _broadcastState(): void {
  if (_suppressBroadcast) return
  if (!_socket || !_channelId || !_ytPlayer || !_ytReady) return
  const playing  = _ytPlayer.getPlayerState?.() === 1
  const position = _ytPlayer.getCurrentTime?.() ?? 0
  const duration = _ytPlayer.getDuration?.() ?? 0
  const state: JukeboxState = {
    ...get(jukeboxStore),
    playing, position, duration,
    syncedAt: Date.now(),
  }
  jukeboxStore.set(state)
  _socket.emit('jukebox:update', { channelId: _channelId, state })
}

function _applyState(state: JukeboxState): void {
  jukeboxStore.set(state)
  const apply = () => {
    if (!_ytPlayer || !_ytReady) { _pendingOp = () => _applyState(state); return }
    const prev      = get(jukeboxStore)
    const sameVideo = prev.track?.videoId === state.track?.videoId
    const target    = _livePosition(state)

    if (state.track) {
      if (!sameVideo) {
        // New video: load, then explicitly play/pause
        _ytPlayer.loadVideoById({ videoId: state.track.videoId, startSeconds: target })
        if (state.playing) {
          _ytPlayer.playVideo()
          setTimeout(() => _ytPlayer?.playVideo(), 600)
          // Detect browser autoplay blockage (socket event ≠ user gesture)
          // State 1=playing, 3=buffering → OK ; anything else → blocked
          setTimeout(() => {
            const ps = _ytPlayer?.getPlayerState?.()
            if (ps !== 1 && ps !== 3 && get(jukeboxStore).playing) {
              jukeboxAutoplayBlocked.set(true)
            }
          }, 2000)
        } else {
          setTimeout(() => _ytPlayer?.pauseVideo(), 800)
        }
      } else {
        // Same video: sync position if drift > 2.5s
        const cur = _ytPlayer.getCurrentTime?.() ?? 0
        if (Math.abs(cur - target) > 2.5) _ytPlayer.seekTo(target, true)
        if (state.playing) {
          _ytPlayer.playVideo()
          // Detect blockage for same-video play commands too
          setTimeout(() => {
            const ps = _ytPlayer?.getPlayerState?.()
            if (ps !== 1 && ps !== 3 && get(jukeboxStore).playing) {
              jukeboxAutoplayBlocked.set(true)
            }
          }, 2000)
        } else {
          _ytPlayer.pauseVideo()
        }
      }
    } else {
      _ytPlayer.stopVideo?.()
    }
  }
  apply()
  _startProgressLoop()
}

function _startProgressLoop(): void {
  if (_progressTick) return
  _progressTick = setInterval(() => {
    if (!_ytPlayer || !_ytReady) return
    const playing  = _ytPlayer.getPlayerState?.() === 1
    const position = _ytPlayer.getCurrentTime?.() ?? 0
    const duration = _ytPlayer.getDuration?.() ?? 0
    jukeboxStore.update(s => ({ ...s, playing, position, duration }))
  }, 500)
}

function _stopProgressLoop(): void {
  if (_progressTick) { clearInterval(_progressTick); _progressTick = null }
}

// ── Auto-advance ──────────────────────────────────────────────────────────────

function _handleTrackEnd(): void {
  const state = get(jukeboxStore)
  // Only the track's adder manages auto-advance — prevents multiple broadcasts
  if (state.track?.addedBy !== _username) return

  if (state.repeat === 'track') {
    _ytPlayer?.seekTo(0, true)
    _ytPlayer?.playVideo()
    setTimeout(_broadcastState, 200)
    return
  }
  _advanceQueue()
}

function _advanceQueue(): void {
  const state   = get(jukeboxStore)
  const history = state.track
    ? [state.track, ...state.history].slice(0, 10)
    : [...state.history]

  if (state.queue.length === 0) {
    // Queue empty — stop
    _ytPlayer?.stopVideo?.()
    _stopProgressLoop()
    const newState: JukeboxState = { ...state, track: null, playing: false, history }
    jukeboxStore.set(newState)
    _socket?.emit('jukebox:update', { channelId: _channelId, state: newState })
    return
  }

  // Pick next from queue: most votes wins; shuffle = random pick
  const queue  = [...state.queue]
  const sorted = state.shuffle
    ? [...queue].sort(() => Math.random() - 0.5)
    : [...queue].sort((a, b) => b.votes.length - a.votes.length)
  const next     = sorted[0]
  const nextIdx  = queue.findIndex(q => q.videoId === next.videoId && q.addedBy === next.addedBy)
  const newQueue = queue.filter((_, i) => i !== nextIdx)

  _ytPlayer?.loadVideoById({ videoId: next.videoId, startSeconds: 0 })
  _ytPlayer?.playVideo()
  setTimeout(() => _ytPlayer?.playVideo(), 600)

  const newState: JukeboxState = {
    ...state,
    track:    { videoId: next.videoId, title: next.title, addedBy: next.addedBy },
    playing:  true,
    position: 0,
    syncedAt: Date.now(),
    queue:    newQueue,
    history,
  }
  jukeboxStore.set(newState)
  _socket?.emit('jukebox:update', { channelId: _channelId, state: newState })
}

// ── Public API — lifecycle ────────────────────────────────────────────────────

export function initJukebox(socket: Socket, channelId: string, username: string): void {
  _socket    = socket
  _channelId = channelId
  _username  = username

  socket.on('jukebox:update', ({ state }: { from: string; state: JukeboxState }) => {
    _applyState(state)
  })

  socket.on('jukebox:request_sync', () => {
    const s = get(jukeboxStore)
    if (s.track && _socket) _socket.emit('jukebox:update', { channelId, state: s })
  })

  // Ask peers for current state on join
  socket.emit('jukebox:request_sync', channelId)
}

export function cleanupJukebox(socket: Socket): void {
  socket.off('jukebox:update')
  socket.off('jukebox:request_sync')
  _stopProgressLoop()
  try { _ytPlayer?.destroy?.() } catch { /* ignore */ }
  _ytPlayer  = null
  _ytReady   = false
  _pendingOp = null
  _socket    = null
  _channelId = null
  jukeboxStore.set({ ..._INIT })
  jukeboxAutoplayBlocked.set(false)
}

// ── Public API — user actions ─────────────────────────────────────────────────

export function jukeboxLoad(url: string): boolean {
  const videoId = parseYouTubeUrl(url)
  if (!videoId) return false

  jukeboxAutoplayBlocked.set(false)
  // ── Lancement direct dans le contexte du geste utilisateur ───────────────
  // Ne jamais mettre d'await avant ce bloc — le navigateur bloque playVideo()
  // si on sort du stack frame du clic (règle autoplay Chrome/Firefox).
  if (_ytPlayer && _ytReady) {
    _ytPlayer.loadVideoById({ videoId, startSeconds: 0 })
    _ytPlayer.playVideo()
  } else {
    _pendingOp = () => {
      _ytPlayer?.loadVideoById({ videoId, startSeconds: 0 })
      _ytPlayer?.playVideo()
    }
  }

  // Push current track to history, update store immediately
  const prev    = get(jukeboxStore)
  const history = prev.track
    ? [prev.track, ...prev.history].slice(0, 10)
    : prev.history

  const state: JukeboxState = {
    ...prev,
    track:    { videoId, title: 'Chargement…', addedBy: _username },
    playing:  true,
    position: 0,
    syncedAt: Date.now(),
    duration: 0,
    history,
  }
  jukeboxStore.set(state)
  _startProgressLoop()

  // Fetch title async — non-blocking
  fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${videoId}&format=json`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d?.title) return
      jukeboxStore.update(s =>
        s.track?.videoId === videoId
          ? { ...s, track: { ...s.track!, title: d.title } }
          : s
      )
      _socket?.emit('jukebox:update', { channelId: _channelId, state: get(jukeboxStore) })
    })
    .catch(() => { /* oEmbed can fail for private/age-restricted videos */ })

  // Broadcast full state after load
  setTimeout(() => _broadcastState(), 2000)
  return true
}

export function jukeboxPlay(): void {
  jukeboxAutoplayBlocked.set(false)
  _ytPlayer?.playVideo()
  setTimeout(_broadcastState, 200)
}

export function jukeboxPause(): void {
  _ytPlayer?.pauseVideo()
  setTimeout(_broadcastState, 200)
}

export function jukeboxSeek(seconds: number): void {
  _ytPlayer?.seekTo(seconds, true)
  setTimeout(_broadcastState, 200)
}

export function jukeboxClear(): void {
  _ytPlayer?.stopVideo?.()
  _stopProgressLoop()
  const state: JukeboxState = { ..._INIT }
  jukeboxStore.set(state)
  _socket?.emit('jukebox:update', { channelId: _channelId, state })
}

export function jukeboxAddToQueue(url: string): boolean {
  const videoId = parseYouTubeUrl(url)
  if (!videoId) return false

  const item: JukeboxQueueItem = { videoId, title: 'Chargement…', addedBy: _username, votes: [] }
  jukeboxStore.update(s => ({ ...s, queue: [...s.queue, item] }))
  _socket?.emit('jukebox:update', { channelId: _channelId, state: get(jukeboxStore) })

  fetch(`https://www.youtube.com/oembed?url=https://youtu.be/${videoId}&format=json`)
    .then(r => r.ok ? r.json() : null)
    .then(d => {
      if (!d?.title) return
      jukeboxStore.update(s => ({
        ...s,
        queue: s.queue.map(q =>
          q.videoId === videoId && q.addedBy === _username ? { ...q, title: d.title } : q
        ),
      }))
      _socket?.emit('jukebox:update', { channelId: _channelId, state: get(jukeboxStore) })
    })
    .catch(() => {})
  return true
}

export function jukeboxVote(videoId: string, addedBy: string): void {
  jukeboxStore.update(s => ({
    ...s,
    queue: s.queue.map(q => {
      if (q.videoId !== videoId || q.addedBy !== addedBy) return q
      const voted = q.votes.includes(_username)
      return { ...q, votes: voted ? q.votes.filter(v => v !== _username) : [...q.votes, _username] }
    }),
  }))
  _socket?.emit('jukebox:update', { channelId: _channelId, state: get(jukeboxStore) })
}

export function jukeboxRemoveFromQueue(videoId: string, addedBy: string): void {
  jukeboxStore.update(s => ({
    ...s,
    queue: s.queue.filter(q => !(q.videoId === videoId && q.addedBy === addedBy)),
  }))
  _socket?.emit('jukebox:update', { channelId: _channelId, state: get(jukeboxStore) })
}

export function jukeboxSkipNext(): void {
  _advanceQueue()
}

export function jukeboxSkipPrev(): void {
  const state = get(jukeboxStore)
  if (state.history.length === 0) return
  const [prev, ...rest] = state.history

  if (_ytPlayer && _ytReady) {
    _ytPlayer.loadVideoById({ videoId: prev.videoId, startSeconds: 0 })
    _ytPlayer.playVideo()
  } else {
    _pendingOp = () => {
      _ytPlayer?.loadVideoById({ videoId: prev.videoId, startSeconds: 0 })
      _ytPlayer?.playVideo()
    }
  }

  const newState: JukeboxState = {
    ...state,
    track:    prev,
    playing:  true,
    position: 0,
    syncedAt: Date.now(),
    history:  rest,
  }
  jukeboxStore.set(newState)
  _socket?.emit('jukebox:update', { channelId: _channelId, state: newState })
}

export function jukeboxToggleRepeat(): void {
  jukeboxStore.update(s => ({ ...s, repeat: s.repeat === 'none' ? 'track' : 'none' }))
  _socket?.emit('jukebox:update', { channelId: _channelId, state: get(jukeboxStore) })
}

export function jukeboxToggleShuffle(): void {
  jukeboxStore.update(s => ({ ...s, shuffle: !s.shuffle }))
  _socket?.emit('jukebox:update', { channelId: _channelId, state: get(jukeboxStore) })
}

export function jukeboxReplayFromHistory(track: JukeboxTrack): void {
  if (_ytPlayer && _ytReady) {
    _ytPlayer.loadVideoById({ videoId: track.videoId, startSeconds: 0 })
    _ytPlayer.playVideo()
  } else {
    _pendingOp = () => {
      _ytPlayer?.loadVideoById({ videoId: track.videoId, startSeconds: 0 })
      _ytPlayer?.playVideo()
    }
  }

  const prev    = get(jukeboxStore)
  const history = prev.track
    ? [prev.track, ...prev.history.filter(h => h.videoId !== track.videoId)].slice(0, 10)
    : prev.history.filter(h => h.videoId !== track.videoId)

  const state: JukeboxState = {
    ...prev,
    track:    track,
    playing:  true,
    position: 0,
    syncedAt: Date.now(),
    duration: 0,
    history,
  }
  jukeboxStore.set(state)
  _startProgressLoop()
  setTimeout(() => _broadcastState(), 2000)
}

// ── Utilities ─────────────────────────────────────────────────────────────────

export function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00'
  const m  = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}
