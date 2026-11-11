import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lot 8 : contester une décision. Les règles que le serveur tient, quelle que soit
// l'interface : la sienne seulement, une fois, dans les 30 jours ; jamais tranchée
// par son auteur ni par la personne qui conteste ; deux décisions simultanées, une
// seule gagne ; une annulation ratée remet la contestation à trancher.

const { q, undoLadderMock, removeMuteMock, checkTargetMock, notifMock } = vi.hoisted(() => ({
  q: vi.fn(),
  undoLadderMock: vi.fn(),
  removeMuteMock: vi.fn(async () => true),
  checkTargetMock: vi.fn(async () => ({ ok: true, username: 'remi' })),
  notifMock: vi.fn(async () => ({})),
}))
vi.mock('../config/database', () => ({ db: { query: q }, redis: {} }))
vi.mock('../services/octoguard/ladder', () => ({ undoLadder: undoLadderMock, checkTarget: checkTargetMock }))
vi.mock('../services/octoguard/mutes', () => ({ removeMute: removeMuteMock }))
vi.mock('../services/octoguard/logger', () => ({ logOctoGuardAction: vi.fn() }))
vi.mock('../models/notification', () => ({ create: notifMock, getUnreadCount: vi.fn(async () => 1) }))
vi.mock('../socket/io', () => ({ io: null }))

import { fileAppeal, decideAppeal } from '../services/octoguard/appeals'

const REMI = '00000000-0000-4000-8000-0000000000a1'
const MAX = '00000000-0000-4000-8000-0000000000a2'
const LEA = '00000000-0000-4000-8000-0000000000a3'
const W = '00000000-0000-4000-8000-0000000000b1'
const AP = '00000000-0000-4000-8000-0000000000c1'
const recent = new Date(Date.now() - 3600_000).toISOString()
const access = (perms = ['moderate_members']) => ({ permissions: perms, rank: 2, role: 'moderator' }) as never

function decision(extra: Record<string, unknown> = {}) {
  return { type: 'warn', id: W, user_id: REMI, at: recent, reason: 'x', decided_by: MAX, rule_id: null, rule_name: null,
    ladder_id: null, ladder_status: null, ladder_step: null, expires_at: null, active: true, undone: false, ...extra }
}
function appeal(extra: Record<string, unknown> = {}) {
  return { id: AP, user_id: REMI, username: 'remi', decision_type: 'warn', decision_id: W, decided_by: MAX, decided_by_engine: false,
    decided_by_username: 'max', message: 'je conteste ceci', status: 'open', reply: null, created_at: recent, handled_by: null, handled_by_username: null, handled_at: null, ...extra }
}
/** Répond selon la requête : la décision, la contestation, la réservation. */
function route(o: { dec?: unknown; ap?: unknown; insert?: unknown[]; claim?: unknown[] } = {}) {
  q.mockImplementation(async (sql: string) => {
    const s = sql.replace(/\s+/g, ' ')
    if (s.includes('FROM octoguard_warns w') || s.includes('FROM octoguard_mute_log m')) return { rows: o.dec ? [o.dec] : [] }
    if (s.includes('FROM octoguard_appeals a')) return { rows: o.ap ? [o.ap] : [] }
    if (s.startsWith(' INSERT INTO octoguard_appeals') || s.startsWith('INSERT INTO octoguard_appeals')) return { rows: o.insert ?? [{ id: AP, created_at: recent }] }
    if (s.includes("SET status = $2")) return { rows: o.claim ?? [{ id: AP }] }
    return { rows: [] }
  })
}
const sqls = () => q.mock.calls.map(c => String(c[0]).replace(/\s+/g, ' '))

beforeEach(() => { vi.clearAllMocks(); checkTargetMock.mockResolvedValue({ ok: true, username: 'remi' }) })

describe('contester (le membre)', () => {
  const msg = 'Je répondais à trois personnes.'
  it('la décision d’un autre : « introuvable », comme une décision inconnue', async () => {
    route({ dec: decision({ user_id: MAX }) })
    expect(await fileAppeal(REMI, { decision_type: 'warn', decision_id: W, message: msg })).toMatchObject({ ok: false, status: 404, code: 'NOT_FOUND' })
    route({})
    expect(await fileAppeal(REMI, { decision_type: 'warn', decision_id: W, message: msg })).toMatchObject({ code: 'NOT_FOUND' })
  })
  it('après 30 jours : trop tard (D33)', async () => {
    route({ dec: decision({ at: new Date(Date.now() - 31 * 86_400_000).toISOString() }) })
    expect(await fileAppeal(REMI, { decision_type: 'warn', decision_id: W, message: msg })).toMatchObject({ code: 'APPEAL_TOO_LATE' })
  })
  it('une décision déjà défaite : rien à contester', async () => {
    route({ dec: decision({ undone: true }) })
    expect(await fileAppeal(REMI, { decision_type: 'warn', decision_id: W, message: msg })).toMatchObject({ code: 'DECISION_UNDONE' })
  })
  it('une seule fois par décision (D23)', async () => {
    route({ dec: decision(), insert: [] })
    expect(await fileAppeal(REMI, { decision_type: 'warn', decision_id: W, message: msg })).toMatchObject({ status: 409, code: 'APPEAL_EXISTS' })
  })
  it('le mot du membre : 10 caractères au moins, une fois les espaces ôtés', async () => {
    route({ dec: decision() })
    expect(await fileAppeal(REMI, { decision_type: 'warn', decision_id: W, message: '   pas juste   ' })).toMatchObject({ code: 'APPEAL_MESSAGE_LENGTH' })
  })
  it('l’auteur est figé au dépôt ; OctoGuard est noté comme tel', async () => {
    route({ dec: decision({ decided_by: null }) })
    const r = await fileAppeal(REMI, { decision_type: 'warn', decision_id: W, message: msg })
    expect(r.ok).toBe(true)
    const ins = q.mock.calls.find(c => String(c[0]).includes('INSERT INTO octoguard_appeals'))!
    expect(ins[1]).toEqual([REMI, 'warn', W, null, true, msg])
  })
})

