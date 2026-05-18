// ─── OctoGuard Session C + C.2 — tests Vitest ─────────────────────────────────
// Couvre :
//   - assessPatternSafety (helper d'admission Session D)
//   - durationToExpiresAt (mutes.ts)
//   - substituteVariables (welcome.ts)
//   - applyMute + isUserMuted + cache (mutes.ts, avec mock DB)
//   - migrateEnvPatternsToDB (envMigration.ts, avec mock DB)
//
// Les tests d'intégration end-to-end ont déjà été passés en isolation sur
// le VPS (cf. /tmp/octoguard-e2e-*.mjs scripts), ces tests Vitest sont le
// filet de sécurité pour les refactos futurs (cf. feedback_test_first_critical).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks DB / Redis ────────────────────────────────────────────────────────

const { dbQueryMock, redisSetMock, redisGetMock } = vi.hoisted(() => ({
  dbQueryMock:   vi.fn(),
  redisSetMock:  vi.fn().mockResolvedValue('OK'),
  redisGetMock:  vi.fn(),
}))

vi.mock('../config/database', () => ({
  db:    { query: dbQueryMock },
  redis: {
    set:    redisSetMock,
    get:    redisGetMock,
    keyPrefix: 'nodyx:',
  },
}))

// ─── Imports après mock ──────────────────────────────────────────────────────

import { assessPatternSafety, hasRE2 } from '../services/octoguard/matchers'
import { durationToExpiresAt, applyMute, isUserMuted, clearMuteCache, invalidateMuteCache } from '../services/octoguard/mutes'
import { substituteVariables } from '../services/octoguard/welcome'
import { migrateEnvPatternsToDB } from '../services/octoguard/envMigration'

beforeEach(() => {
  vi.resetAllMocks()
  redisSetMock.mockResolvedValue('OK')
  clearMuteCache()
})

// ─── assessPatternSafety ────────────────────────────────────────────────────

describe('assessPatternSafety', () => {
  it('pattern simple : valid + safe + compiles', () => {
    const r = assessPatternSafety('\\bhello\\b', 'i')
    expect(r.valid).toBe(true)
    expect(r.compiles).toBe(true)
    expect(r.reason).toBeNull()
  })

  it('pattern vide : invalid', () => {
    const r = assessPatternSafety('', 'i')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('vide')
  })

  it('pattern trop long (>500 chars) : invalid', () => {
    const long = 'a'.repeat(501)
    const r = assessPatternSafety(long, 'i')
    expect(r.valid).toBe(false)
    expect(r.reason).toContain('trop long')
  })

  it('pattern invalide syntaxe : invalid + ne compile pas', () => {
    const r = assessPatternSafety('[unclosed', 'i')
    expect(r.valid).toBe(false)
    expect(r.compiles).toBe(false)
  })

  it('pattern catastrophique en mode re2 : accepté avec warning safe-regex', () => {
    if (!hasRE2()) return  // skip si re2 absent
    const r = assessPatternSafety('(a+)+$', 'i')
    // re2 le compile, donc valid=true, mais safe-regex râle → reason explique
    expect(r.compiles).toBe(true)
    expect(r.valid).toBe(true)
    expect(r.safe).toBe(false)
    expect(r.reason).toContain('safe-regex')
  })
})

// ─── durationToExpiresAt ─────────────────────────────────────────────────────

