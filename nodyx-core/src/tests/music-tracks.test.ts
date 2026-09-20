import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  redis: {
    exists:   vi.fn().mockResolvedValue(0),
    incr:     vi.fn().mockResolvedValue(1),
    expire:   vi.fn().mockResolvedValue(1),
    setex:    vi.fn().mockResolvedValue('OK'),
    get:      vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

const { CATEGORY } = vi.hoisted(() => ({
  CATEGORY: {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', community_id: 'c', slug: 'twisted-reality',
    title: 'Twisted Reality', description: null, license_note: null, views: 0, position: 0,
    created_at: '', updated_at: '', image_url: null, track_count: 0,
  },
}))

vi.mock('../models/musicCategory', () => ({
  findById: vi.fn().mockResolvedValue(CATEGORY),
}))

const createTrack = vi.fn()
vi.mock('../models/musicTrack', () => ({
  create: (...args: any[]) => createTrack(...args),
}))

// ── Imports ───────────────────────────────────────────────────

import musicRoutes from '../routes/music'

function makeAdminToken() {
  return jwt.sign({ userId: 'admin-uuid', username: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

describe('POST /api/v1/music/tracks — source upload vs youtube', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    createTrack.mockResolvedValue({ id: 't1', source_type: 'youtube', youtube_id: 'xPU8OAjjS4k' })
    app = await buildApp(a => a.register(musicRoutes, { prefix: '/api/v1/music' }))
  })

  function post(body: unknown) {
    return app.inject({
      method:  'POST',
      url:     '/api/v1/music/tracks',
      headers: { Authorization: `Bearer ${makeAdminToken()}` },
      payload: body,
    })
  }

  it('rejects an upload track with no audio_asset_id', async () => {
    const res = await post({ category_id: CATEGORY.id, title: 'Sans fichier', source_type: 'upload' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('MISSING_FIELDS')
    expect(createTrack).not.toHaveBeenCalled()
  })

  it('rejects a youtube track with a malformed video id', async () => {
    const res = await post({ category_id: CATEGORY.id, title: 'Mauvais id', source_type: 'youtube', youtube_id: 'trop-court', artist: 'X' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('INVALID_YOUTUBE_ID')
    expect(createTrack).not.toHaveBeenCalled()
  })

  it('rejects a youtube track with no artist', async () => {
    const res = await post({ category_id: CATEGORY.id, title: 'Sans artiste', source_type: 'youtube', youtube_id: 'xPU8OAjjS4k' })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('INVALID_ARTIST')
    expect(createTrack).not.toHaveBeenCalled()
  })

  it('accepts a valid youtube track and never sets audio_asset_id', async () => {
    const res = await post({
      category_id: CATEGORY.id, title: 'Kryptonite', source_type: 'youtube',
      youtube_id: 'xPU8OAjjS4k', artist: '3 Doors Down', genre: 'post_grunge',
    })
    expect(res.statusCode).toBe(201)
    expect(createTrack).toHaveBeenCalledTimes(1)
    const arg = createTrack.mock.calls[0][0]
    expect(arg.source_type).toBe('youtube')
    expect(arg.youtube_id).toBe('xPU8OAjjS4k')
    expect(arg.artist).toBe('3 Doors Down')
    expect(arg.audio_asset_id).toBeNull()
  })

  it('accepts a valid upload track and never sets youtube_id/artist', async () => {
    createTrack.mockResolvedValue({ id: 't2', source_type: 'upload' })
    const res = await post({
      category_id: CATEGORY.id, title: 'Ambiance village', audio_asset_id: 'a1b2c3d4-58cc-4372-a567-0e02b2c3d479',
    })
    expect(res.statusCode).toBe(201)
    const arg = createTrack.mock.calls[0][0]
    expect(arg.source_type).toBe('upload')
    expect(arg.audio_asset_id).toBe('a1b2c3d4-58cc-4372-a567-0e02b2c3d479')
    expect(arg.youtube_id).toBeNull()
    expect(arg.artist).toBeNull()
  })

  it('rejects a genre longer than 30 characters', async () => {
    const res = await post({
      category_id: CATEGORY.id, title: 'Genre trop long', source_type: 'youtube',
      youtube_id: 'xPU8OAjjS4k', artist: 'X', genre: 'a'.repeat(31),
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('INVALID_GENRE')
  })

  it('returns 401 without an auth token', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/music/tracks', payload: {} })
    expect(res.statusCode).toBe(401)
  })
})
