// ─── OctoGuard 2, lot 5 : « Tu es sûr ? » avant d'envoyer ────────────────────
// La pré-vérification dit ce que le moteur ferait d'un texte, SANS RIEN FAIRE :
// ni journal, ni avertissement, ni marche du barème, ni mémoire d'inondation.
// Et elle doit dire la même chose que le vrai moteur (sinon elle ment), sans
// jamais nommer la règle (D20).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { q, logSpy, ladderSpy, muteSpy, banSpy } = vi.hoisted(() => ({
  q: vi.fn(), logSpy: vi.fn(), ladderSpy: vi.fn(async () => ({})), muteSpy: vi.fn(async () => ({})), banSpy: vi.fn(async () => ({})),
}))
vi.mock('../config/database', () => ({ db: { query: q }, redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn() } }))
vi.mock('../middleware/adminOnly', () => ({ getInstanceCommunityId: vi.fn(async () => 'community-1') }))
vi.mock('../services/octoguard/logger', () => ({ logOctoGuardAction: logSpy }))
vi.mock('../services/octoguard/ladder', () => ({ engineLadderStep: ladderSpy }))
vi.mock('../services/octoguard/mutes', () => ({ applyMute: muteSpy }))
vi.mock('../services/octoguard/bans', () => ({ applyTempBan: banSpy }))

import { precheck, judge } from '../services/octoguard/precheck'
import { runPipeline } from '../services/octoguard/pipeline'
import { _setRulesForBench, clearRules } from '../services/octoguard/cache'
import type { AutomodRuleRow, AutomodAction, PipelineUserCtx } from '../services/octoguard/types'

const USER = '00000000-0000-0000-0000-0000000000u1'
let profile: { role: string; grade_id: string | null; account_age_days: number } = { role: 'member', grade_id: null, account_age_days: 200 }

let n = 0
function rule(action: AutomodAction, extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  n++
  return {
    id: `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`, name: `Règle secrète ${n}`,
    type: 'keywords', params: { words: ['nul'] },
    action, action_duration: action === 'mute' || action === 'ban_temp' ? { value: 1, unit: 'h' } : null, escalation: null,
    immunized_role_types: ['owner', 'admin', 'moderator'], immunized_grade_ids: [],
    dry_run: false, enabled: true, scopes: ['chat', 'forum'], preset_key: null, customized: false,
    created_at: '', updated_at: '',
    ...extra,
  } as AutomodRuleRow
}

/** Toutes les requêtes en base passées pendant le test, en clair. */
const sqls = () => q.mock.calls.map((c) => String(c[0]).replace(/\s+/g, ' '))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.OCTOGUARD_ENABLED = 'true'
  process.env.OCTOGUARD_NUDGE = 'true'
  delete process.env.OCTOGUARD_FORCE_OFF
  profile = { role: 'member', grade_id: null, account_age_days: 200 }
  q.mockImplementation(async (sql: string) => (/FROM users u/.test(sql) ? { rows: [profile] } : { rows: [] }))
  clearRules()
})

describe('« Tu es sûr ? » : allumé seulement quand on le demande', () => {
  it('éteint par défaut : rien, même si une règle correspond', async () => {
    delete process.env.OCTOGUARD_NUDGE
    _setRulesForBench([rule('delete')])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
  })
  it('OctoGuard éteint : rien, même avec le réglage allumé', async () => {
    process.env.OCTOGUARD_ENABLED = 'false'
    _setRulesForBench([rule('delete')])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
  })
  it('OctoGuard verrouillé par le serveur : rien', async () => {
    process.env.OCTOGUARD_FORCE_OFF = 'true'
    _setRulesForBench([rule('delete')])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
  })
})

