import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// OctoGuard 2, cran « Retenir » (CDC E4h, lot 2, D17) : le moteur ne publie
// rien, le contenu attend dans octoguard_held, n'est publié qu'une fois à
// l'approbation (même sur double clic), jeté au refus ou après 72 h.

const { st, calls, addMessageMock, postCreateMock, emitMock } = vi.hoisted(() => ({
  st: { held: null as null | Record<string, unknown>, claimable: true, role: 'member' as string, full: false, insertFails: false, banned: false, locked: false },
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  addMessageMock: vi.fn(),
  postCreateMock: vi.fn(),
  emitMock: vi.fn(),
}))

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue('OK'), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn().mockResolvedValue(1), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), keyPrefix: 'nodyx:' },
}))
vi.mock('../services/octoguard/webhook', () => ({ triggerWebhook: vi.fn(), buildWebhookPayload: vi.fn(() => ({})), getWebhookConfig: vi.fn(), setWebhookConfig: vi.fn(), invalidateWebhookConfig: vi.fn() }))
vi.mock('../models/channel', () => ({ addMessage: addMessageMock }))
vi.mock('../models/post', () => ({ create: postCreateMock, updateContent: vi.fn(), getAuthorAndThread: vi.fn(), listByThread: vi.fn() }))
vi.mock('../models/thread', () => ({ findById: vi.fn(), create: vi.fn(), incrementViews: vi.fn(), update: vi.fn(), remove: vi.fn() }))
vi.mock('../models/tag', () => ({ setThreadTags: vi.fn(), getTagsForThread: vi.fn().mockResolvedValue([]) }))
vi.mock('../models/reputation', () => ({ awardPoints: vi.fn(), REPUTATION: { THREAD: 10, REPLY: 2 } }))
vi.mock('../socket/io', () => ({ io: { to: () => ({ emit: emitMock }) } }))

import { db, redis } from '../config/database'
import * as ThreadModel from '../models/thread'
import { runPipeline } from '../services/octoguard/pipeline'
import { _setRulesForBench, clearRules } from '../services/octoguard/cache'
import { moderateText } from '../services/octoguard/moderate'
import { approveHeld, refuseHeld, expireHeld, holdContent, forAuthor, HELD_EXPIRY_HOURS } from '../services/octoguard/held'
import { octoguardAdminPlugin } from '../routes/octoguard'
import forumRoutes from '../routes/forums'
import type { AutomodRuleRow } from '../services/octoguard/types'

const AUTHOR = '00000000-0000-4000-8000-0000000000aa'
const MOD    = '22222222-2222-4222-8222-222222222222'
const CHAN   = '33333333-3333-4333-8333-333333333333'
const THREAD = '550e8400-e29b-41d4-a716-446655440000'
const HELD   = '44444444-4444-4444-8444-444444444444'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'mod' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
const flush = () => new Promise(r => setTimeout(r, 20))

function rule(extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  return {
    id: '00000000-0000-4000-8000-00000000rule', name: 'Liens', type: 'link_spam',
    params: { max_links: 1 }, action: 'hold', action_duration: null, escalation: null,
    immunized_role_types: [], immunized_grade_ids: [], dry_run: false, enabled: true,
    scopes: ['chat', 'forum', 'profile'], preset_key: null, customized: false, created_at: '', updated_at: '',
    ...extra,
  } as AutomodRuleRow
}
const SPAM = 'voir https://a.example et https://b.example'

