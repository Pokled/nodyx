// Vignettes (services/thumbnails.ts) : la bonne taille, jamais plus, jamais ailleurs.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

const dir = mkdtempSync(path.join(os.tmpdir(), 'thumbs-'))
const cwd = process.cwd()
let T: typeof import('../services/thumbnails')

beforeAll(async () => {
  process.chdir(dir)
  mkdirSync('uploads/posts', { recursive: true })
  writeFileSync('uploads/posts/big.png', await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#c03' } }).png().toBuffer())
  writeFileSync('uploads/posts/small.png', await sharp({ create: { width: 100, height: 80, channels: 3, background: '#03c' } }).png().toBuffer())
  // GIF animé de 3 images
  const frames = await Promise.all(['#f00', '#0f0', '#00f'].map(c => sharp({ create: { width: 300, height: 200, channels: 3, background: c } }).png().toBuffer()))
  const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer()
  writeFileSync('uploads/posts/anim.gif', gif)
  writeFileSync('uploads/posts/notes.txt', 'hello')
  T = await import('../services/thumbnails')
})
afterAll(() => { process.chdir(cwd); rmSync(dir, { recursive: true, force: true }) })

describe('parseThumb : ce qu’on accepte de fabriquer', () => {
  it('une largeur de la liste, un chemin d’image dans le dossier', () => {
    expect(T.parseThumb('256', 'posts/big.png')).toEqual({ width: 256, still: false, rel: 'posts/big.png' })
    expect(T.parseThumb('512s', 'banners/x.gif')).toEqual({ width: 512, still: true, rel: 'banners/x.gif' })
  })
  it('refuse une largeur hors liste (sinon on remplirait le disque)', () => {
    for (const w of ['257', '0', '99999', 'abc', '256x']) expect(T.parseThumb(w, 'posts/big.png')).toBeNull()
  })
  it('refuse les chemins piégés et ce qui n’est pas une image', () => {
    for (const p of ['../../.env.png', 'posts/../../x.png', 'posts/%2e%2e/x.png', 'posts\\x.png', 'posts/notes.txt', '_thumbs/256/posts/big.webp', '', 'posts/x.svg'])
      expect([p, T.parseThumb('256', p)]).toEqual([p, null])
  })
})

describe('ensureThumb : la vignette', () => {
  it('2400 px demandée en 256 : un WebP de 256 px de large', async () => {
    const f = await T.ensureThumb(T.parseThumb('256', 'posts/big.png')!)
    const m = await sharp(f!).metadata()
    expect([m.format, m.width, m.height]).toEqual(['webp', 256, 171])
  })
  it('jamais agrandie : une image de 100 px reste à 100 px', async () => {
    const m = await sharp((await T.ensureThumb(T.parseThumb('1024', 'posts/small.png')!))!).metadata()
    expect(m.width).toBe(100)
  })
  it('un GIF animé reste animé ; en « s » il est figé (une seule image)', async () => {
    const anim = await sharp((await T.ensureThumb(T.parseThumb('128', 'posts/anim.gif')!))!, { animated: true }).metadata()
    const still = await sharp((await T.ensureThumb(T.parseThumb('128s', 'posts/anim.gif')!))!, { animated: true }).metadata()
    expect(anim.pages).toBe(3)
    expect(still.pages ?? 1).toBe(1)
  })
  it('un original absent : rien n’est fabriqué', async () => {
    expect(await T.ensureThumb(T.parseThumb('256', 'posts/absent.png')!)).toBeNull()
  })
  it('gardée sur le disque et réutilisée ; deux demandes simultanées, une seule fabrication', async () => {
    const t = T.parseThumb('384', 'posts/big.png')!
    const [a, b] = await Promise.all([T.ensureThumb(t), T.ensureThumb(t)])
    expect(a).toBe(b)
    expect(existsSync(a!)).toBe(true)
    expect(a).toContain(path.join('_thumbs', '384', 'posts', 'big.webp'))
  })
})
