// Le jeu d'un événement (D66) : catalogue, jaquette TOUJOURS copiée et réencodée, Steam borné.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import sharp from 'sharp'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1) },
}))
vi.mock('node:fs', async (orig) => {
  const real: any = await orig()
  return { ...real, promises: { ...real.promises, mkdir: vi.fn(async () => {}), writeFile: vi.fn(async () => {}), unlink: vi.fn(async () => {}) } }
})
vi.mock('../utils/ssrfGuard', () => ({ safeRequest: vi.fn() }))
vi.mock('../services/mentionPeople', () => ({ instanceCommunityId: vi.fn(async () => 'c1') }))
vi.mock('../services/mentionGroups', () => ({ isTeam: vi.fn(async (_c: string, u: string) => u === 'modo') }))

import { db, redis } from '../config/database'
import { promises as fs } from 'node:fs'
import { safeRequest } from '../utils/ssrfGuard'
import { cleanName, addUploadedGame, steamSearch, importSteamGame, GameError } from '../services/eventGames'
import gamesRoutes from '../routes/games'

const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: u }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
let png: Buffer
const ok = (body: Buffer | string, type = 'image/jpeg') => ({ status: 200, headers: { 'content-type': type }, body: Buffer.from(body as any), truncated: false })

beforeEach(async () => {
  vi.clearAllMocks()
  delete process.env.NODYX_STEAM_IMPORT
  png ??= await sharp({ create: { width: 300, height: 200, channels: 3, background: '#c03' } }).png().toBuffer()
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    if (String(sql).includes('INSERT INTO event_games')) {
      if (params[1] === 'Doublon') { const e: any = new Error('dup'); e.code = '23505'; throw e }
      return { rows: [{ id: 'g1', name: params[1], cover_path: params[2], source: params[3] }] } as any
    }
    return { rows: [] } as any
  })
})

describe('le nom', () => {
  it('une ligne, sans caractère de contrôle, 80 au plus', () => {
    expect(cleanName('  Hollow\n\tKnight ')).toBe('Hollow Knight')
    expect(cleanName('x'.repeat(200))).toHaveLength(80)
    expect(cleanName(42)).toBe('')
  })
})

describe('jaquette téléversée', () => {
  it('réencodée en webp portrait 600×900, écrite dans /uploads/games', async () => {
    const g = await addUploadedGame('c1', 'modo', 'Veloren', png, 'image/png')
    expect(g.cover_path).toMatch(/^\/uploads\/games\/[0-9a-f-]{36}\.webp$/)
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as Buffer
    const meta = await sharp(written).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 600, 900])
  })
  it('un logo en largeur n’est pas rogné : posé entier, centré sur fond sombre', async () => {
    const wide = await sharp({ create: { width: 600, height: 150, channels: 3, background: '#ff0000' } }).png().toBuffer()
    await addUploadedGame('c1', 'modo', 'Logo', wide, 'image/png')
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as Buffer
    const { data, info } = await sharp(written).raw().toBuffer({ resolveWithObject: true })
    const px = (x: number, y: number) => data[(y * info.width + x) * info.channels]
    expect(px(300, 450)).toBeGreaterThan(200)   // le logo, au centre, entier en largeur
    expect(px(5, 450)).toBeGreaterThan(200)     // jusqu'au bord : rien de rogné
    expect(px(300, 20)).toBeLessThan(40)        // fond sombre au-dessus
  })
  it('refuse un format hors liste (gif, svg) et une image illisible', async () => {
    await expect(addUploadedGame('c1', 'modo', 'X', png, 'image/svg+xml')).rejects.toMatchObject({ code: 'GAME_COVER_FORMAT' })
    await expect(addUploadedGame('c1', 'modo', 'X', Buffer.from('pas une image'), 'image/png')).rejects.toBeInstanceOf(GameError)
    expect(fs.writeFile).not.toHaveBeenCalled()
  })
  it('un nom déjà au catalogue : 409, et le fichier écrit est retiré', async () => {
    await expect(addUploadedGame('c1', 'modo', 'Doublon', png, 'image/png')).rejects.toMatchObject({ code: 'GAME_EXISTS', status: 409 })
    expect(fs.unlink).toHaveBeenCalled()
  })
})