describe('ce que le moteur ferait, dit à l’auteur', () => {
  it.each([
    ['hold', 'hold'], ['delete', 'refuse'], ['warn', 'warn'], ['mute', 'sanction'], ['ban_temp', 'sanction'],
  ] as Array<[AutomodAction, string]>)('cran %s : « %s »', async (action, outcome) => {
    _setRulesForBench([rule(action)])
    expect(await precheck(USER, 'chat', 't’es vraiment trop nul, dégage')).toEqual({ outcome, kind: 'words' })
  })
  it('cran Signaler ou Notifier : le message passe, rien à annoncer', async () => {
    _setRulesForBench([rule('report_only')])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
    _setRulesForBench([rule('notify_only')])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
  })
  it('un message propre : rien', async () => {
    _setRulesForBench([rule('delete')])
    expect(await precheck(USER, 'chat', 'bien joué pour le niveau 4 !')).toBeNull()
  })
  it('la sorte de souci : liens, capitales, mentions', async () => {
    _setRulesForBench([rule('delete', { type: 'link_domain', params: { mode: 'blacklist', domains: ['bit.ly'] } })])
    expect(await precheck(USER, 'chat', 'la suite ici : https://bit.ly/x9k')).toEqual({ outcome: 'refuse', kind: 'links' })
    _setRulesForBench([rule('warn', { type: 'caps', params: { min_length: 10, max_ratio: 0.7 } })])
    expect(await precheck(USER, 'chat', 'POURQUOI PERSONNE NE RÉPOND ???')).toEqual({ outcome: 'warn', kind: 'caps' })
  })
})

describe('AUCUN effet de bord', () => {
  it('ni journal, ni avertissement, ni barème, ni sourdine, ni bannissement, ni écriture en base', async () => {
    _setRulesForBench([
      rule('warn', { follow_ladder: true, params: { words: ['nul'] } }),
    ])
    for (const action of ['hold', 'delete', 'warn', 'mute', 'ban_temp', 'report_only'] as AutomodAction[]) {
      _setRulesForBench([rule(action, { follow_ladder: action === 'warn', escalation: { warns_threshold: 1, window_days: 7, action: 'mute', duration: { value: 1, unit: 'h' } } as never })])
      await precheck(USER, 'chat', 't’es trop nul')
      await precheck(USER, 'forum', '<p>t’es trop nul</p>', 'Titre')
    }
    await new Promise((r) => setTimeout(r, 20))   // les effets du moteur partent en tâche de fond
    expect(logSpy).not.toHaveBeenCalled()
    expect(ladderSpy).not.toHaveBeenCalled()
    expect(muteSpy).not.toHaveBeenCalled()
    expect(banSpy).not.toHaveBeenCalled()
    expect(sqls().filter((s) => !/^ ?SELECT/i.test(s.trim()))).toEqual([])
  })
  it('l’inondation : cent pré-vérifications ne comptent pas comme des messages', async () => {
    const flood = rule('delete', { type: 'flood', params: { max_repeats: 2, repeat_window_s: 60, max_messages: 50, burst_window_s: 10 } })
    _setRulesForBench([flood])
    for (let i = 0; i < 100; i++) expect(await precheck(USER, 'chat', 'même message')).toBeNull()
    // Le vrai moteur, juste après : le PREMIER vrai envoi passe (rien n'a été compté)
    const user: PipelineUserCtx = { userId: USER, role: 'member', gradeIds: [] }
    const res = await runPipeline({ content: 'même message', userCtx: user, surface: 'chat' })
    expect(res.blocked).toBe(false)
  })
})

