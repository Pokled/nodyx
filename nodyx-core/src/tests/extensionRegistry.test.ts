import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'crypto'
import {
  registryAllowed, configuredRegistries, findVersion, downloadFromRegistry,
  type FetchLike,
} from '../extensions/registry'

const PAQUET = Buffer.from('contenu du paquet')
const SHA = createHash('sha256').update(PAQUET).digest('hex')

function index(over: Record<string, unknown> = {}) {
  return {
    index: 1,
    extensions: [{
      id: 'next-event',
      versions: [{ version: '1.0.0', sha256: SHA, url: 'https://extensions.nodyx.org/p/next-event-1.0.0.nyx' }],
    }],
    ...over,
  }
}

/** Un reseau simule : l'index, puis le paquet. */
function net(idx: unknown = index(), archive: Buffer = PAQUET, over: { indexStatus?: number; pkgStatus?: number } = {}): FetchLike {
  return (async (url: string) => {
    if (url.endsWith('/index.json')) {
      return { ok: (over.indexStatus ?? 200) < 400, status: over.indexStatus ?? 200, json: async () => idx, arrayBuffer: async () => new ArrayBuffer(0) }
    }
    return {
      ok: (over.pkgStatus ?? 200) < 400, status: over.pkgStatus ?? 200,
      json: async () => ({}),
      arrayBuffer: async () => archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength),
    }
  }) as FetchLike
}

afterEach(() => { delete process.env.NODYX_EXTENSION_REGISTRIES })

describe('le registre doit etre configure sur l instance', () => {
  it('accepte celui par defaut', () => {
    expect(registryAllowed('extensions.nodyx.org')).toBe(true)
    expect(configuredRegistries()).toEqual(['extensions.nodyx.org'])
  })

  it('tolere une forme avec schema ou chemin', () => {
    expect(registryAllowed('https://extensions.nodyx.org')).toBe(true)
    expect(registryAllowed('https://extensions.nodyx.org/e/x')).toBe(true)
  })

  it('REFUSE un registre inconnu', async () => {
    // Sans ce controle, un lien fabrique avec src=<registre_de_l_attaquant>
    // envoye a un owner installerait du code arbitraire en un clic.
    expect(registryAllowed('registre-pirate.example')).toBe(false)
    const r = await downloadFromRegistry('registre-pirate.example', 'next-event', '1.0.0', net())
    expect(r).toMatchObject({ ok: false, code: 'REGISTRY_NOT_ALLOWED' })
  })

  it.each([null, 42, '', 'extensions.nodyx.org.evil.example'])('refuse %p', (raw) => {
    expect(registryAllowed(raw)).toBe(false)
  })

  it('l instance peut declarer les siens', () => {
    process.env.NODYX_EXTENSION_REGISTRIES = 'store.interne.example, extensions.nodyx.org'
    expect(registryAllowed('store.interne.example')).toBe(true)
    expect(registryAllowed('autre.example')).toBe(false)
  })
})

describe('lecture de l index', () => {
  it('trouve la version demandee', () => {
    const r = findVersion(index(), 'next-event', '1.0.0')
    expect(r).toMatchObject({ ok: true })
  })

  it('refuse une extension absente', () => {
    expect(findVersion(index(), 'inconnue', '1.0.0')).toMatchObject({ ok: false, code: 'EXTENSION_NOT_IN_REGISTRY' })
  })

  it('refuse une version non publiee', () => {
    expect(findVersion(index(), 'next-event', '9.9.9')).toMatchObject({ ok: false, code: 'VERSION_NOT_IN_REGISTRY' })
  })

  it('refuse un index illisible', () => {
    for (const bad of [null, 42, {}, { extensions: 'x' }]) {
      expect(findVersion(bad, 'next-event', '1.0.0')).toMatchObject({ ok: false, code: 'REGISTRY_MALFORMED' })
    }
  })

  it('refuse une empreinte absente ou mal formee', () => {
    const idx = index({ extensions: [{ id: 'next-event', versions: [{ version: '1.0.0', sha256: 'court', url: 'https://a/x.nyx' }] }] })
    expect(findVersion(idx, 'next-event', '1.0.0')).toMatchObject({ ok: false, code: 'REGISTRY_MALFORMED' })
  })

  it('refuse une URL de paquet non securisee', () => {
    const idx = index({ extensions: [{ id: 'next-event', versions: [{ version: '1.0.0', sha256: SHA, url: 'http://a/x.nyx' }] }] })
    expect(findVersion(idx, 'next-event', '1.0.0')).toMatchObject({ ok: false, code: 'REGISTRY_MALFORMED' })
  })
})

describe('telechargement verifiable', () => {
  it('rend le paquet quand l empreinte correspond', async () => {
    const r = await downloadFromRegistry('extensions.nodyx.org', 'next-event', '1.0.0', net())
    if (!r.ok) throw new Error('refuse a tort : ' + r.code)
    expect(r.value.archive.toString()).toBe('contenu du paquet')
  })

  it('REFUSE des octets qui ne correspondent pas a l empreinte publiee', async () => {
    // L'empreinte vient de l'index, pas du paquet : c'est ce qui rend le
    // telechargement verifiable et l'URL de paquet inutile a croire.
    const r = await downloadFromRegistry('extensions.nodyx.org', 'next-event', '1.0.0', net(index(), Buffer.from('AUTRE CHOSE')))
    expect(r).toMatchObject({ ok: false, code: 'CHECKSUM_MISMATCH' })
  })

  it('refuse une archive au dessus du plafond', async () => {
    const gros = Buffer.alloc(21 * 1024 * 1024, 1)
    const idx = index({ extensions: [{ id: 'next-event', versions: [{ version: '1.0.0', sha256: createHash('sha256').update(gros).digest('hex'), url: 'https://a/x.nyx' }] }] })
    const r = await downloadFromRegistry('extensions.nodyx.org', 'next-event', '1.0.0', net(idx, gros))
    expect(r).toMatchObject({ ok: false, code: 'ARCHIVE_TOO_LARGE' })
  })

  it('traduit un registre injoignable', async () => {
    const boom: FetchLike = (async () => { throw new Error('reseau') }) as FetchLike
    expect(await downloadFromRegistry('extensions.nodyx.org', 'next-event', '1.0.0', boom))
      .toMatchObject({ ok: false, code: 'REGISTRY_UNREACHABLE' })
  })

  it('traduit un index en erreur', async () => {
    expect(await downloadFromRegistry('extensions.nodyx.org', 'next-event', '1.0.0', net(index(), PAQUET, { indexStatus: 503 })))
      .toMatchObject({ ok: false, code: 'REGISTRY_UNREACHABLE' })
  })

  it('traduit un paquet introuvable', async () => {
    expect(await downloadFromRegistry('extensions.nodyx.org', 'next-event', '1.0.0', net(index(), PAQUET, { pkgStatus: 404 })))
      .toMatchObject({ ok: false, code: 'DOWNLOAD_FAILED' })
  })

  it('ne telecharge RIEN quand le registre n est pas autorise', async () => {
    const spy = vi.fn(net())
    await downloadFromRegistry('pirate.example', 'next-event', '1.0.0', spy as unknown as FetchLike)
    expect(spy).not.toHaveBeenCalled()
  })
})
