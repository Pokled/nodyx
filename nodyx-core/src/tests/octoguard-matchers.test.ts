// ─── OctoGuard auto-mod matchers ─────────────────────────────────────────────
// Mitigation R1 du risk register : tests Vitest sur les 5 matchers avant
// d'attaquer la Session C. Couvre les chemins critiques (hit, miss, edge,
// fail-safe) + le dispatcher matchRule + la protection ReDoS via re2.

import { describe, it, expect } from 'vitest'
import {
  matchRegex,
  matchCaps,
  matchLinkDomain,
  matchMentionSpam,
  matchLinkSpam,
  matchRule,
  hasRE2,
  compileSafeRegex,
} from '../services/octoguard/matchers'
import type { AutomodRuleRow } from '../services/octoguard/types'

// Helper : créer une AutomodRuleRow minimale pour les tests dispatcher
function rule(partial: Partial<AutomodRuleRow>): AutomodRuleRow {
  return {
    id:                    'test-id',
    name:                  'test',
    type:                  'regex',
    params:                {},
    action:                'delete',
    action_duration:       null,
    escalation:            null,
    immunized_role_types:  [],
    immunized_grade_ids:   [],
    dry_run:               false,
    enabled:               true,
    created_at:            '',
    updated_at:            '',
    ...partial,
  }
}

describe('compileSafeRegex', () => {
  it('retourne un objet avec test() pour un pattern valide', () => {
    const r = compileSafeRegex('hello', 'i')
    expect(r).not.toBeNull()
    expect(typeof r!.test).toBe('function')
  })

  it('retourne null pour un pattern invalide', () => {
    const r = compileSafeRegex('[invalid', 'i')
    expect(r).toBeNull()
  })

  it('résiste au ReDoS catastrophique (a+)+$ en mode re2', () => {
    if (!hasRE2()) return  // skip si re2 absent (mode dégradé)
    const r = compileSafeRegex('(a+)+$', '')
    expect(r).not.toBeNull()
    const start = Date.now()
    const out = r!.test('a'.repeat(30) + '!')
    const elapsed = Date.now() - start
    expect(out).toBe(false)
    expect(elapsed).toBeLessThan(50)  // re2 = quasi instantané
  })
})

describe('matchRegex', () => {
  it('match un mot précis', () => {
    const r = matchRegex({ content: 'hello freshtest world' }, { pattern: '\\bfreshtest\\b' })
    expect(r).not.toBeNull()
    expect(r!.excerpt).toContain('freshtest')
  })

  it('miss si le mot n\'est pas présent', () => {
    const r = matchRegex({ content: 'hello world' }, { pattern: '\\bfreshtest\\b' })
    expect(r).toBeNull()
  })

  it('pattern invalide retourne null silencieusement', () => {
    const r = matchRegex({ content: 'anything' }, { pattern: '[invalid' })
    expect(r).toBeNull()
  })

  it('params vides retourne null', () => {
    const r = matchRegex({ content: 'anything' }, {})
    expect(r).toBeNull()
  })

  it('flags i par défaut (case-insensitive)', () => {
    const r = matchRegex({ content: 'HELLO' }, { pattern: 'hello' })
    expect(r).not.toBeNull()
  })
})

describe('matchCaps', () => {
  it('match si > seuil de majuscules sur texte assez long', () => {
    const r = matchCaps({ content: 'HELLO EVERYONE WHAT IS UP' }, { min_length: 15, threshold_percent: 70 })
    expect(r).not.toBeNull()
  })

  it('miss si < seuil', () => {
    const r = matchCaps({ content: 'hello everyone what is up' }, { min_length: 15, threshold_percent: 70 })
    expect(r).toBeNull()
  })

  it('miss si texte trop court (avant strip)', () => {
    const r = matchCaps({ content: 'HI ALL' }, { min_length: 15, threshold_percent: 70 })
    expect(r).toBeNull()
  })

  it('strip HTML avant compte (les balises ne comptent pas)', () => {
    // sans strip, "<strong>" pèserait sur le compte ; avec strip on garde "hello"
    const r = matchCaps({ content: '<strong>hello world this is normal text</strong>' }, { min_length: 15, threshold_percent: 70 })
    expect(r).toBeNull()
  })

  it('params par défaut si non fournis (15 / 70%)', () => {
    const r = matchCaps({ content: 'ALL CAPS LONG ENOUGH' }, {})
    expect(r).not.toBeNull()
  })
})

