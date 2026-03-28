/**
 * Tests for /api/v1/polls
 * Routes: GET /, POST /, GET /:id, POST /:id/vote, DELETE /:id/vote,
 *         POST /:id/close, DELETE /:id
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query:   vi.fn(),
    connect: vi.fn(),  // pool client for transactions
  },
  redis: {
    exists: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('banned:') ? 0 : 1)
    ),
    incr:     vi.fn().mockResolvedValue(1),
    expire:   vi.fn().mockResolvedValue(1),
    ttl:      vi.fn().mockResolvedValue(60),
    setex:    vi.fn().mockResolvedValue('OK'),
    set:      vi.fn().mockResolvedValue('OK'),
    del:      vi.fn().mockResolvedValue(1),
    sadd:     vi.fn().mockResolvedValue(1),
    srem:     vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../socket/io', () => ({
  io: { to: vi.fn().mockReturnValue({ emit: vi.fn() }) },
}))

vi.mock('../models/channel', () => ({
  addMessage: vi.fn().mockResolvedValue({ id: 'msg-uuid', content: '' }),
}))

import { db, redis } from '../config/database'
import pollRoutes  from '../routes/polls'

// ── Helpers ───────────────────────────────────────────────────────────────────

function restoreRedis() {
  vi.mocked(redis.exists).mockImplementation((key: string) =>
    Promise.resolve(key.startsWith('banned:') ? 0 : 1)
  )
  vi.mocked(redis.setex).mockResolvedValue('OK')
}

/** Returns a mock pool client for transaction tests */
function makeMockClient(queryReplies: any[]) {
  const client = {
    query:   vi.fn(),
    release: vi.fn(),
  }
  queryReplies.forEach(r => client.query.mockResolvedValueOnce(r))
  vi.mocked((db as any).connect).mockResolvedValueOnce(client)
  return client
}

const SECRET = process.env.JWT_SECRET!
const CREATOR_ID = 'creator-uuid'
const OTHER_ID   = 'other-uuid'

function makeToken(userId: string) {
  return jwt.sign({ userId, username: `user_${userId.slice(0,4)}` }, SECRET, { expiresIn: '1h' })
}

const CREATOR_TOKEN = makeToken(CREATOR_ID)
const OTHER_TOKEN   = makeToken(OTHER_ID)
const AUTH_CREATOR  = `Bearer ${CREATOR_TOKEN}`
const AUTH_OTHER    = `Bearer ${OTHER_TOKEN}`

const FAKE_POLL_OPEN = {
  id:               'poll-uuid-1',
  title:            'Quelle feature en priorité ?',
  description:      null,
  type:             'choice',
  multiple:         false,
  max_choices:      null,
  anonymous:        false,
  show_results:     true,
  created_by:       CREATOR_ID,
  closed_at:        null,
  closes_at:        null,
  channel_id:       null,
  thread_id:        null,
  creator_username: 'creator',
  creator_avatar:   null,
  total_votes:      '3',
  option_count:     '3',
  has_voted:        false,
}

const FAKE_POLL_CLOSED = {
  ...FAKE_POLL_OPEN,
  id: 'poll-uuid-2',
  closed_at: '2026-03-27T00:00:00Z',
}

const FAKE_OPTIONS = [
  { id: 'opt-1', label: 'Wiki', description: null, image_url: null, date_start: null, date_end: null, position: 1 },
  { id: 'opt-2', label: 'Canvas', description: null, image_url: null, date_start: null, date_end: null, position: 2 },
  { id: 'opt-3', label: 'Jukebox', description: null, image_url: null, date_start: null, date_end: null, position: 3 },
]

