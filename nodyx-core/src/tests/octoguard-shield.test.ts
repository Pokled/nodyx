import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lot 6 : le bouclier anti-raid (D21 : moins d'1 jour, D21b : chat, forum et MP,
// D21c : le bouton marche OctoGuard éteint, l'automatique demande OctoGuard allumé).

const h = vi.hoisted(() => {
  const store = new Map<string, { v: string; exp: number | null }>()
  const alive = (k: string) => { const e = store.get(k); if (!e) return null; if (e.exp !== null && e.exp <= Date.now()) { store.delete(k); return null } return e }
  const redis = {
    get: async (k: string) => alive(k)?.v ?? null,
    set: async (k: string, v: string, ...args: Array<string | number>) => {
      let exp: number | null = null; let nx = false
      for (let i = 0; i < args.length; i++) {
        if (args[i] === 'PX') exp = Date.now() + Number(args[++i])
        else if (args[i] === 'EX') exp = Date.now() + Number(args[++i]) * 1000
        else if (args[i] === 'NX') nx = true
      }
      if (nx && alive(k)) return null
      store.set(k, { v, exp }); return 'OK'
    },
    del: async (k: string) => (store.delete(k) ? 1 : 0),
    incr: async (k: string) => { const e = alive(k); const n = (e ? Number(e.v) : 0) + 1; store.set(k, { v: String(n), exp: e?.exp ?? null }); return n },
    expire: async (k: string, s: number) => { const e = alive(k); if (!e) return 0; e.exp = Date.now() + s * 1000; return 1 },
    ttl: async (k: string) => { const e = alive(k); if (!e) return -2; return e.exp === null ? -1 : Math.ceil((e.exp - Date.now()) / 1000) },
  }
  return {
    store, redis,
    clock: { advance: (ms: number) => { vi.setSystemTime(Date.now() + ms) }, now: () => Date.now(), reset: () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-11-12T20:00:00Z')) } },
    ageDays: new Map<string, number>(),
    perms: new Map<string, string[]>(),
    ogOn: { v: false },
    logs: [] as Array<{ action: string; actor_id?: string | null; metadata: Record<string, unknown> }>,
    notes: [] as Array<{ user_id: string; type: string }>,
    emits: [] as Array<[string, unknown]>,
  }
})

vi.mock('../config/database', () => ({
  redis: h.redis,
  db: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql)
      if (s.includes('AS age_days FROM users')) return { rows: [{ age_days: h.ageDays.get(params[0] as string) ?? 400 }] }
      if (s.includes('FROM community_members cm') && s.includes("cm.role IN ('owner', 'admin', 'moderator')")) return { rows: [{ user_id: 'mod-1' }, { user_id: 'admin-1' }].filter((r) => r.user_id !== params[1]) }
      return { rows: [{ n: 0 }] }
    }),
  },
}))
vi.mock('../middleware/adminOnly', () => ({ getInstanceCommunityId: vi.fn(async () => 'c1'), adminOnly: vi.fn() }))
vi.mock('../services/permissions', async (orig) => ({
  ...(await orig() as object),
  getAccess: vi.fn(async (_c: string, u: string) => ({ role: null, rank: 0, permissions: h.perms.get(u) ?? [] })),
}))
vi.mock('../services/octoguard/index', () => ({ isOctoGuardEnabled: () => h.ogOn.v }))
vi.mock('../services/octoguard/logger', () => ({ logOctoGuardAction: (e: never) => { h.logs.push(e) } }))
vi.mock('../models/notification', () => ({
  create: vi.fn(async (n: { user_id: string; type: string }) => { h.notes.push(n); return n }),
  getUnreadCount: vi.fn(async () => 1),
}))
vi.mock('../socket/io', () => ({ io: { emit: (e: string, p: unknown) => { h.emits.push([e, p]) }, to: () => ({ emit: () => {} }) } }))

import {
  getShield, raiseShield, lowerShield, shieldGate, hasLink, recordSignup, recordHeld,
  SHIELD_NEW_ACCOUNT_DAYS, SHIELD_SLOW_SECONDS,
} from '../services/octoguard/shield'

