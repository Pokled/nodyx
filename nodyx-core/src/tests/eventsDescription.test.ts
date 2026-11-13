/**
 * La description d'un événement passe par le MÊME nettoyeur que le forum
 * (utils/sanitize) et la même recopie des images externes. Avant, une liste
 * locale laissait une image d'un autre site en place : chaque lecteur la
 * chargeait chez ce site, qui voyait son adresse IP.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get:    vi.fn(),
    setex:  vi.fn().mockResolvedValue('OK'),
    exists: vi.fn(),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl:    vi.fn().mockResolvedValue(60),
    set:    vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
  },
}))
vi.mock('../socket/io', () => ({ io: { emit: vi.fn() } }))
vi.mock('../services/webhooks/announce', () => ({ announceCalendarEvent: vi.fn() }))
// La recopie réelle télécharge l'image : on la remplace par ce qu'elle produit
// quand elle réussit (une adresse /uploads/), pour tester le câblage, pas le réseau.
vi.mock('../services/inlineImageRehost', () => ({
  rehostExternalImages: vi.fn(async (html: string) => ({
    html: html.replace('https://pisteur.example/pixel.png', '/uploads/inline_images/abc.png'),
    rehosted: 1, failed: [], skipped: 0,
  })),
}))

import { db, redis } from '../config/database'
import { rehostExternalImages } from '../services/inlineImageRehost'
import eventRoutes from '../routes/events'

const TOKEN = jwt.sign({ userId: 'author-uuid', username: 'auteur' }, process.env.JWT_SECRET!, { expiresIn: '1h' })
const AUTH  = { Authorization: `Bearer ${TOKEN}` }

const BASE = {
  title: 'Soirée jeux', starts_at: '2026-12-01T19:00:00.000Z',
}

/** Renvoie la description réellement écrite en base par l'INSERT ou l'UPDATE. */
function captureWrites() {
  const writes: unknown[][] = []
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('FROM community_members WHERE user_id')) return { rows: [{ community_id: 'c1' }] } as any
    if (s.includes('SELECT e.author_id'))                    return { rows: [{ author_id: 'author-uuid', community_id: 'c1' }] } as any
    if (s.includes('INSERT INTO events') || s.includes('UPDATE events')) {
      writes.push(params)
      return { rows: [{ id: 'ev1' }] } as any
    }
    return { rows: [] } as any
  })
  return writes
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
})

describe('Description d’un événement : le nettoyeur partagé', () => {
  it('création : l’image d’un autre site est recopiée chez nous, jamais laissée en place', async () => {
    const writes = captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'POST', url: '/', headers: AUTH, payload: {
      ...BASE, description: '<p>Venez !</p><img src="https://pisteur.example/pixel.png">',
    } })
    expect(res.statusCode).toBe(201)
    expect(rehostExternalImages).toHaveBeenCalledOnce()
    const desc = String(writes[0][3])
    expect(desc).toContain('/uploads/inline_images/abc.png')
    expect(desc).not.toContain('pisteur.example')
  })

  it('une image externe que la recopie n’a pas pu prendre est retirée (aucune requête vers ce site)', async () => {
    vi.mocked(rehostExternalImages).mockResolvedValueOnce({
      html: '<p>Hop</p><img src="https://injoignable.example/x.png">', rehosted: 0, failed: [{ src: 'x', reason: 'timeout' }], skipped: 0,
    } as any)
    const writes = captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    await app.inject({ method: 'POST', url: '/', headers: AUTH, payload: {
      ...BASE, description: '<p>Hop</p><img src="https://injoignable.example/x.png">',
    } })
    expect(String(writes[0][3])).not.toContain('injoignable.example')
  })

  it('modification : même traitement, et un lien vers un domaine bloqué est retiré', async () => {
    const writes = captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'PATCH', url: '/ev1', headers: AUTH, payload: {
      description: '<p>Infos <a href="https://pornhub.com/x">ici</a></p><img src="https://pisteur.example/pixel.png">',
    } })
    expect(res.statusCode).toBe(200)
    const desc = String(writes[0][0])
    expect(desc).not.toContain('pornhub.com')
    expect(desc).not.toContain('pisteur.example')
    expect(desc).toContain('/uploads/inline_images/abc.png')
  })

  it('une vidéo hors des lecteurs officiels est retirée', async () => {
    const writes = captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    await app.inject({ method: 'POST', url: '/', headers: AUTH, payload: {
      ...BASE, description: '<p>a</p><iframe src="https://piege.example/embed"></iframe>',
    } })
    expect(String(writes[0][3])).not.toContain('piege.example')
  })

  it('le contenu honnête de l’éditeur passe intact : colonnes, tableau, titre ancré, audio, vidéo YouTube', async () => {
    const honest =
      '<h2 id="programme">Programme</h2>' +
      '<div class="nodyx-two-cols" data-type="two-cols"><div class="nodyx-col"><p>gauche</p></div><div class="nodyx-col"><p>droite</p></div></div>' +
      '<table><tbody><tr><td colspan="2">x</td></tr></tbody></table>' +
      '<nodyx-audio-player src="/uploads/audio/a.mp3" track-title="Intro" artist="Léa"></nodyx-audio-player>' +
      '<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>'
    const writes = captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    await app.inject({ method: 'POST', url: '/', headers: AUTH, payload: { ...BASE, description: honest } })
    expect(String(writes[0][3])).toBe(honest)
  })
})

