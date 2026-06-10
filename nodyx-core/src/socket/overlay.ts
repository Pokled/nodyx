// ─── Streamer Hub — Socket.IO namespace pour les overlays OBS ──────────────
// Les overlays sont des pages publiques (URL avec token) qui tournent dans
// OBS. Elles n'ont pas de JWT user, donc on les fait passer par un namespace
// séparé `/overlay` avec sa propre auth middleware basée sur le token row.
//
// Rooms par socket :
//   - overlay:<id>          → push de config spécifique à cet overlay
//   - overlay-type:<type>   → broadcast par type (alert_box reçoit tous les
//                              events follow/sub/raid/cheer)
//
// Dispatch côté event ingest : voir streamerHubService.ingestEvent qui
// appelle dispatchEventToOverlays() après persistence.

import type { Server, Socket } from 'socket.io'
import { findOverlayByToken, touchOverlayLastSeen, type OverlayType } from '../services/streamer/overlayService'

export const OVERLAY_NS = '/overlay'

export function registerOverlayNamespace(server: Server): void {
  const ns = server.of(OVERLAY_NS)

  // Auth middleware : valide le token côté DB. Si revoked → reject.
  ns.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next(new Error('Missing token'))

    const overlay = await findOverlayByToken(token).catch(() => null)
    if (!overlay) return next(new Error('Invalid or revoked token'))

    socket.data.overlayId   = overlay.id
    socket.data.overlayType = overlay.overlayType
    socket.data.createdBy   = overlay.createdBy
    next()
  })

  ns.on('connection', (socket: Socket) => {
    const overlayId   = socket.data.overlayId as string
    const overlayType = socket.data.overlayType as OverlayType
    const createdBy   = socket.data.createdBy as string | null

    socket.join(`overlay:${overlayId}`)
    socket.join(`overlay-type:${overlayType}`)

    // Soundboard : on join une room par owner, c'est elle qui reçoit les
    // events audio:play/stop/pause émis par le dispatch deck. Si plusieurs
    // overlays soundboard existent pour le même owner (ex: une browser
    // source par scène OBS), ils reçoivent tous le même flux → comportement
    // recherché.
    if (overlayType === 'soundboard' && createdBy) {
      socket.join(`soundboard:${createdBy}`)
    }

    // Playlist : un overlay par scène OBS peut tourner en parallèle, tous
    // dans la même room. Quand le streamer presse un bouton "playlist_control"
    // sur son Deck, le service envoie un event `playlist:control` à cette
    // room et chaque overlay applique localement (play/pause/skip/volume).
    if (overlayType === 'playlist' && createdBy) {
      socket.join(`playlist:${createdBy}`)
    }

    // Trace last connection pour le debug admin ("dernière connexion OBS").
    touchOverlayLastSeen(overlayId).catch(() => {})

    // Ack côté client pour qu'il sache qu'il est bien sub.
    socket.emit('overlay:ready', { overlayId, overlayType })

    // Soundboard : l'overlay nous signale la fin d'un son → on pop le suivant
    // de la queue et on le rebalance. Émetteur authentifié (auth middleware),
    // donc on fait confiance au signal. Pas de fallback timer côté backend :
    // si l'overlay crash en plein son, l'admin peut skip via l'UI admin.
    if (overlayType === 'soundboard' && createdBy) {
      socket.on('audio:ended', async () => {
        try {
          const [{ popNext }, { redis }, { resolveTrackForPlay }] = await Promise.all([
            import('../services/streamer/soundboardQueueService'),
            import('../config/database'),
            import('../services/streamer/audioLibraryService'),
          ])
          // Clear le now-playing avant de potentiellement le replacer avec le suivant.
          await redis.del(`soundboard:nowplaying:${createdBy}`).catch(() => 0)

          const next = await popNext(createdBy)
          if (!next) return            // queue vide, rien à jouer

          const track = await resolveTrackForPlay(next.trackId)
          if (!track) return           // track supprimé entre l'add et le pop

          // Émet vers tous les overlays soundboard du même owner (room shared).
          const ns = server.of(OVERLAY_NS)
          ns.to(`soundboard:${createdBy}`).emit('audio:play', {
            trackId:      track.id,
            fileUrl:      track.fileUrl,
            mimeType:     track.mimeType,
            title:        track.title,
            artist:       track.artist,
            thumbnailUrl: track.thumbnailUrl,
            durationMs:   track.durationMs,
            volume:       track.volumeDefault,
            fadeInMs:     track.fadeInMs,
            fadeOutMs:    track.fadeOutMs,
            loop:         track.loop,
          })
          // Persiste le now-playing pour la page publique (polling REST).
          const ttlSec = Math.max(60, Math.min(3600, Math.ceil(((track.durationMs ?? 0) / 1000) + 30)))
          await redis.setex(
            `soundboard:nowplaying:${createdBy}`,
            ttlSec,
            JSON.stringify({
              trackId:      track.id,
              title:        track.title,
              artist:       track.artist,
              thumbnailUrl: track.thumbnailUrl,
              durationMs:   track.durationMs,
              loop:         track.loop,
              startedAt:    Date.now(),
            }),
          )
        } catch (err) {
          console.warn('[overlay] audio:ended → queue consume failed', err)
        }
      })
    }
  })
}

// ── Dispatch — appelé depuis ingestEvent quand un event Twitch arrive ──────
// On expose une API simple pour que la couche service ne dépende pas de
// Socket.IO directement (testabilité).

export interface OverlayEvent {
  kind:        OverlayType            // type d'overlay à qui c'est destiné
  eventType:   string                  // ex: 'channel.follow'
  payload:     Record<string, unknown>
  occurredAt:  string
}

export function dispatchOverlayEvent(server: Server, evt: OverlayEvent): void {
  const ns = server.of(OVERLAY_NS)
  ns.to(`overlay-type:${evt.kind}`).emit('overlay:event', evt)
}
