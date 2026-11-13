/**
 * « Nodyx relié » : la carte d'un lien interne. Ce qui compte le plus : une carte ne
 * montre que ce que le lecteur a le droit de voir, et « interdit » ressemble à
 * « introuvable ».
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))

import { db, redis } from '../config/database'
import linksRoutes from '../routes/links'
import { parseInternalLink, plainExcerpt } from '../services/linkCards'

const T  = '11111111-1111-4111-8111-111111111111'
const P  = '22222222-2222-4222-8222-222222222222'
const E  = '33333333-3333-4333-8333-333333333333'
const T2 = '55555555-5555-4555-8555-555555555555'
const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FRONTEND_URL = 'https://communaute.example'
  delete process.env.SELF_URL; delete process.env.PUBLIC_API_URL
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
})

describe('Reconnaître un lien interne', () => {
  it.each([
    ['/forum/general/soiree-jeux-ab12', { kind: 'thread', thread: 'soiree-jeux-ab12', postId: null }],
    [`/forum/general/${T}`, { kind: 'thread', thread: T, postId: null }],
    [`/forum/general/soiree-jeux-ab12#post-${P}`, { kind: 'thread', thread: 'soiree-jeux-ab12', postId: P }],
    [`https://communaute.example/forum/general/soiree-jeux-ab12#post-${P}`, { kind: 'thread', thread: 'soiree-jeux-ab12', postId: P }],
    [`/calendar/${E}`, { kind: 'event', id: E }],
    [`https://communaute.example/calendar/${E}?x=1`, { kind: 'event', id: E }],
  ])('%s', (input, expected) => {
    expect(parseInternalLink(input)).toEqual(expected)
  })

  it.each([
    [`https://autre-site.example/calendar/${E}`, 'un autre site'],
    [`//autre-site.example/calendar/${E}`, 'adresse sans protocole vers un autre site'],
    [`https://x:y@communaute.example/calendar/${E}`, 'identifiants dans l’adresse'],
    ['javascript:alert(1)', 'pseudo-protocole'],
    ['/calendar/pas-un-uuid', 'événement sans identifiant valide'],
    ['/forum/general', 'catégorie seule'],
    ['/forum/general/sujet/en-trop', 'chemin trop long'],
    ['/admin/members', 'page non partageable'],
    ['/forum/general/' + 'a'.repeat(3000), 'adresse démesurée'],
  ])('ignoré : %s (%s)', (input) => {
    expect(parseInternalLink(input)).toBeNull()
  })

  it('un #post- mal formé ouvre le sujet, sans réponse précise', () => {
    expect(parseInternalLink('/forum/general/sujet#post-xyz')).toEqual({ kind: 'thread', thread: 'sujet', postId: null })
  })
})

describe('Extrait d’une réponse', () => {
  it('du texte brut : sans balise, sans script, entités rendues, espaces réduits', () => {
    expect(plainExcerpt('<p>Salut &amp; <strong>bienvenue</strong></p><script>alert(1)</script>\n\n<p>à  toi</p>'))
      .toBe('Salut & bienvenue à toi')
  })
  it('coupé proprement avec des points de suspension', () => {
    const out = plainExcerpt('<p>' + 'mot '.repeat(100) + '</p>', 40)
    expect(out.length).toBeLessThanOrEqual(40)
    expect(out.endsWith('…')).toBe(true)
  })
})

/** Base simulée : un sujet T (catégorie « Général »), une réponse P dans T, un événement E. */
function world(opts: { eventPublic: boolean; members: string[]; max?: number }) {
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('FROM threads t')) {
      return { rows: (params[0] === T || params[0] === 'soiree-jeux-ab12') ? [{
        id: T, slug: 'soiree-jeux-ab12', title: 'Soirée jeux', category_id: 'cat1', category_slug: 'general',
        author_username: 'lea', author_avatar: '/uploads/avatars/lea.webp', post_count: 4, is_locked: false,
        created_at: new Date('2026-11-01T10:00:00Z'), author_id: 'lea-id',
      }] : params[0] === T2 ? [{
        id: T2, slug: 'autre-sujet', title: 'Autre sujet', category_id: 'cat1', category_slug: 'general',
        author_username: 'remi', author_avatar: null, post_count: 1, is_locked: false,
        created_at: new Date('2026-11-03T10:00:00Z'), author_id: 'remi-id',
      }] : [] } as any
    }
    if (s.includes('FROM categories WHERE id')) return { rows: [{ name: 'Général' }] } as any
    if (s.includes('FROM thread_tags tt')) {
      return { rows: [params[0] === T ? { last_at: new Date('2026-11-04T08:30:00Z'), tags: ['inscriptions', 'tournoi'] } : { last_at: null, tags: null }] } as any
    }
    if (s.includes('FROM event_rsvps r JOIN users u')) {
      return { rows: [{ username: 'lea', avatar: '/uploads/avatars/lea.webp' }, { username: 'max', avatar: null }] } as any
    }
    if (s.includes('FROM posts p JOIN users u')) {
      // Fidèle à la requête : la réponse P vit dans le sujet T. Le filtre sur le sujet ne
      // s'applique QUE si la requête le demande (sinon le sabotage ne pourrait pas tomber).
      const sujetOk = !s.includes('p.thread_id = $2') || params[1] === T
      return { rows: (params[0] === P && sujetOk) ? [{ id: P, content: '<p>Je viens avec <b>des chips</b></p>', created_at: '2026-11-02T10:00:00Z', username: 'max', avatar: null }] : [] } as any
    }
    if (s.includes('FROM events e WHERE e.id = $1')) {
      return { rows: params[0] === E ? [{
        id: E, title: 'Réunion de l’équipe', starts_at: '2026-12-01T19:00:00Z', ends_at: null, is_all_day: false,
        location: 'Discord', cover_url: null, is_cancelled: false, rsvp_enabled: true, is_public: opts.eventPublic,
        community_id: 'c1', going_count: 3, my_rsvp: params[1] ? 'going' : null, max_attendees: opts.max ?? null,
      }] : [] } as any
    }
    if (s.includes('FROM community_members WHERE community_id = $1 AND user_id = $2')) {
      return { rows: opts.members.includes(params[1]) ? [{ x: 1 }] : [] } as any
    }
    return { rows: [] } as any
  })
}