describe('Image de couverture : seulement un fichier de l’instance', () => {
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://communaute.example'
    delete process.env.SELF_URL
    delete process.env.PUBLIC_API_URL
  })

  it.each([
    ['/uploads/assets/abc.webp'],
    ['https://communaute.example/uploads/assets/abc.webp'],
  ])('acceptée : %s', async (cover) => {
    const writes = captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'POST', url: '/', headers: AUTH, payload: { ...BASE, cover_url: cover } })
    expect(res.statusCode).toBe(201)
    expect(writes[0][11]).toBe(cover)
  })

  it.each([
    ['https://pisteur.example/uploads/assets/abc.webp', 'autre site, même chemin'],
    ['https://pisteur.example/pixel.png',               'autre site'],
    ['https://communaute.example/autre/abc.webp',       'hors de /uploads'],
    ['https://communaute.example/uploads/../.env',      'remontée de dossier'],
    ['https://x@communaute.example/uploads/a.webp',     'identifiants dans l’adresse'],
    ['/uploads/../secret',                              'remontée relative'],
    ['javascript:alert(1)',                             'pseudo-protocole'],
  ])('refusée : %s (%s), avec un code stable et sans rien écrire', async (cover) => {
    const writes = captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'POST', url: '/', headers: AUTH, payload: { ...BASE, cover_url: cover } })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('COVER_URL_INVALID')
    expect(writes).toHaveLength(0)
    expect(rehostExternalImages).not.toHaveBeenCalled()
  })

  it('API sur un autre domaine : son origine est reconnue quand PUBLIC_API_URL est posée', async () => {
    process.env.PUBLIC_API_URL = 'https://api.communaute.example'
    captureWrites()
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'POST', url: '/', headers: AUTH, payload: { ...BASE, cover_url: 'https://api.communaute.example/uploads/assets/abc.webp' } })
    expect(res.statusCode).toBe(201)
  })

  it('modification : une ANCIENNE couverture qu’on ne touche pas reste acceptée (vieil événement modifiable)', async () => {
    const legacy = 'https://ancien-domaine.example/uploads/assets/abc.webp'
    const writes = captureWrites()
    const base = vi.mocked(db.query).getMockImplementation()!
    vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) =>
      String(sql).includes('SELECT cover_url FROM events') ? { rows: [{ cover_url: legacy }] } as any : base(sql, params))
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'PATCH', url: '/ev1', headers: AUTH, payload: { title: 'Nouveau titre', cover_url: legacy } })
    expect(res.statusCode).toBe(200)
    expect(writes).toHaveLength(1)
  })

  it('modification : une NOUVELLE couverture d’un autre site est refusée, avant toute recopie d’image', async () => {
    const writes = captureWrites()
    const base = vi.mocked(db.query).getMockImplementation()!
    vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) =>
      String(sql).includes('SELECT cover_url FROM events') ? { rows: [{ cover_url: '/uploads/assets/old.webp' }] } as any : base(sql, params))
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'PATCH', url: '/ev1', headers: AUTH, payload: {
      description: '<img src="https://pisteur.example/pixel.png">', cover_url: 'https://pisteur.example/c.png' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('COVER_URL_INVALID')
    expect(writes).toHaveLength(0)
    expect(rehostExternalImages).not.toHaveBeenCalled()
  })
})
