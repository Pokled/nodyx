/**
 * Canvas : chaque type d'élément proposé par le frontend doit survivre à la
 * sauvegarde, champ par champ.
 *
 * Bug trouvé le 10/10/2026, présent depuis le 16/04 : les cadres, les formes
 * avancées (hexagone, étoile, nuage…) et les connecteurs étaient ignorés en
 * silence par la sauvegarde en direct et refusés par l'API. Dessinés à
 * l'écran, ils disparaissaient au rechargement.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { randomUUID } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'
import { buildApp } from './helpers/buildApp'

const USER  = randomUUID()
const saved: unknown[][] = []

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM modules'))                   return { rows: [{ enabled: true }], rowCount: 1 }
      if (/SELECT created_by/.test(sql))                 return { rows: [{ created_by: USER, channel_id: null, visibility: 'private' }], rowCount: 1 }
      if (/SELECT snapshot FROM canvas_boards/.test(sql)) return { rows: [{ snapshot: [] }], rowCount: 1 }
      if (/UPDATE canvas_boards/.test(sql)) {
        const json = params.find(p => typeof p === 'string' && p.startsWith('['))
        if (json) saved.push(JSON.parse(json as string))
        return { rows: [{ id: params[params.length - 1] ?? params[0], name: 'x', updated_at: new Date() }], rowCount: 1 }
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

// ── Un élément complet de chaque type, TOUS les champs du frontend remplis ────

function el(kind: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return { id: randomUUID(), ts: Date.now(), author: USER, kind, data, ...extra }
}

const COMPLETS = {
  pen:       el('pen',    { points: [[0, 0], [10, 12.5]], color: '#fff', width: 3, opacity: 0.8 }),
  sticky:    el('sticky', { x: 1, y: 2, w: 200, h: 160, text: 'Une note', color: '#fde047' }),
  rect:      el('rect',   { x: 1, y: 2, w: 30, h: 40, color: '#111', fill: true, strokeColor: '#222', strokeWidth: 2, opacity: 0.5 }),
  circle:    el('circle', { x: 1, y: 2, w: 30, h: 30, color: '#111', fill: false, strokeColor: '#222', strokeWidth: 3, opacity: 1 }),
  shape:     el('shape',  { x: 1, y: 2, w: 90, h: 80, color: '#0ea5e9', fill: true, strokeColor: '#fff', strokeWidth: 2, opacity: 0.9, shape: 'hexagon', label: 'Relais' }),
  text:      el('text',   { x: 5, y: 6, text: 'Titre', color: '#fff', fontSize: 32, bold: true, italic: true, underline: true, strikethrough: false, align: 'center', fontFamily: 'serif', w: 400 }),
  arrow:     el('arrow',  { x1: 0, y1: 0, x2: 50, y2: 60, color: '#f00', width: 2, lineStyle: 'dashed', startCap: 'dot', endCap: 'arrow' }),
  connector: el('connector', { x1: 0, y1: 0, x2: 80, y2: 90, type: 'bezier', style: 'dotted', color: '#0f0', width: 2, startCap: 'none', endCap: 'arrow' }),
  image:     el('image',  { x: 0, y: 0, w: 120, h: 80, url: '/uploads/canvas/a.png', assetId: randomUUID(), opacity: 0.7 }),
  frame:     el('frame',  { x: -100, y: -100, w: 800, h: 600, name: 'Le cœur', color: '#6366f1' }),
}
const AVEC_ATTRIBUTS = el('sticky', { x: 0, y: 0, text: 'lien', color: '#fff' }, { locked: true, url: 'https://nodyx.org' })

// ── Faux socket : on capture les gestionnaires, puis on les déclenche ────────

function makeSocket() {
  const handlers = new Map<string, (p: unknown) => Promise<void> | void>()
  const emits: { ev: string; payload: any }[] = []
  const rooms = new Set<string>()
  const socket = {
    data: { userId: USER, username: 'Doomguy' },
    rooms,
    on: (ev: string, fn: (p: unknown) => Promise<void>) => { handlers.set(ev, fn) },
    emit: (ev: string, payload: unknown) => { emits.push({ ev, payload }) },
    join: async (r: string) => { rooms.add(r) },
    leave: async (r: string) => { rooms.delete(r) },
    to: () => ({ emit: () => {} }),
  }
  const io = { to: () => ({ emit: () => {} }), sockets: { adapter: { rooms: new Map() } } }
  registerCanvasHandlers(io as never, socket as never)
  const fire = (ev: string, p: unknown) => handlers.get(ev)!(p)
  return { fire, emits }
}

/** Envoie des éléments en direct, force la sauvegarde, renvoie ce qui a été écrit en base. */
async function viaSocket(ops: unknown[]) {
  const boardId = randomUUID()
  const { fire } = makeSocket()
  await fire('canvas:join', { boardId })
  for (const op of ops) await fire('canvas:op', { boardId, op })
  saved.length = 0
  await fire('canvas:save', { boardId })
  return saved[0] as Array<Record<string, unknown>>
}

beforeEach(() => { saved.length = 0 })