describe('le même jugement que le vrai moteur', () => {
  it('la PREMIÈRE règle qui correspond décide, même en observation (le message passerait)', async () => {
    _setRulesForBench([rule('delete', { dry_run: true }), rule('delete')])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
    const res = await runPipeline({ content: 't’es trop nul', userCtx: { userId: USER, role: 'member', gradeIds: [] }, surface: 'chat' })
    expect(res.blocked).toBe(false)
  })
  it('l’équipe est immunisée : rien', async () => {
    profile = { ...profile, role: 'moderator' }
    _setRulesForBench([rule('delete')])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
  })
  it('« comptes récents seulement » suit l’âge réel du compte', async () => {
    _setRulesForBench([rule('hold', { conditions: { account_max_age_days: 7 } })])
    profile = { ...profile, account_age_days: 2 }
    expect(await precheck(USER, 'chat', 't’es trop nul')).toEqual({ outcome: 'hold', kind: 'words' })
    profile = { ...profile, account_age_days: 30 }
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
  })
  it('l’endroit compte : une règle du forum seulement ne dit rien au chat', async () => {
    _setRulesForBench([rule('delete', { scopes: ['forum'] })])
    expect(await precheck(USER, 'chat', 't’es trop nul')).toBeNull()
    expect(await precheck(USER, 'forum', '<p>t’es trop nul</p>', 'Bonjour')).toEqual({ outcome: 'refuse', kind: 'words' })
  })
  it('forum : le titre est jugé avec le corps, comme à la publication', async () => {
    _setRulesForBench([rule('delete', { scopes: ['forum'] })])
    expect(await precheck(USER, 'forum', '<p>bonjour</p>', 'T’es nul')).toEqual({ outcome: 'refuse', kind: 'words' })
  })
  it('forum : un lien caché derrière « ici » est vu, comme à la publication', async () => {
    _setRulesForBench([rule('delete', { type: 'link_domain', params: { mode: 'blacklist', domains: ['bit.ly'] } })])
    expect(await precheck(USER, 'forum', '<p>la suite <a href="https://bit.ly/x9k">ici</a></p>')).toEqual({ outcome: 'refuse', kind: 'links' })
  })
  it('accord avec le moteur sur une série de messages (chat)', async () => {
    const rules = [
      rule('report_only', { type: 'mention_spam', params: { max_mentions: 3 } }),
      rule('hold', { type: 'link_domain', params: { mode: 'blacklist', domains: ['bit.ly'] } }),
      rule('warn', { params: { words: ['nul', 'dégage'] } }),
      rule('delete', { type: 'caps', params: { min_length: 10, max_ratio: 0.7 } }),
    ]
    _setRulesForBench(rules)
    const user: PipelineUserCtx = { userId: USER, role: 'member', gradeIds: [], accountAgeDays: 200 }
    const samples = [
      'bonjour tout le monde', 't’es nul', 'https://bit.ly/abc à voir', 'POURQUOI PERSONNE NE RÉPOND',
      '@a @b @c @d @e salut', 'dégage', 'un message normal avec un lien https://nodyx.org',
    ]
    for (const content of samples) {
      const nudge = judge(content, rules, user, 'chat')
      const real = await runPipeline({ content, userCtx: { ...user, userId: `${USER}-${content}` }, surface: 'chat' })
      const engineSays = real.hold ? 'hold' : real.blocked ? 'blocked' : 'passes'
      const nudgeSays = !nudge ? 'passes' : nudge.outcome === 'hold' ? 'hold' : 'blocked'
      expect(`${content} → ${nudgeSays}`).toBe(`${content} → ${engineSays}`)
    }
  })
})

describe('D20 : jamais le nom de la règle', () => {
  it('la réponse ne contient ni le nom ni l’identifiant de la règle', async () => {
    const r = rule('delete', { name: 'Liste noire des insultes de Jonathan' })
    _setRulesForBench([r])
    const res = await precheck(USER, 'chat', 't’es trop nul')
    expect(res).not.toBeNull()
    const json = JSON.stringify(res)
    expect(json).not.toContain('Jonathan')
    expect(json).not.toContain(r.id)
    expect(Object.keys(res!).sort()).toEqual(['kind', 'outcome'])
  })
})

describe('jamais de panne', () => {
  it('base indisponible : pas d’annonce, pas d’erreur', async () => {
    q.mockRejectedValue(new Error('pool exhausted'))
    _setRulesForBench([rule('delete')])
    await expect(precheck(USER, 'chat', 't’es trop nul')).resolves.toBeNull()
  })
  it('texte au-delà de la limite : pas d’annonce (le vrai envoi sera jugé)', async () => {
    _setRulesForBench([rule('delete')])
    expect(await precheck(USER, 'forum', 'nul '.repeat(20_000))).toBeNull()
  })
})
