// ─── OctoGuard : « Spam de mentions » compte les VRAIES mentions ─────────────
// Avant : la règle comptait les « @mot » non accentués. `@équipe` n'était pas vu,
// et un groupe (`@tous`, une équipe de 40) pesait 1, comme une seule personne.
// Maintenant : une personne pèse 1, un groupe le nombre de personnes qu'il
// prévient, partout où le moteur juge (chat, forum, wiki, « Tu es sûr ? », rejeu).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { q, groups, teamOf, calls } = vi.hoisted(() => ({
  q: vi.fn(),
  groups: new Map<string, number>(),
  teamOf: new Set<string>(),
  calls: { membersOf: 0, isTeam: 0 },
}))
vi.mock('../config/database', () => ({ db: { query: q }, redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn() } }))
vi.mock('../middleware/adminOnly', () => ({ getInstanceCommunityId: vi.fn(async () => 'community-1') }))
vi.mock('../services/octoguard/logger', () => ({ logOctoGuardAction: vi.fn() }))
vi.mock('../services/octoguard/ladder', () => ({ engineLadderStep: vi.fn(async () => ({})) }))
vi.mock('../services/octoguard/mutes', () => ({ applyMute: vi.fn(async () => ({})) }))
vi.mock('../services/octoguard/bans', () => ({ applyTempBan: vi.fn(async () => ({})) }))
vi.mock('../services/octoguard/shield', () => ({ shieldGate: vi.fn(async () => ({ allow: true, holdLinks: false })), hasLink: () => false, shieldHoldRule: vi.fn() }))
vi.mock('../services/mentionPeople', () => ({ instanceCommunityId: vi.fn(async () => 'community-1') }))
vi.mock('../services/mentionGroups', async (orig) => ({
  ...(await orig<typeof import('../services/mentionGroups')>()),
  membersOf: vi.fn(async (_c: string, key: string) => { calls.membersOf++; return Array.from({ length: groups.get(key) ?? 0 }, (_, i) => `u${i}`) }),
  isTeam: vi.fn(async (_c: string, userId: string) => { calls.isTeam++; return teamOf.has(userId) }),
}))

import { matchMentionSpam } from '../services/octoguard/matchers'
import { tallyMentions, countMentionsText } from '../services/octoguard/mentionTally'
import { mentionWeight } from '../services/octoguard/mentionWeight'
import { runPipeline, _resetMentionCacheForTests } from '../services/octoguard/pipeline'
import { moderateText, textForModeration } from '../services/octoguard/moderate'
import { precheck } from '../services/octoguard/precheck'
import { _setRulesForBench, clearRules } from '../services/octoguard/cache'
import { replayRule } from '../services/octoguard/replay'
import type { AutomodRuleRow } from '../services/octoguard/types'

const AUTHOR = '00000000-0000-4000-8000-0000000000a1'
const LEA = '11111111-1111-4111-8111-111111111111'
const GRADE = '22222222-2222-4222-8222-222222222222'
const person = (id: string, name: string) => `<span class="nx-mention" data-mention="u:${id}">@${name}</span>`
const group = (key: string, label: string) => `<span class="nx-mention nx-mention-group" data-mention="g:${key}">@${label}</span>`

function rule(extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  return {
    id: '00000000-0000-4000-8000-000000000001', name: 'Mentions', type: 'mention_spam', params: { max_mentions: 5 },
    action: 'delete', action_duration: null, escalation: null, immunized_role_types: ['owner', 'admin'], immunized_grade_ids: [],
    dry_run: false, enabled: true, scopes: ['chat', 'forum', 'wiki'], preset_key: null, customized: false, created_at: '', updated_at: '',
    ...extra,
  } as AutomodRuleRow
}

beforeEach(() => {
  vi.clearAllMocks()
  groups.clear(); teamOf.clear(); calls.membersOf = 0; calls.isTeam = 0
  process.env.OCTOGUARD_ENABLED = 'true'
  process.env.OCTOGUARD_NUDGE = 'true'
  delete process.env.OCTOGUARD_FORCE_OFF
  q.mockImplementation(async (sql: string) => (/FROM users u/.test(sql) ? { rows: [{ role: 'member', grade_id: null, account_age_days: 200 }] } : { rows: [] }))
  clearRules()
  _resetMentionCacheForTests()
})