function heldRow(extra: Record<string, unknown> = {}) {
  return {
    id: HELD, kind: 'chat', author_id: AUTHOR, channel_id: CHAN, thread_id: null, post_id: null, category_id: null,
    payload: { content: '<p>voir https://a.example</p>', reply_to_id: null }, rule_id: 'r1', rule_name: 'Liens',
    excerpt: 'https://a.example', status: 'pending', decided_by: null, decided_at: null, published_id: null,
    created_at: '2026-11-04T10:00:00Z', ...extra,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  st.held = heldRow(); st.claimable = true; st.role = 'member'; st.full = false; st.insertFails = false; st.banned = false; st.locked = false
  process.env.OCTOGUARD_ENABLED = 'true'
  clearRules()
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  addMessageMock.mockResolvedValue({ id: 'msg-new', channel_id: CHAN })
  postCreateMock.mockResolvedValue({ id: 'p-new' })
  vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: MOD, is_locked: false, category_id: 'cat' } as never)
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }], rowCount: 1 }
    if (s.includes('community_grades cg ON cg.id = cm.grade_id AND')) {
      return { rows: [{ role: params[1] === MOD ? 'admin' : st.role, permissions: null }], rowCount: 1 }
    }
    if (s.includes('LEFT JOIN community_members cm ON cm.user_id = u.id')) return { rows: [{ role: 'member', grade_id: null, account_age_days: 400 }] }
    if (s.startsWith('INSERT INTO octoguard_held')) {
      if (st.insertFails) throw new Error('db down')
      // La condition « moins de N en attente » est dans la requête : file pleine = aucune ligne
      if (st.full) return { rows: [], rowCount: 0 }
      return { rows: [heldRow({ kind: params[0], payload: JSON.parse(String(params[6])) })], rowCount: 1 }
    }
    if (s.startsWith('SELECT EXISTS (SELECT 1 FROM community_bans')) return { rows: [{ banned: st.banned, locked: st.locked }], rowCount: 1 }
    if (s.startsWith('DELETE FROM octoguard_held')) return { rows: [{ id: 'old' }], rowCount: 1 }
    if (s.startsWith("UPDATE octoguard_held SET status = $2")) {
      // La décision ne se prend qu'une fois : le second clic ne trouve plus de ligne « pending »
      if (!st.claimable) return { rows: [], rowCount: 0 }
      st.claimable = false
      return { rows: [st.held], rowCount: 1 }
    }
    if (s.startsWith("UPDATE octoguard_held SET status = 'expired'")) return { rows: [heldRow()], rowCount: 1 }
    if (s.startsWith('SELECT author_id, status FROM octoguard_held')) return { rows: st.held ? [st.held] : [], rowCount: st.held ? 1 : 0 }
    if (s.startsWith('INSERT INTO notifications')) return { rows: [{ id: 'n1' }], rowCount: 1 }
    return { rows: [], rowCount: 0 }
  }) as never)
})

describe('le moteur', () => {
  it('une règle au cran « retenir » ne bloque pas et ne publie pas : elle demande la mise de côté', async () => {
    _setRulesForBench([rule()])
    const res = await runPipeline({ content: SPAM, userCtx: { userId: AUTHOR, role: 'member', gradeIds: [] } })
    expect(res.blocked).toBe(false)
    expect(res.hold).toMatchObject({ rule_name: 'Liens' })
    expect(res.report).toBeUndefined()
  })
  it('en observation, « retenir » ne retient rien (journal « would_hold » seulement)', async () => {
    _setRulesForBench([rule({ dry_run: true })])
    const res = await runPipeline({ content: SPAM, userCtx: { userId: AUTHOR, role: 'member', gradeIds: [] } })
    expect(res.hold).toBeUndefined()
    await flush()
    expect(calls.some(c => c.sql.startsWith('INSERT INTO admin_audit_log') && c.params.includes('octoguard.would_hold'))).toBe(true)
  })
  it('le forum garde « retenir » ; le profil, qui n’a pas d’attente, le transforme en « signaler »', async () => {
    _setRulesForBench([rule()])
    expect(await moderateText(AUTHOR, 'forum', [SPAM])).toMatchObject({ blocked: false, hold: { rule_name: 'Liens' } })
    const profile = await moderateText(AUTHOR, 'profile', [SPAM])
    expect(profile).toMatchObject({ blocked: false, report: { rule_name: 'Liens' } })
    expect((profile as { hold?: unknown }).hold).toBeUndefined()
  })
})