beforeEach(() => {
  h.store.clear(); h.clock.reset(); h.ageDays.clear(); h.perms.clear()
  h.logs.length = 0; h.notes.length = 0; h.emits.length = 0; h.ogOn.v = false
  delete process.env.OCTOGUARD_SHIELD_ALERT_ACCOUNTS; delete process.env.OCTOGUARD_SHIELD_ALERT_HELD; delete process.env.OCTOGUARD_SHIELD_AUTO
})
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('lever et baisser', () => {
  it('le bouton lève 30 minutes par défaut, journalise, prévient l’équipe (sauf soi)', async () => {
    const s = await raiseShield({ actorId: 'mod-1', actorName: 'Lea' })
    expect(Date.parse(s.until) - h.clock.now()).toBe(30 * 60_000)
    expect(await getShield()).not.toBeNull()
    expect(h.logs.map((l) => l.action)).toEqual(['octoguard.shield_raised'])
    expect(h.logs[0].actor_id).toBe('mod-1')
    await flush(); await flush()
    expect(h.notes).toEqual([expect.objectContaining({ user_id: 'admin-1', type: 'shield_raised' })])
    expect(h.emits).toContainEqual(['octoguard:shield', { active: true, until: s.until }])
  })
  it('il retombe TOUT SEUL à l’heure dite', async () => {
    await raiseShield({ actorId: 'mod-1', minutes: 15 })
    h.clock.advance(15 * 60_000 - 1000)
    expect(await getShield()).not.toBeNull()
    h.clock.advance(2000)
    expect(await getShield()).toBeNull()
  })
  it('la clé Redis expire d’elle-même (rien ne traîne après le bouclier)', async () => {
    await raiseShield({ actorId: 'mod-1', minutes: 60 })
    expect(await h.redis.ttl('og:shield')).toBe(3600)
  })
  it('une durée hors liste retombe sur 30 minutes', async () => {
    const s = await raiseShield({ actorId: 'mod-1', minutes: 9999 })
    expect(Date.parse(s.until) - h.clock.now()).toBe(30 * 60_000)
  })
  it('baisser avant l’heure ; baisser un bouclier déjà baissé ne journalise rien', async () => {
    await raiseShield({ actorId: 'mod-1' })
    expect(await lowerShield({ actorId: 'mod-1' })).toBe(true)
    expect(await getShield()).toBeNull()
    expect(await lowerShield({ actorId: 'mod-1' })).toBe(false)
    expect(h.logs.map((l) => l.action)).toEqual(['octoguard.shield_raised', 'octoguard.shield_lowered'])
  })
})

describe('qui peut écrire pendant le bouclier', () => {
  it('bouclier baissé : tout le monde écrit, rien n’est retenu', async () => {
    h.ageDays.set('neuf', 0.01)
    expect(await shieldGate('neuf', 'chat')).toEqual({ allow: true, holdLinks: false })
  })
  it('D21 : un compte de moins d’1 jour lit sans écrire, chat, forum ET messages privés', async () => {
    await raiseShield({ actorId: 'mod-1' })
    h.ageDays.set('neuf', 0.5)
    for (const surface of ['chat', 'forum', 'dm', 'other'] as const) {
      const g = await shieldGate('neuf', surface)
      expect(g.allow).toBe(false)
      if (!g.allow) expect(g.code).toBe('SHIELD_NEW_ACCOUNT')
    }
    expect(SHIELD_NEW_ACCOUNT_DAYS).toBe(1)
  })
  it('un compte d’hier (plus d’1 jour) écrit encore', async () => {
    await raiseShield({ actorId: 'mod-1' })
    h.ageDays.set('hier', 1.2)
    expect((await shieldGate('hier', 'forum')).allow).toBe(true)
  })
  it('l’équipe n’est jamais touchée, même avec un compte tout neuf', async () => {
    await raiseShield({ actorId: 'mod-1' })
    h.ageDays.set('modo', 0.1); h.perms.set('modo', ['moderate_content'])
    for (let i = 0; i < 3; i++) expect(await shieldGate('modo', 'chat')).toEqual({ allow: true, holdLinks: false })
  })
  it('le chat ralenti : un message toutes les 10 s, pas pour une modification', async () => {
    await raiseShield({ actorId: 'mod-1' })
    expect(await shieldGate('ancien', 'chat')).toEqual({ allow: true, holdLinks: true })
    const second = await shieldGate('ancien', 'chat')
    expect(second.allow).toBe(false)
    if (!second.allow) { expect(second.code).toBe('SHIELD_SLOW'); expect(second.retry_after_s).toBe(SHIELD_SLOW_SECONDS) }
    expect((await shieldGate('ancien', 'chat', { isNew: false })).allow).toBe(true)
    h.clock.advance(SHIELD_SLOW_SECONDS * 1000)
    expect((await shieldGate('ancien', 'chat')).allow).toBe(true)
  })
  it('le forum et les MP ne sont pas ralentis ; les liens attendent seulement dans le chat et le forum', async () => {
    await raiseShield({ actorId: 'mod-1' })
    expect(await shieldGate('ancien', 'forum')).toEqual({ allow: true, holdLinks: true })
    expect(await shieldGate('ancien', 'forum')).toEqual({ allow: true, holdLinks: true })
    expect(await shieldGate('ancien', 'dm')).toEqual({ allow: true, holdLinks: false })
    expect(await shieldGate('ancien', 'other')).toEqual({ allow: true, holdLinks: false })
  })
  it('une panne de la base, en plein contrôle, laisse écrire aussi', async () => {
    await raiseShield({ actorId: 'mod-1' })
    const { db } = await import('../config/database')
    vi.mocked(db.query).mockRejectedValueOnce(new Error('db down'))
    expect(await shieldGate('ancien', 'forum')).toEqual({ allow: true, holdLinks: false })
  })
  it('une panne laisse écrire (jamais une porte fermée sur une erreur)', async () => {
    await raiseShield({ actorId: 'mod-1' })
    const spy = vi.spyOn(h.redis, 'get').mockRejectedValueOnce(new Error('redis down'))
    expect(await shieldGate('ancien', 'chat')).toEqual({ allow: true, holdLinks: false })
    spy.mockRestore()
  })
})

