import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// Messages privés : inviter quelqu'un crée un NOUVEAU groupe. La conversation
// d'origine ne gagne jamais de membre, donc l'invité ne lit rien de ce qui s'y
// est dit avant lui (fuite trouvée le 08/11 : il lisait tout l'historique).

const { db, emits } = vi.hoisted(() => {
  const db = {
    convs: [] as Array<{ id: string; is_group: boolean }>,
    parts: [] as Array<{ conversation_id: string; user_id: string }>,
    msgs: [] as Array<{ id: string; conversation_id: string; sender_id: string; content: string }>,
    users: [] as Array<{ id: string; username: string; avatar: string | null }>,
    n: 0,
  }
  return { db, emits: [] as Array<{ room: string; ev: string; data: Record<string, unknown> }> }
})

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = sql.replace(/\s+/g, ' ').trim()
      if (s.startsWith('SELECT user_id FROM dm_participants WHERE conversation_id = $1') && !s.includes('AND')) {
        return { rows: db.parts.filter(p => p.conversation_id === params[0]).map(p => ({ user_id: p.user_id })) }
      }
      if (s.startsWith('SELECT 1 FROM dm_participants WHERE conversation_id = $1 AND user_id = $2')) {
        return { rows: db.parts.some(p => p.conversation_id === params[0] && p.user_id === params[1]) ? [{ '?column?': 1 }] : [] }
      }
      if (s.startsWith('SELECT id, username, avatar FROM users WHERE id = $1')) return { rows: db.users.filter(u => u.id === params[0]) }
      if (s.startsWith('SELECT username FROM users WHERE id = $1')) return { rows: db.users.filter(u => u.id === params[0]) }
      if (s.startsWith('WITH conv AS (INSERT INTO dm_conversations (is_group) VALUES (TRUE)')) {
        const id = `aaaaaaaa-0000-4000-8000-${String(++db.n).padStart(12, '0')}`
        db.convs.push({ id, is_group: true })
        const rows = (params[0] as string[]).map(u => { db.parts.push({ conversation_id: id, user_id: u }); return { conversation_id: id } })
        return { rows }
      }
      if (s.includes('FROM dm_messages m') && s.includes('WHERE m.conversation_id = $1')) {
        return { rows: db.msgs.filter(m => m.conversation_id === params[0]) }
      }
      // Les écritures de l'ANCIENNE route, comprises pour pouvoir prouver la fuite sur l'ancien code
      if (s.startsWith('UPDATE dm_conversations SET is_group = TRUE WHERE id = $1')) { db.convs.forEach(c => { if (c.id === params[0]) c.is_group = true }); return { rows: [] } }
      if (s.startsWith('INSERT INTO dm_participants (conversation_id, user_id) VALUES ($1, $2)')) { db.parts.push({ conversation_id: params[0] as string, user_id: params[1] as string }); return { rows: [] } }
      if (/^(UPDATE|INSERT|DELETE)/.test(s)) throw new Error('écriture inattendue : ' + s.slice(0, 80))
      return { rows: [] }
    }),
  },
  redis: { exists: vi.fn(async (k: string) => (k.startsWith('banned:') ? 0 : 1)), setex: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
}))
vi.mock('../socket/io', () => ({
  io: { to: (room: string) => ({ emit: (ev: string, data: Record<string, unknown>) => { emits.push({ room, ev, data }) } }) },
}))

import dmRoutes, { DM_GROUP_MAX } from '../routes/dm'

const LEA = '11111111-1111-4111-8111-111111111111'
const REMI = '22222222-2222-4222-8222-222222222222'
const MAX = '33333333-3333-4333-8333-333333333333'
const INTRUS = '44444444-4444-4444-8444-444444444444'
const CONV = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