describe('sauvegarde en direct (socket) : tous les types survivent', () => {
  for (const [kind, op] of Object.entries(COMPLETS)) {
    it(`${kind} : gardé avec tous ses champs`, async () => {
      const base = await viaSocket([op])
      expect(base).toHaveLength(1)
      expect(base[0]).toEqual(op)
    })
  }

  it('verrou et lien sur un élément : gardés', async () => {
    const base = await viaSocket([AVEC_ATTRIBUTS])
    expect(base[0]).toEqual(AVEC_ATTRIBUTS)
  })
})

describe('sauvegarde en direct (socket) : ce qui est refusé', () => {
  it('un type inconnu', async () => {
    expect(await viaSocket([el('virus', { x: 0 })])).toEqual([])
  })
  it('un lien javascript: sur un élément', async () => {
    const op = el('sticky', { x: 0, y: 0, text: 'clic', color: '#fff' }, { url: 'javascript:alert(1)' })
    expect(await viaSocket([op])).toEqual([])
  })
  it('des données au-delà de 64 Ko', async () => {
    const op = el('sticky', { x: 0, y: 0, text: 'x'.repeat(19_000), color: '#fff' })
    const gros = el('pen', { points: Array.from({ length: 9000 }, (_, i) => [i * 1.123456, i * 2.654321]), color: '#fff', width: 2 })
    const base = await viaSocket([op, gros])
    expect(base.map(e => e.kind)).toEqual(['sticky'])
  })
  it('des données qui ne correspondent pas à leur type', async () => {
    expect(await viaSocket([el('frame', { x: 0, y: 0, text: 'pas un cadre', color: '#fff' })])).toEqual([])
  })
  it('les champs inconnus sont retirés, pas stockés', async () => {
    const op = el('shape', { ...(COMPLETS.shape.data), intrus: 'x'.repeat(100) }, { intrus: true })
    const base = await viaSocket([op])
    expect(base[0]).toEqual({ ...COMPLETS.shape, id: op.id, ts: op.ts })
  })
})

describe('API PATCH /canvas/:id : tous les types acceptés et gardés', () => {
  it('un snapshot avec les 10 types et les attributs passe intact', async () => {
    const app = await buildApp(async a => { await a.register(canvasRoutes) })
    const snapshot = [...Object.values(COMPLETS), AVEC_ATTRIBUTS]
    const res = await app.inject({ method: 'PATCH', url: `/${randomUUID()}`, payload: { snapshot } })
    expect(res.statusCode).toBe(200)
    expect(saved[0]).toEqual(snapshot)
    await app.close()
  })

  it('un lien javascript: est refusé', async () => {
    const app = await buildApp(async a => { await a.register(canvasRoutes) })
    const snapshot = [el('sticky', { x: 0, y: 0, text: 'clic', color: '#fff' }, { url: 'javascript:alert(1)' })]
    const res = await app.inject({ method: 'PATCH', url: `/${randomUUID()}`, payload: { snapshot } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

// ── Garde-fou : le serveur suit le frontend ──────────────────────────────────
//
// Si un champ ou un type est ajouté à nodyx-frontend/src/lib/canvas.ts sans
// l'être ici, ce test tombe : c'est exactement ce qui s'est passé le 16/04.

describe('le schéma serveur suit les types du frontend', () => {
  const src = readFileSync(join(__dirname, '../../../nodyx-frontend/src/lib/canvas.ts'), 'utf8')

  function champs(type: string): string[] {
    const m = src.match(new RegExp(`export type ${type} = \\{([\\s\\S]*?)\\n\\}`))
    if (!m) throw new Error(`type ${type} introuvable dans le frontend`)
    return [...m[1].matchAll(/(?:^\s+|;\s*)(\w+)\??\s*:/gm)].map(x => x[1]).sort()
  }

  it('chaque type de données a exactement les mêmes champs', async () => {
    const s = await import('../utils/canvasSchema')
    const paires: [string, { shape: Record<string, unknown> }][] = [
      ['PathData', s.PathDataSchema], ['StickyData', s.StickyDataSchema], ['ShapeData', s.ShapeDataSchema],
      ['TextData', s.TextDataSchema], ['ArrowData', s.ArrowDataSchema], ['ImageData', s.ImageDataSchema],
      ['FrameData', s.FrameDataSchema], ['ConnectorData', s.ConnectorDataSchema],
    ]
    for (const [type, schema] of paires) {
      expect(Object.keys(schema.shape).sort(), type).toEqual(champs(type))
    }
  })

  it("l'élément a exactement les mêmes champs", () => {
    expect(['author', 'data', 'deleted', 'id', 'kind', 'locked', 'ts', 'url']).toEqual(champs('CanvasElement'))
  })

  it('chaque outil qui crée un élément est un type accepté', async () => {
    const { ELEMENT_KINDS } = await import('../utils/canvasSchema')
    const outils = src.match(/export type CanvasTool =([\s\S]*?)\n\n/)![1].match(/'(\w+)'/g)!.map(x => x.slice(1, -1))
    const creent = outils.filter(t => t !== 'select')
    for (const t of creent) expect(ELEMENT_KINDS, t).toContain(t)
  })
})
