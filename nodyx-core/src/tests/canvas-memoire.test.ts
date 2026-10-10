/**
 * Canvas : la copie en mémoire d'un tableau ne doit jamais survivre à la base.
 *
 * Bug trouvé en production le 10/10/2026 : le nettoyage de fin de connexion
 * lisait `socket.rooms` dans l'événement `disconnect`, où Socket.IO 4 l'a
 * déjà vidé. Il ne faisait donc rien : un tableau restait en mémoire jusqu'au
 * redémarrage du coeur, et une sauvegarde par l'API (PATCH) était masquée par
 * cette vieille copie, puis réécrasée au premier coup de crayon.
 */

import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { buildApp } from './helpers/buildApp'

const USER = randomUUID()
/** La « base » : un snapshot par tableau. */
const base = new Map<string, unknown[]>()

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const id = params.find(p => typeof p === 'string' && /^[0-9a-f-]{36}$/.test(p)) as string
      if (sql.includes('FROM modules'))                   return { rows: [{ enabled: true }], rowCount: 1 }
      if (/SELECT created_by/.test(sql))                 return { rows: [{ created_by: USER, channel_id: null, visibility: 'private' }], rowCount: 1 }
      if (/SELECT snapshot FROM canvas_boards/.test(sql)) return { rows: [{ snapshot: base.get(id) ?? [] }], rowCount: 1 }
      if (/UPDATE canvas_boards/.test(sql)) {
        const json = params.find(p => typeof p === 'string' && p.startsWith('['))
        if (json) base.set(id, JSON.parse(json as string))
        return { rows: [{ id, name: 'x', updated_at: new Date() }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    }),
  },
  redis: {},
}))
vi.mock('../socket/rateLimiter', () => ({ checkRateLimit: () => false }))
vi.mock('../middleware/rateLimit', () => ({ rateLimit: async () => {} }))
vi.mock('../middleware/auth', () => ({
  requireAuth: async (req: { user?: unknown }) => { req.user = { userId: USER } },
  optionalAuth: async () => {},
}))
vi.mock('../middleware/adminOnly', () => ({ adminOnly: async () => {} }))
vi.mock('../models/notification', () => ({ create: vi.fn() }))

import { registerCanvasHandlers } from '../socket/canvas'
import canvasRoutes from '../routes/canvas'

// ── Un faux serveur fidèle à Socket.IO 4 sur l'ordre de déconnexion ─────────
//
// Socket.IO 4 émet `disconnecting` (salons encore là), retire le socket de
// tous ses salons, PUIS émet `disconnect` (salons vides).

const salons = new Map<string, Set<string>>()
const io = { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: salons } } }

function connecter() {
  const sid = randomUUID()
  const handlers = new Map<string, (p?: unknown) => Promise<void> | void>()
  const rooms = new Set<string>([sid])
  const recus: { ev: string; payload: any }[] = []
  const join = async (r: string) => { rooms.add(r); (salons.get(r) ?? salons.set(r, new Set()).get(r)!).add(sid) }
  const leave = async (r: string) => {
    rooms.delete(r)
    const s = salons.get(r); s?.delete(sid); if (s && s.size === 0) salons.delete(r)
  }
  const socket = {
    id: sid, data: { userId: USER, username: 'Doomguy' }, rooms,
    on: (ev: string, fn: (p?: unknown) => Promise<void>) => { handlers.set(ev, fn) },
    emit: (ev: string, payload: unknown) => { recus.push({ ev, payload }) },
    join, leave, to: () => ({ emit: () => {} }),
  }
  registerCanvasHandlers(io as never, socket as never)
  const fire = async (ev: string, p?: unknown) => { await handlers.get(ev)?.(p) }
  const deconnecter = async () => {
    await fire('disconnecting', 'transport close')
    for (const r of [...rooms]) await leave(r)
    await fire('disconnect', 'transport close')
  }
  /** Rejoint le tableau et renvoie le snapshot servi. */
  const rejoindre = async (boardId: string) => {
    await fire('canvas:join', { boardId })
    return recus.filter(r => r.ev === 'canvas:snapshot').at(-1)!.payload.elements as Array<{ id: string }>
  }
  return { fire, deconnecter, rejoindre }
}

const note = (text: string) => ({
  id: randomUUID(), ts: Date.now(), author: USER, kind: 'sticky', data: { x: 0, y: 0, text, color: '#fff' },
})

describe('fin de connexion', () => {
  it('le dernier à partir sauvegarde le tableau, sans attendre le délai', async () => {
    const boardId = randomUUID()
    const a = connecter()
    await a.rejoindre(boardId)
    const n = note('écrite juste avant de fermer')
    await a.fire('canvas:op', { boardId, op: n })
    await a.deconnecter()
    expect((base.get(boardId) ?? []).map((e: any) => e.id)).toEqual([n.id])
  })

  it('le tableau quitte la mémoire : la base fait foi au retour', async () => {
    const boardId = randomUUID()
    const a = connecter()
    await a.rejoindre(boardId)
    await a.fire('canvas:op', { boardId, op: note('ancienne') })
    await a.deconnecter()

    const neuve = note('posée directement en base')
    base.set(boardId, [neuve])
    const b = connecter()
    expect((await b.rejoindre(boardId)).map(e => e.id)).toEqual([neuve.id])
    await b.deconnecter()
  })

  it('tant que quelqu\'un reste, le tableau reste en mémoire', async () => {
    const boardId = randomUUID()
    const a = connecter(); const b = connecter()
    await a.rejoindre(boardId); await b.rejoindre(boardId)
    const n = note('de b')
    await b.fire('canvas:op', { boardId, op: n })
    await a.deconnecter()
    base.set(boardId, [])
    const c = connecter()
    expect((await c.rejoindre(boardId)).map(e => e.id)).toEqual([n.id])
    await b.deconnecter(); await c.deconnecter()
  })
})

describe('sauvegarde par l\'API pendant que le tableau est en mémoire', () => {
  it('le PATCH fait foi : le socket ne sert plus, ni ne réécrit, la vieille copie', async () => {
    const boardId = randomUUID()
    const a = connecter()
    await a.rejoindre(boardId)
    const vieille = note('à retirer')
    await a.fire('canvas:op', { boardId, op: vieille })
    await a.fire('canvas:save', { boardId })

    const app = await buildApp(async x => { await x.register(canvasRoutes) })
    const gardee = note('gardée par l\'API')
    const res = await app.inject({ method: 'PATCH', url: `/${boardId}`, payload: { snapshot: [gardee] } })
    expect(res.statusCode).toBe(200)
    await app.close()

    const b = connecter()
    expect((await b.rejoindre(boardId)).map(e => e.id)).toEqual([gardee.id])

    // Un coup de crayon ensuite ne ressuscite pas l'élément retiré.
    const n = note('nouvelle')
    await b.fire('canvas:op', { boardId, op: n })
    await b.fire('canvas:save', { boardId })
    expect((base.get(boardId) ?? []).map((e: any) => e.id).sort()).toEqual([gardee.id, n.id].sort())
    await a.deconnecter(); await b.deconnecter()
  })
})