describe('la mise de côté et les décisions', () => {
  const who = { id: MOD, username: 'mod' }

  it('holdContent écrit dans octoguard_held, PAS dans channel_messages', async () => {
    const h = await holdContent({ kind: 'chat', authorId: AUTHOR, channelId: CHAN, payload: { content: 'x' }, rule: { rule_id: 'r1', rule_name: 'Liens', excerpt: 'x' } })
    expect(h.ok && h.row.id).toBe(HELD)
    expect(calls.some(c => c.sql.includes('channel_messages'))).toBe(false)
    expect(addMessageMock).not.toHaveBeenCalled()
  })
  it('ce que voit l’auteur ne contient jamais le nom de la règle (D20)', () => {
    const v = forAuthor(heldRow() as never)
    expect(JSON.stringify(v)).not.toContain('Liens')
    expect(v.content).toContain('a.example')
  })
  it('approuver publie le message une fois dans le salon, et prévient l’auteur', async () => {
    const r = await approveHeld(HELD, who)
    expect(r).toMatchObject({ ok: true, published_id: 'msg-new' })
    expect(addMessageMock).toHaveBeenCalledTimes(1)
    expect(addMessageMock).toHaveBeenCalledWith({ channel_id: CHAN, author_id: AUTHOR, content: '<p>voir https://a.example</p>', reply_to_id: null })
    expect(emitMock).toHaveBeenCalledWith('chat:message', { id: 'msg-new', channel_id: CHAN })
    expect(emitMock).toHaveBeenCalledWith('octoguard:held_decided', expect.objectContaining({ outcome: 'approved' }))
  })
  it('deux membres de l’équipe qui approuvent en même temps : publié UNE seule fois', async () => {
    const [a, b] = await Promise.all([approveHeld(HELD, who), approveHeld(HELD, who)])
    expect([a.ok, b.ok].sort()).toEqual([false, true])
    expect(addMessageMock).toHaveBeenCalledTimes(1)
  })
  it('si le salon a disparu, rien n’est publié et le contenu repasse en attente', async () => {
    addMessageMock.mockRejectedValueOnce(new Error('fk'))
    const r = await approveHeld(HELD, who)
    expect(r).toEqual({ ok: false, code: 'PUBLISH_FAILED' })
    expect(calls.some(c => c.sql.startsWith("UPDATE octoguard_held SET status = 'pending'"))).toBe(true)
  })
  it('approuver une réponse du forum la crée dans son fil', async () => {
    st.held = heldRow({ kind: 'post', channel_id: null, thread_id: THREAD })
    const r = await approveHeld(HELD, who)
    expect(r).toMatchObject({ ok: true, published_id: 'p-new' })
    expect(postCreateMock).toHaveBeenCalledWith({ thread_id: THREAD, author_id: AUTHOR, content: '<p>voir https://a.example</p>' })
  })
  it('refuser ne publie rien et prévient l’auteur', async () => {
    const r = await refuseHeld(HELD, who)
    expect(r.ok).toBe(true)
    expect(addMessageMock).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith('octoguard:held_decided', expect.objectContaining({ outcome: 'refused' }))
  })
  it('D17 : l’expiration vise ce qui attend depuis plus de 72 h', async () => {
    expect(HELD_EXPIRY_HOURS).toBe(72)
    expect(await expireHeld()).toBe(1)
    const q = calls.find(c => c.sql.startsWith("UPDATE octoguard_held SET status = 'expired'"))!
    expect(q.sql).toContain("status = 'pending'")
    expect(q.params).toEqual(['72'])
    expect(emitMock).toHaveBeenCalledWith('octoguard:held_decided', expect.objectContaining({ outcome: 'expired' }))
  })
})

