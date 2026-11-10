import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lot 4b, 3/3 (D28) : une règle qui « suit le barème ». Au cran Avertir, le message
// est bloqué tout de suite ; la prochaine marche part en tâche de fond. Pas
// d'avertissement brut, pas d'escalade propre à la règle. Une règle normale ne change pas.

const { dbQueryMock, stepMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
  stepMock: vi.fn(async () => 'applied'),
}))
vi.mock('../config/database', () => ({
  db: { query: dbQueryMock },
  redis: { set: vi.fn().mockResolvedValue('OK'), get: vi.fn(), keyPrefix: 'nodyx:' },
}))
vi.mock('../services/octoguard/ladder', () => ({ engineLadderStep: stepMock }))

import { runPipeline } from '../services/octoguard/pipeline'
import { _setRulesForBench, clearRules } from '../services/octoguard/cache'
import type { AutomodRuleRow } from '../services/octoguard/types'

const RULE_ID = '00000000-0000-0000-0000-0000000000aa'
function rule(extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  return {
    id: RULE_ID, name: 'Inondation', type: 'regex', params: { pattern: '\\bbadword\\b', flags: 'i' },
    action: 'warn', action_duration: null,
    escalation: { warns_threshold: 1, window_days: 1, action: 'mute', duration: { value: 1, unit: 'h' } },
    immunized_role_types: [], immunized_grade_ids: [], dry_run: false, enabled: true, created_at: '', updated_at: '',
    ...extra,
  } as AutomodRuleRow
}
const USER = '00000000-0000-4000-8000-00000000beef'
const INPUT = { content: 'this is a badword message', userCtx: { userId: USER, role: 'member', gradeIds: [] as string[] }, channelId: '00000000-0000-0000-0000-0000000chan00' }
const settle = () => new Promise(r => setTimeout(r, 30))
const sqls = () => dbQueryMock.mock.calls.map(c => String(c[0]).replace(/\s+/g, ' '))

beforeEach(() => {
  vi.clearAllMocks()
  dbQueryMock.mockResolvedValue({ rows: [{ cnt: 5 }] })
  process.env.OCTOGUARD_ENABLED = 'true'
  clearRules()
})

describe('une règle qui suit le barème (D28)', () => {
  it('le message est bloqué, et c’est la marche du barème qui part, pour CE membre et CETTE règle', async () => {
    _setRulesForBench([rule({ follow_ladder: true })])
    const r = await runPipeline(INPUT)
    expect(r.blocked).toBe(true)
    await settle()
    expect(stepMock).toHaveBeenCalledTimes(1)
    expect(stepMock).toHaveBeenCalledWith({ id: RULE_ID, name: 'Inondation' }, USER)
  })
  it('ni avertissement brut, ni escalade propre à la règle (le barème les remplace)', async () => {
    _setRulesForBench([rule({ follow_ladder: true })])
    await runPipeline(INPUT); await settle()
    expect(sqls().some(q => q.includes('INSERT INTO octoguard_warns'))).toBe(false)
    expect(sqls().some(q => q.includes('INSERT INTO chat_mutes'))).toBe(false)
    expect(sqls().some(q => q.includes("'octoguard.warn_user'") || q.includes('octoguard.warn_user'))).toBe(false)
  })
  it('une règle NORMALE garde l’ancien comportement : avertissement, puis son escalade', async () => {
    _setRulesForBench([rule()])
    const r = await runPipeline(INPUT)
    expect(r.blocked).toBe(true)
    await settle()
    expect(stepMock).not.toHaveBeenCalled()
    expect(sqls().some(q => q.includes('INSERT INTO octoguard_warns'))).toBe(true)
  })
  it('au cran Observer, une règle qui suit le barème ne touche à rien', async () => {
    _setRulesForBench([rule({ follow_ladder: true, dry_run: true })])
    const r = await runPipeline(INPUT)
    expect(r.blocked).toBe(false)
    await settle()
    expect(stepMock).not.toHaveBeenCalled()
  })
  it('si la marche échoue en arrière-plan, la décision de blocage tient', async () => {
    stepMock.mockRejectedValueOnce(new Error('db down'))
    _setRulesForBench([rule({ follow_ladder: true })])
    const r = await runPipeline(INPUT)
    expect(r.blocked).toBe(true)
  })
})
