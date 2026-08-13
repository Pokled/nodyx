/**
 * Nodyx Jukebox — synchronized YouTube player via Socket.IO voice room relay.
 *
 * Transport  : jukebox:update / jukebox:request_sync (relayed by nodyx-core voice socket)
 * Sync model : host emits state { videoId, playing, position, syncedAt }
 *              peers apply position + elapsed time drift on receive
 */
import { writable, get } from 'svelte/store'
import { browser } from '$app/environment'
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
  if (!browser) return def
  const v = localStorage.getItem(key)
  return v !== null ? +v : def
}
function _lsBool(key: string, def: boolean) {
  if (!browser) return def
  const v = localStorage.getItem(key)
  return v !== null ? v === '1' : def
}
export const jukeboxVolume         = writable<number>(_lsNum('jb_vol', 80))
export const jukeboxMuted          = writable<boolean>(_lsBool('jb_muted', false))
export const jukeboxAutoplayBlocked = writable<boolean>(false)

// True when audio is playing but muted because the browser refused unmuted
// autoplay (no user gesture yet). User clicks the "Activer le son" overlay
// to unmute and resync to the current host position.
export const jukeboxStartedMuted   = writable<boolean>(false)

// ── Internal state ────────────────────────────────────────────────────────────

let _socket:    Socket | null = null
let _channelId: string | null = null
let _username:  string        = ''
let _ytPlayer:  any           = null
let _ytReady    = false
let _pendingOp: (() => void) | null = null
let _progressTick: ReturnType<typeof setInterval> | null = null
let _suppressBroadcast = false  // prevents broadcasting during local unblock

// Has the user clicked anywhere in the jukebox (or its container) since
// joining the channel? Browsers allow unmuted playVideo() only after such a
// gesture. Until then, incoming "play" states from the host start MUTED with
// an overlay to enable sound. Reset on channel disconnect.
let _userInteracted = false

