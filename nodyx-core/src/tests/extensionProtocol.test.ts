import { describe, it, expect } from 'vitest'
import { parseRequest, ok, err, event, RequestLedger, REQUEST_TYPES } from '../extensions/protocol'

const EXPECTED = { ext: 'library', surface: 'widget:tonight' }

function envelope(over: Record<string, unknown> = {}) {
  return { p: 1, id: 'abc123', ext: 'library', surface: 'widget:tonight', type: 'storage.get', payload: { key: 'k' }, ...over }
}

function code(raw: unknown): string | null {
  const r = parseRequest(raw, EXPECTED)
  return r.ok ? null : r.code
}

describe('enveloppe valide', () => {
  it('accepte une requête bien formée', () => {
    const r = parseRequest(envelope(), EXPECTED)
    if (!r.ok) throw new Error('refusée à tort : ' + r.code)
    expect(r.request.type).toBe('storage.get')
    expect(r.request.payload).toEqual({ key: 'k' })
  })

  it.each(REQUEST_TYPES)('accepte le type %s', (type) => {
    expect(code(envelope({ type }))).toBeNull()
  })
})

describe('une frame ne parle que pour elle même', () => {
  it('refuse une requête au nom d une autre extension', () => {
    expect(code(envelope({ ext: 'autre-ext' }))).toBe('PROTOCOL_WRONG_EXTENSION')
  })

  it('refuse une requête au nom d une autre surface', () => {
    expect(code(envelope({ surface: 'page' }))).toBe('PROTOCOL_WRONG_SURFACE')
  })
})

describe('entrée hostile par défaut', () => {
  it.each([null, 42, 'texte', [], undefined])('refuse l enveloppe %p', (raw) => {
    expect(code(raw)).toBe('PROTOCOL_MALFORMED')
  })

  it('refuse une version de protocole différente', () => {
    expect(code(envelope({ p: 2 }))).toBe('PROTOCOL_VERSION')
    expect(code(envelope({ p: '1' }))).toBe('PROTOCOL_VERSION')
  })

  it('refuse un type inconnu', () => {
    expect(code(envelope({ type: 'fs.readFile' }))).toBe('PROTOCOL_UNKNOWN_TYPE')
    expect(code(envelope({ type: '__proto__' }))).toBe('PROTOCOL_UNKNOWN_TYPE')
  })

  it.each(['', 'a'.repeat(65), 'id avec espace', '../x'])('refuse l identifiant de requête %p', (id) => {
    expect(code(envelope({ id }))).toBe('PROTOCOL_MALFORMED')
  })

  it('refuse un identifiant d extension mal formé', () => {
    expect(code(envelope({ ext: 'MAJ' }))).toBe('PROTOCOL_WRONG_EXTENSION')
  })
})

describe('réponses et événements', () => {
  it('corrèle une réponse à sa requête', () => {
    expect(ok('abc123', [1, 2])).toEqual({ p: 1, id: 'abc123', ok: true, result: [1, 2] })
  })

  it('porte un code stable en cas d échec', () => {
    const e = err('abc123', 'QUOTA_EXCEEDED', 'quota atteint')
    expect(e).toMatchObject({ id: 'abc123', ok: false, error: { code: 'QUOTA_EXCEEDED' } })
  })

  it('un événement n a pas d identifiant, il n attend pas de réponse', () => {
    expect(event('theme', { bg: '#000' })).toEqual({ p: 1, event: 'theme', payload: { bg: '#000' } })
  })
})

describe('rejeu', () => {
  it('accepte un identifiant neuf, refuse le même deux fois', () => {
    const ledger = new RequestLedger()
    expect(ledger.accept('a')).toBe(true)
    expect(ledger.accept('a')).toBe(false)
    expect(ledger.accept('b')).toBe(true)
  })

  it('reste borné en mémoire face à une frame bavarde', () => {
    const ledger = new RequestLedger(4)
    for (let i = 0; i < 1000; i++) expect(ledger.accept('id-' + i)).toBe(true)
    // Les plus récents restent protégés, ce qui est le seul cas utile.
    expect(ledger.accept('id-999')).toBe(false)
  })
})
