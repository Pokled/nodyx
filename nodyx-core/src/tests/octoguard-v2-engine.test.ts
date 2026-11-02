import { describe, it, expect, vi, beforeEach } from 'vitest'

// OctoGuard 2, le moteur (CDC SPECS/NODYX_OCTOGUARD_V2_CDC.md, E4a) :
// endroits surveillés, cran « signaler » vers la file (D13), escalade réelle,
// bannissement temporaire réel, point d'entrée unique, filtre haineux journalisé (D11).

const { dbQueryMock, applyMuteMock, calls } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  applyMuteMock: vi.fn().mockResolvedValue({ id: 'm1' }),
  calls: [] as Array<{ sql: string; params: unknown[] }>,
}))

vi.mock('../config/database', () => ({
  db: { query: dbQueryMock },
  redis: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), incr: vi.fn().mockResolvedValue(1), keyPrefix: 'nodyx:' },
}))
vi.mock('../services/octoguard/webhook', () => ({ triggerWebhook: vi.fn(), buildWebhookPayload: vi.fn(() => ({})) }))
vi.mock('../services/octoguard/mutes', () => ({ applyMute: applyMuteMock, isUserMuted: vi.fn().mockResolvedValue({ muted: false }) }))

import { runPipeline } from '../services/octoguard/pipeline'
import { _setRulesForBench, clearRules } from '../services/octoguard/cache'
import { applyTempBan, purgeExpiredBans, expiryFrom } from '../services/octoguard/bans'
import { moderateText } from '../services/octoguard/moderate'
import { checkContent } from '../services/contentFilter'
import type { AutomodRuleRow } from '../services/octoguard/types'

const USER = '00000000-0000-4000-8000-0000000000aa'

function rule(extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  return {
    id: '00000000-0000-4000-8000-00000000rule', name: 'Liens', type: 'link_spam',
    params: { max_links: 1 }, action: 'delete', action_duration: null, escalation: null,
    immunized_role_types: [], immunized_grade_ids: [], dry_run: false, enabled: true,
    scopes: ['chat'], preset_key: null, customized: false, created_at: '', updated_at: '',
    ...extra,
  } as AutomodRuleRow
}
const SPAM = 'voir https://a.example et https://b.example'
const ctx = { userId: USER, role: 'member', gradeIds: [] as string[] }
const flush = () => new Promise(r => setTimeout(r, 30))

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  process.env.OCTOGUARD_ENABLED = 'true'
  clearRules()
  dbQueryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }] }
    if (s.includes('SELECT COUNT(*)::int AS cnt')) return { rows: [{ cnt: 3 }] }
    if (s.startsWith('INSERT INTO community_bans')) return { rows: [{ user_id: USER }] }
    if (s.startsWith('DELETE FROM community_bans')) return { rows: [{ user_id: USER, community_id: 'c1' }] }
    if (s.includes('LEFT JOIN community_members cm')) return { rows: [{ role: 'member', grade_id: null, account_age_days: 400 }] }
    return { rows: [] }
  })
})

describe('les endroits surveillés', () => {
  it('une règle du chat ne s’applique pas au forum', async () => {
    _setRulesForBench([rule({ scopes: ['chat'] })])
    expect((await runPipeline({ content: SPAM, userCtx: ctx, surface: 'forum' })).blocked).toBe(false)
    expect((await runPipeline({ content: SPAM, userCtx: ctx, surface: 'chat' })).blocked).toBe(true)
  })
  it('une règle « partout » s’applique au forum, aux profils, au wiki', async () => {
    _setRulesForBench([rule({ scopes: ['chat', 'forum', 'profile', 'poll', 'wiki'] })])
    for (const surface of ['forum', 'profile', 'wiki'] as const) {
      expect((await runPipeline({ content: SPAM, userCtx: ctx, surface })).blocked).toBe(true)
    }
  })
  it('une règle d’avant OctoGuard 2 (sans scopes) reste au chat', async () => {
    _setRulesForBench([rule({ scopes: undefined as never })])
    expect((await runPipeline({ content: SPAM, userCtx: ctx, surface: 'forum' })).blocked).toBe(false)
    expect((await runPipeline({ content: SPAM, userCtx: ctx })).blocked).toBe(true)
  })
})

describe('les crans', () => {
  it('« signaler » laisse passer et transmet le dossier à ouvrir (D13)', async () => {
    _setRulesForBench([rule({ action: 'report_only' })])
    const res = await runPipeline({ content: SPAM, userCtx: ctx })
    expect(res.blocked).toBe(false)
    expect(res.report).toMatchObject({ rule_name: 'Liens' })
  })
  it('« observer » ne bloque rien et n’ouvre aucun dossier', async () => {
    _setRulesForBench([rule({ action: 'delete', dry_run: true })])
    const res = await runPipeline({ content: SPAM, userCtx: ctx })
    expect(res).toMatchObject({ blocked: false })
    expect(res.report).toBeUndefined()
    await flush()
    expect(calls.some(c => c.params.includes('octoguard.would_delete'))).toBe(true)
  })
})

