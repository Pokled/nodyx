// ─── Le fil d'Ariane n'affiche jamais un nom de dossier brut ──────────────────
//
// Avant : une page absente de la liste affichait son dossier avec une majuscule
// (« Auth » sur la page de connexion, « Canvas », « Whisper »…), jamais traduit.

import { describe, it, expect } from 'vitest'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { filAriane } from './filAriane'

const tFn = (cle: string) => `«${cle}»`
const libelles = (chemin: string, extra = {}) => filAriane(chemin, { tFn, ...extra }).map((m) => m.label)

// Dossiers qui n'ont pas la barre du haut (pages pour OBS, téléphone, fichiers).
const SANS_BARRE = new Set(['overlay', 'deck', 'rss.xml', 'sitemap.xml'])

describe("fil d'Ariane", () => {
  it('traduit la page de connexion au lieu d’afficher « Auth »', () => {
    expect(libelles('/auth/login')).toEqual(['«auth.login.title»'])
    expect(libelles('/auth/register')).toEqual(['«auth.register.title»'])
    expect(libelles('/auth/forgot-password')).toEqual(['«auth.forgot_password.title»'])
  })

  it('nomme le tableau blanc par sa traduction', () => {
    expect(libelles('/canvas')).toEqual(['«nav.canvas»'])
    expect(libelles('/canvas/abc')).toEqual(['«nav.canvas»'])
  })

  it("aucun dossier de page n'affiche son nom brut", () => {
    const routes = join(__dirname, '..', 'routes')
    const dossiers = readdirSync(routes).filter((n) => !n.startsWith('+') && !n.startsWith('(') && statSync(join(routes, n)).isDirectory())
    expect(dossiers.length).toBeGreaterThan(20)
    for (const d of dossiers) {
      if (SANS_BARRE.has(d)) continue
      for (const label of libelles(`/${d}`)) {
        expect(label, `/${d}`).not.toBe(d.charAt(0).toUpperCase() + d.slice(1))
        expect(label.startsWith('«') || d === 'users', `/${d} → ${label}`).toBe(true)
      }
    }
  })

  it('ne confond pas un préfixe avec un autre mot (/authors n’est pas /auth)', () => {
    expect(libelles('/authors')).toEqual([])
  })

  it('garde le forum, ses catégories et le salon du chat', () => {
    expect(libelles('/forum/x', { data: { category: { name: '📢 Annonces', slug: 'annonces' }, thread: { title: 'Bienvenue' } } }))
      .toEqual(['«nav.forum»', 'Annonces', 'Bienvenue'])
    expect(libelles('/chat', { canal: 'c1', salons: [{ id: 'c1', name: 'Entraide', type: 'voice' }] }))
      .toEqual(['«nav.chat»', '🔊 Entraide'])
  })

  it("affiche le nom d'utilisateur sur un profil, et rien sur l'accueil", () => {
    expect(libelles('/users/Pokled')).toEqual(['Pokled'])
    expect(libelles('/')).toEqual([])
  })
})
