import { describe, it, expect, vi, beforeEach } from 'vitest'

// Base et Redis simulés : chaque requête est reconnue à son texte
const state = {
  enabled: true, current: 2 as number | null, minImportant: 2 as number | null,
  signatures: [] as number[], role: 'member', permissions: {} as Record<string, boolean>,
  failSettings: false,
}
const cache = new Map<string, string>()
vi.mock('../config/database', () => ({
  db: {
    query: vi.fn(async (sql: string) => {
      if (/FROM charter_settings s WHERE s\.audience/.test(sql)) {
        if (state.failSettings) throw new Error('base indisponible')
        return { rows: [{ enabled: state.enabled, draw_enabled: true, pledge_tone: 'sober', pledge_own: '', current: state.current, min_important: state.minImportant }] }
      }
      if (/SELECT version FROM charter_signatures/.test(sql)) return { rows: state.signatures.map(version => ({ version })) }
      if (/FROM community_members cm\s+LEFT JOIN community_grades/.test(sql)) return { rows: [{ role: state.role, permissions: state.permissions }] }
      return { rows: [] }
    }),
  },
  redis: {
    get: vi.fn(async (k: string) => cache.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => { cache.set(k, v); return 'OK' }),
    setex: vi.fn(async () => 'OK'),
    del: vi.fn(async (k: string) => { cache.delete(k); return 1 }),
    incr: vi.fn(async () => 1),
    ttl: vi.fn(async () => -2),
  },
}))
vi.mock('../services/mentionPeople', () => ({ instanceCommunityId: vi.fn(async () => 'c0000000-0000-4000-8000-000000000000') }))
vi.mock('../middleware/adminOnly', () => ({ getInstanceCommunityId: vi.fn(async () => 'c0000000-0000-4000-8000-000000000000') }))
vi.mock('../services/octoguard/logger', () => ({ logOctoGuardAction: vi.fn() }))

import {
  signedEnough, decideSign, readiness, sectionTitles, hasContent, mustSign, charterGate, forgetCharterState,
  CHARTER_MIN_SIGN_MS,
} from '../services/charter'
import { sanitizeCharter } from '../utils/sanitize'
import { moderateText } from '../services/octoguard/moderate'

beforeEach(() => {
  Object.assign(state, { enabled: true, current: 2, minImportant: 2, signatures: [], role: 'member', permissions: {}, failSettings: false })
  cache.clear(); forgetCharterState()
})

describe('qui doit signer (D16)', () => {
  it('tout le monde signe une fois, puis seulement après un changement important', () => {
    expect(signedEnough([], 0)).toBe(false)          // jamais signé
    expect(signedEnough([1], 0)).toBe(true)          // v2 publiée en simple correction : v1 suffit
    expect(signedEnough([1], 2)).toBe(false)         // v2 importante : re-signer
    expect(signedEnough([1, 2], 2)).toBe(true)
    expect(signedEnough([3], 2)).toBe(true)          // a signé plus récent que l'importante
  })
})

describe('signer : l\'ordre des refus', () => {
  const now = new Date('2026-11-19T12:00:00Z')
  const ok = { version: 2, way: 'hand' as const, pledge: true, decoy: false, typed: 0 }
  const ctx = { enabled: true, current: 2, drawEnabled: true, openedAt: new Date(now.getTime() - 60_000), bottomAt: new Date(now.getTime() - 10_000), now }
  it('une signature honnête passe', () => { expect(decideSign(ok, ctx)).toEqual({ ok: true }) })
  it('la fausse case : robot, même si tout le reste est parfait', () => {
    expect(decideSign({ ...ok, decoy: true }, ctx)).toEqual({ ok: false, bot: 'decoy' })
  })
  it('le chrono se lit sur l\'horloge du serveur : moins de 3 s depuis l\'ouverture = robot', () => {
    expect(decideSign(ok, { ...ctx, openedAt: new Date(now.getTime() - (CHARTER_MIN_SIGN_MS - 1)) })).toEqual({ ok: false, bot: 'clock' })
    expect(decideSign(ok, { ...ctx, openedAt: new Date(now.getTime() - CHARTER_MIN_SIGN_MS) })).toEqual({ ok: true })
  })
  it('pas arrivé en bas, case non cochée, version changée : refus sans parler de robot', () => {
    expect(decideSign(ok, { ...ctx, bottomAt: null })).toMatchObject({ ok: false, code: 'CHARTER_NOT_READ' })
    expect(decideSign({ ...ok, pledge: false }, ctx)).toMatchObject({ ok: false, code: 'CHARTER_PLEDGE_REQUIRED' })
    expect(decideSign({ ...ok, version: 1 }, ctx)).toMatchObject({ ok: false, code: 'CHARTER_VERSION_CHANGED' })
    expect(decideSign(ok, { ...ctx, openedAt: null })).toMatchObject({ ok: false, code: 'CHARTER_NOT_OPENED' })
  })
  it('la phrase : un collage instantané est refusé, avec son propre message', () => {
    expect(decideSign({ ...ok, way: 'phrase', typed: 2 }, ctx)).toMatchObject({ ok: false, code: 'CHARTER_TYPE_IT' })
    expect(decideSign({ ...ok, way: 'phrase', typed: 12 }, ctx)).toEqual({ ok: true })
  })
  it('signer à la main éteint par l\'admin : seule la phrase est acceptée', () => {
    expect(decideSign(ok, { ...ctx, drawEnabled: false })).toMatchObject({ ok: false, code: 'CHARTER_WAY_INVALID' })
  })
  it('charte éteinte ou jamais publiée : on ne signe rien', () => {
    expect(decideSign(ok, { ...ctx, enabled: false })).toMatchObject({ code: 'CHARTER_OFF' })
    expect(decideSign(ok, { ...ctx, current: null })).toMatchObject({ code: 'CHARTER_OFF' })
  })
})

