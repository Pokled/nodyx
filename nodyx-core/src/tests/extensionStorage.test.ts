import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  storageGet, storageSet, storageDelete, storageList,
  resolveScope, validateKey, jsonDepth, valueBytes,
  type StorageCaller,
} from '../extensions/storage'

const CALLER: StorageCaller = {
  extensionId: 'library',
  userId:      'user-42',
  granted:     ['storage.user', 'storage.instance.read'],
  quotaBytes:  1024 * 1024,
}

let query: ReturnType<typeof vi.fn>

beforeEach(() => {
  query = vi.fn().mockResolvedValue({ rows: [] })
})

/** Reponse par defaut de la mesure d'occupation. */
function usage(n: number, total: number) {
  query.mockResolvedValueOnce({ rows: [{ n, total }] }).mockResolvedValueOnce({ rows: [] })
}

describe('l extension ne nomme jamais son propre espace', () => {
  it('la requete porte l extension du JETON, pas celle de l appel', async () => {
    usage(0, 0)
    await storageSet(CALLER, 'k', { a: 1 }, undefined, query)
    for (const call of query.mock.calls) {
      expect(call[1][0]).toBe('library')       // toujours l'extension de l'appelant
    }
  })

  it('la portee utilisateur vise l utilisateur de la session', async () => {
    await storageGet(CALLER, 'k', 'user', query)
    expect(query.mock.calls[0][1]).toEqual(['library', 'user', 'user-42', 'k'])
  })

  it('la portee instance ne porte aucun utilisateur', async () => {
    await storageGet(CALLER, 'k', 'instance', query)
    expect(query.mock.calls[0][1]).toEqual(['library', 'instance', null, 'k'])
  })
})

describe('les deux axes : capacite accordee et droits utilisateur', () => {
  it('refuse la portee utilisateur sans la capacite', async () => {
    const r = await storageGet({ ...CALLER, granted: [] }, 'k', 'user', query)
    expect(r).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' })
    expect(query).not.toHaveBeenCalled()
  })

  it('refuse la portee utilisateur a un visiteur, avec un conseil utile', async () => {
    const r = await storageGet({ ...CALLER, userId: null }, 'k', 'user', query)
    expect(r).toMatchObject({ ok: false, code: 'NOT_AUTHENTICATED' })
    if (!r.ok) expect(r.message).toContain('mémoire')
  })

  it('lire le partage ne donne pas le droit d y ecrire', async () => {
    expect(resolveScope('instance', CALLER, 'read')).toMatchObject({ ok: true })
    expect(resolveScope('instance', CALLER, 'write')).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' })
  })

  it('accorde l ecriture partagee quand la capacite est la', () => {
    const c = { ...CALLER, granted: [...CALLER.granted, 'storage.instance.write'] }
    expect(resolveScope('instance', c, 'write')).toMatchObject({ ok: true })
  })

  it('refuse une portee inconnue', () => {
    expect(resolveScope('global', CALLER, 'read')).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
  })

  it('la portee par defaut est utilisateur', () => {
    const r = resolveScope(undefined, CALLER, 'read')
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.value.scope).toBe('user')
  })
})

