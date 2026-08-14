import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './helpers/buildApp'

vi.mock('../middleware/rateLimit', () => ({ rateLimit: vi.fn(async () => {}) }))

let app: FastifyInstance
let cwd: string
const ORIGIN = 'https://instance.example'

beforeAll(async () => {
  cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'nodyx-frame-'))
  const dir = path.join(cwd, 'uploads', 'extensions', 'demo-ext', '1.0.0')
  await fs.mkdir(path.join(dir, 'ui'), { recursive: true })
  await fs.writeFile(path.join(dir, 'ui', 'widget.js'), 'export function mount() {}')
  await fs.writeFile(path.join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>')
  await fs.writeFile(path.join(cwd, 'secret.txt'), 'ceci ne doit jamais sortir')

  vi.spyOn(process, 'cwd').mockReturnValue(cwd)
  process.env.FRONTEND_URL = ORIGIN

  const { extensionFrameRoutes } = await import('../routes/extensionFrame')
  app = await buildApp(async (a) => { await a.register(extensionFrameRoutes, { prefix: '/api/v1' }) })
})

afterAll(async () => {
  await app?.close()
  await fs.rm(cwd, { recursive: true, force: true })
})

const frame = (q = '') => app.inject({ method: 'GET', url: `/api/v1/extensions/demo-ext/1.0.0/frame${q}` })
const asset = (p: string) => app.inject({ method: 'GET', url: `/api/v1/extensions/demo-ext/1.0.0/assets/${p}` })

describe('document de frame', () => {
  it('sert un document HTML avec une politique stricte', async () => {
    const r = await frame()
    expect(r.statusCode).toBe(200)
    const csp = r.headers['content-security-policy'] as string
    expect(csp).toContain("default-src 'none'")
    expect(csp).toContain("frame-src 'none'")
    expect(csp).toContain(`connect-src ${ORIGIN}`)
    expect(csp).toContain(`form-action 'none'`)
  })

  it('pose la politique DEUX FOIS, en en-tête et en balise', async () => {
    // Le proxy de production remplace l'en-tête. Sans la balise, la frame
    // hériterait d'une politique permissive et le réseau sortant direct
    // redeviendrait possible.
    const r = await frame()
    const header = r.headers['content-security-policy'] as string
    const meta   = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(r.body)
    expect(meta).not.toBeNull()
    expect(meta![1]).toBe(header)
  })

  it('écrit l origine en clair, jamais self', async () => {
    // Dans une origine opaque, 'self' ne correspond à rien.
    const csp = (await frame()).headers['content-security-policy'] as string
    expect(csp).not.toContain("'self'")
    expect(csp).toContain(ORIGIN)
  })

  it('n autorise pas unsafe-inline pour les scripts ni les styles', async () => {
    const csp = (await frame()).headers['content-security-policy'] as string
    expect(/script-src[^;]*unsafe-inline/.test(csp)).toBe(false)
    expect(/style-src '[^;]*unsafe-inline/.test(csp)).toBe(false)
    expect(csp).toContain("style-src-attr 'unsafe-inline'")   // borné aux attributs, délibéré
  })

  it('utilise un nonce neuf à chaque requête', async () => {
    const [a, b] = await Promise.all([frame(), frame()])
    const nonceOf = (r: { headers: Record<string, unknown> }) =>
      /nonce-([^' ]+)/.exec(r.headers['content-security-policy'] as string)![1]
    expect(nonceOf(a)).not.toBe(nonceOf(b))
  })

  it('durcit la réponse et ne la met pas en cache', async () => {
    const r = await frame()
    expect(r.headers['x-content-type-options']).toBe('nosniff')
    expect(r.headers['referrer-policy']).toBe('no-referrer')
    expect(r.headers['cross-origin-resource-policy']).toBe('same-origin')
    expect(r.headers['cache-control']).toBe('no-store')
  })

  it('accepte une surface bien formée et refuse le reste', async () => {
    expect((await frame('?surface=page')).statusCode).toBe(200)
    expect((await frame('?surface=widget:tonight')).statusCode).toBe(200)
    expect((await frame('?surface=../../evil')).statusCode).toBe(400)
  })

  it('refuse une référence d extension ou de version mal formée', async () => {
    expect((await app.inject({ url: '/api/v1/extensions/Demo/1.0.0/frame' })).statusCode).toBe(400)
    expect((await app.inject({ url: '/api/v1/extensions/demo-ext/latest/frame' })).statusCode).toBe(400)
  })
})

describe('assets', () => {
  it('sert un fichier de la version demandée', async () => {
    const r = await asset('ui/widget.js')
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toContain('application/javascript')
    expect(r.body).toContain('mount')
  })

  it('met en cache immuablement, la version étant dans le chemin', async () => {
    expect((await asset('ui/widget.js')).headers['cache-control']).toContain('immutable')
  })

  it('sert un SVG inerte, parce qu il s affiche hors du bac à sable', async () => {
    const r = await asset('icon.svg')
    expect(r.statusCode).toBe(200)
    expect(r.headers['content-type']).toBe('image/svg+xml')
    expect(r.headers['content-security-policy']).toContain("default-src 'none'")
    expect(r.headers['x-content-type-options']).toBe('nosniff')
  })

  it.each([
    '../../../secret.txt',
    '../../secret.txt',
    '..%2f..%2fsecret.txt',
    '/etc/passwd',
  ])('ne sort jamais du dossier de version : %s', async (p) => {
    const r = await asset(p)
    expect(r.statusCode).not.toBe(200)
    expect(r.body).not.toContain('ne doit jamais sortir')
  })

  it('refuse un type de fichier non servi', async () => {
    const r = await asset('notes.txt')
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('ASSET_TYPE_REFUSED')
  })

  it('rend 404 pour un fichier absent, sans divulguer le chemin', async () => {
    const r = await asset('ui/absent.js')
    expect(r.statusCode).toBe(404)
    expect(r.body).not.toContain(cwd)
  })

  it('ne sert pas la version voisine', async () => {
    const r = await app.inject({ url: '/api/v1/extensions/demo-ext/9.9.9/assets/ui/widget.js' })
    expect(r.statusCode).toBe(404)
  })
})