async function resolve(url: string, user?: string) {
  const app = await buildApp(a => linksRoutes(a))
  return app.inject({ method: 'GET', url: '/resolve?url=' + encodeURIComponent(url), headers: user ? { Authorization: `Bearer ${tokenOf(user)}` } : {} })
}

describe('GET /links/resolve', () => {
  it('sans url : 400 avec un code stable', async () => {
    const app = await buildApp(a => linksRoutes(a))
    const res = await app.inject({ method: 'GET', url: '/resolve' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('LINK_URL_REQUIRED')
  })

  it('un lien externe : card = null (il reste un lien ordinaire)', async () => {
    world({ eventPublic: true, members: [] })
    const res = await resolve('https://wikipedia.org/wiki/Nodyx')
    expect(res.json()).toEqual({ card: null })
  })

  it('un sujet : titre, catégorie, auteur, RÉPONSES (sans le 1er message), lien canonique', async () => {
    world({ eventPublic: true, members: [] })
    const res = await resolve(`/forum/n-importe/${T}`)
    expect(res.json().card).toEqual({
      type: 'thread', url: '/forum/general/soiree-jeux-ab12', title: 'Soirée jeux', category: 'Général',
      author: { username: 'lea', avatar: '/uploads/avatars/lea.webp' }, replies: 3,
      created_at: '2026-11-01T10:00:00.000Z', last_activity_at: '2026-11-04T08:30:00.000Z', is_locked: false,
      tags: ['inscriptions', 'tournoi'],
    })
    expect(res.headers['cache-control']).toBe('private, no-store')
  })

  it('une réponse précise : extrait en texte brut, lien vers la réponse', async () => {
    world({ eventPublic: true, members: [] })
    const res = await resolve(`/forum/general/soiree-jeux-ab12#post-${P}`)
    expect(res.json().card).toMatchObject({
      type: 'post', url: `/forum/general/soiree-jeux-ab12#post-${P}`, excerpt: 'Je viens avec des chips',
      thread: { title: 'Soirée jeux', url: '/forum/general/soiree-jeux-ab12' }, author: { username: 'max' },
    })
  })

  it('une réponse qui n’appartient PAS à ce sujet : indisponible (pas de mélange de sujets)', async () => {
    world({ eventPublic: true, members: [] })
    // Le sujet T2 EXISTE (sa carte seule sort bien) ; la réponse P est dans T, pas dans T2.
    expect((await resolve(`/forum/general/${T2}`)).json().card).toMatchObject({ type: 'thread', title: 'Autre sujet' })
    const res = await resolve(`/forum/general/${T2}#post-${P}`)
    expect(res.json().card).toEqual({ type: 'unavailable' })
    expect(res.body).not.toContain('chips')
  })

  it('un événement public, sans compte : la carte, sans « je participe »', async () => {
    world({ eventPublic: true, members: [] })
    const res = await resolve(`/calendar/${E}`)
    expect(res.json().card).toMatchObject({ type: 'event', title: 'Réunion de l’équipe', going_count: 3, my_rsvp: null })
  })

  it('un événement PRIVÉ, sans compte : « indisponible », EXACTEMENT comme un événement inexistant', async () => {
    world({ eventPublic: false, members: ['lea-id'] })
    const prive = await resolve(`/calendar/${E}`)
    const inexistant = await resolve('/calendar/44444444-4444-4444-8444-444444444444')
    expect(prive.json()).toEqual({ card: { type: 'unavailable' } })
    expect(prive.body).toBe(inexistant.body)
    expect(prive.statusCode).toBe(inexistant.statusCode)
    expect(prive.body).not.toContain('Réunion')
  })

  it('un événement PRIVÉ, compte non membre : indisponible', async () => {
    world({ eventPublic: false, members: ['lea-id'] })
    const res = await resolve(`/calendar/${E}`, 'etranger')
    expect(res.json().card).toEqual({ type: 'unavailable' })
  })

  it('un événement PRIVÉ, membre : la carte, avec son « je participe »', async () => {
    world({ eventPublic: false, members: ['lea-id'] })
    const res = await resolve(`/calendar/${E}`, 'lea-id')
    expect(res.json().card).toMatchObject({ type: 'event', title: 'Réunion de l’équipe', my_rsvp: 'going' })
  })

  it('aucune donnée interne ne sort : ni communauté, ni visibilité, ni identifiant d’auteur', async () => {
    world({ eventPublic: true, members: [] })
    for (const url of [`/calendar/${E}`, `/forum/general/${T}`, `/forum/general/${T}#post-${P}`]) {
      const body = (await resolve(url, 'lea-id')).body
      expect(body).not.toContain('community_id')
      expect(body).not.toContain('is_public')
      expect(body).not.toContain('author_id')
      expect(body).not.toContain('lea-id')
    }
  })
})

describe('Carte enrichie (affichage dans le chat et le forum)', () => {
  it('un sujet sans tag ni réponse : tags vides, dernière activité = sa création', async () => {
    world({ eventPublic: true, members: [] })
    const card = (await resolve(`/forum/general/${T2}`)).json().card
    expect(card.tags).toEqual([])
    expect(card.last_activity_at).toBe('2026-11-03T10:00:00.000Z')
  })

  it('un événement : trois inscrits au plus, pseudo et avatar SEULEMENT', async () => {
    world({ eventPublic: true, members: [] })
    const res = await resolve(`/calendar/${E}`)
    expect(res.json().card.going_preview).toEqual([
      { username: 'lea', avatar: '/uploads/avatars/lea.webp' }, { username: 'max', avatar: null },
    ])
    const sql = vi.mocked(db.query).mock.calls.map(c => String(c[0])).find(q => q.includes('FROM event_rsvps r JOIN users u'))!
    expect(sql).toContain('LIMIT 3')
    // Colonnes LUES (avant FROM) : pseudo et avatar, rien d'autre
    expect(sql.split('FROM')[0].replace(/\s+/g, ' ').trim()).toBe('SELECT u.username, u.avatar')
  })

  it('un événement complet : is_full, pour que la carte ne propose pas « Je participe » en vain', async () => {
    world({ eventPublic: true, members: [], max: 3 })
    expect((await resolve(`/calendar/${E}`)).json().card.is_full).toBe(true)
    world({ eventPublic: true, members: [], max: 10 })
    expect((await resolve(`/calendar/${E}`)).json().card.is_full).toBe(false)
  })

  it('un événement PRIVÉ refusé : la liste des inscrits n’est même pas lue', async () => {
    world({ eventPublic: false, members: ['lea-id'] })
    const res = await resolve(`/calendar/${E}`, 'etranger')
    expect(res.json().card).toEqual({ type: 'unavailable' })
    expect(vi.mocked(db.query).mock.calls.some(c => String(c[0]).includes('FROM event_rsvps r JOIN users u'))).toBe(false)
  })
})
