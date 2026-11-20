// Lot 7d-3 : relire la charte (rien n'est compté), l'entrée du menu, l'écran Bienvenue,
// {rulesUrl} du message de bienvenue.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const state = {
  current: 2 as number | null,
  body: '<h2 data-color="green">Le respect</h2><p>On se parle bien.</p>',
  published: new Date('2026-11-03T10:00:00Z'),
  sig: [] as Array<{ version: number; way: 'hand' | 'phrase'; signed_at: Date }>,
  members: 152,
  welcome: true,
  pending: true,
  faces: [{ username: 'lea', avatar: '/uploads/avatars/lea.png' }, { username: 'max', avatar: null }],
}
const calls: string[] = []
vi.mock('../config/database', () => ({
  db: {
    query: vi.fn(async (sql: string) => {
      calls.push(sql)
      if (/FROM charter_settings s WHERE s\.audience/.test(sql)) {
        return { rows: [{ enabled: true, draw_enabled: true, pledge_tone: 'sober', pledge_own: '', current: state.current, min_important: null }] }
      }
      if (/SELECT body_html, published_at FROM charter_versions/.test(sql)) return { rows: [{ body_html: state.body, published_at: state.published }] }
      if (/SELECT body_html FROM charter_versions/.test(sql)) return { rows: [{ body_html: state.body }] }
      if (/SELECT version, way, signed_at FROM charter_signatures/.test(sql)) return { rows: state.sig.slice(0, 1) }
      if (/SELECT name FROM communities/.test(sql)) return { rows: [{ name: 'Vieux Looters' }] }
      if (/count\(\*\)::int AS n FROM community_members/.test(sql)) return { rows: [{ n: state.members }] }
      if (/ORDER BY \(NULLIF\(u\.avatar/.test(sql)) return { rows: state.faces }
      if (/FROM octoguard_welcome w WHERE w\.id = 1/.test(sql)) return { rows: [{ ok: state.welcome && state.pending }] }
      return { rows: [] }
    }),
  },
  redis: { get: vi.fn(async () => null), set: vi.fn(async () => 'OK'), del: vi.fn(async () => 1) },
}))
vi.mock('../services/mentionPeople', () => ({ instanceCommunityId: vi.fn(async () => 'c0000000-0000-4000-8000-000000000000') }))
vi.mock('../services/octoguard/logger', () => ({ logOctoGuardAction: vi.fn() }))

import { readCharter, charterPublished, openCharter, forgetCharterState } from '../services/charter'
import { charterRulesUrl } from '../services/octoguard/welcome'

const U = '11111111-1111-4111-8111-111111111111'
beforeEach(() => {
  calls.length = 0
  state.current = 2; state.sig = []
  forgetCharterState()
})

describe('relire la charte (page « La charte »)', () => {
  it('rend la version en ligne, sa date et le texte', async () => {
    const r = await readCharter('members', U)
    expect(r).toMatchObject({ version: 2, community: 'Vieux Looters', body_html: state.body, published_at: state.published, signed: null })
  })
  it('dit ce que la personne a signé (sa dernière signature)', async () => {
    state.sig = [{ version: 2, way: 'hand', signed_at: new Date('2026-11-12T09:00:00Z') }]
    expect((await readCharter('members', U)).signed).toEqual(state.sig[0])
  })
  it('ne compte RIEN : aucune lecture ouverte, le parcours de l’admin ne bouge pas', async () => {
    await readCharter('members', U)
    expect(calls.filter(q => /INSERT|UPDATE|DELETE/i.test(q))).toEqual([])
  })
  it('aucune charte publiée : une réponse vide, sans texte', async () => {
    state.current = null
    expect(await readCharter('members', U)).toEqual({ version: null, community: 'Vieux Looters' })
  })
})

describe('l’entrée « La charte » du menu', () => {
  it('apparaît seulement si une charte est publiée', async () => {
    expect(await charterPublished('members')).toBe(true)
    forgetCharterState(); state.current = null
    expect(await charterPublished('members')).toBe(false)
  })
})

describe('l’écran Bienvenue : les membres qu’on rejoint', () => {
  it('la charte des membres donne le nombre et quatre visages au plus', async () => {
    const r = await openCharter('members', U) as { crowd: unknown }
    expect(r.crowd).toEqual({ count: 152, faces: state.faces })
    const faceSql = calls.find(q => /ORDER BY \(NULLIF\(u\.avatar/.test(q))!
    expect(faceSql).toMatch(/LIMIT 4/)
    expect(faceSql).toMatch(/cm\.user_id <> \$2/)
  })
  it('la charte de l’équipe n’en a pas besoin', async () => {
    expect((await openCharter('team', U) as { crowd: unknown }).crowd).toBeNull()
  })
})

describe('l’écran Bienvenue emmène au salon seulement si un message y attend', () => {
  const old = process.env.OCTOGUARD_ENABLED
  afterEach(() => { process.env.OCTOGUARD_ENABLED = old; state.welcome = true; state.pending = true })
  const welcome = async () => (await openCharter('members', U) as { welcome: boolean }).welcome
  it('OctoGuard allumé + accueil actif avec un salon : oui', async () => {
    process.env.OCTOGUARD_ENABLED = 'true'
    expect(await welcome()).toBe(true)
  })
  it('accueil éteint ou sans salon : non', async () => {
    process.env.OCTOGUARD_ENABLED = 'true'; state.welcome = false
    expect(await welcome()).toBe(false)
  })
  it('un membre déjà là qui signe (aucun accueil en attente pour lui) : non', async () => {
    process.env.OCTOGUARD_ENABLED = 'true'; state.pending = false
    expect(await welcome()).toBe(false)
  })
  it('la requête vérifie bien l’attente de CETTE personne', async () => {
    process.env.OCTOGUARD_ENABLED = 'true'
    await welcome()
    expect(calls.find(q => /octoguard_welcome w/.test(q))).toMatch(/charter_welcome_pending p WHERE p\.user_id = \$1/)
  })
  it('OctoGuard éteint (aucun message ne part) : non, même si l’accueil est réglé', async () => {
    process.env.OCTOGUARD_ENABLED = 'false'
    expect(await welcome()).toBe(false)
  })
  it('la charte de l’équipe : jamais', async () => {
    process.env.OCTOGUARD_ENABLED = 'true'
    expect((await openCharter('team', U) as { welcome: boolean }).welcome).toBe(false)
  })
})

describe('{rulesUrl} dans le message de bienvenue', () => {
  const old = process.env.FRONTEND_URL
  afterEach(() => { process.env.FRONTEND_URL = old })
  it('mène à la page « La charte » de l’instance', async () => {
    process.env.FRONTEND_URL = 'https://vieuxlooters.nodyx.org/'
    expect(await charterRulesUrl()).toBe('https://vieuxlooters.nodyx.org/charter')
  })
  it('vide si aucune charte n’est publiée (pas de lien vers une page vide)', async () => {
    process.env.FRONTEND_URL = 'https://nodyx.org'
    state.current = null
    expect(await charterRulesUrl()).toBeNull()
  })
  it('vide si l’instance ne connaît pas son adresse publique', async () => {
    for (const v of ['', 'nodyx.org', 'javascript:alert(1)']) {
      process.env.FRONTEND_URL = v
      expect([v, await charterRulesUrl()]).toEqual([v, null])
    }
  })
})