describe('« prête à allumer ? » (indicatif)', () => {
  const full = '<figure class="nx-banner"><img src="/biomes/fr-1.webp" alt=""><figcaption>Bienvenue</figcaption></figure><h2>Un</h2><h2>Deux</h2><h2>Trois</h2>'
  it('tout y est', () => { expect(readiness(full, 'sober', '')).toEqual({ title: true, rules: true, banner: true, pledge: true, ready: true }) })
  it('dit ce qui manque', () => {
    expect(readiness('<h2>Un</h2><h2>Deux</h2>', 'own', ' ')).toEqual({ title: true, rules: false, banner: false, pledge: false, ready: false })
  })
  it('titres de section et contenu vide', () => {
    expect(sectionTitles('<h2 data-color="green">Le <strong>respect</strong></h2><p>x</p><h2>Pas de spam</h2>')).toEqual(['Le respect', 'Pas de spam'])
    expect(hasContent('<p> </p><hr>')).toBe(false)
    expect(hasContent('<p>Bonjour</p>')).toBe(true)
  })
})

describe('le nettoyage de la charte : les blocs de l\'aide-mémoire, rien d\'autre', () => {
  it('garde la bannière, l\'accroche, l\'encadré, les titres à pastille', () => {
    const html = '<figure class="nx-banner"><img src="/biomes/fr-1.webp" alt="Lavande"><figcaption>Bienvenue chez {communauté} !</figcaption></figure>'
      + '<p class="lead">Salut {pseudo} !</p><h2 data-color="green">Le respect</h2>'
      + '<p>On débat <span style="color:#22c55e"><strong>des idées</strong></span>.</p>'
      + '<aside class="nx-callout" data-color="orange"><strong>Jamais</strong> ton adresse.</aside><hr><ul><li>Un</li></ul>'
      + '<p style="text-align:center"><a href="/chat/aide">#aide</a></p>'
    // Même contenu ; le nettoyeur écrit seulement les balises vides en « <img /> », « <hr /> »
    expect(sanitizeCharter(html)).toBe(html.replace('alt="Lavande">', 'alt="Lavande" />').replace('<hr>', '<hr />'))
  })
  it('retire le code collé d\'ailleurs', () => {
    const out = sanitizeCharter('<script>alert(1)</script><p onclick="x()">a</p><iframe src="https://www.youtube.com/embed/x"></iframe>'
      + '<a href="javascript:alert(1)">b</a><img src="https://evil.example/t.png"><table><tr><td>c</td></tr></table>'
      + '<div class="nx-banner">d</div><h2 data-color="pink" id="chat-input">e</h2><p class="lead other">f</p>'
      + '<span style="color:red;position:fixed">g</span>')
    expect(out).not.toMatch(/script|onclick|iframe|javascript|evil|table|<div|pink|chat-input|other|position/)
    expect(out).toContain('<h2>e</h2>')
    expect(out).toContain('<p class="lead">f</p>')
  })
  it('les images : celles de l\'instance et les photos livrées avec Nodyx', () => {
    expect(sanitizeCharter('<img src="/uploads/assets/a.webp" alt="x">')).toBe('<img src="/uploads/assets/a.webp" alt="x" />')
    expect(sanitizeCharter('<img src="/uploads/../etc/passwd">')).toBe('')
    expect(sanitizeCharter('<img src="/biomes/../x.webp">')).toBe('')
  })
})

describe('la porte d\'écriture (validée le 19/11 : chat, MP, sujets, réponses)', () => {
  it('pas signé : refusé ; signé : ouvert ; éteinte : ouvert', async () => {
    expect(await charterGate('u1')).toEqual({ allow: false, code: 'CHARTER_UNSIGNED', i18n_key: 'charter.unsigned' })
    state.signatures = [2]; cache.clear()
    expect(await charterGate('u1')).toEqual({ allow: true })
    state.signatures = []; state.enabled = false; forgetCharterState(); cache.clear()
    expect(await charterGate('u1')).toEqual({ allow: true })
  })
  it('allumée mais jamais publiée : personne n\'a rien à signer', async () => {
    state.current = null; state.minImportant = null
    expect(await mustSign('members', 'u1')).toBe(false)
  })
  it('panne de la base : personne n\'est enfermé dehors', async () => {
    state.failSettings = true
    expect(await charterGate('u1')).toEqual({ allow: true })
  })
  it('un sujet ou une réponse du forum, un sondage : refusés tant que la charte n\'est pas signée', async () => {
    for (const surface of ['forum', 'poll'] as const) {
      const v = await moderateText('u1', surface, ['Bonjour tout le monde'])
      expect(v).toMatchObject({ blocked: true, reason: 'CHARTER_UNSIGNED', i18n_key: 'charter.unsigned' })
    }
  })
  it('le profil et le wiki ne sont pas concernés', async () => {
    for (const surface of ['profile', 'wiki'] as const) {
      expect((await moderateText('u1', surface, ['Ma bio'])).blocked).toBe(false)
    }
  })
  it('la charte de l\'équipe : un membre sans droit, le propriétaire n\'ont rien à signer ; un modérateur, si', async () => {
    expect(await mustSign('team', 'u1')).toBe(false)
    state.role = 'owner'; cache.clear()
    expect(await mustSign('team', 'u2')).toBe(false)
    state.role = 'moderator'; cache.clear()
    expect(await mustSign('team', 'u3')).toBe(true)
    state.role = 'member'; state.permissions = { moderate_content: true }; cache.clear()
    expect(await mustSign('team', 'u4')).toBe(true)
  })
})