describe('durationToExpiresAt', () => {
  it('null durée → null (permanent)', () => {
    expect(durationToExpiresAt(null)).toBeNull()
  })

  it('15 minutes', () => {
    const d = durationToExpiresAt({ value: 15, unit: 'm' })
    expect(d).toBeInstanceOf(Date)
    const diff = d!.getTime() - Date.now()
    expect(diff).toBeGreaterThan(14 * 60_000)
    expect(diff).toBeLessThan(16 * 60_000)
  })

  it('2 heures', () => {
    const d = durationToExpiresAt({ value: 2, unit: 'h' })!
    expect(d.getTime() - Date.now()).toBeGreaterThan(1.9 * 3_600_000)
  })

  it('3 jours', () => {
    const d = durationToExpiresAt({ value: 3, unit: 'd' })!
    expect(d.getTime() - Date.now()).toBeGreaterThan(2.9 * 86_400_000)
  })

  it('1 semaine', () => {
    const d = durationToExpiresAt({ value: 1, unit: 'w' })!
    expect(d.getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000)
  })

  it('1 mois (30 jours)', () => {
    const d = durationToExpiresAt({ value: 1, unit: 'M' })!
    expect(d.getTime() - Date.now()).toBeGreaterThan(29.9 * 86_400_000)
  })

  it('valeur <= 0 → null', () => {
    expect(durationToExpiresAt({ value: 0,  unit: 'm' })).toBeNull()
    expect(durationToExpiresAt({ value: -5, unit: 'h' })).toBeNull()
  })

  // Note : TypeScript empêche l'usage d'une unit invalide via le type
  // DurationUnit, donc on ne teste pas le cas runtime "unit inconnue".
})

// ─── substituteVariables (welcome.ts) ────────────────────────────────────────

describe('substituteVariables', () => {
  const ctx = {
    username:      'alice',
    userId:        'uuid-1',
    communityName: 'My Community',
    rulesUrl:      'https://example.com/rules',
  }

  it('substitue {user}', () => {
    expect(substituteVariables('Bienvenue {user} !', ctx)).toBe('Bienvenue alice !')
  })

  it('substitue {userMention}', () => {
    expect(substituteVariables('Salut {userMention}', ctx)).toBe('Salut @alice')
  })

  it('substitue {communityName}', () => {
    expect(substituteVariables('Welcome to {communityName}', ctx)).toBe('Welcome to My Community')
  })

  it('substitue {rulesUrl}', () => {
    expect(substituteVariables('Lis {rulesUrl}', ctx)).toBe('Lis https://example.com/rules')
  })

  it('rulesUrl manquant → string vide', () => {
    expect(substituteVariables('Lis {rulesUrl}', { ...ctx, rulesUrl: null })).toBe('Lis ')
  })

  it('toutes les variables ensemble', () => {
    const tmpl = '{user} aka {userMention} sur {communityName} : {rulesUrl}'
    expect(substituteVariables(tmpl, ctx)).toBe('alice aka @alice sur My Community : https://example.com/rules')
  })

  it('variable inconnue laissée telle quelle', () => {
    expect(substituteVariables('Salut {unknown}', ctx)).toBe('Salut {unknown}')
  })

  it('variable répétée substituée partout', () => {
    expect(substituteVariables('{user} {user} {user}', ctx)).toBe('alice alice alice')
  })
})

// ─── mutes : applyMute + isUserMuted + cache ─────────────────────────────────

describe('mutes.applyMute + isUserMuted', () => {
  it('applyMute INSERT + log → isUserMuted retourne muted=true', async () => {
    const muteRow = {
      id: 'mute-1', user_id: 'user-1', channel_id: null,
      reason: 'test', applied_by: null,
      applied_at: '2026-01-01', expires_at: null,
    }
    // 1er appel : INSERT chat_mutes
    dbQueryMock.mockResolvedValueOnce({ rows: [muteRow] })
    // 2e appel : INSERT admin_audit_log (logger)
    dbQueryMock.mockResolvedValueOnce({ rows: [] })
    // 3e appel : SELECT chat_mutes (par isUserMuted)
    dbQueryMock.mockResolvedValueOnce({ rows: [muteRow] })

    const r1 = await applyMute({ userId: 'user-1', reason: 'test' })
    expect(r1?.id).toBe('mute-1')

    const r2 = await isUserMuted('user-1', 'ch-1')
    expect(r2.muted).toBe(true)
    expect(r2.reason).toBe('test')
  })

  it('isUserMuted fail-open en cas d\'erreur DB', async () => {
    dbQueryMock.mockRejectedValueOnce(new Error('db down'))
    const r = await isUserMuted('user-1', 'ch-1')
    expect(r.muted).toBe(false)
  })

  it('mute par channel ne bloque pas un autre channel', async () => {
    const muteRow = {
      id: 'mute-2', user_id: 'user-2', channel_id: 'ch-A',
      reason: null, applied_by: null,
      applied_at: '2026-01-01', expires_at: null,
    }
    // Le cache a déjà été clearé. isUserMuted va appeler DB
    dbQueryMock.mockResolvedValueOnce({ rows: [muteRow] })
    const r1 = await isUserMuted('user-2', 'ch-A')
    expect(r1.muted).toBe(true)  // muted dans ch-A

    invalidateMuteCache('user-2')
    dbQueryMock.mockResolvedValueOnce({ rows: [muteRow] })
    const r2 = await isUserMuted('user-2', 'ch-B')
    expect(r2.muted).toBe(false)  // pas muted dans ch-B
  })

  it('mute global (channel_id=NULL) bloque tous les channels', async () => {
    const muteRow = {
      id: 'mute-3', user_id: 'user-3', channel_id: null,
      reason: 'global', applied_by: null,
      applied_at: '2026-01-01', expires_at: null,
    }
    dbQueryMock.mockResolvedValueOnce({ rows: [muteRow] })
    const r1 = await isUserMuted('user-3', 'any-channel')
    expect(r1.muted).toBe(true)
    expect(r1.channel_id).toBeNull()
  })
})

