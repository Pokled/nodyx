// ── NodyxCanvas — Socket.IO handlers ─────────────────────────────────────────
//
// Stratégie de persistance (simple et fiable) :
//   • Chaque board a un snapshot JSONB en DB (source de vérité).
//   • En mémoire (Map): snapshot courant par boardId (chargé au 1er join).
//   • Sur canvas:op → merge LWW immédiat en mémoire + broadcast → flush DB
//     après 10 s d'inactivité (debounce par boardId).
//   • Sur canvas:save → flush immédiat.
//   • Quand le dernier user quitte → flush immédiat.
//
// Format CanvasElement : { id, ts, author, kind, data, deleted? }
// Compatible avec canvas.ts frontend (même CRDT LWW).

import type { Server, Socket } from 'socket.io'
import { db } from '../config/database'

// ── Types ─────────────────────────────────────────────────────────────────────

interface CanvasElement {
  id:      string
  ts:      number
  author:  string
  kind:    string
  data:    unknown
  deleted?: boolean
}

// ── Access control ────────────────────────────────────────────────────────────
// On distingue VOIR (rejoindre la room, recevoir le snapshot + les ops live) et
// ÉCRIRE (émettre des ops). Sans ce contrôle n'importe quel socket authentifié
// pourrait lire/écrire un board en devinant son UUID.
//
//   • board d'un canal  : membre de la communauté → view + write (collab vocal).
//   • board standalone, créateur               : view + write.
//   • board standalone PUBLIC, autre membre     : view seul (lecture seule).
//   • board standalone PRIVÉ, autre membre      : aucun accès.
//
// (Lot 2b : invitations/éditeurs → write accordé à des membres choisis.)

async function isCommunityMember(userId: string): Promise<boolean> {
	const { rowCount } = await db.query(
		`SELECT 1 FROM community_members WHERE user_id = $1 LIMIT 1`,
		[userId]
	).catch(() => ({ rowCount: 0 }))
	return (rowCount ?? 0) > 0
}

async function resolveBoardAccess(boardId: string, userId: string): Promise<{ view: boolean; write: boolean }> {
	const { rows: [board] } = await db.query<{ created_by: string; channel_id: string | null; visibility: string }>(
		`SELECT created_by, channel_id, visibility FROM canvas_boards WHERE id = $1`,
		[boardId]
	).catch(() => ({ rows: [] as any[] }))
	if (!board) return { view: false, write: false }
	if (board.created_by === userId) return { view: true, write: true }

	if (board.channel_id) {
		const { rowCount } = await db.query(
			`SELECT 1 FROM channels c
			 JOIN community_members cm ON cm.community_id = c.community_id
			 WHERE c.id = $1 AND cm.user_id = $2 LIMIT 1`,
			[board.channel_id, userId]
		).catch(() => ({ rowCount: 0 }))
		const m = (rowCount ?? 0) > 0
		return { view: m, write: m }
	}

	// Standalone, pas le créateur : collaborateur accepté ?
	const { rows: [collab] } = await db.query<{ role: string; status: string }>(
		`SELECT role, status FROM canvas_board_collaborators WHERE board_id = $1 AND user_id = $2`,
		[boardId, userId]
	).catch(() => ({ rows: [] as any[] }))
	const activeEditor = collab?.status === 'active' && collab?.role === 'editor'

	if (board.visibility === 'public') {
		const m = await isCommunityMember(userId)
		return { view: m, write: !!activeEditor }   // tout membre voit ; éditeur accepté écrit
	}
	// Privé : seuls les collaborateurs actifs voient.
	return { view: collab?.status === 'active', write: !!activeEditor }
}

// ── In-memory state ───────────────────────────────────────────────────────────

// boardId → Map<elementId, CanvasElement>  (LWW per element)
const snapshots = new Map<string, Map<string, CanvasElement>>()

// boardId → debounce timer handle
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>()

const FLUSH_DELAY_MS = 10_000   // 10 s d'inactivité → flush DB
const MAX_ELEMENTS   = 5_000    // limite par board

// ── Helpers ───────────────────────────────────────────────────────────────────