describe('matchLinkDomain', () => {
  it('match blacklist quand le domaine est listé', () => {
    const r = matchLinkDomain(
      { content: 'join https://discord.gg/abc' },
      { mode: 'blacklist', domains: ['discord.gg'] }
    )
    expect(r).not.toBeNull()
    expect(r!.excerpt).toContain('discord.gg')
  })

  it('match blacklist via wildcard *.example.com', () => {
    const r = matchLinkDomain(
      { content: 'see https://sub.example.com/x' },
      { mode: 'blacklist', domains: ['*.example.com'] }
    )
    expect(r).not.toBeNull()
  })

  it('miss whitelist quand URL est autorisée', () => {
    const r = matchLinkDomain(
      { content: 'see https://nodyx.org/doc' },
      { mode: 'whitelist', domains: ['nodyx.org'] }
    )
    expect(r).toBeNull()
  })

  it('match whitelist quand URL n\'est PAS autorisée', () => {
    const r = matchLinkDomain(
      { content: 'see https://example.com/x' },
      { mode: 'whitelist', domains: ['nodyx.org'] }
    )
    expect(r).not.toBeNull()
  })

  it('pas de match si aucune URL dans le message', () => {
    const r = matchLinkDomain(
      { content: 'just plain text no url here' },
      { mode: 'blacklist', domains: ['discord.gg'] }
    )
    expect(r).toBeNull()
  })

  it('domains vide retourne null', () => {
    const r = matchLinkDomain(
      { content: 'https://anywhere.com' },
      { mode: 'blacklist', domains: [] }
    )
    expect(r).toBeNull()
  })
})

describe('matchMentionSpam', () => {
  it('match si > max_mentions', () => {
    const r = matchMentionSpam(
      { content: '@a @b @c @d @e @f hi' },
      { max_mentions: 3 }
    )
    expect(r).not.toBeNull()
    expect(r!.excerpt).toContain('mentions=6')
  })

  it('miss si <= max_mentions', () => {
    const r = matchMentionSpam(
      { content: '@alice hi' },
      { max_mentions: 3 }
    )
    expect(r).toBeNull()
  })

  it('détecte aussi les mentions à 1 char (anti-spam tolérant)', () => {
    const r = matchMentionSpam(
      { content: '@a @b @c @d @e' },
      { max_mentions: 3 }
    )
    expect(r).not.toBeNull()
  })

  it('default max_mentions = 5', () => {
    const r = matchMentionSpam(
      { content: '@a @b @c @d' },
      {}
    )
    expect(r).toBeNull()  // 4 mentions, default 5 max
  })
})

describe('matchLinkSpam', () => {
  it('match si > max_links', () => {
    const r = matchLinkSpam(
      { content: 'a https://x.com b https://y.com c https://z.com d' },
      { max_links: 2 }
    )
    expect(r).not.toBeNull()
    expect(r!.excerpt).toContain('links=3')
  })

  it('miss si <= max_links', () => {
    const r = matchLinkSpam(
      { content: 'just https://nodyx.org' },
      { max_links: 2 }
    )
    expect(r).toBeNull()
  })

  it('aucun lien retourne null', () => {
    const r = matchLinkSpam({ content: 'plain text' }, { max_links: 2 })
    expect(r).toBeNull()
  })
})

describe('matchRule (dispatcher)', () => {
  it('dispatche vers le bon matcher selon rule.type', () => {
    const r = matchRule('HELLO LONG ENOUGH FOR CAPS', rule({ type: 'caps', params: { min_length: 15, threshold_percent: 70 } }))
    expect(r).not.toBeNull()
  })

  it('retourne null pour type inconnu', () => {
    const r = matchRule('anything', rule({ type: 'unknown_type' as never, params: {} }))
    expect(r).toBeNull()
  })

  it('respecte enabled (du contrat : appelé par pipeline qui filtre déjà, mais le matcher ne refuse pas)', () => {
    // matchRule ne check pas enabled, c'est le pipeline qui le fait
    // Ce test documente le contrat
    const r = matchRule('match', rule({ type: 'regex', params: { pattern: 'match' }, enabled: false }))
    expect(r).not.toBeNull()
  })
})
