// ─── OctoGuard, découplage décision / effets de bord (CDC pipeline) ───────────
// Prouve que la DÉCISION de blocage (warn, mute) ne dépend plus des écritures DB :
// même avec une DB lente (contention du pool) ou en échec, le pipeline rend
// blocked:true IMMÉDIATEMENT, sans atteindre le hard-timeout 50ms fail-open.
//
// AVANT le fix ces tests échoueraient : l'INSERT/applyMute étaient awaités sur le
// chemin chaud -> une DB à 200ms déclenchait le timeout 50ms -> blocked:false
// (le spam passait pile quand la modération sert le plus). cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbQueryMock, redisSetMock, redisGetMock } = vi.hoisted(() => ({
  dbQueryMock:  vi.fn(),
  redisSetMock: vi.fn().mockResolvedValue('OK'),
  redisGetMock: vi.fn(),
}))

vi.mock('../config/database', () => ({
  db:    { query: dbQueryMock },
  redis: { set: redisSetMock, get: redisGetMock, keyPrefix: 'nodyx:' },
}))

import { runPipeline } from '../services/octoguard/pipeline'
import { _setRulesForBench, clearRules } from '../services/octoguard/cache'
import type { AutomodRuleRow } from '../services/octoguard/types'

// Une DB volontairement LENTE (200ms) : simule la contention du pool qui, avant
// le fix, faisait dépasser le budget 50ms du pipeline.
const SLOW_DB_MS = 200
function slowResolve(rows: unknown[] = []) {
  return new Promise((resolve) => setTimeout(() => resolve({ rows }), SLOW_DB_MS))
}

function rule(action: AutomodRuleRow['action'], extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  return {
    id: '00000000-0000-0000-0000-0000000000aa', name: `test-${action}`, type: 'regex',
    params: { pattern: '\\bbadword\\b', flags: 'i' },
    action, action_duration: null, escalation: null,
    immunized_role_types: [], immunized_grade_ids: [],
    dry_run: false, enabled: true, created_at: '', updated_at: '',
    ...extra,
  } as AutomodRuleRow
}

const INPUT = {
  content:   'this is a badword message',
  userCtx:   { userId: '00000000-0000-0000-0000-00000000user', role: 'member', gradeIds: [] as string[] },
  channelId: '00000000-0000-0000-0000-0000000chan00',
}

beforeEach(() => {
  vi.resetAllMocks()
  redisSetMock.mockResolvedValue('OK')
  process.env.OCTOGUARD_ENABLED = 'true'
  clearRules()
})

describe('pipeline decoupling — la décision ne dépend pas des écritures DB', () => {
  it('warn : blocked=true rendu immédiatement malgré une DB à 200ms (pas de timeout 50ms)', async () => {
    dbQueryMock.mockImplementation(() => slowResolve())
    _setRulesForBench([rule('warn')])

    const start = performance.now()
    const r = await runPipeline(INPUT)
    const elapsed = performance.now() - start

    expect(r.blocked).toBe(true)                 // décision correcte (avant le fix : false, fail-open)
    expect(elapsed).toBeLessThan(50)             // rendue sans attendre la DB ni le hard-timeout
  })

  it('warn : la décision tient même si l\'INSERT DB rejette', async () => {
    dbQueryMock.mockRejectedValue(new Error('db down'))
    _setRulesForBench([rule('warn')])

    const r = await runPipeline(INPUT)
    expect(r.blocked).toBe(true)                 // l'échec d'un effet de bord ne renverse pas la décision
  })

  it('mute : blocked=true rendu immédiatement malgré applyMute lent (DB 200ms)', async () => {
    dbQueryMock.mockImplementation(() => slowResolve())
    _setRulesForBench([rule('mute', { action_duration: 3600 })])

    const start = performance.now()
    const r = await runPipeline(INPUT)
    const elapsed = performance.now() - start

    expect(r.blocked).toBe(true)
    expect(elapsed).toBeLessThan(50)
  })

  it('l\'effet de bord fire-and-forget finit par écrire en DB (INSERT warn appelé)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] })
    _setRulesForBench([rule('warn')])

    await runPipeline(INPUT)
    // laisser tourner le void(async) fire-and-forget
    await new Promise((r) => setTimeout(r, 20))

    const insertCalled = dbQueryMock.mock.calls.some(
      ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO octoguard_warns'),
    )
    expect(insertCalled).toBe(true)
  })

  it('message sans match : passe (blocked=false), aucune écriture', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] })
    _setRulesForBench([rule('warn')])

    const r = await runPipeline({ ...INPUT, content: 'a perfectly fine message' })
    expect(r.blocked).toBe(false)
    expect(dbQueryMock).not.toHaveBeenCalled()
  })
})