describe('les routes', () => {
  it('forum : une réponse retenue répond 202 et n’est PAS créée', async () => {
    _setRulesForBench([rule()])
    const app = await buildApp(a => a.register(forumRoutes, { prefix: '/f' }))
    const res = await app.inject({ method: 'POST', url: '/f/posts', headers: { authorization: token(AUTHOR) }, payload: { thread_id: THREAD, content: `<p>${SPAM}</p>` } })
    expect(res.statusCode).toBe(202)
    expect(res.json()).toMatchObject({ held: true, held_id: HELD, code: 'OCTOGUARD_HELD' })
    expect(postCreateMock).not.toHaveBeenCalled()
    const ins = calls.find(c => c.sql.startsWith('INSERT INTO octoguard_held'))!
    expect(ins.params[0]).toBe('post')
    expect(ins.params[3]).toBe(THREAD)
  })

  describe('la file de l’équipe', () => {
    let app: Awaited<ReturnType<typeof buildApp>>
    beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/api/v1/admin/octoguard' })) })
    const decide = (u: string, d = 'approve') => app.inject({ method: 'POST', url: `/api/v1/admin/octoguard/held/${HELD}/${d}`, headers: { authorization: token(u) } })

    it('approuver depuis la file publie', async () => {
      const res = await decide(MOD)
      expect(res.statusCode).toBe(200)
      expect(res.json()).toMatchObject({ ok: true, published_id: 'msg-new' })
    })
    it('on ne relit pas son propre contenu', async () => {
      st.held = heldRow({ author_id: MOD })
      const res = await decide(MOD)
      expect(res.statusCode).toBe(403)
      expect(res.json().code).toBe('CANNOT_REVIEW_SELF')
      expect(addMessageMock).not.toHaveBeenCalled()
    })
    it('déjà décidé : 409', async () => {
      st.held = heldRow({ status: 'approved' })
      const res = await decide(MOD)
      expect(res.statusCode).toBe(409)
      expect(res.json().code).toBe('ALREADY_DECIDED')
    })
    it('une décision inconnue est refusée', async () => {
      expect((await decide(MOD, 'publish')).statusCode).toBe(400)
    })
    it('un simple membre n’a pas accès à la file', async () => {
      const res = await decide(AUTHOR)
      expect(res.statusCode).toBe(403)
      expect(addMessageMock).not.toHaveBeenCalled()
    })
  })
})

describe('ce que le moteur lit du forum (trous trouvés au banc d’essai du 04/11)', () => {
  it('l’adresse d’un lien caché derrière un texte est lue', async () => {
    const { textForModeration } = await import('../services/octoguard/moderate')
    expect(textForModeration('<p>Lien : <a href="https://bit.ly/x9k">ici</a></p>')).toBe('Lien : ici https://bit.ly/x9k')
    expect(textForModeration('<p><a href="https://a.example">https://a.example</a></p>')).toBe('https://a.example')
  })
  it('rien n’est tronqué : un lien après 1000 caractères est lu', async () => {
    const { textForModeration } = await import('../services/octoguard/moderate')
    const long = `<p>${'blabla '.repeat(300)}</p><p>https://spam.example</p>`
    expect(textForModeration(long)).toContain('https://spam.example')
  })
  it('bout en bout : une réponse avec un lien « ici » est retenue par la règle de liens', async () => {
    _setRulesForBench([rule({ params: { max_links: 0 } })])
    const app = await buildApp(a => a.register(forumRoutes, { prefix: '/f' }))
    const res = await app.inject({ method: 'POST', url: '/f/posts', headers: { authorization: token(AUTHOR) }, payload: { thread_id: THREAD, content: '<p>Lien : <a href="https://bit.ly/x9k">ici</a></p>' } })
    expect(res.statusCode).toBe(202)
  })
})