describe('un quota en octets ne suffit pas', () => {
  it('refuse une cle interminable', async () => {
    const r = await storageSet(CALLER, 'k'.repeat(200), 1, undefined, query)
    expect(r).toMatchObject({ ok: false, code: 'KEY_TOO_LONG' })
  })

  it('refuse une cle aux caracteres douteux', async () => {
    for (const key of ['a b', 'a/b', '../x', 'é']) {
      expect(await storageSet(CALLER, key, 1, undefined, query)).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    }
  })

  it('refuse une valeur trop grosse', async () => {
    const r = await storageSet(CALLER, 'k', 'x'.repeat(70_000), undefined, query)
    expect(r).toMatchObject({ ok: false, code: 'VALUE_TOO_LARGE' })
  })

  it('refuse un JSON trop profond, sans exploser en le mesurant', async () => {
    let deep: unknown = 'fond'
    for (let i = 0; i < 40; i++) deep = { n: deep }
    const r = await storageSet(CALLER, 'k', deep, undefined, query)
    expect(r).toMatchObject({ ok: false, code: 'JSON_TOO_DEEP' })
  })

  it('refuse au dela du nombre de cles', async () => {
    usage(500, 100)
    const r = await storageSet(CALLER, 'nouvelle', 1, undefined, query)
    expect(r).toMatchObject({ ok: false, code: 'TOO_MANY_KEYS' })
  })

  it('refuse au dela du quota d octets', async () => {
    usage(3, 1024 * 1024)
    const r = await storageSet(CALLER, 'k', { gros: 'x'.repeat(100) }, undefined, query)
    expect(r).toMatchObject({ ok: false, code: 'QUOTA_EXCEEDED' })
  })

  it('une reecriture ne se fait pas refuser pour la place qu elle libere', async () => {
    // La mesure exclut la cle visee : sans ca, remplacer une grosse valeur par
    // une petite echouerait alors qu'elle fait de la place.
    usage(2, 500)
    const r = await storageSet({ ...CALLER, quotaBytes: 600 }, 'k', { a: 1 }, undefined, query)
    expect(r.ok).toBe(true)
    expect(query.mock.calls[0][0]).toContain('key <> $4')
  })

  it('refuse une valeur non serialisable plutot que de planter', async () => {
    const cyclique: Record<string, unknown> = {}
    cyclique.moi = cyclique
    const r = await storageSet(CALLER, 'k', cyclique, undefined, query)
    expect(r).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
  })

  it('refuse une ecriture sans valeur, en orientant vers delete', async () => {
    const r = await storageSet(CALLER, 'k', undefined, undefined, query)
    expect(r).toMatchObject({ ok: false, code: 'INVALID_ARGUMENT' })
    if (!r.ok) expect(r.message).toContain('delete')
  })
})

describe('operations', () => {
  it('rend undefined pour une cle absente, pas une erreur', async () => {
    const r = await storageGet(CALLER, 'absente', undefined, query)
    expect(r).toEqual({ ok: true, value: undefined })
  })

  it('rend la valeur stockee', async () => {
    query.mockResolvedValue({ rows: [{ value: [603, 27205] }] })
    const r = await storageGet(CALLER, 'watched', undefined, query)
    expect(r).toEqual({ ok: true, value: [603, 27205] })
  })

  it('ecrit et rend la taille occupee', async () => {
    usage(1, 20)
    const r = await storageSet(CALLER, 'k', { a: 1 }, undefined, query)
    expect(r).toEqual({ ok: true, value: { bytes: valueBytes({ a: 1 }) } })
    expect(query.mock.calls[1][0]).toContain('ON CONFLICT')
  })

  it('dit si la suppression a touche quelque chose', async () => {
    query.mockResolvedValue({ rows: [{ key: 'k' }] })
    expect(await storageDelete(CALLER, 'k', undefined, query)).toEqual({ ok: true, value: { deleted: true } })
    query.mockResolvedValue({ rows: [] })
    expect(await storageDelete(CALLER, 'k', undefined, query)).toEqual({ ok: true, value: { deleted: false } })
  })

  it('liste les cles avec leur taille et leur date', async () => {
    query.mockResolvedValue({ rows: [{ key: 'a', bytes: 12, updated_at: '2026-08-14T10:00:00.000Z' }] })
    const r = await storageList(CALLER, undefined, query)
    expect(r).toEqual({ ok: true, value: [{ key: 'a', bytes: 12, updatedAt: '2026-08-14T10:00:00.000Z' }] })
  })
})

describe('outils de mesure', () => {
  it('mesure la profondeur sans partir a l infini', () => {
    expect(jsonDepth('a')).toBe(1)
    expect(jsonDepth({ a: { b: { c: 1 } } })).toBe(4)
    expect(jsonDepth([[[1]]])).toBe(4)
    let deep: unknown = 1
    for (let i = 0; i < 5000; i++) deep = [deep]
    expect(jsonDepth(deep)).toBeGreaterThan(16)      // s'arrete, ne deborde pas la pile
  })

  it('mesure les octets reellement stockes', () => {
    expect(valueBytes('é')).toBe(4)                  // guillemets compris
    expect(valueBytes(null)).toBe(4)
  })

  it('valide les cles', () => {
    expect(validateKey('a.b:c-d_e')).toMatchObject({ ok: true })
    expect(validateKey('')).toMatchObject({ ok: false })
    expect(validateKey(42)).toMatchObject({ ok: false })
  })
})
