import { describe, it, expect, vi, beforeEach } from 'vitest'

// OctoGuard 2, livraison 2 (CDC SPECS/NODYX_OCTOGUARD_V2_CDC.md, E4b) :
// mots interdits, inondation, texte corrompu, comptes récents, profil de base
// (semis unique, D12, mise à jour), export/aperçu/import, bac à sable.

const { dbQueryMock, calls, state } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  state: { seed: null as string | null, users: 2, rules: [] as any[] },
}))

vi.mock('../config/database', () => ({
  db: { query: dbQueryMock },
  redis: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), incr: vi.fn().mockResolvedValue(1), keyPrefix: 'nodyx:' },
}))
vi.mock('../services/octoguard/webhook', () => ({ triggerWebhook: vi.fn(), buildWebhookPayload: vi.fn(() => ({})) }))

import { matchKeywords, matchFlood, matchZalgo, recordActivity, _resetActivity, tokensOf } from '../services/octoguard/matchers2'
import { conditionsMet } from '../services/octoguard/pipeline'
import { ensureBaseProfile, startingLevel, BASE_PRESETS, previewImport, ProfileZ } from '../services/octoguard/profile'
import { runSandbox } from '../services/octoguard/sandbox'
import type { AutomodRuleRow } from '../services/octoguard/types'

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  _resetActivity()
  state.seed = null; state.users = 2; state.rules = []
  dbQueryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.startsWith('SELECT value FROM instance_settings')) return { rows: state.seed ? [{ value: state.seed }] : [] }
    if (s.includes('COUNT(*)::int AS n FROM users')) return { rows: [{ n: state.users }] }
    if (s.startsWith('INSERT INTO octoguard_automod_rules')) return { rowCount: 1, rows: [] }
    if (s.startsWith('UPDATE octoguard_automod_rules')) return { rowCount: 1, rows: [] }
    if (s.startsWith('SELECT name, type, params, action, scopes') || s.startsWith('SELECT id, name, type, params')) return { rows: state.rules }
    return { rows: [], rowCount: 0 }
  })
})

const kw = (content: string, words: string[], exceptions: string[] = []) => matchKeywords({ content }, { words, exceptions })

describe('mots interdits : attraper les contournements', () => {
  it('le mot tel quel, sans casse ni accents', () => {
    expect(kw('Espèce de CONNARD', ['connard'])).not.toBeNull()
    expect(kw('quel crétin', ['cretin'])).not.toBeNull()
  })
  it('les chiffres à la place des lettres', () => {
    expect(kw('c0nn4rd va', ['connard'])).not.toBeNull()
  })
  it('les lettres séparées par des points ou des espaces', () => {
    expect(kw('t’es un c.o.n.n.a.r.d', ['connard'])).not.toBeNull()
    expect(kw('c o n n a r d', ['connard'])).not.toBeNull()
  })
  it('« *mot* » prend le mot n’importe où ; « mot* » au début', () => {
    expect(kw('superconnardise', ['*connard*'])).not.toBeNull()
    expect(kw('connardise', ['connard*'])).not.toBeNull()
  })
  it('ne prend PAS un mot innocent qui en contient un autre', () => {
    expect(kw('un bon gâteau au chocolat', ['con'])).toBeNull()          // « con » mot entier
    expect(kw('le bacon nardé', ['connard'])).toBeNull()                 // jamais de recollage entre deux vrais mots
  })
  it('les exceptions protègent un mot légitime', () => {
    expect(kw('j’habite à Concarneau', ['*con*'], ['concarneau'])).toBeNull()
  })
  it('une liste vide ne prend rien', () => {
    expect(kw('n’importe quoi', [])).toBeNull()
  })
  it('les mots épelés sont recollés en un seul', () => {
    expect(tokensOf('a b c')).toContain('abc')
  })
})

describe('inondation', () => {
  it('le même message 4 fois en une minute', () => {
    for (let i = 0; i < 4; i++) recordActivity('u1', 'achetez maintenant', 1000 + i)
    expect(matchFlood({ content: 'achetez maintenant', userId: 'u1', now: 2000 }, { max_repeats: 4, repeat_window_s: 60 })).not.toBeNull()
  })
  it('3 fois ne suffit pas', () => {
    for (let i = 0; i < 3; i++) recordActivity('u2', 'salut', 1000 + i)
    expect(matchFlood({ content: 'salut', userId: 'u2', now: 2000 }, { max_repeats: 4 })).toBeNull()
  })
  it('une rafale de 9 messages en 10 s', () => {
    for (let i = 0; i < 9; i++) recordActivity('u3', `msg ${i}`, 1000 + i * 100)
    expect(matchFlood({ content: 'msg 8', userId: 'u3', now: 2000 }, { max_messages: 8, burst_window_s: 10 })).not.toBeNull()
  })
  it('hors de la fenêtre, les anciens messages ne comptent plus', () => {
    for (let i = 0; i < 4; i++) recordActivity('u4', 'pareil', 1000)
    expect(matchFlood({ content: 'pareil', userId: 'u4', now: 1000 + 61_000 }, { max_repeats: 4, repeat_window_s: 60 })).toBeNull()
  })
})