describe('les liens', () => {
  it.each([
    ['https://arnaque.example/gratuit', true], ['va sur www.site-louche.com', true], ['discord.gg/abcd', true],
    ['http://x.y', true], ['rendez-vous à 20h. merci', false], ['le fichier notes.txt', false], ['e.g. un exemple', false],
  ])('%s → %s', (text, expected) => { expect(hasLink(text)).toBe(expected) })
})

describe('l’alerte : OctoGuard repère la vague', () => {
  it('D21c : OctoGuard éteint, aucune alerte, même au-delà du seuil', async () => {
    for (let i = 0; i < 15; i++) expect(await recordSignup()).toBeNull()
    expect(await getShield()).toBeNull()
  })
  it('allumé : au 10e compte en 10 min, l’équipe est prévenue UNE fois (pas de levée sans autorisation)', async () => {
    h.ogOn.v = true
    const out: Array<string | null> = []
    for (let i = 0; i < 14; i++) out.push(await recordSignup())
    expect(out.indexOf('suggested')).toBe(9)
    expect(out.filter((x) => x === 'suggested')).toHaveLength(1)
    expect(await getShield()).toBeNull()
    expect(h.logs.map((l) => l.action)).toContain('octoguard.shield_suggested')
    await flush(); await flush()
    expect(h.notes.every((n) => n.type === 'shield_suggested')).toBe(true)
    expect(h.notes.length).toBe(2)
  })
  it('les comptes au-delà de 10 minutes ne s’additionnent pas', async () => {
    h.ogOn.v = true
    for (let i = 0; i < 9; i++) await recordSignup()
    h.clock.advance(601_000)
    expect(await recordSignup()).toBeNull()
  })
  it('levée automatique autorisée : le bouclier se lève tout seul, 30 minutes', async () => {
    h.ogOn.v = true; process.env.OCTOGUARD_SHIELD_AUTO = 'true'; process.env.OCTOGUARD_SHIELD_ALERT_HELD = '3'
    expect(await recordHeld()).toBeNull()
    expect(await recordHeld()).toBeNull()
    expect(await recordHeld()).toBe('raised')
    const s = await getShield()
    expect(s?.reason).toBe('auto')
    expect(s?.trigger).toEqual({ kind: 'held', count: 3, window_minutes: 5 })
  })
  it('déjà levé : pas de nouvelle alerte', async () => {
    h.ogOn.v = true; process.env.OCTOGUARD_SHIELD_ALERT_ACCOUNTS = '2'
    await raiseShield({ actorId: 'mod-1' })
    h.logs.length = 0
    await recordSignup(); await recordSignup(); await recordSignup()
    expect(h.logs).toHaveLength(0)
  })
})

describe('le forum (moderateText) : avant OctoGuard, même éteint', () => {
  it('D21c : OctoGuard éteint, un compte tout neuf est quand même refusé pendant le bouclier', async () => {
    const { moderateText } = await import('../services/octoguard/moderate')
    await raiseShield({ actorId: 'mod-1' })
    h.ageDays.set('neuf', 0.2)
    const v = await moderateText('neuf', 'forum', ['Titre', 'Bonjour'])
    expect(v).toEqual({ blocked: true, reason: 'SHIELD_NEW_ACCOUNT', i18n_key: 'octoguard.shield.new_account' })
  })
  it('un lien dans le forum attend d’être relu (règle « shield », sans identifiant)', async () => {
    const { moderateText } = await import('../services/octoguard/moderate')
    await raiseShield({ actorId: 'mod-1' })
    const v = await moderateText('ancien', 'forum', ['Bon plan', 'https://arnaque.example'])
    expect(v.blocked).toBe(false)
    if (!v.blocked) expect(v.hold).toEqual(expect.objectContaining({ rule_id: null, rule_name: 'shield' }))
  })
  it('un profil, un sondage ou un wiki : lecture seule pour le compte neuf, pas de mise de côté des liens', async () => {
    const { moderateText } = await import('../services/octoguard/moderate')
    await raiseShield({ actorId: 'mod-1' })
    h.ageDays.set('neuf', 0.2)
    expect((await moderateText('neuf', 'profile', ['ma bio'])).blocked).toBe(true)
    expect(await moderateText('ancien', 'profile', ['mon site https://moi.example'])).toEqual({ blocked: false })
  })
  it('bouclier baissé, OctoGuard éteint : rien ne change', async () => {
    const { moderateText } = await import('../services/octoguard/moderate')
    h.ageDays.set('neuf', 0.2)
    expect(await moderateText('neuf', 'forum', ['https://x.example'])).toEqual({ blocked: false })
  })
})
