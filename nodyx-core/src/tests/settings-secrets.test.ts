// ─── Spec 017 Phase 2 — secrets chiffrés ──────────────────────────────────────
// Garantit : chiffrement/déchiffrement correct, aucune fuite de secret en clair
// (ni en DB, ni en audit, ni vers le client), retrait propre, et déchiffrement
// au boot.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { dbQueryMock } = vi.hoisted(() => ({ dbQueryMock: vi.fn() }))
vi.mock('../config/database', () => ({ db: { query: dbQueryMock }, redis: {} }))

import { encryptSecret, decryptSecret } from '../config/settingsCrypto'
import { setSettings, loadSettingsIntoEnv, getEffectiveSettings } from '../config/settings'

const TOUCHED = ['SMTP_PASS', 'TWITCH_CLIENT_SECRET', 'SMTP_HOST', 'STREAMER_OAUTH_KEY']

beforeEach(() => {
  vi.resetAllMocks()
  dbQueryMock.mockResolvedValue({ rows: [] })
  process.env.JWT_SECRET = 'test-jwt-secret-for-settings-crypto'
  delete process.env.SETTINGS_SECRET_KEY
  for (const k of TOUCHED) delete process.env[k]
})
afterEach(() => { for (const k of TOUCHED) delete process.env[k] })

describe('settingsCrypto', () => {
  it('chiffre puis déchiffre (roundtrip)', () => {
    const blob = encryptSecret('mon-mot-de-passe-smtp')
    expect(decryptSecret(blob)).toBe('mon-mot-de-passe-smtp')
  })

  it('refuse de déchiffrer si le tag est altéré', () => {
    const blob = encryptSecret('secret')
    blob.tag[0] ^= 0xff
    expect(() => decryptSecret(blob)).toThrow()
  })

  it('refuse de déchiffrer avec une autre clé maître', () => {
    const blob = encryptSecret('secret')
    process.env.JWT_SECRET = 'une-tout-autre-cle'
    expect(() => decryptSecret(blob)).toThrow()
  })
})

describe('setSettings — secrets', () => {
  it('chiffre le secret, l’applique à process.env, et ne fuite jamais le clair', async () => {
    const r = await setSettings({ SMTP_PASS: 'super-secret-123' }, 'actor-1')
    expect(r.ok).toBe(true)
    expect(process.env.SMTP_PASS).toBe('super-secret-123')

    const allCalls = JSON.stringify(dbQueryMock.mock.calls)
    // Le clair ne doit apparaître NULLE PART (ni INSERT value_enc, ni audit).
    expect(allCalls).not.toContain('super-secret-123')
    // L'INSERT secret passe bien par les colonnes chiffrées.
    const sqls = dbQueryMock.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('value_enc') && s.includes('is_secret'))).toBe(true)
  })

  it('valide le format de STREAMER_OAUTH_KEY (64 hex)', async () => {
    const bad = await setSettings({ STREAMER_OAUTH_KEY: 'trop-court' }, 'actor-1')
    expect(bad.ok).toBe(false)
    expect(bad.errors.STREAMER_OAUTH_KEY).toBeDefined()

    const good = await setSettings({ STREAMER_OAUTH_KEY: 'a'.repeat(64) }, 'actor-1')
    expect(good.ok).toBe(true)
    expect(process.env.STREAMER_OAUTH_KEY).toBe('a'.repeat(64))
  })

  it('retire le secret quand on envoie une valeur vide', async () => {
    process.env.SMTP_PASS = 'ancien'
    const r = await setSettings({ SMTP_PASS: '' }, 'actor-1')
    expect(r.ok).toBe(true)
    expect(process.env.SMTP_PASS).toBeUndefined()
    const sqls = dbQueryMock.mock.calls.map(c => String(c[0]))
    expect(sqls.some(s => s.includes('DELETE FROM instance_settings'))).toBe(true)
  })
})

describe('loadSettingsIntoEnv — secrets', () => {
  it('déchiffre une row secret et l’injecte dans process.env', async () => {
    const blob = encryptSecret('twitch-secret-xyz')
    dbQueryMock.mockResolvedValueOnce({ rows: [{
      key: 'TWITCH_CLIENT_SECRET', value: null,
      value_enc: blob.ciphertext, salt: blob.salt, iv: blob.iv, tag: blob.tag,
      is_secret: true,
    }] })
    await loadSettingsIntoEnv()
    expect(process.env.TWITCH_CLIENT_SECRET).toBe('twitch-secret-xyz')
  })

  it('ne casse pas le boot si un secret est indéchiffrable', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{
      key: 'TWITCH_CLIENT_SECRET', value: null,
      value_enc: Buffer.from('garbage'), salt: Buffer.alloc(16), iv: Buffer.alloc(12), tag: Buffer.alloc(16),
      is_secret: true,
    }] })
    await expect(loadSettingsIntoEnv()).resolves.toBeUndefined()
    expect(process.env.TWITCH_CLIENT_SECRET).toBeUndefined()
  })
})

describe('getEffectiveSettings — secrets', () => {
  it('ne renvoie jamais la valeur d’un secret, seulement isSet', () => {
    process.env.SMTP_PASS = 'devrait-rester-cache'
    const list = getEffectiveSettings()
    const pass = list.find(s => s.key === 'SMTP_PASS')
    expect(pass?.secret).toBe(true)
    expect(pass?.value).toBeUndefined()
    expect(pass?.isSet).toBe(true)
    expect(JSON.stringify(list)).not.toContain('devrait-rester-cache')
  })
})