describe('texte corrompu', () => {
  it('prend les caractères empilés', () => {
    expect(matchZalgo({ content: 'h́̂̃̄̅ello' }, {})).not.toBeNull()
  })
  it('laisse passer les accents normaux', () => {
    expect(matchZalgo({ content: 'Élève, ça a été très réussi' }, {})).toBeNull()
  })
})

describe('comptes récents', () => {
  const rule = { conditions: { account_max_age_days: 2 } } as AutomodRuleRow
  it('vise un compte de 1 jour, pas un compte de 3 jours', () => {
    expect(conditionsMet(rule, { userId: 'x', role: 'member', gradeIds: [], accountAgeDays: 1 })).toBe(true)
    expect(conditionsMet(rule, { userId: 'x', role: 'member', gradeIds: [], accountAgeDays: 3 })).toBe(false)
  })
  it('un âge inconnu ne déclenche jamais la règle', () => {
    expect(conditionsMet(rule, { userId: 'x', role: 'member', gradeIds: [] })).toBe(false)
  })
})

describe('le profil de base', () => {
  it('8 modèles, chacun avec un nom en français et en anglais', () => {
    expect(BASE_PRESETS).toHaveLength(8)
    for (const p of BASE_PRESETS) expect(p.name.fr && p.name.en).toBeTruthy()
  })
  it('D12 : sur une instance existante, « avertir » démarre en observation', () => {
    const mention = BASE_PRESETS.find(p => p.key === 'base.mention_spam')!
    expect(startingLevel(mention, true)).toEqual({ action: 'warn', dry_run: true })
    expect(startingLevel(mention, false)).toEqual({ action: 'warn', dry_run: false })
  })
  it('jamais plus que « signaler » d’emblée sur une instance existante', () => {
    for (const p of BASE_PRESETS) {
      const lvl = startingLevel(p, true)
      const strong = !['report_only', 'notify_only'].includes(lvl.action)
      expect(strong ? lvl.dry_run : true).toBe(true)
    }
  })
  it('semé UNE fois : instance existante (plus de 5 comptes), 8 règles', async () => {
    state.users = 100
    expect(await ensureBaseProfile()).toEqual({ seeded: 8, updated: 0 })
    const inserts = calls.filter(c => c.sql.startsWith('INSERT INTO octoguard_automod_rules'))
    expect(inserts).toHaveLength(8)
    expect(calls.some(c => c.sql.startsWith('INSERT INTO instance_settings'))).toBe(true)
  })
  it('déjà semé : rien n’est réinséré (une règle supprimée ne revient pas)', async () => {
    state.seed = '1'
    expect(await ensureBaseProfile()).toEqual({ seeded: 0, updated: 0 })
    expect(calls.some(c => c.sql.startsWith('INSERT INTO octoguard_automod_rules'))).toBe(false)
  })
  it('mise à jour du profil : seulement les règles non personnalisées', async () => {
    state.seed = '0'
    await ensureBaseProfile()
    const up = calls.filter(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))
    expect(up.length).toBe(8)
    expect(up[0].sql).toContain('customized = false')
    expect(up[0].sql).not.toMatch(/SET[^W]*\baction\b/) // le cran reste à l’admin
  })
})

