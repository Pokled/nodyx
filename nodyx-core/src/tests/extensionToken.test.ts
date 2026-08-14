import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import {
  mintExtensionToken, verifyExtensionToken, deriveExtensionSecret, tokenGrants,
  type MintInput, type ExpectedAudience,
} from '../extensions/token'

const SECRET = 'secret-applicatif-de-test'

const MINT: MintInput = {
  issuer:      'https://instance.example',
  instanceId:  'inst-1',
  extensionId: 'library',
  surface:     'page',
  userId:      'user-42',
  permissions: ['storage.user', 'identity'],
  jti:         'jti-1',
}

const EXPECTED: ExpectedAudience = { instanceId: 'inst-1', extensionId: 'library', surface: 'page' }

function ok(token: string, expected = EXPECTED, revoked?: (j: string) => boolean) {
  return verifyExtensionToken(token, expected, SECRET, revoked)
}

describe('aller-retour', () => {
  it('frappe puis vérifie un jeton, en conservant ses claims', () => {
    const r = ok(mintExtensionToken(MINT, SECRET))
    if (!r.ok) throw new Error('refusé à tort : ' + r.code)
    expect(r.claims).toMatchObject({
      iss: 'https://instance.example',
      aud: 'nodyx-extension',
      ins: 'inst-1',
      ext: 'library',
      sur: 'page',
      sub: 'user-42',
      jti: 'jti-1',
    })
    expect(r.claims.exp - r.claims.iat).toBe(600)
  })

  it('accepte un visiteur, sans utilisateur rattaché', () => {
    const r = ok(mintExtensionToken({ ...MINT, userId: null }, SECRET))
    if (!r.ok) throw new Error('refusé à tort')
    expect(r.claims.sub).toBeNull()
  })

  it('porte les permissions ACCORDÉES, triées', () => {
    const r = ok(mintExtensionToken({ ...MINT, permissions: ['identity', 'storage.user', 'core'] }, SECRET))
    if (!r.ok) throw new Error('refusé à tort')
    expect(r.claims.prm).toEqual(['core', 'identity', 'storage.user'])
    expect(tokenGrants(r.claims, 'storage.user')).toBe(true)
    expect(tokenGrants(r.claims, 'storage.instance.write')).toBe(false)
  })
})

describe('rejeu croisé : chaque claim ferme une porte', () => {
  const token = mintExtensionToken(MINT, SECRET)

  it('refuse le rejeu sur une autre instance', () => {
    const r = ok(token, { ...EXPECTED, instanceId: 'inst-2' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_WRONG_INSTANCE')
  })

  it('refuse le rejeu par une autre extension', () => {
    const r = ok(token, { ...EXPECTED, extensionId: 'autre-ext' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_WRONG_EXTENSION')
  })

  it('refuse le rejeu sur une autre surface de la même extension', () => {
    const r = ok(token, { ...EXPECTED, surface: 'widget:tonight' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_WRONG_SURFACE')
  })

  it('refuse un jeton expiré', () => {
    const expired = mintExtensionToken({ ...MINT, ttlSeconds: -10 }, SECRET)
    const r = ok(expired)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('SESSION_EXPIRED')
  })

  it('refuse un jeton révoqué, même valide par ailleurs', () => {
    const r = ok(token, EXPECTED, (j) => j === 'jti-1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_REVOKED')
  })
})

describe('séparation des familles de jetons', () => {
  it('refuse un jeton de session d utilisateur signé avec le secret applicatif', () => {
    // Le cas qui compte : le secret est le même, seule la dérivation diffère.
    const userToken = jwt.sign({ userId: 'user-42' }, SECRET, { algorithm: 'HS256' })
    const r = ok(userToken)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_INVALID')
  })

  it('refuse un jeton d extension présenté avec la bonne forme mais la mauvaise clé', () => {
    const forged = jwt.sign(
      { iss: 'x', aud: 'nodyx-extension', ins: 'inst-1', ext: 'library', sur: 'page', sub: null, prm: ['storage.user'], jti: 'j', iat: 1, exp: 9999999999 },
      SECRET,                                  // secret applicatif brut, pas le dérivé
      { algorithm: 'HS256' },
    )
    const r = ok(forged)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_INVALID')
  })

  it('la clé dérivée n est pas le secret applicatif', () => {
    expect(deriveExtensionSecret(SECRET)).not.toBe(SECRET)
    expect(deriveExtensionSecret(SECRET)).toHaveLength(64)
  })

  it('deux secrets applicatifs donnent deux clés dérivées différentes', () => {
    expect(deriveExtensionSecret('a')).not.toBe(deriveExtensionSecret('b'))
  })
})

describe('formes malveillantes', () => {
  it('refuse un jeton dont la charge a été retouchée', () => {
    const token = mintExtensionToken(MINT, SECRET)
    const [h, p, s] = token.split('.')
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString())
    payload.prm = ['storage.instance.write', 'core']
    const tampered = [h, Buffer.from(JSON.stringify(payload)).toString('base64url'), s].join('.')
    const r = ok(tampered)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_INVALID')
  })

  it('refuse l algorithme none', () => {
    const none = jwt.sign(
      { iss: 'x', aud: 'nodyx-extension', ins: 'inst-1', ext: 'library', sur: 'page', sub: null, prm: [], jti: 'j', exp: 9999999999 },
      '', { algorithm: 'none' },
    )
    const r = ok(none)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_INVALID')
  })

  it.each(['', 'pas-un-jeton', 'a.b.c'])('refuse la chaîne %p', (raw) => {
    expect(ok(raw).ok).toBe(false)
  })

  it('refuse un jeton d extension destiné à une autre audience', () => {
    const other = jwt.sign(
      { aud: 'autre-chose', ins: 'inst-1', ext: 'library', sur: 'page', exp: 9999999999 },
      deriveExtensionSecret(SECRET), { algorithm: 'HS256' },
    )
    const r = ok(other)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOKEN_WRONG_AUDIENCE')
  })
})