describe('le comptage, sans base', () => {
  it('lit les lettres accentuées : @équipe, @Zoé, @Inès comptent', () => {
    // L'ancien détecteur ([a-zA-Z0-9_-]) ne voyait AUCUNE de ces six mentions en entier
    const text = '@équipe @Zoé @Inès @Noé @Léa @Chloé venez voir'
    expect(countMentionsText(text)).toBe(6)
    expect(matchMentionSpam({ content: text }, { max_mentions: 5 })?.excerpt).toBe('mentions=6 @équipe @Zoé @Inès')
  })
  it('une marque compte une fois : son texte n’est pas relu comme un « @mot »', () => {
    const t = tallyMentions(`<p>${person(LEA, 'Léa')} et ${group('equipe', 'équipe')} et @max</p>`)
    expect(t).toEqual({ people: 1, words: 1, groups: ['equipe'], sample: ['@Léa', '@équipe', '@max'] })
  })
  it('répéter un nom en rafale reste du spam : chaque reprise compte', () => {
    const rafale = Array.from({ length: 6 }, () => person(LEA, 'Léa')).join(' ')
    expect(matchMentionSpam({ content: rafale }, { max_mentions: 5 })).not.toBeNull()
  })
  it('un message normal passe toujours', () => {
    expect(matchMentionSpam({ content: `<p>Salut ${person(LEA, 'Léa')}, tu viens ce soir ?</p>` }, { max_mentions: 5 })).toBeNull()
  })
  it('le poids fourni par le moteur l’emporte sur le comptage du texte', () => {
    expect(matchMentionSpam({ content: '@tous', mentionCount: 40 }, { max_mentions: 5 })?.excerpt).toBe('mentions=40 @tous')
    expect(matchMentionSpam({ content: '@a @b @c @d @e @f @g', mentionCount: 2 }, { max_mentions: 5 })).toBeNull()
  })
  it('un texte hostile ne bloque pas le cœur (500 Ko de balises jamais fermées)', () => {
    const hostile = '<span data-mention="u:'.repeat(25_000) + '@a'.repeat(1000)
    const t0 = performance.now()
    countMentionsText(hostile)
    expect(performance.now() - t0).toBeLessThan(500)
  })
})

describe('le poids réel : un groupe vaut les personnes qu’il prévient', () => {
  it('@équipe à 12 personnes pèse 12', async () => {
    groups.set('equipe', 12)
    expect(await mentionWeight(`<p>${group('equipe', 'équipe')} au secours</p>`, 'community-1', AUTHOR)).toBe(12)
  })
  it('un grade vide, ou personne en ligne, pèse quand même 1', async () => {
    expect(await mentionWeight(group(`grade:${GRADE}`, 'Artistes') + group('ici', 'enligne'), 'community-1', AUTHOR)).toBe(2)
  })
  it('@tous écrit par un membre hors équipe ne prévient personne : il pèse 1', async () => {
    groups.set('tous', 300)
    expect(await mentionWeight(group('tous', 'tous'), 'community-1', AUTHOR)).toBe(1)
    teamOf.add(AUTHOR)
    expect(await mentionWeight(group('tous', 'tous'), 'community-1', AUTHOR)).toBe(300)
  })
  it('plafonné comme l’envoi (500), et une reprise du même groupe pèse 1', async () => {
    groups.set('tous', 501); teamOf.add(AUTHOR)
    expect(await mentionWeight(group('tous', 'tous') + group('tous', 'tous'), 'community-1', AUTHOR)).toBe(501)
  })
  it('personnes + mots + groupes s’additionnent', async () => {
    groups.set('moderation', 3)
    expect(await mentionWeight(`${person(LEA, 'Léa')} @max ${group('moderation', 'modération')}`, 'community-1', AUTHOR)).toBe(5)
  })
  it('une panne de lecture ne fait pas lever : le groupe pèse 1', async () => {
    const { membersOf } = await import('../services/mentionGroups')
    vi.mocked(membersOf).mockRejectedValueOnce(new Error('pg down'))
    expect(await mentionWeight(group('equipe', 'équipe'), 'community-1', AUTHOR)).toBe(1)
  })
  it('le cache du rejeu lit chaque groupe une seule fois', async () => {
    groups.set('equipe', 8)
    const cache = new Map<string, number>()
    for (let i = 0; i < 50; i++) await mentionWeight(group('equipe', 'équipe'), 'community-1', AUTHOR, cache)
    expect(calls.membersOf).toBe(1)
  })
})