// ─────────────────────────────────────────────────────────────────────────────
// GET /
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/polls', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 503 when no community configured', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any) // getCommunityId → null
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { Authorization: AUTH_CREATOR },
    })
    expect(res.statusCode).toBe(503)
  })

  it('returns polls list with is_open computed', async () => {
    // Use mockImplementation to route by SQL — handles _communityId module cache
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (String(sql).includes('communities')) return { rows: [{ id: 'comm-uuid' }] } as any
      return { rows: [FAKE_POLL_OPEN, FAKE_POLL_CLOSED] } as any
    })

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { Authorization: AUTH_CREATOR },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.polls).toHaveLength(2)
    expect(body.polls[0].is_open).toBe(true)
    expect(body.polls[1].is_open).toBe(false)
  })

  it('total_votes and option_count are numbers', async () => {
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (String(sql).includes('communities')) return { rows: [{ id: 'comm-uuid' }] } as any
      return { rows: [FAKE_POLL_OPEN] } as any
    })

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { Authorization: AUTH_CREATOR },
    })
    expect(typeof res.json().polls[0].total_votes).toBe('number')
    expect(typeof res.json().polls[0].option_count).toBe('number')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST / — create
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/polls', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  const VALID_BODY = {
    title:   'Quel OS pour votre VPS ?',
    type:    'choice',
    options: [
      { label: 'Ubuntu 24.04' },
      { label: 'Debian 12' },
      { label: 'Fedora 40' },
    ],
  }

  it('requires authentication', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects empty title', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'content-type': 'application/json', Authorization: AUTH_CREATOR },
      payload: { ...VALID_BODY, title: '   ' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/Title/)
  })

  it('rejects fewer than 2 options', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'content-type': 'application/json', Authorization: AUTH_CREATOR },
      payload: { ...VALID_BODY, options: [{ label: 'Only one' }] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/2 options/)
  })

  it('rejects more than 20 options', async () => {
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ label: `Option ${i + 1}` }))
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'content-type': 'application/json', Authorization: AUTH_CREATOR },
      payload: { ...VALID_BODY, options: tooMany },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/20/)
  })

  it('rejects schedule poll with options missing date_start', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'content-type': 'application/json', Authorization: AUTH_CREATOR },
      payload: {
        title: 'Quand se retrouver ?',
        type: 'schedule',
        options: [{ label: 'Samedi' }, { label: 'Dimanche' }], // missing date_start
      },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatch(/date_start/)
  })

  it('creates a valid choice poll and returns poll object', async () => {
    const pollRow = { id: 'new-poll-uuid', title: VALID_BODY.title, type: 'choice', anonymous: false }
    makeMockClient([
      { rows: [] },                  // BEGIN
      { rows: [pollRow] },           // INSERT poll
      { rows: [] },                  // INSERT option 1
      { rows: [] },                  // INSERT option 2
      { rows: [] },                  // INSERT option 3
      { rows: [] },                  // COMMIT
    ])

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'content-type': 'application/json', Authorization: AUTH_CREATOR },
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().poll.id).toBe('new-poll-uuid')
    expect(res.json().poll.title).toBe(VALID_BODY.title)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/polls/:id', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/poll-uuid-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when poll not found', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any)
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/unknown-poll-uuid',
      headers: { Authorization: AUTH_OTHER },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns poll with results and user votes', async () => {
    // Route query order: SELECT poll → getUserVotes → computeResults(votes, options) → participantCount
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_POLL_OPEN] } as any)          // SELECT poll
      .mockResolvedValueOnce({ rows: [] } as any)                        // getUserVotes
      .mockResolvedValueOnce({ rows: [] } as any)                        // computeResults: poll_votes
      .mockResolvedValueOnce({ rows: FAKE_OPTIONS } as any)              // computeResults: poll_options
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)         // participantCount

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/poll-uuid-1',
      headers: { Authorization: AUTH_OTHER },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.poll.id).toBe('poll-uuid-1')
    expect(body.poll.is_open).toBe(true)
    expect(body.poll.results).toBeInstanceOf(Array)
    expect(body.poll.user_votes).toBeInstanceOf(Array)
  })

  it('marks poll as closed when closed_at is set', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_POLL_CLOSED] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)                        // getUserVotes
      .mockResolvedValueOnce({ rows: [] } as any)                        // computeResults: votes
      .mockResolvedValueOnce({ rows: FAKE_OPTIONS } as any)              // computeResults: options
      .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)         // participantCount

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/poll-uuid-2',
      headers: { Authorization: AUTH_OTHER },
    })
    expect(res.json().poll.is_open).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/vote
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/polls/:id/vote', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/poll-uuid-1/vote',
      headers: { 'content-type': 'application/json' },
      payload: { votes: [{ option_id: 'opt-1' }] },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when poll not found', async () => {
    // Route: ban check → poll pre-check (not found) → 404
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] } as any)  // ban check (no ban)
      .mockResolvedValueOnce({ rows: [] } as any)  // SELECT poll (not found)

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/unknown/vote',
      headers: { 'content-type': 'application/json', Authorization: AUTH_OTHER },
      payload: { votes: [{ option_id: 'opt-1' }] },
    })
    expect(res.statusCode).toBe(404)
  })

  it('rejects vote on closed poll', async () => {
    // Route: ban check → pre-check (closed poll) → options validate → transaction (FOR UPDATE → closed → ROLLBACK → 409)
    makeMockClient([
      { rows: [] },               // BEGIN
      { rows: [FAKE_POLL_CLOSED] }, // SELECT FOR UPDATE — poll is closed
      { rows: [] },               // ROLLBACK
    ])
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [] } as any)   // ban check
      .mockResolvedValueOnce({ rows: [{ id: 'poll-uuid-2', type: 'choice', multiple: false, max_choices: null }] } as any) // pre-check
      .mockResolvedValueOnce({ rows: [{ id: 'opt-1' }] } as any)  // options validation

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/poll-uuid-2/vote',
      headers: { 'content-type': 'application/json', Authorization: AUTH_OTHER },
      payload: { votes: [{ option_id: 'opt-1' }] },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().error).toMatch(/closed/i)
  })

  it('rejects empty votes array', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [FAKE_POLL_OPEN] } as any)
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/poll-uuid-1/vote',
      headers: { 'content-type': 'application/json', Authorization: AUTH_OTHER },
      payload: { votes: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/close
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/polls/:id/close', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({ method: 'POST', url: '/poll-uuid-1/close' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when poll not found', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any)
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/unknown/close',
      headers: { Authorization: AUTH_CREATOR },
    })
    expect(res.statusCode).toBe(404)
  })

  it('blocks non-creator non-admin from closing', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_POLL_OPEN] } as any) // SELECT poll (created_by = CREATOR_ID)
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] } as any) // getUserRole for OTHER_ID

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/poll-uuid-1/close',
      headers: { Authorization: AUTH_OTHER }, // not the creator
    })
    expect(res.statusCode).toBe(403)
  })

  it('allows creator to close their poll', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_POLL_OPEN] } as any)   // SELECT poll
      .mockResolvedValueOnce({ rows: [] } as any)                  // community_members (creator check)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)    // UPDATE closed_at

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/poll-uuid-1/close',
      headers: { Authorization: AUTH_CREATOR },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id — delete poll
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/polls/:id', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({ method: 'DELETE', url: '/poll-uuid-1' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when poll not found', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any)
    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/unknown-poll',
      headers: { Authorization: AUTH_CREATOR },
    })
    expect(res.statusCode).toBe(404)
  })

  it('blocks non-creator non-admin from deleting', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_POLL_OPEN] } as any)
      .mockResolvedValueOnce({ rows: [{ role: 'member' }] } as any)

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/poll-uuid-1',
      headers: { Authorization: AUTH_OTHER },
    })
    expect(res.statusCode).toBe(403)
  })

  it('allows creator to delete', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_POLL_OPEN] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)                // community_members (creator check)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)  // DELETE

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/poll-uuid-1',
      headers: { Authorization: AUTH_CREATOR },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
  })

  it('allows admin to delete any poll', async () => {
    const adminToken = jwt.sign({ userId: 'admin-uuid', username: 'admin' }, SECRET, { expiresIn: '1h' })
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_POLL_OPEN] } as any)                // SELECT poll (not admin's)
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }] } as any)             // getUserRole → admin
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)                 // DELETE

    const app = await buildApp(app => pollRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/poll-uuid-1',
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
  })
})