describe('Steam', () => {
  it('recherche : adresse figée de Steam, résultats propres (sans bande-son)', async () => {
    vi.mocked(safeRequest).mockResolvedValueOnce(ok(JSON.stringify({ items: [{ id: 367520, name: 'Hollow Knight' }, { id: 598190, name: 'Hollow Knight - Official Soundtrack' }, { id: 'x', name: 'piège' }, { id: 5 }] }), 'application/json') as any)
    expect(await steamSearch('hollow')).toEqual([{ appid: 367520, name: 'Hollow Knight' }])
    expect(vi.mocked(safeRequest).mock.calls[0][0]).toMatch(/^https:\/\/store\.steampowered\.com\/api\/storesearch\/\?term=hollow&/)
  })
  it('import : jaquette portrait, et repli sur l’en-tête si elle manque', async () => {
    vi.mocked(safeRequest)
      .mockResolvedValueOnce({ status: 404, headers: {}, body: Buffer.alloc(0), truncated: false } as any)
      .mockResolvedValueOnce(ok(png, 'image/png') as any)
    const g = await importSteamGame('c1', 'modo', 367520, 'Hollow Knight')
    expect(g.source).toBe('steam')
    const urls = vi.mocked(safeRequest).mock.calls.map(c => c[0])
    expect(urls).toEqual(['https://cdn.cloudflare.steamstatic.com/steam/apps/367520/library_600x900.jpg', 'https://cdn.cloudflare.steamstatic.com/steam/apps/367520/header.jpg'])
  })
  it('un identifiant qui n’est pas un nombre entier : refusé AVANT tout appel', async () => {
    for (const bad of ['367520/../x', -1, 1.5, '1', 1e12]) {
      await expect(importSteamGame('c1', 'modo', bad, 'X')).rejects.toMatchObject({ code: 'STEAM_APPID_INVALID' })
    }
    expect(safeRequest).not.toHaveBeenCalled()
  })
  it('NODYX_STEAM_IMPORT=off : aucun appel à Steam', async () => {
    process.env.NODYX_STEAM_IMPORT = 'off'
    await expect(steamSearch('hollow')).rejects.toMatchObject({ code: 'STEAM_DISABLED' })
    await expect(importSteamGame('c1', 'modo', 1, 'X')).rejects.toMatchObject({ code: 'STEAM_DISABLED' })
    expect(safeRequest).not.toHaveBeenCalled()
  })
})

describe('les routes', () => {
  it('un membre lit le catalogue, mais ne peut ni ajouter, ni chercher sur Steam, ni retirer', async () => {
    const app = await buildApp(async a => { await a.register(gamesRoutes, { prefix: '/api/v1/games' }) })
    const r0 = await app.inject({ method: 'GET', url: '/api/v1/games', headers: { authorization: token('lea') } })
    expect(r0.statusCode).toBe(200)
    for (const [method, url] of [['GET', '/api/v1/games/steam?q=x'], ['POST', '/api/v1/games/steam'], ['DELETE', '/api/v1/games/11111111-1111-4111-8111-111111111111']] as const) {
      const r = await app.inject({ method, url, headers: { authorization: token('lea') }, ...(method === 'POST' ? { payload: { appid: 1, name: 'X' } } : {}) })
      expect([url, r.statusCode, r.json().code]).toEqual([url, 403, 'GAME_TEAM_ONLY'])
    }
    expect(safeRequest).not.toHaveBeenCalled()
    await app.close()
  })
  it('le statut dit si l’équipe peut gérer et si Steam est disponible', async () => {
    const app = await buildApp(async a => { await a.register(gamesRoutes, { prefix: '/api/v1/games' }) })
    expect((await app.inject({ method: 'GET', url: '/api/v1/games/status', headers: { authorization: token('modo') } })).json()).toEqual({ steam: true, can_manage: true })
    await app.close()
  })
})
