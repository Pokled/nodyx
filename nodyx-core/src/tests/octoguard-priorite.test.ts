import { describe, it, expect, vi, beforeEach } from 'vitest'

// OctoGuard, priorité des règles (CDC §E5, D-E5a et D-E5b validées le 20/11/2026).
// Trouvé en testant la prod : le moteur s'arrêtait à la PREMIÈRE règle qui correspondait
// (ordre de création), même en essai ou « signaler ». « Mots interdits » (Retenir), 8e et
// dernière sur nodyx.org, ne s'appliquait jamais à un gros mot en majuscules.

const { dbQueryMock, applyMuteMock, journal } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  applyMuteMock: vi.fn().mockResolvedValue({ id: 'm1' }),
  journal: [] as Array<{ action: string; metadata: Record<string, unknown> }>,
}))
vi.mock('../config/database', () => ({
  db: { query: dbQueryMock },
  redis: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), incr: vi.fn().mockResolvedValue(1), keyPrefix: 'nodyx:' },
}))
vi.mock('../services/octoguard/webhook', () => ({ triggerWebhook: vi.fn(), buildWebhookPayload: vi.fn(() => ({})) }))
vi.mock('../services/octoguard/mutes', () => ({ applyMute: applyMuteMock, isUserMuted: vi.fn().mockResolvedValue({ muted: false }) }))
vi.mock('../services/octoguard/logger', () => ({
  logOctoGuardAction: vi.fn((e: { action: string; metadata: Record<string, unknown> }) => { journal.push({ action: e.action, metadata: e.metadata }) }),
}))

import { runPipeline } from '../services/octoguard/pipeline'
import { _setRulesForBench, clearRules } from '../services/octoguard/cache'
import type { AutomodRuleRow, AutomodAction } from '../services/octoguard/types'

const USER = '00000000-0000-4000-8000-0000000000aa'
let n = 0
function rule(name: string, type: string, params: Record<string, unknown>, action: AutomodAction, extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  n++
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name, type, params, action, action_duration: action === 'mute' || action === 'ban_temp' ? '1h' : null,
    escalation: null, immunized_role_types: [], immunized_grade_ids: [], dry_run: false, enabled: true,
    scopes: ['chat'], preset_key: null, customized: false, created_at: '', updated_at: '', ...extra,
  } as AutomodRuleRow
}
const caps   = (action: AutomodAction = 'report_only', extra = {}) => rule('Majuscules', 'caps', { min_length: 10, threshold_percent: 70 }, action, extra)
const words  = (action: AutomodAction = 'hold', extra = {}) => rule('Mots interdits', 'keywords', { words: ['abruti'] }, action, extra)
const links  = (action: AutomodAction = 'hold', extra = {}) => rule('Liens des comptes neufs', 'link_spam', { max_links: 0 }, action, extra)
const invite = (action: AutomodAction = 'report_only', extra = {}) => rule('Invitations', 'link_domain', { mode: 'blacklist', domains: ['discord.gg'] }, action, extra)
const run = (content: string) => runPipeline({ content, userCtx: { userId: USER, role: 'member', gradeIds: [] }, surface: 'chat' })

beforeEach(() => {
  vi.clearAllMocks(); journal.length = 0; n = 0
  process.env.OCTOGUARD_ENABLED = 'true'
  clearRules()
  dbQueryMock.mockImplementation(async (sql: string) => {
    const s = String(sql)
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }] }
    if (s.includes('SELECT COUNT(*)::int AS cnt')) return { rows: [{ cnt: 1 }] }
    if (s.includes('LEFT JOIN community_members cm')) return { rows: [{ role: 'member', grade_id: null, account_age_days: 400 }] }
    return { rows: [] }
  })
})

