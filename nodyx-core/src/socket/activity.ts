// ── Nodyx Activities — relais temps-réel d'une activité dans un canal vocal ────
//
// Une "activité" est une extension (surface `type: "activity"`) rendue en iframe
// cross-origin dans un canal vocal. Elle n'a NI socket NI jeton propre : la page
// hôte relaie pour elle, via le socket déjà authentifié de l'utilisateur, et
// UNIQUEMENT dans la room `voice:<channelId>` que l'utilisateur a rejointe.
//
// Ce handler est le calque exact de `jukebox:update` (voir voice.ts) :
//   - `isUuid(channelId)` + `socket.rooms.has(voiceRoom(channelId))`  ← l'invariant
//   - payload opaque, plafonné en taille
//   - rate-limit par (userId, event)
//   - `from` est estampillé serveur (jamais fourni par l'invité)
//
// Cf SPECS/NODYX_ACTIVITIES_CDC.md §3.

import type { Server, Socket } from 'socket.io'
import { checkRateLimit } from './rateLimiter'
import { isUuid, voiceRoom } from './voice'

/** Plafond d'un message `activity:send` (JSON.stringify du payload). */
const MSG_MAX_BYTES = 8 * 1024
/** Plafond d'un snapshot `activity:snapshot` (chaîne base64). */
const SNAPSHOT_MAX_BYTES = 12 * 1024

type SendMsg = { channelId?: unknown; to?: unknown; payload?: unknown }
type SnapshotMsg = { channelId?: unknown; blob?: unknown }
type SyncMsg = { channelId?: unknown }

type Kind = 'send' | 'snapshot' | 'sync'

/**
 * Décision de relais, pure et testable (patron `voiceBascule`).
 * Ne fait rien si l'appelant n'est pas dans la room vocale ciblée.
 */
export async function activityRelay(
  socket: Socket, server: Server, kind: Kind, msg: SendMsg | SnapshotMsg | SyncMsg,
): Promise<void> {
  const { userId } = socket.data as { userId: string }

  if (checkRateLimit(userId, `activity:${kind}`)) return

  const channelId = (msg as { channelId?: unknown }).channelId
  if (!isUuid(channelId)) return
  const room = voiceRoom(channelId)
  if (!socket.rooms.has(room)) return

  if (kind === 'sync') {
    socket.to(room).emit('activity:sync_request', { from: userId })
    return
  }

  if (kind === 'snapshot') {
    const blob = (msg as SnapshotMsg).blob
    if (typeof blob !== 'string' || blob.length > SNAPSHOT_MAX_BYTES) return
    socket.to(room).emit('activity:snap', { from: userId, blob })
    return
  }

  // kind === 'send'
  const { to, payload } = msg as SendMsg
  let serialized: string
  try { serialized = JSON.stringify(payload ?? null) } catch { return }
  if (serialized.length > MSG_MAX_BYTES) return

  if (isUuid(to)) {
    // Envoi ciblé : uniquement les sockets de cet utilisateur, s'il est dans la room.
    const inRoom = await server.in(room).fetchSockets()
    for (const s of inRoom) {
      if ((s.data as { userId?: string }).userId === to) {
        server.to(s.id).emit('activity:msg', { from: userId, payload })
      }
    }
  } else {
    socket.to(room).emit('activity:msg', { from: userId, payload })
  }
}

export function registerActivityHandlers(socket: Socket, server: Server): void {
  socket.on('activity:send',         (m: SendMsg)     => void activityRelay(socket, server, 'send', m))
  socket.on('activity:snapshot',     (m: SnapshotMsg) => void activityRelay(socket, server, 'snapshot', m))
  socket.on('activity:sync_request', (m: SyncMsg)     => void activityRelay(socket, server, 'sync', m))
}
