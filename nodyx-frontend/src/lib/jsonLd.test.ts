import { describe, it, expect } from 'vitest'
import { jsonLdScript, absoluteUrl, plainText } from './jsonLd'

describe('jsonLdScript', () => {
  it('un titre piégé ne ferme pas la balise script', () => {
    const out = jsonLdScript({ name: '</script><script>alert(1)</script>' })
    expect(out.match(/<\/script>/g)?.length).toBe(1)
    expect(JSON.parse(out.slice(out.indexOf('>') + 1, out.lastIndexOf('<')))).toEqual({ name: '</script><script>alert(1)</script>' })
  })
})

describe('absoluteUrl', () => {
  it('complète un chemin relatif, garde une adresse complète', () => {
    expect(absoluteUrl('https://a.org', '/uploads/x.png')).toBe('https://a.org/uploads/x.png')
    expect(absoluteUrl('https://a.org', 'uploads/x.png')).toBe('https://a.org/uploads/x.png')
    expect(absoluteUrl('https://a.org', 'https://b.org/y.png')).toBe('https://b.org/y.png')
    expect(absoluteUrl('https://a.org', null)).toBeUndefined()
  })
})

describe('plainText', () => {
  it('retire le HTML et borne la longueur', () => {
    expect(plainText('<p>Salut <b>toi</b></p>')).toBe('Salut toi')
    expect(plainText('a'.repeat(400), 10)).toHaveLength(10)
  })
})
