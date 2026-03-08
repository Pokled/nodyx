import { Server, Socket } from 'socket.io'
import * as crypto from 'crypto'

// ── TURN credentials ─────────────────────────────────────────────────────────
// Dynamic time-limited credentials (nexus-turn / coturn use-auth-secret style).
// TURN_SECRET + TURN_PUBLIC_IP env vars — set by install.sh.

function buildIceServers(userId: string): object[] {
  const secret   = process.env.TURN_SECRET
  const ip       = process.env.TURN_PUBLIC_IP
  const port     = process.env.TURN_PORT || '3478'
  const fallback = process.env.STUN_FALLBACK_URLS  // relay mode: no nexus-turn

  // No nexus-turn configured — use fallback STUN URLs if provided
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

function voiceRoom(channelId: string): string {
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
    }))
  // Emit to presence (sidebar overview) AND voice room (handles presence-join timing edge cases)
  server.to('presence').to(voiceRoom(channelId)).emit('voice:channel_update', { channelId, members })
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerVoiceHandlers(socket: Socket, server: Server): void {
  const { userId, username } = socket.data

  // ── voice:join ────────────────────────────────────────────────────────────
  socket.on('voice:join', async (channelId: string) => {
    if (!channelId) return

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

    // Join the room
    socket.join(room)

    // Broadcast updated member list to presence room
    await broadcastVoiceChannelUpdate(server, channelId)

    // Send current peer list to the joiner (with their seat index + dynamic TURN creds)
    socket.emit('voice:init', { channelId, peers, mySeatIndex: mySeat, iceServers: buildIceServers(userId) })

    // Notify existing peers about the newcomer
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
  })

  // ── voice:leave ───────────────────────────────────────────────────────────
  socket.on('voice:leave', async (channelId: string) => {
    if (!channelId) return
    const room = voiceRoom(channelId)
    socket.leave(room)
    freeSeat(channelId, socket.id)
    server.to(room).emit('voice:peer_left', { channelId, socketId: socket.id })
    await broadcastVoiceChannelUpdate(server, channelId)
  })

  // ── WebRTC signaling — forwarded to target socket only ───────────────────
  socket.on('voice:offer', ({ to, sdp, channelId }: { to: string; sdp: unknown; channelId: string }) => {
    server.to(to).emit('voice:offer', { from: socket.id, sdp, channelId })
  })

  socket.on('voice:answer', ({ to, sdp, channelId }: { to: string; sdp: unknown; channelId: string }) => {
    server.to(to).emit('voice:answer', { from: socket.id, sdp, channelId })
  })

  socket.on('voice:ice', ({ to, candidate, channelId }: { to: string; candidate: unknown; channelId: string }) => {
    server.to(to).emit('voice:ice', { from: socket.id, candidate, channelId })
  })

  // ── voice:speaking — VAD indicator ───────────────────────────────────────
  socket.on('voice:speaking', ({ channelId, speaking }: { channelId: string; speaking: boolean }) => {
    socket.to(voiceRoom(channelId)).emit('voice:speaking', { socketId: socket.id, userId, speaking })
  })

  // ── voice:ping — keep presence alive + refresh sidebar for caller ──────────
  socket.on('voice:ping', async (channelId: string) => {
    if (!channelId) return
    await broadcastVoiceChannelUpdate(server, channelId)
  })

  // ── voice:stats — relay RTT broadcast to room peers ───────────────────────
  socket.on('voice:stats', ({ channelId, rtt }: { channelId: string; rtt: number | null }) => {
    if (!channelId) return
    socket.to(voiceRoom(channelId)).emit('voice:stats', { from: socket.id, rtt })
  })

  // ── jukebox:update — relay jukebox state to all voice room peers ──────────
  socket.on('jukebox:update', ({ channelId, state }: { channelId: string; state: unknown }) => {
    if (!channelId) return
    socket.to(voiceRoom(channelId)).emit('jukebox:update', { from: socket.id, state })
  })

  // ── jukebox:request_sync — ask current peers to re-broadcast state ────────
  socket.on('jukebox:request_sync', (channelId: string) => {
    if (!channelId) return
    socket.to(voiceRoom(channelId)).emit('jukebox:request_sync', { from: socket.id })
  })

  // ── P2P signaling — Browser-to-browser WebRTC DataChannels ──────────────
  // Discovery: join/leave the P2P pool for a text channel
  socket.on('p2p:join', (channelId: string) => {
    if (!channelId) return
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
    server.to(to).emit('p2p:offer',  { from: socket.id, sdp, channelId })
  })
  socket.on('p2p:answer', ({ to, sdp, channelId }: { to: string; sdp: unknown; channelId: string }) => {
    server.to(to).emit('p2p:answer', { from: socket.id, sdp, channelId })
  })
  socket.on('p2p:ice',    ({ to, candidate, channelId }: { to: string; candidate: unknown; channelId: string }) => {
    server.to(to).emit('p2p:ice',    { from: socket.id, candidate, channelId })
  })

  // ── Cleanup on disconnect ─────────────────────────────────────────────────
  socket.on('disconnect', async () => {
    // Leave all voice rooms and notify peers
    const allRooms = [...socket.rooms]
    for (const room of allRooms) {
      if (room.startsWith('voice:')) {
        const channelId = room.slice(6)
        freeSeat(channelId, socket.id)
        server.to(room).emit('voice:peer_left', { channelId, socketId: socket.id })
        // Exclude this socket manually — socket.rooms not yet cleared at disconnect
        await broadcastVoiceChannelUpdate(server, channelId, socket.id)
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
