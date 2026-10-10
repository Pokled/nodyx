import { Server, Socket } from 'socket.io'
import * as crypto from 'crypto'
import { checkRateLimit } from './rateLimiter'
import { db } from '../config/database'
// Bascule mesh↔SFU (§17-B) : additif & dormant. Flag OFF ⇒ channelMode()==='mesh'
// partout ⇒ les lignes ci-dessous se comportent EXACTEMENT comme avant.
import * as bascule from './voiceBascule'

type CommunityRole = 'owner' | 'admin' | 'moderator' | 'member'
const MOD_ROLES: ReadonlyArray<CommunityRole> = ['owner', 'admin', 'moderator']

export async function getCommunityRoleForChannel(
  channelId: string, userId: string,
): Promise<CommunityRole | null> {
  const { rows } = await db.query<{ role: CommunityRole }>(
    `SELECT cm.role
       FROM community_members cm
       JOIN channels c ON c.community_id = cm.community_id
      WHERE c.id = $1 AND cm.user_id = $2`,
    [channelId, userId],
  )
  return rows[0]?.role ?? null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(v: unknown): v is string { return typeof v === 'string' && UUID_RE.test(v) }

// Max size for jukebox state payload (10 KB)
const JUKEBOX_STATE_MAX = 10_240

// ── TURN credentials ─────────────────────────────────────────────────────────
// Dynamic time-limited credentials (nodyx-turn / coturn use-auth-secret style).
// TURN_SECRET + TURN_PUBLIC_IP env vars — set by install.sh.

// Exporté : réutilisé par GET /api/v1/instance/ice-servers (diagnostic admin),
// pour que tout consommateur reçoive des credentials FRAIS (jamais de statique).
export function buildIceServers(userId: string): object[] {
  const secret   = process.env.TURN_SECRET
  const ip       = process.env.TURN_PUBLIC_IP
  const port     = process.env.TURN_PORT || '3478'
  const fallback = process.env.STUN_FALLBACK_URLS  // relay mode: no nodyx-turn

  // No nodyx-turn configured — use fallback STUN URLs if provided
  if (!ip) {
    if (!fallback) return []
    return fallback.split(',').map(url => ({ urls: url.trim() }))
  }

  const servers: object[] = [{ urls: `stun:${ip}:${port}` }]
  if (secret) {
    const expires    = Math.floor(Date.now() / 1000) + 86400 // 24h TTL
    const username   = `${expires}:${userId}`
    const credential = crypto.createHmac('sha1', secret).update(username).digest('base64')
    servers.push({ urls: `turn:${ip}:${port}`, username, credential })
    // TURN-over-TCP (RFC 6062) — penetrates VPNs and strict firewalls that block UDP
    servers.push({ urls: `turn:${ip}:${port}?transport=tcp`, username, credential })
  }
  return servers
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VoicePeer {
  socketId:  string
  userId:    string
  username:  string
  avatar:    string | null
  seatIndex: number
}

// ── Seat management ───────────────────────────────────────────────────────────

const VOICE_MAX_SEATS = 25

const _voiceSeats = new Map<string, Map<string, number>>()

// ── P2P channel registry ───────────────────────────────────────────────────────
// channelId → Set of socketIds willing to do P2P in that text channel

const _p2pChannels = new Map<string, Set<string>>()

// Returns the assigned seat index, or null if the channel is full
function assignSeat(channelId: string, socketId: string): number | null {
  if (!_voiceSeats.has(channelId)) _voiceSeats.set(channelId, new Map())
  const seats = _voiceSeats.get(channelId)!
  const taken = new Set(seats.values())
  if (taken.size >= VOICE_MAX_SEATS) return null
  let seat = 0
  while (taken.has(seat)) seat++
  seats.set(socketId, seat)
  return seat
}

function freeSeat(channelId: string, socketId: string): void {
  _voiceSeats.get(channelId)?.delete(socketId)
  if (_voiceSeats.get(channelId)?.size === 0) _voiceSeats.delete(channelId)
}

function getChannelSeats(channelId: string): Map<string, number> {
  return _voiceSeats.get(channelId) ?? new Map()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function voiceRoom(channelId: string): string {
  return `voice:${channelId}`
}

async function broadcastVoiceChannelUpdate(
  server: Server, channelId: string, excludeSocketId?: string
): Promise<void> {
  const sockets = await server.in(voiceRoom(channelId)).fetchSockets()
  const seatsMap = getChannelSeats(channelId)
  const members = sockets
    .filter(s => s.id !== excludeSocketId)
    .map(s => ({
      userId:    s.data.userId,
      username:  s.data.username,
      avatar:    s.data.avatar ?? null,
      seatIndex: seatsMap.get(s.id) ?? 0,
      // État volatile publié par le client (voice:state). Permet à l'écran d'un
      // canal NON rejoint de montrer qui est muet / sourd / en train de partager.
      muted:     s.data.voiceState?.muted    === true,
      deafened:  s.data.voiceState?.deafened === true,
      sharing:   s.data.voiceState?.sharing  === true,
    }))
  // Emit to presence (sidebar overview) AND voice room (handles presence-join timing edge cases)
  server.to('presence').to(voiceRoom(channelId)).emit('voice:channel_update', { channelId, members })
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerVoiceHandlers(socket: Socket, server: Server): void {
  const { userId, username } = socket.data

  // ── voice:join ────────────────────────────────────────────────────────────
  socket.on('voice:join', async (channelId: string) => {
    if (!isUuid(channelId)) return

    // Access control: only members of the community owning this channel can join.
    // Without this check any authenticated socket could squat any voice channel
    // by guessing the channelId, receive the ICE servers + peer list, and
    // participate in WebRTC signaling.
    const accessRole = await getCommunityRoleForChannel(channelId, userId)
    if (!accessRole) return

    const room = voiceRoom(channelId)

    // Évacue les anciens sockets du même userId (page refresh, reconnexion rapide)
    // Sans ça, l'utilisateur apparaît en double le temps que l'ancien socket se déconnecte
    const stale = await server.in(room).fetchSockets()
    for (const s of stale) {
      if (s.data.userId === userId && s.id !== socket.id) {
        freeSeat(channelId, s.id)
        s.leave(room)
        server.to(room).emit('voice:peer_left', { channelId, socketId: s.id })
      }
    }

    // Assign seat BEFORE any await to prevent race condition when two users join simultaneously
    const mySeat = assignSeat(channelId, socket.id)
    if (mySeat === null) {
      socket.emit('voice:full', { channelId, max: VOICE_MAX_SEATS })
      return
    }

    // Collect current peers (exclude self — handles rejoin case)
    const existing = await server.in(room).fetchSockets()
    const seatsMap = getChannelSeats(channelId)
    const peers: VoicePeer[] = existing
      .filter(s => s.id !== socket.id && s.data.userId !== userId)
      .map(s => ({
        socketId:  s.id,
        userId:    s.data.userId,
        username:  s.data.username,
        avatar:    s.data.avatar ?? null,
        seatIndex: seatsMap.get(s.id) ?? 0,
      }))

    // État vocal volatile : on repart propre à chaque arrivée (un rejoin ne doit
    // pas traîner le « muet » d'une session précédente). Le client republie son
    // état réel juste après, via voice:state.
    socket.data.voiceState = null

    // Join the room
    socket.join(room)

    // Broadcast updated member list to presence room
    await broadcastVoiceChannelUpdate(server, channelId)

    // Send current peer list to the joiner (with their seat index + dynamic TURN creds).
    // `mode` : 'mesh' par défaut (flag off) ; 'switching'/'sfu' si la bascule est active
    // (un arrivant sur un canal déjà SFU rejoint directement l'SFU, cf §5 du CDC bascule).
    const chMode = bascule.channelMode(channelId)
    socket.emit('voice:init', { channelId, peers, mySeatIndex: mySeat, iceServers: buildIceServers(userId), mode: chMode })

    // Roster : on prévient TOUJOURS les pairs. voice:peer_joined peuple la liste des
    // participants (voiceStore.peers), indépendamment du média. C'est le CLIENT qui
    // décide de créer un PC mesh ou non selon le mode (en SFU : roster seul, le média
    // passe par l'SFU via voice:sfu_new_producer). Cf SPECS/NODYX_SFU_BASCULE.md.
    socket.to(room).emit('voice:peer_joined', {
      channelId,
      peer: {
        socketId:  socket.id,
        userId,
        username,
        avatar:    socket.data.avatar ?? null,
        seatIndex: mySeat,
      },
    })

    // Le seuil est-il franchi ? (no-op si le flag est off)
    bascule.onSeatCount(server, channelId, getChannelSeats(channelId).size)
  })

  // ── voice:leave ───────────────────────────────────────────────────────────
  socket.on('voice:leave', async (channelId: string) => {
    if (checkRateLimit(userId, 'voice:leave')) return
    if (!isUuid(channelId)) return
    const room = voiceRoom(channelId)
    if (!socket.rooms.has(room)) return
    socket.leave(room)
    freeSeat(channelId, socket.id)
    server.to(room).emit('voice:peer_left', { channelId, socketId: socket.id })
    await broadcastVoiceChannelUpdate(server, channelId)
    bascule.onLeave(server, channelId, socket.id, getChannelSeats(channelId).size)
  })

  // ── voice:sfu_ready — bascule (§17-B) ─────────────────────────────────────
  // Un client confirme que son SFU produit + consomme (audio prêt, pas encore joué).
  // no-op si le canal n'est pas en 'switching'. Le client émettra cet event à
  // l'étape 2 (frontend) ; inoffensif d'ici là (flag off).
  socket.on('voice:sfu_ready', ({ channelId }: { channelId: string }) => {
    if (!isUuid(channelId)) return
    bascule.onSfuReady(server, channelId, socket.id)
  })

  // ── voice:screenshare_intent — le partage d'écran DÉCLENCHE la bascule ─────
  // Le partage est précisément le moment où le mesh s'écroule (le partageur y
  // uploade sa vidéo une fois PAR spectateur). On ne l'attend donc pas : dès qu'un
  // partage commence, on bascule, sans quorum. Le client, lui, a déjà capturé son
  // écran et le publie en mesh ; il migrera vers le SFU au commit, sans redemander
  // l'écran à l'utilisateur. No-op si le canal est déjà en bascule ou en SFU, ou si
  // le flag est off (mesh strictement inchangé).
  socket.on('voice:screenshare_intent', ({ channelId }: { channelId: string }) => {
    if (checkRateLimit(userId, 'voice:screenshare_intent')) return
    if (!isUuid(channelId)) return
    // Sans ce garde, n'importe quel socket connu pouvait forcer la bascule
    // SFU d'un canal vocal étranger en boucle (trouvé en audit le 16/09).
    if (!socket.rooms.has(voiceRoom(channelId))) return
    bascule.onScreenShare(server, channelId)
  })

  // ── voice:kick — moderator action ─────────────────────────────────────────
  // Forces a peer out of a voice channel. Permitted to community
  // owner / admin / moderator. Moderators cannot kick admins or owners.
  socket.on('voice:kick', async (
    { channelId, targetSocketId }: { channelId: string; targetSocketId: string },
  ) => {
    if (checkRateLimit(userId, 'voice:kick')) return
    if (!isUuid(channelId) || typeof targetSocketId !== 'string') return

    const room = voiceRoom(channelId)
    if (!socket.rooms.has(room)) return

    const actorRole = await getCommunityRoleForChannel(channelId, userId)
    if (!actorRole || !MOD_ROLES.includes(actorRole)) return

    const sockets = await server.in(room).fetchSockets()
    const target  = sockets.find(s => s.id === targetSocketId)
    if (!target) return

    const targetUserId   = target.data.userId   as string
    const targetUsername = target.data.username as string
    if (targetUserId === userId) return

    const targetRole = await getCommunityRoleForChannel(channelId, targetUserId)
    // Owners are untouchable.
    if (targetRole === 'owner') return
    // Moderators cannot kick admins; only admin/owner can.
    if (actorRole === 'moderator' && targetRole === 'admin') return

    target.emit('voice:kicked', { channelId, by: username })
    freeSeat(channelId, target.id)
    target.leave(room)
    server.to(room).emit('voice:peer_left', { channelId, socketId: target.id })
    await broadcastVoiceChannelUpdate(server, channelId)
    bascule.onLeave(server, channelId, target.id, getChannelSeats(channelId).size)

    try {
      await db.query(
        `INSERT INTO admin_audit_log
           (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
         VALUES ($1, $2, 'voice_kick', 'user', $3, $4, $5)`,
        [userId, username, targetUserId, targetUsername, JSON.stringify({ channelId })],
      )
    } catch {
      // audit failure must never block the moderation action
    }
  })

  // ── WebRTC signaling — forwarded to target socket only ───────────────────
  // Vérifie que l'émetteur ET le destinataire sont bien dans la même room vocale
  async function inSameVoiceRoom(channelId: string, targetSocketId: string): Promise<boolean> {
    if (!isUuid(channelId)) return false
    const room = voiceRoom(channelId)
    if (!socket.rooms.has(room)) return false
    const sockets = await server.in(room).fetchSockets()
    return sockets.some(s => s.id === targetSocketId)
  }

  socket.on('voice:offer', async ({ to, sdp, channelId }: { to: string; sdp: unknown; channelId: string }) => {
    if (checkRateLimit(userId, 'voice:offer')) return
    if (!await inSameVoiceRoom(channelId, to)) return
    server.to(to).emit('voice:offer', { from: socket.id, sdp, channelId })
  })

  socket.on('voice:answer', async ({ to, sdp, channelId }: { to: string; sdp: unknown; channelId: string }) => {
    if (checkRateLimit(userId, 'voice:answer')) return
    if (!await inSameVoiceRoom(channelId, to)) return
    server.to(to).emit('voice:answer', { from: socket.id, sdp, channelId })
  })

  socket.on('voice:ice', async ({ to, candidate, channelId }: { to: string; candidate: unknown; channelId: string }) => {
    if (checkRateLimit(userId, 'voice:ice')) return
    if (!await inSameVoiceRoom(channelId, to)) return
    server.to(to).emit('voice:ice', { from: socket.id, candidate, channelId })
  })

  // ── voice:speaking — VAD indicator ───────────────────────────────────────
  socket.on('voice:speaking', ({ channelId, speaking }: { channelId: string; speaking: boolean }) => {
    if (checkRateLimit(userId, 'voice:speaking')) return
    if (!isUuid(channelId)) return
    // Must be in the voice room to broadcast speaking state to its members.
    if (!socket.rooms.has(voiceRoom(channelId))) return
    socket.to(voiceRoom(channelId)).emit('voice:speaking', { socketId: socket.id, userId, speaking })
  })

  // ── voice:state — muet / sourd / partage, pour le roster du canal ─────────
  // Le roster (voice:channel_update) ne portait que l'identité : l'écran d'un
  // canal qu'on n'a PAS rejoint ne pouvait donc pas montrer qui est muet, sourd
  // ou en train de partager. Le client publie ici son état ; on le garde sur le
  // socket (volatile, rien en base) et on rediffuse le roster.
  socket.on('voice:state', (
    { channelId, muted, deafened, sharing }:
    { channelId: string; muted?: unknown; deafened?: unknown; sharing?: unknown },
  ) => {
    if (checkRateLimit(userId, 'voice:state')) return
    if (!isUuid(channelId)) return
    // Doit être DANS le vocal : on ne publie pas l'état d'un canal qu'on ne
    // fréquente pas.
    if (!socket.rooms.has(voiceRoom(channelId))) return
    socket.data.voiceState = {
      muted:    muted    === true,
      deafened: deafened === true,
      sharing:  sharing  === true,
    }
    void broadcastVoiceChannelUpdate(server, channelId)
  })

  // ── voice:ping — keep presence alive + refresh sidebar for caller ──────────
  socket.on('voice:ping', async (channelId: string) => {
    if (checkRateLimit(userId, 'voice:ping')) return
    if (!isUuid(channelId)) return
    if (!socket.rooms.has(voiceRoom(channelId))) return
    await broadcastVoiceChannelUpdate(server, channelId)
  })

  // ── voice:stats — relay RTT broadcast to room peers ───────────────────────
  socket.on('voice:stats', ({ channelId, rtt }: { channelId: string; rtt: unknown }) => {
    if (checkRateLimit(userId, 'voice:stats')) return
    if (!isUuid(channelId)) return
    if (!socket.rooms.has(voiceRoom(channelId))) return
    // Reject non-finite numbers (NaN, Infinity, -Infinity) to prevent UI corruption
    if (rtt !== null && (typeof rtt !== 'number' || !isFinite(rtt))) return
    socket.to(voiceRoom(channelId)).emit('voice:stats', { from: socket.id, rtt: rtt as number | null })
  })

  // ── jukebox:update — relay jukebox state to all voice room peers ──────────
  socket.on('jukebox:update', ({ channelId, state }: { channelId: string; state: unknown }) => {
    if (checkRateLimit(userId, 'jukebox:update')) return
    if (!isUuid(channelId)) return
    if (!socket.rooms.has(voiceRoom(channelId))) return
    const serialized = JSON.stringify(state)
    if (serialized.length > JUKEBOX_STATE_MAX) return
    socket.to(voiceRoom(channelId)).emit('jukebox:update', { from: socket.id, state })
  })

  // ── jukebox:request_sync — ask current peers to re-broadcast state ────────
  socket.on('jukebox:request_sync', (channelId: string) => {
    if (checkRateLimit(userId, 'jukebox:request_sync')) return
    if (!isUuid(channelId)) return
    if (!socket.rooms.has(voiceRoom(channelId))) return
    socket.to(voiceRoom(channelId)).emit('jukebox:request_sync', { from: socket.id })
  })

  // ── P2P signaling — Browser-to-browser WebRTC DataChannels ──────────────
  // Discovery: join/leave the P2P pool for a text channel
  socket.on('p2p:join', async (channelId: string) => {
    if (!isUuid(channelId)) return
    // Access control: only community members of the channel can join the P2P pool.
    // Without this any auth socket could squat the pool, harvest peer IDs and
    // attempt to open WebRTC DataChannels with users in a channel they don't belong to.
    const role = await getCommunityRoleForChannel(channelId, userId)
    if (!role) return
    if (!_p2pChannels.has(channelId)) _p2pChannels.set(channelId, new Set())
    const pool = _p2pChannels.get(channelId)!
    const existingPeers = [...pool].filter(id => id !== socket.id)
    pool.add(socket.id)
    // Tell the newcomer who's already in the pool
    socket.emit('p2p:peers', { channelId, peers: existingPeers })
    // Tell existing peers a new candidate arrived
    for (const peerId of existingPeers) {
      server.to(peerId).emit('p2p:new_peer', { channelId, peerId: socket.id })
    }
  })

  socket.on('p2p:leave', (channelId: string) => {
    const pool = _p2pChannels.get(channelId)
    if (!pool) return
    pool.delete(socket.id)
    if (pool.size === 0) _p2pChannels.delete(channelId)
  })

  // Signaling — forwarded to target socket only (same pattern as voice:offer/answer/ice)
  socket.on('p2p:offer',  ({ to, sdp, channelId }: { to: string; sdp: unknown; channelId: string }) => {
    if (checkRateLimit(userId, 'p2p:offer')) return
    if (!isUuid(channelId)) return
    const pool = _p2pChannels.get(channelId)
    if (!pool || !pool.has(socket.id) || !pool.has(to)) return  // sender et target doivent être dans le pool
    server.to(to).emit('p2p:offer',  { from: socket.id, sdp, channelId })
  })
  socket.on('p2p:answer', ({ to, sdp, channelId }: { to: string; sdp: unknown; channelId: string }) => {
    if (checkRateLimit(userId, 'p2p:answer')) return
    if (!isUuid(channelId)) return
    const pool = _p2pChannels.get(channelId)
    if (!pool || !pool.has(socket.id) || !pool.has(to)) return
    server.to(to).emit('p2p:answer', { from: socket.id, sdp, channelId })
  })
  socket.on('p2p:ice',    ({ to, candidate, channelId }: { to: string; candidate: unknown; channelId: string }) => {
    if (checkRateLimit(userId, 'p2p:ice')) return
    if (!isUuid(channelId)) return
    const pool = _p2pChannels.get(channelId)
    if (!pool || !pool.has(socket.id) || !pool.has(to)) return
    server.to(to).emit('p2p:ice',    { from: socket.id, candidate, channelId })
  })

  // ── Cleanup on disconnect ─────────────────────────────────────────────────
  // `disconnecting` et non `disconnect` : à `disconnect`, Socket.IO 4 a déjà
  // vidé `socket.rooms` et cette boucle ne faisait rien (reproduit en prod le
  // 10/10/2026 : fantôme jamais retiré de la liste, place jamais libérée,
  // bascule SFU qui compte le fantôme). Ici le socket est encore dans ses
  // salons, d'où l'exclusion explicite dans broadcastVoiceChannelUpdate.
  socket.on('disconnecting', async () => {
    // Leave all voice rooms and notify peers
    const allRooms = [...socket.rooms]
    for (const room of allRooms) {
      if (room.startsWith('voice:')) {
        const channelId = room.slice(6)
        freeSeat(channelId, socket.id)
        server.to(room).emit('voice:peer_left', { channelId, socketId: socket.id })
        // Exclure ce socket : il est encore dans le salon à `disconnecting`
        await broadcastVoiceChannelUpdate(server, channelId, socket.id)
        bascule.onLeave(server, channelId, socket.id, getChannelSeats(channelId).size)
      }
    }
    // Clean up P2P registry
    for (const [channelId, pool] of _p2pChannels) {
      pool.delete(socket.id)
      if (pool.size === 0) _p2pChannels.delete(channelId)
    }
  })
}

// ── Initial voice snapshot for newly connected sockets ────────────────────────
// Called after a socket joins the 'presence' room so they see who's already in voice

export async function sendVoiceSnapshot(socket: Socket, server: Server): Promise<void> {
  for (const [channelId] of _voiceSeats) {
    const sockets = await server.in(voiceRoom(channelId)).fetchSockets()
    if (sockets.length === 0) continue
    const seatsMap = getChannelSeats(channelId)
    const members = sockets.map(s => ({
      userId:    s.data.userId,
      username:  s.data.username,
      avatar:    s.data.avatar ?? null,
      seatIndex: seatsMap.get(s.id) ?? 0,
    }))
    socket.emit('voice:channel_update', { channelId, members })
  }
}
