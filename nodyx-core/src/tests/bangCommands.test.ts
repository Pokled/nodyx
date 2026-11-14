// « ! » dans l'aide (lot C6, D58) : seulement ce qui marche pour la personne, jamais la réponse.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))
vi.mock('../services/octoguard', () => ({ isOctoGuardEnabled: vi.fn(() => true) }))
vi.mock('../services/streamer/streamerHubService', () => ({
  getNativeChatCommands: () => [{ name: '!nodyx', modOnly: false }, { name: '!so', modOnly: true }],
}))

import { db, redis } from '../config/database'
import { isOctoGuardEnabled } from '../services/octoguard'
import { bangCommands } from '../services/bangCommands'
import commandsRoutes from '../routes/commands'

const GEN = '33333333-3333-4333-8333-333333333333'
const GONE = '44444444-4444-4444-8444-444444444444'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: u }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
let twitchLinked = true

beforeEach(() => {
  vi.clearAllMocks()
  twitchLinked = true
  vi.mocked(isOctoGuardEnabled).mockReturnValue(true)
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('SELECT role, community_id FROM community_members')) return { rows: ({ lea: [{ role: 'member', community_id: 'c1' }], modo: [{ role: 'moderator', community_id: 'c1' }] } as any)[params[0]] ?? [] } as any
    if (s.includes('FROM octoguard_commands')) return { rows: [
      { command: 'regles', allowed_channels: null, allowed_roles: null, response: 'SECRET-REPONSE' },
      { command: 'ban-info', allowed_channels: null, allowed_roles: ['moderator', 'admin'] },
      { command: 'jeux', allowed_channels: [GEN], allowed_roles: null },
      { command: 'fantome', allowed_channels: [GONE], allowed_roles: null },
    ] } as any
    if (s.includes('FROM channels WHERE id = ANY')) return { rows: params[0].includes(GEN) ? [{ id: GEN, name: 'général' }] : [] } as any
    if (s.includes('FROM streamer_oauth_tokens')) return { rows: twitchLinked ? [{ external_login: 'pokled' }] : [] } as any
    if (s.includes('FROM streamer_chat_commands')) return { rows: [{ name: '!github', mod_only: false, response_template: 'SECRET-TWITCH' }, { name: '!nodyx', mod_only: false }] } as any
    return { rows: [] } as any
  })
})

describe('bangCommands', () => {
  it('un membre : les commandes OctoGuard de son rôle, avec leurs salons, plus celles de Twitch', async () => {
    const r = await bangCommands('lea')
    const og = r.commands.filter(c => c.source === 'octoguard').map(c => c.name)
    expect(og).toEqual(['regles', 'jeux'])
    expect(r.commands.find(c => c.name === 'jeux')?.channels).toEqual([{ id: GEN, name: 'général' }])
    expect(r.commands.filter(c => c.source === 'twitch').map(c => c.name)).toEqual(['nodyx', 'so', 'github'])
    expect(r.twitch).toBe('pokled')
  })
  it('la commande réservée aux modérateurs : montrée au modérateur, marquée réservée', async () => {
    const r = await bangCommands('modo')
    expect(r.commands.find(c => c.name === 'ban-info')).toMatchObject({ restricted: true })
  })
  it('limitée à un salon disparu : elle ne marche nulle part, elle n’est pas annoncée', async () => {
    expect((await bangCommands('lea')).commands.some(c => c.name === 'fantome')).toBe(false)
  })
  it('OctoGuard éteint : aucune commande OctoGuard', async () => {
    vi.mocked(isOctoGuardEnabled).mockReturnValue(false)
    expect((await bangCommands('lea')).commands.some(c => c.source === 'octoguard')).toBe(false)
  })
  it('aucune chaîne Twitch reliée : aucune commande Twitch', async () => {
    twitchLinked = false
    const r = await bangCommands('lea')
    expect(r.twitch).toBeNull()
    expect(r.commands.some(c => c.source === 'twitch')).toBe(false)
  })
  it('une commande personnalisée homonyme d’une native n’est pas annoncée deux fois', async () => {
    const r = await bangCommands('lea')
    expect(r.commands.filter(c => c.source === 'twitch' && c.name === 'nodyx')).toHaveLength(1)
  })
  it('jamais le texte d’une réponse', async () => {
    expect(JSON.stringify(await bangCommands('modo'))).not.toMatch(/SECRET/)
  })
})

describe('GET /api/v1/commands/bang', () => {
  it('sans compte : seulement Twitch (public)', async () => {
    const app = await buildApp(async a => { await a.register(commandsRoutes, { prefix: '/api/v1/commands' }) })
    const r = await app.inject({ method: 'GET', url: '/api/v1/commands/bang' })
    expect(r.statusCode).toBe(200)
    expect(r.json().commands.every((c: any) => c.source === 'twitch')).toBe(true)
    await app.close()
  })
  it('avec compte : les siennes', async () => {
    const app = await buildApp(async a => { await a.register(commandsRoutes, { prefix: '/api/v1/commands' }) })
    const r = await app.inject({ method: 'GET', url: '/api/v1/commands/bang', headers: { authorization: token('lea') } })
    expect(r.json().commands.map((c: any) => c.name)).toContain('regles')
    await app.close()
  })
})
