import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  redis: {
    exists: vi.fn().mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1)),
    setex:  vi.fn().mockResolvedValue('OK'),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../services/assetService', () => ({
  uploadAsset:    vi.fn(),
  getAssetMeta:   vi.fn(),
  listUserAssets: vi.fn(),
  searchAssets:   vi.fn(),
  deleteAsset:    vi.fn(),
}))

// Minimal mock for adminOnly — asset admin routes use it
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

// ── Imports ───────────────────────────────────────────────────

import * as AssetService from '../services/assetService'
import { db, redis }     from '../config/database'
import assetRoutes       from '../routes/assets'

// ── Helpers ───────────────────────────────────────────────────

const USER_UUID  = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const ASSET_UUID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d'

function makeToken(userId = USER_UUID, username = 'testuser') {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

const FAKE_ASSET = {
  id:           ASSET_UUID,
  creator_id:   USER_UUID,
  name:         'Cool Frame',
  asset_type:   'frame',
  file_path:    'assets/cool-frame.webp',
  thumbnail_path: 'assets/cool-frame-thumb.webp',
  tags:         ['fantasy'],
  is_banned:    false,
  created_at:   new Date(),
}

// ── Tests — GET / (search) ────────────────────────────────────

describe('GET /api/v1/assets', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(AssetService.searchAssets).mockResolvedValue([FAKE_ASSET] as any)
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 200 with array of assets', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets' })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.assets)).toBe(true)
    expect(body.assets[0].name).toBe('Cool Frame')
  })

  it('accepts type filter query param', async () => {
    vi.mocked(AssetService.searchAssets).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets?type=frame' })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(AssetService.searchAssets)).toHaveBeenCalledWith(
      expect.objectContaining({ assetType: 'frame' })
    )
  })

  it('returns 400 for invalid type value', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets?type=invalid' })
    expect(res.statusCode).toBe(400)
  })

  it('passes search query to searchAssets', async () => {
    vi.mocked(AssetService.searchAssets).mockResolvedValue([])
    const res = await app.inject({ method: 'GET', url: '/api/v1/assets?q=frame' })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(AssetService.searchAssets)).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'frame' })
    )
  })
})

// ── Tests — GET /:id ──────────────────────────────────────────

describe('GET /api/v1/assets/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 200 with asset metadata for existing asset', async () => {
    vi.mocked(AssetService.getAssetMeta).mockResolvedValue(FAKE_ASSET as any)
    const res = await app.inject({ method: 'GET', url: `/api/v1/assets/${ASSET_UUID}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.asset.id).toBe(ASSET_UUID)
  })

  it('returns 404 when asset not found', async () => {
    vi.mocked(AssetService.getAssetMeta).mockResolvedValue(null)
    const res = await app.inject({ method: 'GET', url: `/api/v1/assets/${ASSET_UUID}` })
    expect(res.statusCode).toBe(404)
  })
})

// ── Tests — GET /user/:userId ─────────────────────────────────

describe('GET /api/v1/assets/user/:userId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(AssetService.listUserAssets).mockResolvedValue([FAKE_ASSET] as any)
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 200 with list of user assets', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/v1/assets/user/${USER_UUID}` })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.assets)).toBe(true)
  })
})

// ── Tests — DELETE /:id ───────────────────────────────────────

describe('DELETE /api/v1/assets/:id', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(assetRoutes, { prefix: '/api/v1/assets' }))
  })

  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'DELETE', url: `/api/v1/assets/${ASSET_UUID}` })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when asset not found or not owner', async () => {
    vi.mocked(AssetService.deleteAsset).mockResolvedValue(false)
    const token = makeToken()
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/assets/${ASSET_UUID}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 200 when asset deleted successfully', async () => {
    vi.mocked(AssetService.deleteAsset).mockResolvedValue(true)
    const token = makeToken()
    const res = await app.inject({
      method:  'DELETE',
      url:     `/api/v1/assets/${ASSET_UUID}`,
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
  })
})