describe('trancher (l’équipe)', () => {
  const me = (userId: string, perms?: string[]) => ({ userId, access: access(perms) })
  it('l’auteur de la décision ne tranche pas, et rien n’est réservé', async () => {
    route({ ap: appeal() })
    expect(await decideAppeal(me(MAX), AP, { outcome: 'overturned' })).toMatchObject({ status: 403, code: 'APPEAL_SAME_AUTHOR' })
    expect(sqls().some(s => s.includes('SET status = $2'))).toBe(false)
  })
  it('la personne qui conteste ne tranche pas la sienne', async () => {
    route({ ap: appeal({ user_id: MAX, decided_by: LEA }) })
    expect(await decideAppeal(me(MAX), AP, { outcome: 'overturned' })).toMatchObject({ code: 'APPEAL_OWN' })
  })
  it('une décision d’OctoGuard : toute l’équipe peut trancher', async () => {
    route({ ap: appeal({ decided_by: null, decided_by_engine: true }), dec: decision({ decided_by: null }) })
    expect(await decideAppeal(me(MAX), AP, { outcome: 'upheld' })).toMatchObject({ ok: true, status: 'upheld', undone: false })
  })
  it('sans le droit de modérer : refusé', async () => {
    route({ ap: appeal() })
    expect(await decideAppeal(me(LEA, ['manage_octoguard']), AP, { outcome: 'upheld' })).toMatchObject({ code: 'FORBIDDEN' })
  })
  it('le garde-fou de rang du barème s’applique', async () => {
    route({ ap: appeal() })
    checkTargetMock.mockResolvedValueOnce({ ok: false, status: 403, code: 'RANK_TOO_LOW', error: 'x' } as never)
    expect(await decideAppeal(me(LEA), AP, { outcome: 'overturned' })).toMatchObject({ code: 'RANK_TOO_LOW' })
  })
  it('deux personnes en même temps : la réservation perdue répond « déjà tranchée », sans rien défaire', async () => {
    route({ ap: appeal(), dec: decision(), claim: [] })
    expect(await decideAppeal(me(LEA), AP, { outcome: 'overturned' })).toMatchObject({ status: 409, code: 'APPEAL_DECIDED' })
    expect(sqls().some(s => s.includes('UPDATE octoguard_warns'))).toBe(false)
    expect(notifMock).not.toHaveBeenCalled()
  })
  it('annuler un avertissement hors barème : il est retiré, le membre est prévenu (une valeur, pas une phrase)', async () => {
    route({ ap: appeal(), dec: decision() })
    expect(await decideAppeal(me(LEA), AP, { outcome: 'overturned', reply: '  On a mal lu.  ' })).toMatchObject({ ok: true, undone: true })
    expect(sqls().some(s => s.includes('UPDATE octoguard_warns SET cleared_at = NOW()'))).toBe(true)
    expect(notifMock).toHaveBeenCalledWith({ user_id: REMI, type: 'appeal_resolved', meta: { outcome: 'overturned', decision_type: 'warn', reply: 'On a mal lu.' } })
  })
  it('annuler une marche du barème passe par le barème (le membre redescend)', async () => {
    route({ ap: appeal(), dec: decision({ ladder_id: 'L1', ladder_status: 'applied' }) })
    undoLadderMock.mockResolvedValueOnce({ ok: true })
    expect(await decideAppeal(me(LEA), AP, { outcome: 'overturned' })).toMatchObject({ ok: true, undone: true })
    expect(undoLadderMock).toHaveBeenCalledWith(expect.objectContaining({ userId: LEA }), 'L1')
  })
  it('annuler une sourdine en cours la lève', async () => {
    route({ ap: appeal({ decision_type: 'mute' }), dec: decision({ type: 'mute', active: true }) })
    await decideAppeal(me(LEA), AP, { outcome: 'overturned' })
    expect(removeMuteMock).toHaveBeenCalledWith(W, LEA)
  })
  it('si l’annulation échoue, la contestation redevient à trancher et personne n’est prévenu', async () => {
    route({ ap: appeal(), dec: decision({ ladder_id: 'L1', ladder_status: 'applied' }) })
    undoLadderMock.mockResolvedValueOnce({ ok: false, status: 403, code: 'FORBIDDEN', error: 'x' })
    expect(await decideAppeal(me(LEA), AP, { outcome: 'overturned' })).toMatchObject({ ok: false, code: 'FORBIDDEN' })
    expect(sqls().some(s => s.includes("SET status = 'open', handled_by = NULL"))).toBe(true)
    expect(notifMock).not.toHaveBeenCalled()
  })
  it('maintenir ne touche à rien', async () => {
    route({ ap: appeal(), dec: decision() })
    expect(await decideAppeal(me(LEA), AP, { outcome: 'upheld' })).toMatchObject({ ok: true, undone: false })
    expect(sqls().some(s => s.includes('UPDATE octoguard_warns'))).toBe(false)
    expect(undoLadderMock).not.toHaveBeenCalled()
    expect(removeMuteMock).not.toHaveBeenCalled()
  })
})