describe('la règle la plus sévère l’emporte (D-E5a)', () => {
  it('« Majuscules » (signaler) créée AVANT « Mots interdits » (retenir) : le gros mot est retenu', async () => {
    _setRulesForBench([caps(), words()])
    const r = await run('FRANCHEMENT TU ES UN ABRUTI')
    expect(r.hold?.rule_name).toBe('Mots interdits')
    expect(r.report).toBeUndefined()
  })
  it('l’ordre de création ne change rien au résultat', async () => {
    _setRulesForBench([words(), caps()])
    expect((await run('FRANCHEMENT TU ES UN ABRUTI')).hold?.rule_name).toBe('Mots interdits')
  })
  it('sourdine > avertissement > suppression > retenue > signaler', async () => {
    _setRulesForBench([caps('report_only'), words('hold'), links('delete'), invite('warn')])
    const r = await run('REJOINS DISCORD.GG/ABRUTI MAINTENANT')
    expect(r.blocked).toBe(true)
    expect(journal.some(e => e.action === 'octoguard.warn_user')).toBe(true)
    expect(journal.some(e => e.action === 'octoguard.delete_message' || e.action === 'octoguard.message_held')).toBe(false)
  })
  it('la sourdine passe devant l’avertissement', async () => {
    _setRulesForBench([invite('warn'), words('mute')])
    await run('rejoins discord.gg/abruti')
    await new Promise(r => setTimeout(r, 30))
    expect(applyMuteMock).toHaveBeenCalledTimes(1)
    expect(journal.some(e => e.action === 'octoguard.warn_user')).toBe(false)
  })
})

describe('une règle en essai ne s’arrête jamais', () => {
  it('« Invitations » en essai ne masque plus « Liens des comptes neufs » (retenir)', async () => {
    _setRulesForBench([invite('report_only', { dry_run: true }), links('hold')])
    const r = await run('Rejoins mon serveur discord.gg/abcdef')
    expect(r.hold?.rule_name).toBe('Liens des comptes neufs')
    expect(journal.some(e => e.action === 'octoguard.would_report_only' && e.metadata.rule_name === 'Invitations')).toBe(true)
  })
  it('que des essais : rien ne se passe, chaque essai est noté', async () => {
    _setRulesForBench([caps('report_only', { dry_run: true }), words('hold', { dry_run: true })])
    const r = await run('FRANCHEMENT TU ES UN ABRUTI')
    expect(r.blocked).toBe(false); expect(r.hold).toBeUndefined(); expect(r.report).toBeUndefined()
    expect(journal.map(e => e.action).sort()).toEqual(['octoguard.would_hold', 'octoguard.would_report_only'])
  })
})

describe('une seule sanction par message (D-E5b)', () => {
  it('deux règles « signaler » : un seul dossier, l’autre notée dans also_matched', async () => {
    _setRulesForBench([caps('report_only'), invite('report_only')])
    const r = await run('REJOINS DISCORD.GG/ABCDEF MAINTENANT')
    expect(r.report?.rule_name).toBe('Majuscules')
    const filed = journal.filter(e => e.action === 'octoguard.report_filed')
    expect(filed).toHaveLength(1)
    expect(filed[0].metadata.also_matched).toEqual(['Invitations'])
  })
  it('la retenue retenue note la règle « signaler » qui correspondait aussi', async () => {
    _setRulesForBench([caps('report_only'), words('hold')])
    // le journal de la retenue est écrit par holdContent (held.ts) : le moteur lui transmet also_matched
    const r = await run('FRANCHEMENT TU ES UN ABRUTI')
    expect(r.hold?.also_matched).toEqual(['Majuscules'])
    expect(journal.some(e => e.action === 'octoguard.report_filed')).toBe(false)
  })
  it('une seule règle : pas de also_matched', async () => {
    _setRulesForBench([words('hold')])
    const r = await run('tu es un abruti')
    expect(r.hold?.rule_name).toBe('Mots interdits')
    expect(r.hold && 'also_matched' in r.hold).toBe(false)
  })
  it('aucune règle ne correspond : rien', async () => {
    _setRulesForBench([caps(), words()])
    expect(await run('bonjour tout le monde')).toEqual({ blocked: false })
    expect(journal).toHaveLength(0)
  })
})
