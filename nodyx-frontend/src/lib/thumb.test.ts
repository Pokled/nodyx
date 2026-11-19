import { describe, it, expect, vi } from 'vitest'
// Avant l'import de thumb : l'instance testée est nodyx.org
vi.hoisted(() => { process.env.PUBLIC_API_URL = 'https://nodyx.org' })
import { thumb, thumbSrcset, originalOf } from './thumb'

describe('thumb', () => {
  it('une image de l’instance : la plus petite largeur qui couvre l’affichage', () => {
    expect(thumb('/uploads/posts/a.webp', 288)).toBe('/uploads/_w/384/posts/a.webp')
    expect(thumb('/uploads/logos/l.png', 40)).toBe('/uploads/_w/64/logos/l.png')
    expect(thumb('/uploads/posts/a.webp', 5000)).toBe('/uploads/_w/1536/posts/a.webp')
  })
  it('figée pour le papier peint', () => {
    expect(thumb('/uploads/banners/b.gif', 700, { still: true })).toBe('/uploads/_w/768s/banners/b.gif')
  })
  it('une image d’ailleurs, une vignette, un chemin piégé ou rien : inchangés', () => {
    for (const u of ['https://exemple.org/x.png', '/uploads/_w/256/posts/a.webp', '/uploads/posts/../../x.png', '/uploads/posts/a.svg', '/static/x.png'])
      expect(thumb(u, 100)).toBe(u)
    expect(thumb(null, 100)).toBe('')
  })
})

describe('thumb : adresse complète', () => {
  it('une image de l’instance enregistrée en adresse complète est réduite aussi (les avatars de profil)', () => {
    expect(thumb('https://nodyx.org/uploads/avatars/u.png', 34)).toBe('/uploads/_w/64/avatars/u.png')
  })
  it('un autre domaine, même ressemblant, reste tel quel', () => {
    for (const u of ['https://nodyx.org.ailleurs.com/uploads/avatars/u.png', 'https://nexusnode.app/uploads/avatars/u.png', 'http://nodyx.org/uploads/avatars/u.png', 'https://nodyx.org/uploads/avatars/../../x.png'])
      expect(thumb(u, 34)).toBe(u)
  })
})

describe('thumbSrcset', () => {
  it('1x et 2x', () => {
    expect(thumbSrcset('/uploads/posts/a.webp', 288)).toBe('/uploads/_w/384/posts/a.webp 1x, /uploads/_w/768/posts/a.webp 2x')
  })
  it('rien pour une image d’ailleurs', () => {
    expect(thumbSrcset('https://exemple.org/x.png', 288)).toBeUndefined()
  })
})

describe('originalOf', () => {
  it('retrouve l’original d’une vignette, rien d’autre', () => {
    expect(originalOf('/uploads/_w/384/posts/a.webp')).toBe('/uploads/posts/a.webp')
    expect(originalOf('/uploads/_w/768s/banners/b.gif')).toBe('/uploads/banners/b.gif')
    expect(originalOf('/uploads/posts/a.webp')).toBeNull()
    expect(originalOf('/uploads/_w/384/../../x.png')).toBeNull()
  })
})