// Global listeners we install on first jukebox mount, removed on cleanup.
// They flip `_userInteracted` to true on the first real input from the user
// (any click, tap or key press anywhere on the page). Lets a member who
// joins a channel where music is already playing get unmuted audio as soon
// as they interact with the page once, without having to click the specific
// "Activer le son" button.
function _onAnyUserGesture(): void { _userInteracted = true }
let _gestureListenersAttached = false
function _attachGestureListeners(): void {
  if (_gestureListenersAttached || typeof document === 'undefined') return
  document.addEventListener('pointerdown', _onAnyUserGesture, { once: false, capture: true, passive: true })
  document.addEventListener('keydown',     _onAnyUserGesture, { once: false, capture: true, passive: true })
  _gestureListenersAttached = true
}
function _detachGestureListeners(): void {
  if (!_gestureListenersAttached || typeof document === 'undefined') return
  document.removeEventListener('pointerdown', _onAnyUserGesture, { capture: true } as EventListenerOptions)
  document.removeEventListener('keydown',     _onAnyUserGesture, { capture: true } as EventListenerOptions)
  _gestureListenersAttached = false
}

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
  _attachGestureListeners()
  await _loadYTApi()
  return new Promise(resolve => {
    const YT = (window as any).YT
    _ytPlayer = new YT.Player(containerId, {
      width: '200', height: '113',
      playerVars: {
        // mute: 1 is the only autoplay-policy-safe default. Programmatic
        // _ytPlayer.mute() called from _applyState was racing against
        // playVideo() and sometimes losing, leaving the player stuck in
        // a CUED state with no audio AND no progress. Starting muted at
        // the iframe level guarantees autoplay works on every browser.
        // Ce démarrage muet DOIT être compensé par un unMute() explicite :
        // setVolume() sur un lecteur muet ne fait aucun son. Les deux endroits
        // qui le font sont onReady (préférence utilisateur) et jukeboxLoad
        // (dans la pile du clic). Ce commentaire affirmait auparavant que
        // jukeboxLoad démutait « immédiatement » : c'était faux, aucun unMute()
        // ne s'y trouvait, et l'hôte lançait sa musique en silence.
        // Les pairs sans geste utilisateur restent muets et voient la
        // bannière verte « Activer le son ».
        controls: 0, modestbranding: 1, rel: 0,
        playsinline: 1, mute: 1, origin: window.location.origin,
      },
      events: {
        onReady: () => {
          _ytReady = true
          // Apply saved volume/mute immediately
          const vol   = get(jukeboxVolume)
          const muted = get(jukeboxMuted)
          _ytPlayer.setVolume(vol)
          // Le lecteur démarre avec playerVars.mute=1 (garantie anti-autoplay).
          // setVolume() sur un lecteur muet ne produit AUCUN son : il faut un
          // unMute() explicite, sinon l'hôte lance sa piste et n'entend rien.
          if (muted) _ytPlayer.mute()
          else       _ytPlayer.unMute()
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
  if (browser) localStorage.setItem('jb_vol', String(vol))
  if (!_ytPlayer || !_ytReady) return
  _ytPlayer.setVolume(vol)
  if (vol === 0) _ytPlayer.mute()
  else if (!get(jukeboxMuted)) _ytPlayer.unMute()
}

export function jukeboxToggleMute(): void {
  const muted = !get(jukeboxMuted)
  jukeboxMuted.set(muted)
  if (browser) localStorage.setItem('jb_muted', muted ? '1' : '0')
  if (!_ytPlayer || !_ytReady) return
  if (muted) _ytPlayer.mute()
  else { _ytPlayer.unMute(); _ytPlayer.setVolume(get(jukeboxVolume)) }
}

// Called by user click — clears the autoplay-blocked banner and resumes playback
export function jukeboxUnblock(): void {
  jukeboxAutoplayBlocked.set(false)
  jukeboxStartedMuted.set(false)
  // Ce bouton chargeait bien la vidéo, mais restait conditionné à
  // `state.playing`, que la boucle de progression remet à false chez un
  // auditeur dont le lecteur est vide : il ne faisait alors rien. Et il ne
  // lançait ni ne démutait ensuite.
  //
  // La suppression de diffusion reste nécessaire : charger une vidéo déclenche
  // onStateChange(1), donc _broadcastState() avec une position ≈0 avant que le
  // positionnement ait pris effet. Le pair rembobinerait à 0 et rediffuserait :
  // boucle.
  _suppressBroadcast = true
  setTimeout(() => { _suppressBroadcast = false }, 3000)
  _resyncFromUserGesture()
}

// Called by user click on the "Activer le son" overlay. The track is already
// playing muted (from a remote state arriving before any user gesture). This
// un-mutes the player, restores the user's volume preference, and resyncs to
// the host's current position so the audio is in time with what the listener
// has been seeing visually.
export function jukeboxEnableAudio(): void {
  jukeboxStartedMuted.set(false)
  jukeboxAutoplayBlocked.set(false)
  // Ce bouton faisait seekTo + playVideo SANS jamais charger la vidéo : sur le
  // lecteur d'un auditeur, resté vide, il ne produisait donc rien du tout.
  // On passe par le chemin unique, qui charge si nécessaire.
  _resyncFromUserGesture()
}

// ── Sync helpers ──────────────────────────────────────────────────────────────

function _livePosition(state: JukeboxState): number {
  if (!state.playing || !state.syncedAt) return state.position
  return state.position + (Date.now() - state.syncedAt) / 1000
}

/** Écart de position au-delà duquel on resynchronise (secondes). */
export const JUKEBOX_DRIFT_TOLERANCE = 0.8

/**
 * Rallume le son, sauf si l'utilisateur a explicitement coupé le sien.
 *
 * Indispensable après tout `loadVideoById` déclenché par un clic : le lecteur
 * démarre avec `playerVars.mute=1`, et un auditeur qui n'avait pas encore
 * interagi a pu être muté par `_syncPlayerTo`. Sans ça, changer de piste
 * rejoue en silence.
 */
function _unmuteIfWanted(): void {
  if (get(jukeboxMuted)) return
  try {
    _ytPlayer?.unMute()
    _ytPlayer?.setVolume(get(jukeboxVolume))
  } catch { /* ignore */ }
}

export type JukeboxAction =
  | { kind: 'load';  videoId: string; at: number; play: boolean }
  | { kind: 'seek';  at: number; play: boolean }
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'stop' }

/**
 * Décide QUOI faire du lecteur, sans le toucher.
 *
 * Cette fonction existe parce que le bug qu'elle corrige était invisible :
 * `_applyState` écrivait le store PUIS relisait ce même store pour savoir quel
 * morceau jouait « avant ». `prev` et `state` étaient donc le même objet, la
 * comparaison de videoId se faisait entre une valeur et elle-même, et valait
 * toujours vrai. Résultat : la branche qui appelle `loadVideoById` chez un
 * auditeur n'était JAMAIS atteinte. Son lecteur recevait `seekTo` et
 * `playVideo` sans avoir jamais reçu de vidéo : titre affiché, silence total.
 *
 * La référence n'est donc plus le store (qui décrit ce qu'on VEUT) mais
 * `loadedVideoId`, ce que le lecteur A réellement chargé. C'est idempotent,
 * insensible à l'ordre des appels, et auto-réparateur : un lecteur qui a perdu
 * sa vidéo la recharge au lieu de jouer dans le vide.
 */
export function decideJukeboxAction(
  loadedVideoId: string | null,
  currentTime:   number,
  state:         JukeboxState,
  livePosition:  number,
): JukeboxAction {
  if (!state.track) return { kind: 'stop' }

  if (loadedVideoId !== state.track.videoId) {
    return { kind: 'load', videoId: state.track.videoId, at: livePosition, play: state.playing }
  }

  if (Math.abs(currentTime - livePosition) > JUKEBOX_DRIFT_TOLERANCE) {
    return { kind: 'seek', at: livePosition, play: state.playing }
  }

  return state.playing ? { kind: 'play' } : { kind: 'pause' }
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

/**
 * Aligne le lecteur sur un état partagé. UNIQUE chemin autorisé.
 *
 * Tous les points d'entrée passent ici : réception d'un état distant, bouton
 * « Activer le son », bouton « Synchroniser », bouton lecture. Avant, chacun
 * bricolait sa propre séquence et TROIS d'entre eux faisaient seekTo/playVideo
 * sans jamais charger la vidéo : sur un lecteur vide, ils ne produisaient
 * strictement rien, et l'auditeur cliquait dans le vide.
 *
 * `forceAudio` = le geste utilisateur est certain (clic sur un bouton), donc on
 * démute sans se demander si un geste a eu lieu.
 */
function _syncPlayerTo(state: JukeboxState, opts: { forceAudio?: boolean } = {}): void {
  const apply = () => {
    if (!_ytPlayer || !_ytReady) { _pendingOp = () => _syncPlayerTo(state, opts); return }
    // Référence = ce que le lecteur a VRAIMENT chargé, pas le store. Voir le
    // commentaire de decideJukeboxAction : relire le store qu'on vient d'écrire
    // rendait la comparaison toujours vraie et tuait le chargement chez l'auditeur.
    const loadedId = _ytPlayer.getVideoData?.()?.video_id ?? null
    const current  = _ytPlayer.getCurrentTime?.() ?? 0
    const action   = decideJukeboxAction(loadedId, current, state, _livePosition(state))

    // Audio policy: the player boots with playerVars.mute=1 so unmuted
    // autoplay can never be denied. Two paths from here:
    //   - User has interacted at least once on the page (host clicking
    //     Play, anyone clicking anywhere on the document): un-mute now,
    //     restore the volume slider, and play with sound.
    //   - User has not interacted yet (peer joining a channel where
    //     music is already playing): leave the player muted, show the
    //     green "Activer le son" overlay, the user un-mutes on click
    //     via jukeboxEnableAudio().
    if (state.playing) {
      const userPrefMuted = get(jukeboxMuted)
      // forceAudio : l'appel vient d'un clic, le geste utilisateur est certain.
      if ((_userInteracted || opts.forceAudio) && !userPrefMuted) {
        try {
          _ytPlayer.unMute()
          _ytPlayer.setVolume(get(jukeboxVolume))
        } catch { /* ignore */ }
        jukeboxStartedMuted.set(false)
      } else if (!_userInteracted && !opts.forceAudio) {
        try { _ytPlayer.mute() } catch { /* ignore */ }
        jukeboxStartedMuted.set(true)
      }
    }

    // Détecteur d'autoplay bloqué. Il teste `state.playing` CAPTURÉ ici, et non
    // `get(jukeboxStore).playing` : la boucle de progression (toutes les 500 ms)
    // écrase `playing` avec l'état du lecteur local, donc à T+2000 ms le store
    // disait déjà `false` et ce détecteur ne se déclenchait jamais. Or la
    // bannière qu'il arme est le SEUL chemin d'un auditeur vers loadVideoById.
    const armBlockageProbe = () => {
      if (!state.playing) return
      setTimeout(() => {
        const ps = _ytPlayer?.getPlayerState?.()
        if (ps !== 1 && ps !== 3) jukeboxAutoplayBlocked.set(true)
      }, 2000)
    }

    switch (action.kind) {
      case 'stop':
        _ytPlayer.stopVideo?.()
        break

      case 'load':
        _ytPlayer.loadVideoById({ videoId: action.videoId, startSeconds: action.at })
        if (action.play) {
          _ytPlayer.playVideo()
          setTimeout(() => _ytPlayer?.playVideo(), 600)
          armBlockageProbe()
        } else {
          setTimeout(() => _ytPlayer?.pauseVideo(), 800)
        }
        break

      case 'seek':
        _ytPlayer.seekTo(action.at, true)
        if (action.play) { _ytPlayer.playVideo(); armBlockageProbe() }
        else             { _ytPlayer.pauseVideo() }
        break

      case 'play':
        _ytPlayer.playVideo()
        armBlockageProbe()
        break

      case 'pause':
        _ytPlayer.pauseVideo()
        break
    }
  }
  apply()
  _startProgressLoop()
}

/** Réception d'un état distant : on mémorise, puis on aligne le lecteur. */
function _applyState(state: JukeboxState): void {
  jukeboxStore.set(state)
  _syncPlayerTo(state)
}

/**
 * Aligne le lecteur sur l'état partagé COURANT, avec certitude d'un geste
 * utilisateur. C'est ce qu'appellent les boutons de secours : eux seuls
 * peuvent garantir que le navigateur autorisera le son.
 */
function _resyncFromUserGesture(): void {
  _userInteracted = true
  _syncPlayerTo(get(jukeboxStore), { forceAudio: true })
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

  _unmuteIfWanted(); _ytPlayer?.loadVideoById({ videoId: next.videoId, startSeconds: 0 })
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

  // Ask peers for the current jukebox state — but with retries.
  //
  // The server gates `jukebox:request_sync` behind `socket.rooms.has(voiceRoom)`,
  // and that membership only lands a few hundred ms AFTER the client's
  // `voice:join` is acked. A single emit at t=0 lands before the server has us
  // in the room, gets dropped silently, and the joiner ends up with an empty
  // store while music is happily playing for everyone else.
  //
  // We retry up to 6 times spaced 700ms apart (≈4 s window), stopping as soon
  // as we receive a track via the `jukebox:update` listener above.
  let tries = 0
  const trySync = () => {
    if (tries >= 6) return
    if (!_socket || !_channelId) return
    if (get(jukeboxStore).track) return  // already in sync, stop
    tries++
    _socket.emit('jukebox:request_sync', _channelId)
    setTimeout(trySync, 700)
  }
  setTimeout(trySync, 150)
}

export function cleanupJukebox(socket: Socket): void {
  socket.off('jukebox:update')
  socket.off('jukebox:request_sync')
  _stopProgressLoop()
  _detachGestureListeners()
  try { _ytPlayer?.destroy?.() } catch { /* ignore */ }
  _ytPlayer        = null
  _ytReady         = false
  _pendingOp       = null
  _socket          = null
  _channelId       = null
  _userInteracted  = false
  jukeboxStore.set({ ..._INIT })
  jukeboxAutoplayBlocked.set(false)
  jukeboxStartedMuted.set(false)
}

// ── Public API — user actions ─────────────────────────────────────────────────

export function jukeboxLoad(url: string): boolean {
  const videoId = parseYouTubeUrl(url)
  if (!videoId) return false

  jukeboxAutoplayBlocked.set(false)
  // ── Lancement direct dans le contexte du geste utilisateur ───────────────
  // Ne jamais mettre d'await avant ce bloc — le navigateur bloque playVideo()
  // si on sort du stack frame du clic (règle autoplay Chrome/Firefox).
  // On démute ICI, dans la pile d'appel du clic : c'est ce que la politique
  // autoplay autorise. Sans ça, l'hôte jouait muet, et son SEUL démutage
  // automatique était _applyState, qui ne s'exécute que sur un événement
  // ENTRANT. Or le serveur exclut l'émetteur de son propre broadcast : il
  // dépendait donc de l'écho d'un pair, d'où le « parfois » et le besoin de
  // marteler pause/lecture jusqu'à ce qu'un écho tombe.
  if (_ytPlayer && _ytReady) {
    _ytPlayer.loadVideoById({ videoId, startSeconds: 0 })
    _unmuteIfWanted()
    _ytPlayer.playVideo()
  } else {
    _pendingOp = () => {
      _ytPlayer?.loadVideoById({ videoId, startSeconds: 0 })
      _unmuteIfWanted()
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
  jukeboxStartedMuted.set(false)
  // Ne faisait que playVideo(). Chez un auditeur dont le lecteur n'a jamais
  // recu de video, appuyer sur Lecture ne faisait donc rien : on passe par le
  // chemin unique, qui charge d'abord si nécessaire.
  const state = get(jukeboxStore)
  _userInteracted = true
  _syncPlayerTo({ ...state, playing: true }, { forceAudio: true })
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
    _unmuteIfWanted(); _ytPlayer.loadVideoById({ videoId: prev.videoId, startSeconds: 0 })
    _ytPlayer.playVideo()
  } else {
    _pendingOp = () => {
      _unmuteIfWanted(); _ytPlayer?.loadVideoById({ videoId: prev.videoId, startSeconds: 0 })
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
    _unmuteIfWanted(); _ytPlayer.loadVideoById({ videoId: track.videoId, startSeconds: 0 })
    _ytPlayer.playVideo()
  } else {
    _pendingOp = () => {
      _unmuteIfWanted(); _ytPlayer?.loadVideoById({ videoId: track.videoId, startSeconds: 0 })
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