describe('export, aperçu, import', () => {
  const profile = (rules: any[]) => ProfileZ.parse({ format: 'nodyx-octoguard-profile', version: 1, name: 'Test', rules })
  it('l’aperçu dit ce qui sera ajouté, modifié, inchangé', async () => {
    state.rules = [
      { name: 'Liens', type: 'link_spam', params: { max_links: 3 }, action: 'report_only', scopes: ['chat'], conditions: {}, escalation: null, dry_run: false, enabled: true, preset_key: 'base.link_spam' },
      { name: 'Caps', type: 'caps', params: {}, action: 'report_only', scopes: ['chat'], conditions: {}, escalation: null, dry_run: false, enabled: true, preset_key: null },
    ]
    const p = await previewImport(profile([
      { name: 'Liens', type: 'link_spam', params: { max_links: 5 }, action: 'report_only', scopes: ['chat'], preset_key: 'base.link_spam' },
      { name: 'Caps', type: 'caps', params: {}, action: 'report_only', scopes: ['chat'], conditions: {}, dry_run: false, enabled: true },
      { name: 'Nouveau', type: 'zalgo', params: {}, action: 'delete', scopes: ['chat'] },
    ]))
    expect(p).toMatchObject({ add: ['Nouveau'], update: ['Liens'], unchanged: ['Caps'], problems: [] })
  })
  // Avec re2 (installé partout depuis #939), « (a+)+$ » n'est plus dangereux :
  // re2 le traite en temps linéaire. Une expression invalide, elle, est refusée.
  it('un profil exporté puis réimporté tel quel est « inchangé » (ordre des clés jsonb)', async () => {
    state.rules = [{ name: 'Flood', type: 'flood', params: { max_repeats: 4, burst_window_s: 10 }, action: 'warn', scopes: ['chat'], conditions: {}, dry_run: false, enabled: true, preset_key: 'base.flood',
      escalation: { action: 'mute', duration: { unit: 'm', value: 10 }, window_days: 1, warns_threshold: 3 } }]
    const p = await previewImport(profile([{ name: 'Flood', type: 'flood', params: { burst_window_s: 10, max_repeats: 4 }, action: 'warn', scopes: ['chat'], conditions: {}, dry_run: false, enabled: true, preset_key: 'base.flood',
      escalation: { warns_threshold: 3, window_days: 1, action: 'mute', duration: { value: 10, unit: 'm' } } }]))
    expect(p).toMatchObject({ unchanged: ['Flood'], update: [] })
  })
  it('refuse une expression invalide', async () => {
    const p = await previewImport(profile([{ name: 'Piège', type: 'regex', params: { pattern: '(abc' }, action: 'delete', scopes: ['chat'] }]))
    expect(p.problems[0]).toMatchObject({ rule: 'Piège', reason: 'regex_unsafe' })
  })
  it('un fichier qui n’est pas un profil Nodyx est refusé à la lecture', () => {
    expect(() => ProfileZ.parse({ format: 'autre', version: 1, name: 'x', rules: [] })).toThrow()
  })
})

describe('le bac à sable', () => {
  const r = (extra: any) => ({ id: 'r', name: 'R', type: 'link_spam', params: { max_links: 1 }, action: 'delete', dry_run: false, enabled: true, scopes: ['chat'], conditions: {}, immunized_role_types: [], preset_key: null, ...extra })
  it('dit ce qui se passerait, règle par règle, sans rien écrire', async () => {
    state.rules = [r({ id: 'a', name: 'Liens' }), r({ id: 'b', name: 'Observée', dry_run: true }), r({ id: 'c', name: 'Forum seulement', scopes: ['forum'] })]
    const res = await runSandbox({ content: 'https://a.x https://b.x', surface: 'chat' })
    expect(res.rules.map(x => [x.name, x.outcome])).toEqual([['Liens', 'delete'], ['Observée', 'observe'], ['Forum seulement', 'none']])
    expect(res.first).toBe('a')
    expect(calls.some(c => c.sql.startsWith('INSERT'))).toBe(false)
  })
  it('l’immunité et l’âge du compte sont pris en compte', async () => {
    state.rules = [r({ name: 'Nouveaux', conditions: { account_max_age_days: 2 } }), r({ name: 'Pas les modos', immunized_role_types: ['moderator'] })]
    const res = await runSandbox({ content: 'https://a.x https://b.x', surface: 'chat', accountAgeDays: 10, role: 'moderator' })
    expect(res.rules.every(x => x.outcome === 'none')).toBe(true)
    expect(res.rules[0].conditions_ok).toBe(false)
    expect(res.rules[1].immune).toBe(true)
  })
  it('l’inondation est signalée « non testable » ici', async () => {
    state.rules = [r({ type: 'flood', params: {} })]
    expect((await runSandbox({ content: 'x', surface: 'chat' })).rules[0].testable).toBe(false)
  })
  it('le filtre des symboles haineux est vérifié sans passer au journal', async () => {
    const res = await runSandbox({ content: 'yo 卐', surface: 'chat' })
    expect(res.system).toEqual({ blocked: true, rule: 'hate_symbol' })
    await new Promise(r => setTimeout(r, 20))
    expect(calls.some(c => c.params.includes('octoguard.hate_symbol_blocked'))).toBe(false)
  })
})