function isUuid(v: unknown): v is string {
  return typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

function roomName(boardId: string) { return `canvas:${boardId}` }

/** Charge le snapshot depuis la DB et initialise la Map en mémoire. */
async function loadSnapshot(boardId: string): Promise<Map<string, CanvasElement> | null> {
  const { rows } = await db.query<{ snapshot: CanvasElement[] }>(
    `SELECT snapshot FROM canvas_boards WHERE id = $1`, [boardId]
  )
  if (!rows[0]) return null

  const map = new Map<string, CanvasElement>()
  for (const el of rows[0].snapshot ?? []) {
    if (el?.id) map.set(el.id, el)
  }
  snapshots.set(boardId, map)
  return map
}

/** Applique une opération LWW dans la map en mémoire. Retourne true si changé. */
function applyOp(map: Map<string, CanvasElement>, op: CanvasElement): boolean {
  const existing = map.get(op.id)
  if (existing && existing.ts >= op.ts) return false
  map.set(op.id, op)
  return true
}

/** Sérialise la map en tableau (seulement les non-deleted, pour compacter). */
function toSnapshot(map: Map<string, CanvasElement>): CanvasElement[] {
  return [...map.values()].filter(el => !el.deleted)
}

/** Flush le snapshot en mémoire → DB. */
async function flushToDB(boardId: string): Promise<void> {
  const map = snapshots.get(boardId)
  if (!map) return
  const snapshot = toSnapshot(map)
  try {
    await db.query(
      `UPDATE canvas_boards SET snapshot = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(snapshot), boardId]
    )
  } catch (err) {
    console.error(`[Canvas] Flush DB échoué pour board ${boardId}:`, err)
  }
}

/** Schedule un flush différé (debounce). */
function scheduleFlush(boardId: string): void {
  const existing = flushTimers.get(boardId)
  if (existing) clearTimeout(existing)
  const t = setTimeout(async () => {
    flushTimers.delete(boardId)
    await flushToDB(boardId)
  }, FLUSH_DELAY_MS)
  flushTimers.set(boardId, t)
}

/** Flush immédiat + annule le debounce. */
async function flushNow(boardId: string): Promise<void> {
  const existing = flushTimers.get(boardId)
  if (existing) { clearTimeout(existing); flushTimers.delete(boardId) }
  await flushToDB(boardId)
}

// ── Validation légère des ops entrantes ───────────────────────────────────────

const VALID_KINDS = new Set(['pen','sticky','rect','circle','text','arrow','image','eraser'])

function isValidOp(op: unknown): op is CanvasElement {
  if (!op || typeof op !== 'object') return false
  const o = op as Record<string, unknown>
  return (
    isUuid(o.id) &&
    typeof o.ts === 'number' &&
    isUuid(o.author) &&
    typeof o.kind === 'string' && VALID_KINDS.has(o.kind) &&
    typeof o.data === 'object'
  )
}

// ── Registration ──────────────────────────────────────────────────────────────

export function registerCanvasHandlers(io: Server, socket: Socket): void {
  const userId   = socket.data.userId
  const username = socket.data.username

  // Droit d'écriture résolu au join, par board, pour CE socket. Les ops
  // (op/clear/save) le consultent → un viewer (board public non possédé) ne
  // peut pas écrire même s'il a rejoint la room en lecture.
  const writePerms = new Map<string, boolean>()

  // ── canvas:join ────────────────────────────────────────────────────────────
  socket.on('canvas:join', async (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const { boardId } = payload as Record<string, unknown>
    if (!isUuid(boardId)) return

    // Access control before sharing any board content with the socket
    const access = await resolveBoardAccess(boardId as string, userId)
    if (!access.view) {
      socket.emit('canvas:error', { boardId, error: 'Accès refusé.' })
      return
    }
    writePerms.set(boardId as string, access.write)

    // Load or reuse snapshot
    let map = snapshots.get(boardId)
    if (!map) {
      map = await loadSnapshot(boardId) ?? undefined
      if (!map) {
        socket.emit('canvas:error', { boardId, error: 'Board introuvable.' })
        return
      }
    }

    await socket.join(roomName(boardId))

    // Send full snapshot to the joining client only (readOnly = pas de write)
    socket.emit('canvas:snapshot', {
      boardId,
      elements: toSnapshot(map),
      readOnly: !access.write,
    })

    // Notify others in the room
    socket.to(roomName(boardId)).emit('canvas:peer:joined', {
      boardId,
      userId,
      username,
    })
  })

  // ── canvas:leave ───────────────────────────────────────────────────────────
  socket.on('canvas:leave', async (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const { boardId } = payload as Record<string, unknown>
    if (!isUuid(boardId)) return

    await socket.leave(roomName(boardId))
    writePerms.delete(boardId as string)
    socket.to(roomName(boardId)).emit('canvas:peer:left', { boardId, userId })

    // If room is now empty → flush immediately
    const room = io.sockets.adapter.rooms.get(roomName(boardId))
    if (!room || room.size === 0) {
      await flushNow(boardId)
      // Free memory for idle boards
      snapshots.delete(boardId)
    }
  })

  // ── canvas:op ──────────────────────────────────────────────────────────────
  socket.on('canvas:op', async (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const { boardId, op } = payload as Record<string, unknown>
    if (!isUuid(boardId) || !isValidOp(op)) return

    // Must have joined the board first (canvas:join enforces access control)
    if (!socket.rooms.has(roomName(boardId as string))) return
    // Lecture seule : un viewer (board public non possédé) ne peut pas écrire.
    if (!writePerms.get(boardId as string)) return

    // Security: force author to the authenticated user
    const safeOp: CanvasElement = { ...(op as CanvasElement), author: userId }

    let map = snapshots.get(boardId)
    if (!map) {
      map = await loadSnapshot(boardId) ?? undefined
      if (!map) return
    }

    // Limit board size
    if (!safeOp.deleted && map.size >= MAX_ELEMENTS) {
      socket.emit('canvas:error', { boardId, error: 'Board plein (5000 éléments max).' })
      return
    }

    if (applyOp(map, safeOp)) {
      // Broadcast to everyone in the room (including sender for confirmation)
      io.to(roomName(boardId)).emit('canvas:op', { boardId, op: safeOp })
      scheduleFlush(boardId)
    }
  })

  // ── canvas:clear ───────────────────────────────────────────────────────────
  socket.on('canvas:clear', async (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const { boardId, ts } = payload as Record<string, unknown>
    if (!isUuid(boardId) || typeof ts !== 'number') return
    if (!socket.rooms.has(roomName(boardId as string))) return
    if (!writePerms.get(boardId as string)) return   // lecture seule

    let map = snapshots.get(boardId)
    if (!map) {
      map = await loadSnapshot(boardId) ?? undefined
      if (!map) return
    }

    // Soft-delete all elements older than ts (LWW compatible)
    for (const [id, el] of map) {
      if (el.ts <= ts) map.set(id, { ...el, deleted: true, ts })
    }

    io.to(roomName(boardId)).emit('canvas:clear', { boardId, ts, by: userId })
    await flushNow(boardId)
  })

  // ── canvas:cursor ──────────────────────────────────────────────────────────
  // Curseurs : pas de persistance, juste relay aux pairs.
  socket.on('canvas:cursor', (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const { boardId, x, y, speaking } = payload as Record<string, unknown>
    if (!isUuid(boardId)) return
    if (typeof x !== 'number' || typeof y !== 'number') return
    if (!socket.rooms.has(roomName(boardId as string))) return

    socket.to(roomName(boardId)).emit('canvas:cursor', {
      boardId,
      userId,
      username,
      x, y,
      speaking: speaking === true,
    })
  })

  // ── canvas:save ────────────────────────────────────────────────────────────
  // Sauvegarde explicite déclenchée par le client (ex: fermeture board).
  socket.on('canvas:save', async (payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const { boardId } = payload as Record<string, unknown>
    if (!isUuid(boardId)) return
    if (!socket.rooms.has(roomName(boardId as string))) return
    if (!writePerms.get(boardId as string)) return   // lecture seule : rien à sauver
    await flushNow(boardId)
    socket.emit('canvas:saved', { boardId })
  })

  // ── Nettoyage à la déconnexion ─────────────────────────────────────────────
  socket.on('disconnect', async () => {
    // Flush toutes les rooms canvas que ce socket avait rejointes
    for (const room of socket.rooms) {
      if (!room.startsWith('canvas:')) continue
      const boardId = room.slice('canvas:'.length)
      socket.to(room).emit('canvas:peer:left', { boardId, userId })

      const remaining = io.sockets.adapter.rooms.get(room)
      if (!remaining || remaining.size === 0) {
        await flushNow(boardId)
        snapshots.delete(boardId)
      }
    }
  })
}