// ─── envMigration ────────────────────────────────────────────────────────────

describe('migrateEnvPatternsToDB', () => {
  beforeEach(() => {
    delete process.env.BLOCKED_CONTENT_PATTERNS
  })

  it('env vide → skip sans toucher la DB', async () => {
    const r = await migrateEnvPatternsToDB()
    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('env_empty')
    expect(dbQueryMock).not.toHaveBeenCalled()
  })

  it('DB déjà peuplée → skip', async () => {
    process.env.BLOCKED_CONTENT_PATTERNS = 'foo|bar'
    dbQueryMock.mockResolvedValueOnce({ rows: [{ cnt: '5' }] })  // count: 5 règles existantes
    const r = await migrateEnvPatternsToDB()
    expect(r.skipped).toBe(true)
    expect(r.reason).toContain('5')
    expect(r.imported).toBe(0)
    delete process.env.BLOCKED_CONTENT_PATTERNS
  })

  it('DB vide + patterns valides → import', async () => {
    process.env.BLOCKED_CONTENT_PATTERNS = 'foo|bar|baz'
    dbQueryMock.mockResolvedValueOnce({ rows: [{ cnt: '0' }] })   // count = 0
    dbQueryMock.mockResolvedValue({ rows: [] })                    // INSERT * 3
    const r = await migrateEnvPatternsToDB()
    expect(r.skipped).toBe(false)
    expect(r.imported).toBe(3)
    expect(r.invalid).toHaveLength(0)
    delete process.env.BLOCKED_CONTENT_PATTERNS
  })

  it('patterns invalides rejetés', async () => {
    process.env.BLOCKED_CONTENT_PATTERNS = 'valid|[invalid'
    dbQueryMock.mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
    dbQueryMock.mockResolvedValue({ rows: [] })
    const r = await migrateEnvPatternsToDB()
    expect(r.imported).toBe(1)
    expect(r.invalid).toContain('[invalid')
    delete process.env.BLOCKED_CONTENT_PATTERNS
  })

  it('DB error sur count → skip', async () => {
    process.env.BLOCKED_CONTENT_PATTERNS = 'foo'
    dbQueryMock.mockRejectedValueOnce(new Error('db error'))
    const r = await migrateEnvPatternsToDB()
    expect(r.skipped).toBe(true)
    expect(r.reason).toBe('db_error')
    delete process.env.BLOCKED_CONTENT_PATTERNS
  })

  it('whitespace dans les patterns trimé', async () => {
    process.env.BLOCKED_CONTENT_PATTERNS = '  foo  |  bar  '
    dbQueryMock.mockResolvedValueOnce({ rows: [{ cnt: '0' }] })
    dbQueryMock.mockResolvedValue({ rows: [] })
    const r = await migrateEnvPatternsToDB()
    expect(r.imported).toBe(2)
    delete process.env.BLOCKED_CONTENT_PATTERNS
  })
})
