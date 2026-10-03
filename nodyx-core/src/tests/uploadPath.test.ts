/**
 * Régression : remontée de dossier via un chemin /uploads/ (03/10).
 * `/uploads/../../.env` passait les validateurs, qui ne regardaient que le
 * début du chemin ; le frontend le joignait ensuite au dossier des uploads
 * et lisait le .env du core pour la carte de profil.
 */
import { describe, it, expect } from 'vitest'
import { isContainedUploadPath } from '../utils/uploadPath'
import { sanitize } from '../utils/sanitize'

const ESCAPES = [
  '/uploads/../.env',
  '/uploads/../../../../dev/zero',
  '/uploads/avatars/../../.env',
  '/uploads/./../.env',
  '/uploads/%2e%2e/.env',
  '/uploads/%2E%2E/%2E%2E/.env',
  '/uploads/..\\..\\.env',
  '/uploads//etc/passwd',
  '/uploads/',
  '/uploads/a\0.png',
]

describe('isContainedUploadPath', () => {
  it('accepte les vrais chemins de fichiers téléversés', () => {
    for (const ok of [
      '/uploads/avatars/0b7c6a1e-2f3d-4c5b-9a8e-1f2d3c4b5a6e.png',
      '/uploads/banners/x.webp',
      '/uploads/inline_images/abc_def-1.jpg',
      '/uploads/fonts/my.font.woff2',
      '/uploads/posts/a.png?v=3',
    ]) expect(isContainedUploadPath(ok), ok).toBe(true)
  })

  it('refuse toute forme de remontée de dossier', () => {
    for (const bad of ESCAPES) expect(isContainedUploadPath(bad), bad).toBe(false)
  })

  it('refuse ce qui n’est pas un chemin /uploads/', () => {
    for (const bad of ['/icons/a.png', 'uploads/a.png', '/Uploads/a.png', 'https://x.org/uploads/a.png', ''])
      expect(isContainedUploadPath(bad), bad).toBe(false)
  })
})

describe('sanitizeContent : les <img> /uploads/ qui remontent sont retirés', () => {
  it('garde une vraie image téléversée, retire la remontée', () => {
    const out = sanitize('<p><img src="/uploads/posts/a.png"><img src="/uploads/../api/v1/auth/logout"></p>')
    expect(out).toContain('/uploads/posts/a.png')
    expect(out).not.toContain('..')
  })
})