describe('partout où le moteur juge', () => {
  it('chat : un seul @équipe (12 personnes) dépasse une limite de 5', async () => {
    groups.set('equipe', 12)
    _setRulesForBench([rule()])
    const res = await runPipeline({ content: `<p>${group('equipe', 'équipe')} regardez</p>`, userCtx: { userId: AUTHOR, role: 'member', gradeIds: [], accountAgeDays: 200 }, surface: 'chat' })
    expect(res.blocked).toBe(true)
  })
  it('chat : une conversation ne relit pas la base à chaque message (30 s)', async () => {
    groups.set('equipe', 12)
    _setRulesForBench([rule()])
    for (let i = 0; i < 10; i++) {
      await runPipeline({ content: `<p>${group('equipe', 'équipe')} ${i}</p>`, userCtx: { userId: AUTHOR, role: 'member', gradeIds: [], accountAgeDays: 200 }, surface: 'chat' })
    }
    expect(calls.membersOf).toBe(1)
  })
  it('chat : sans règle de mentions, aucune lecture des groupes', async () => {
    groups.set('equipe', 12)
    _setRulesForBench([rule({ type: 'keywords', params: { words: ['zut'] } })])
    await runPipeline({ content: group('equipe', 'équipe'), userCtx: { userId: AUTHOR, role: 'member', gradeIds: [], accountAgeDays: 200 }, surface: 'chat' })
    expect(calls.membersOf).toBe(0)
  })
  it('forum : le moteur reçoit le HTML, les marques perdues par l’extraction comptent', async () => {
    groups.set('equipe', 12)
    _setRulesForBench([rule()])
    const html = `<p>${group('equipe', 'équipe')} regardez ce fil</p>`
    // Sans le HTML (l'ancien appel) : l'extraction ne garde que « @équipe », qui pèse 1
    expect((await moderateText(AUTHOR, 'forum', [textForModeration(html)])).blocked).toBe(false)
    expect((await moderateText(AUTHOR, 'forum', [textForModeration(html)], { mentionTexts: [html] })).blocked).toBe(true)
  })
  it('forum : les mentions du titre comptent avec celles du corps', async () => {
    _setRulesForBench([rule()])
    const html = `<p>${person(LEA, 'Léa')} ${person(LEA, 'Léa')}</p>`
    const title = '@max @rémi @zoé @noé'
    expect((await moderateText(AUTHOR, 'forum', [title, textForModeration(html)], { mentionTexts: [title, html] })).blocked).toBe(true)
  })
  it('« Tu es sûr ? » prévient comme le vrai envoi', async () => {
    groups.set('equipe', 12)
    _setRulesForBench([rule()])
    expect(await precheck(AUTHOR, 'chat', `<p>${group('equipe', 'équipe')} regardez</p>`)).toEqual({ outcome: 'refuse', kind: 'mentions' })
    expect(await precheck(AUTHOR, 'forum', `<p>${group('equipe', 'équipe')} regardez</p>`, 'Un titre')).toEqual({ outcome: 'refuse', kind: 'mentions' })
    expect(await precheck(AUTHOR, 'chat', `<p>${person(LEA, 'Léa')} tu viens ?</p>`)).toBeNull()
  })
  it('rejeu sur 30 jours : un message du forum avec @équipe (12) est retrouvé', async () => {
    groups.set('equipe', 12)
    const posts = [
      { id: '00000000-0000-4000-8000-000000000101', author_id: AUTHOR, role: 'member', grade_id: null, author: 'max', author_created: '2025-01-01T00:00:00Z', place: 'Aide',
        content: `<p>${group('equipe', 'équipe')} quelqu'un ?</p>`, at: '2026-11-10T10:00:00Z' },
      { id: '00000000-0000-4000-8000-000000000102', author_id: AUTHOR, role: 'member', grade_id: null, author: 'max', author_created: '2025-01-01T00:00:00Z', place: 'Aide',
        content: `<p>${person(LEA, 'Léa')} merci</p>`, at: '2026-11-10T10:01:00Z' },
    ]
    q.mockImplementation(async (sql: string) => (/FROM posts p/.test(sql) ? { rows: posts } : { rows: [] }))
    const res = await replayRule(rule({ scopes: ['forum'] }))
    expect(res.scanned).toBe(2)
    expect(res.matched).toBe(1)
    expect(res.examples[0].excerpt).toBe('mentions=12 @équipe')
  })
})