describe('sécurité de la mise en attente (revue du 07/11)', () => {
  const who = { id: MOD, username: 'mod' }
  const hold = () => holdContent({ kind: 'chat', authorId: AUTHOR, channelId: CHAN, payload: { content: 'x' }, rule: { rule_id: 'r1', rule_name: 'Liens', excerpt: 'x' } })

  it('la limite par auteur est DANS la requête (5 en attente)', async () => {
    await hold()
    const q = calls.find(c => c.sql.startsWith('INSERT INTO octoguard_held'))!
    expect(q.sql).toContain("WHERE author_id = $2 AND status = 'pending') < $11")
    expect(q.params[10]).toBe(5)
  })
  it('file pleine : refus, code stable', async () => {
    st.full = true
    expect(await hold()).toEqual({ ok: false, code: 'HELD_LIMIT' })
  })
  it('base en panne : refus, jamais d’exception, jamais de publication', async () => {
    st.insertFails = true
    expect(await hold()).toEqual({ ok: false, code: 'HOLD_FAILED' })
    expect(addMessageMock).not.toHaveBeenCalled()
  })
  it('forum : file pleine ou base en panne = 422, la réponse N’EST PAS publiée', async () => {
    _setRulesForBench([rule()])
    const app = await buildApp(a => a.register(forumRoutes, { prefix: '/f' }))
    for (const k of ['full', 'insertFails'] as const) {
      st.full = false; st.insertFails = false; st[k] = true
      const res = await app.inject({ method: 'POST', url: '/f/posts', headers: { authorization: token(AUTHOR) }, payload: { thread_id: THREAD, content: `<p>${SPAM}</p>` } })
      expect(res.statusCode).toBe(422)
      expect(postCreateMock).not.toHaveBeenCalled()
    }
  })
  it('auteur banni depuis : l’approbation ne publie pas, le contenu reste en attente', async () => {
    st.banned = true
    expect(await approveHeld(HELD, who)).toEqual({ ok: false, code: 'AUTHOR_BANNED' })
    expect(addMessageMock).not.toHaveBeenCalled()
    expect(calls.some(c => c.sql.startsWith("UPDATE octoguard_held SET status = 'pending'"))).toBe(true)
  })
  it('fil verrouillé depuis : une réponse retenue n’est pas publiée', async () => {
    st.locked = true
    st.held = heldRow({ kind: 'post', channel_id: null, thread_id: THREAD })
    expect(await approveHeld(HELD, who)).toEqual({ ok: false, code: 'THREAD_LOCKED' })
    expect(postCreateMock).not.toHaveBeenCalled()
  })
  it('le texte des contenus décidés est effacé après 30 jours, jamais ce qui attend', async () => {
    const { purgeDecidedHeld } = await import('../services/octoguard/held')
    await purgeDecidedHeld()
    const q = calls.find(c => c.sql.startsWith('DELETE FROM octoguard_held'))!
    expect(q.sql).toContain("status <> 'pending'")
    expect(q.params).toEqual(['30'])
  })
})

describe('approuver ne publie jamais deux fois (relecture du 07/11)', () => {
  const who = { id: MOD, username: 'mod' }
  it('les points de réputation échouent APRÈS la création : publié, acquis, pas de remise en attente', async () => {
    const { awardPoints } = await import('../models/reputation')
    vi.mocked(awardPoints).mockRejectedValueOnce(new Error('redis down'))
    st.held = heldRow({ kind: 'post', channel_id: null, thread_id: THREAD })
    const r = await approveHeld(HELD, who)
    expect(r).toMatchObject({ ok: true, published_id: 'p-new' })
    expect(calls.some(c => c.sql.startsWith("UPDATE octoguard_held SET status = 'pending'"))).toBe(false)
    // un second clic ne trouve plus rien à publier
    expect(await approveHeld(HELD, who)).toEqual({ ok: false, code: 'ALREADY_DECIDED' })
    expect(postCreateMock).toHaveBeenCalledTimes(1)
  })
  it('nouveau fil dont le premier message échoue : le fil vide est retiré, rien n’est publié', async () => {
    vi.mocked(ThreadModel.create).mockResolvedValueOnce({ id: 'th-new' } as never)
    postCreateMock.mockRejectedValueOnce(new Error('fk'))
    st.held = heldRow({ kind: 'thread', channel_id: null, category_id: 'cat', payload: { content: '<p>x</p>', title: 'Titre' } })
    const r = await approveHeld(HELD, who)
    expect(r).toEqual({ ok: false, code: 'PUBLISH_FAILED' })
    expect(ThreadModel.remove).toHaveBeenCalledWith('th-new')
  })
})
