// Le fuseau de l'organisateur (14/11/2026) : Nodyx se plie à l'heure de chacun.
// L'heure est un instant universel ; le fuseau sert à dire « 20:00 à Paris » et aux annonces.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn(), connect: vi.fn() },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))
vi.mock('../socket/io', () => ({ io: { emit: vi.fn() } }))
vi.mock('../services/webhooks/announce', () => ({ announceCalendarEvent: vi.fn() }))
vi.mock('../services/permissions', async (orig) => ({
  ...(await orig<typeof import('../services/permissions')>()),
  getAccess: vi.fn(async () => ({ role: 'member', rank: 0, permissions: [] })),
}))

import { db, redis } from '../config/database'
import eventRoutes from '../routes/events'
import { isTimeZone, zoneCity } from '../utils/timezone'
import { renderEvent } from '../i18n/webhookStrings'
import { buildOutgoing } from '../services/webhooks/format'
import type { NodyxEvent } from '../services/webhooks/catalog'

const token = `Bearer ${jwt.sign({ userId: 'lea', username: 'lea' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
let inserted: unknown[] = []

beforeEach(() => {
  vi.clearAllMocks(); inserted = []
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('SELECT community_id FROM community_members WHERE user_id')) return { rows: [{ community_id: 'c1' }] } as any
    if (s.includes('INSERT INTO events')) { inserted = params; return { rows: [{ id: 'ev1', is_public: true }] } as any }
    if (s.includes('UPDATE events SET')) { inserted = params; return { rows: [{ id: 'ev1', is_public: true }] } as any }
    if (s.includes('SELECT e.author_id')) return { rows: [{ author_id: 'lea', community_id: 'c1' }] } as any
    return { rows: [] } as any
  })
})

describe('un fuseau valide, selon le moteur lui-même', () => {
  it('IANA accepté, le reste non', () => {
    for (const z of ['Europe/Paris', 'America/Montreal', 'Asia/Tokyo', 'UTC', 'America/Argentina/Buenos_Aires']) expect([z, isTimeZone(z)]).toEqual([z, true])
    for (const z of ['Paris', 'Europe/Atlantide', '', 'x'.repeat(65), '<script>', null, 42]) expect(isTimeZone(z)).toBe(false)
  })
  it('la ville d’un fuseau', () => {
    expect(zoneCity('Europe/Paris')).toBe('Paris')
    expect(zoneCity('America/New_York')).toBe('New York')
    expect(zoneCity('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
  })
})

describe('créer : le fuseau de l’organisateur est gardé', () => {
  const create = async (timezone: unknown) => (await buildApp(a => eventRoutes(a))).inject({ method: 'POST', url: '/', headers: { authorization: token },
    payload: { title: 'Soirée jeux', starts_at: '2026-12-20T19:00:00Z', ...(timezone !== undefined ? { timezone } : {}) } })
  it('Europe/Paris : enregistré', async () => { expect((await create('Europe/Paris')).statusCode).toBe(201); expect(inserted[18]).toBe('Europe/Paris') })
  it('absent : NULL (on n’invente pas)', async () => { expect((await create(undefined)).statusCode).toBe(201); expect(inserted[18]).toBeNull() })
  it('inventé : refusé', async () => { expect((await create('Europe/Atlantide')).statusCode).toBe(400) })
  it('une modification ne change jamais le fuseau', async () => {
    await (await buildApp(a => eventRoutes(a))).inject({ method: 'PATCH', url: '/ev1', headers: { authorization: token }, payload: { location: 'Salle 2', timezone: 'Asia/Tokyo' } })
    expect(vi.mocked(db.query).mock.calls.some(c => /UPDATE events SET[^;]*timezone/.test(String(c[0])))).toBe(false)
  })
})

describe('les annonces (webhooks) : plus jamais « l’heure de Paris » codée en dur', () => {
  const ctx = { community: { name: 'Club', url: 'https://club.exemple' }, deliveryId: 'd1', timestamp: 1, secret: null }
  const cal = (item: NodyxEvent['item']): NodyxEvent => ({ type: 'calendar.event', family: 'calendar', at: '2026-11-14T10:00:00Z', item, path: '/calendar/ev1' })
  const unix = Math.floor(Date.parse('2026-12-20T19:00:00Z') / 1000)

  it('Discord : l’heure s’affiche dans le fuseau de CHAQUE lecteur (<t:…:F>)', () => {
    const e = cal({ title: 'Soirée', starts_at: '2026-12-20T19:00:00.000Z', timezone: 'Europe/Paris', all_day: false })
    const body = JSON.parse(buildOutgoing('discord', 'https://discord.com/api/webhooks/1/x', e, renderEvent(e, 'fr'), ctx).body)
    expect(body.embeds[0].fields.find((f: any) => f.name === 'Quand').value).toBe(`<t:${unix}:F> (<t:${unix}:R>)`)
  })
  it('Slack : jeton de date, avec repli', () => {
    const e = cal({ title: 'Soirée', starts_at: '2026-12-20T19:00:00.000Z', timezone: 'Europe/Paris', all_day: false })
    const body = JSON.parse(buildOutgoing('slack', 'https://hooks.slack.com/services/a', e, renderEvent(e, 'fr'), ctx).body)
    expect(JSON.stringify(body)).toContain(`<!date^${unix}^{date_long_pretty} {time}|`)
  })
  it('Matrix / ntfy : l’heure de l’organisateur, dite en clair', () => {
    const fr = renderEvent(cal({ title: 'Soirée', starts_at: '2026-12-20T19:00:00.000Z', timezone: 'Europe/Paris' }), 'fr')
    expect(fr.fields.find(f => f[0] === 'Quand')?.[1]).toMatch(/20:00 \(heure d’Europe centrale\)$/)
    const mtl = renderEvent(cal({ title: 'Soirée', starts_at: '2026-12-20T19:00:00.000Z', timezone: 'America/Montreal' }), 'en')
    expect(mtl.fields.find(f => f[0] === 'When')?.[1]).toMatch(/14:00 \(Eastern Time\)$/)
  })
  it('événement d’avant (sans fuseau) : l’heure UTC, et dite « UTC »', () => {
    const r = renderEvent(cal({ title: 'Ancien', starts_at: '2026-12-20T19:00:00.000Z', timezone: null }), 'fr')
    expect(r.fields.find(f => f[0] === 'Quand')?.[1]).toMatch(/19:00 \(UTC\)$/)
  })
  it('journée entière : une date, sans heure ni fuseau, la même partout (Discord compris)', () => {
    const e = cal({ title: 'Fête', starts_at: '2026-12-24T00:00:00.000Z', timezone: 'America/Los_Angeles', all_day: true })
    const r = renderEvent(e, 'fr')
    expect(r.fields.find(f => f[0] === 'Quand')?.[1]).toBe('jeudi 24 décembre')
    const body = JSON.parse(buildOutgoing('discord', 'https://discord.com/api/webhooks/1/x', e, r, ctx).body)
    expect(body.embeds[0].fields.find((f: any) => f.name === 'Quand').value).toBe('jeudi 24 décembre')
  })
})