let app: Awaited<ReturnType<typeof buildApp>>
beforeEach(async () => {
  db.convs = [{ id: CONV, is_group: false }]
  db.parts = [{ conversation_id: CONV, user_id: LEA }, { conversation_id: CONV, user_id: REMI }]
  db.msgs = [{ id: 'm1', conversation_id: CONV, sender_id: REMI, content: 'mon secret, rien qu’à toi' }]
  db.users = [LEA, REMI, MAX, INTRUS].map((id, i) => ({ id, username: ['lea', 'remi', 'max', 'intrus'][i], avatar: null }))
  db.n = 0; emits.length = 0
  app = await buildApp(async a => { await a.register(dmRoutes, { prefix: '/api/v1/dm' }) })
})
const invite = (who: string, userId: string, conv = CONV) => app.inject({ method: 'POST', url: `/api/v1/dm/conversations/${conv}/participants`, headers: { authorization: token(who) }, payload: { userId } })
const history = (who: string, conv: string) => app.inject({ method: 'GET', url: `/api/v1/dm/conversations/${conv}/messages`, headers: { authorization: token(who) } })

describe('inviter dans une conversation privée', () => {
  it('crée un NOUVEAU groupe avec tout le monde, la conversation d’origine reste à deux', async () => {
    const res = await invite(LEA, MAX)
    expect(res.statusCode).toBe(201)
    const id = res.json().conversationId
    expect(id).not.toBe(CONV)
    expect(db.parts.filter(p => p.conversation_id === id).map(p => p.user_id).sort()).toEqual([LEA, REMI, MAX].sort())
    expect(db.parts.filter(p => p.conversation_id === CONV).map(p => p.user_id).sort()).toEqual([LEA, REMI].sort())
    expect(db.convs.find(c => c.id === CONV)!.is_group).toBe(false)
  })

  it('l’invité ne lit RIEN de ce qui s’est dit avant lui', async () => {
    const id = (await invite(LEA, MAX)).json().conversationId
    expect((await history(MAX, CONV)).statusCode).toBe(403)
    const inGroup = await history(MAX, id)
    expect(inGroup.statusCode).toBe(200)
    expect(JSON.stringify(inGroup.json())).not.toContain('mon secret')
  })

  it('tous les membres du nouveau groupe sont prévenus, sans l’adresse de l’ancienne conversation', async () => {
    const id = (await invite(LEA, MAX)).json().conversationId
    expect(emits.map(e => e.room).sort()).toEqual([`user:${LEA}`, `user:${REMI}`, `user:${MAX}`].sort())
    for (const e of emits) {
      expect(e.ev).toBe('dm:group_created')
      expect(e.data.conversation_id).toBe(id)
      expect(JSON.stringify(e.data)).not.toContain(CONV)
    }
  })

  it('refus : pas participant (403), déjà dedans (409), soi-même, identifiants invalides (400), inconnu (404)', async () => {
    expect((await invite(INTRUS, MAX)).json().code).toBe('NOT_A_PARTICIPANT')
    expect((await invite(LEA, REMI)).json().code).toBe('ALREADY_PARTICIPANT')
    expect((await invite(LEA, LEA)).json().code).toBe('CANNOT_INVITE_SELF')
    expect((await invite(LEA, 'x;drop')).statusCode).toBe(400)
    expect((await invite(LEA, MAX, 'pas-un-id')).statusCode).toBe(400)
    expect((await invite(LEA, '55555555-5555-4555-8555-555555555555')).json().code).toBe('USER_NOT_FOUND')
    expect(db.convs).toHaveLength(1)   // aucun groupe créé par un refus
  })

  it(`un groupe a ${DM_GROUP_MAX} membres au plus`, async () => {
    db.parts = Array.from({ length: DM_GROUP_MAX }, (_, i) => ({ conversation_id: CONV, user_id: i === 0 ? LEA : `99999999-0000-4000-8000-${String(i).padStart(12, '0')}` }))
    const res = await invite(LEA, MAX)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('GROUP_FULL')
  })
})