describe('l’escalade et le bannissement temporaire, pour de vrai', () => {
  it('3 avertissements donnent une sourdine (avant : un « TODO » au journal)', async () => {
    _setRulesForBench([rule({ action: 'warn', escalation: { warns_threshold: 3, window_days: 7, action: 'mute', duration: { value: 2, unit: 'h' } } })])
    expect((await runPipeline({ content: SPAM, userCtx: ctx })).blocked).toBe(true)
    await flush()
    expect(applyMuteMock).toHaveBeenCalledWith(expect.objectContaining({ userId: USER, channelId: null, duration: { value: 2, unit: 'h' } }))
  })
  it('ou un bannissement temporaire', async () => {
    _setRulesForBench([rule({ action: 'warn', escalation: { warns_threshold: 3, window_days: 7, action: 'ban_temp', duration: { value: 1, unit: 'd' } } })])
    await runPipeline({ content: SPAM, userCtx: ctx })
    await flush()
    expect(calls.some(c => c.sql.startsWith('INSERT INTO community_bans'))).toBe(true)
  })
  it('l’action ban_temp bannit vraiment (avant : bloquait le message et c’est tout)', async () => {
    _setRulesForBench([rule({ action: 'ban_temp', action_duration: { value: 3, unit: 'h' } })])
    expect((await runPipeline({ content: SPAM, userCtx: ctx })).blocked).toBe(true)
    await flush()
    const ins = calls.find(c => c.sql.startsWith('INSERT INTO community_bans'))!
    expect(ins.params[1]).toBe(USER)
    expect(calls.some(c => c.sql.startsWith('DELETE FROM community_members'))).toBe(true)
  })
  it('un bannissement définitif n’est jamais raccourci par un temporaire', async () => {
    await applyTempBan({ userId: USER, duration: { value: 1, unit: 'h' }, reason: 'x' })
    expect(calls.find(c => c.sql.startsWith('INSERT INTO community_bans'))!.sql).toContain('WHERE community_bans.expires_at IS NOT NULL')
  })
  it('la durée par défaut d’un bannissement temporaire est de 24 h', () => {
    expect(expiryFrom(null, 0).getTime()).toBe(24 * 3_600_000)
    expect(expiryFrom({ value: 2, unit: 'd' }, 0).getTime()).toBe(2 * 86_400_000)
  })
  it('les bannissements échus sont levés et journalisés', async () => {
    expect(await purgeExpiredBans()).toBe(1)
    await flush()
    expect(calls.some(c => c.params.includes('octoguard.ban_expired'))).toBe(true)
  })
})

describe('le point d’entrée unique (forum, profils, sondages, wiki)', () => {
  it('OctoGuard éteint : rien ne se passe', async () => {
    process.env.OCTOGUARD_ENABLED = 'false'
    _setRulesForBench([rule({ scopes: ['forum'] })])
    expect(await moderateText(USER, 'forum', [SPAM])).toEqual({ blocked: false })
  })
  it('refuse avec une clé de traduction', async () => {
    _setRulesForBench([rule({ scopes: ['forum'] })])
    expect(await moderateText(USER, 'forum', ['titre', SPAM])).toMatchObject({ blocked: true, i18n_key: 'octoguard.message.deleted' })
  })
  it('le cran « signaler » remonte jusqu’à l’appelant', async () => {
    _setRulesForBench([rule({ scopes: ['profile'], action: 'report_only' })])
    expect(await moderateText(USER, 'profile', [SPAM])).toMatchObject({ blocked: false, report: { rule_name: 'Liens' } })
  })
  it('les immunités par rôle valent partout', async () => {
    dbQueryMock.mockImplementation(async (sql: string) => String(sql).includes('LEFT JOIN community_members cm') ? { rows: [{ role: 'moderator', grade_id: null, account_age_days: 400 }] } : String(sql).includes('FROM communities') ? { rows: [{ id: 'c1' }] } : { rows: [] })
    _setRulesForBench([rule({ scopes: ['forum'], immunized_role_types: ['moderator'] })])
    expect((await moderateText(USER, 'forum', [SPAM])).blocked).toBe(false)
  })
})

describe('le filtre des symboles haineux (D11)', () => {
  it('reste actif OctoGuard éteint, et passe au journal', async () => {
    process.env.OCTOGUARD_ENABLED = 'false'
    const r = checkContent('salut 卐')
    expect(r).toMatchObject({ ok: false, rule: 'hate_symbol' })
    await flush()
    expect(calls.some(c => c.params.includes('octoguard.hate_symbol_blocked'))).toBe(true)
  })
})

describe('le minuteur de 50 ms', () => {
  it('ne crie plus « timeout » quand le moteur a répondu à temps', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    _setRulesForBench([rule()])
    await runPipeline({ content: 'rien à signaler', userCtx: ctx })
    await new Promise(r => setTimeout(r, 80))
    expect(warn.mock.calls.some(c => String(c[0]).includes('pipeline timeout'))).toBe(false)
    warn.mockRestore()
  })
})
