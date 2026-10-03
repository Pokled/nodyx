/**
 * Régression : deux dénis de service de @fastify/busboy < 3.2.1, le parseur
 * multipart de @fastify/multipart (tous les envois de fichiers du core).
 *
 *  - GHSA-xjh9-v7x6-24jw : une frontière (boundary) de 252 octets pile fait
 *    boucler la recherche à l'infini. UNE petite requête gèle la boucle
 *    d'événements : toute l'instance cesse de répondre.
 *  - GHSA-x8mw-p69m-v3mx : un en-tête de partie nommé `__proto__` fait jeter
 *    le parseur (TypeError), au risque de faire tomber le processus.
 *
 * L'attaque tourne dans un processus À PART, avec un délai : une boucle
 * infinie bloquerait aussi les minuteurs de Vitest, le test ne finirait
 * jamais au lieu d'échouer. Vérifié rouge sur busboy 3.2.0, vert sur 3.2.2.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const CORE = path.resolve(__dirname, '../..')

/**
 * Envoie `chunks` (frontière `boundary`) à une route multipart réelle, dans un
 * processus à part, morceau par morceau : c'est un morceau qui se termine par
 * un DÉBUT de frontière qui fait entrer le parseur dans la boucle fautive.
 */
function attack(boundary: string, chunks: string[]) {
  const script = `
    const Fastify = require('fastify')
    const app = Fastify()
    app.register(require('@fastify/multipart'))
    app.post('/up', async (req) => {
      try { for await (const part of req.parts()) { if (part.file) part.file.resume() } } catch { return { rejected: true } }
      return { ok: true }
    })
    app.ready().then(() => app.inject({
      method: 'POST', url: '/up',
      headers: { 'content-type': 'multipart/form-data; boundary=' + ${JSON.stringify(boundary)} },
      payload: require('node:stream').Readable.from(${JSON.stringify(chunks)}.map(c => Buffer.from(c))),
    })).then(r => { console.log('STATUS', r.statusCode); process.exit(0) })
  `
  return spawnSync(process.execPath, ['-e', script], { cwd: CORE, timeout: 8000, encoding: 'utf8' })
}

describe('multipart : dénis de service de busboy', () => {
  it('une frontière de 252 octets ne gèle pas le serveur (GHSA-xjh9-v7x6-24jw)', () => {
    // Aiguille cherchée = '\r\n--' + frontière = 256 octets : la table de saut
    // (Uint8Array) déborde à 0 pour tout octet absent de l'aiguille. Le premier
    // morceau finit par un début d'aiguille (tampon de recherche non vide),
    // le second apporte des 'A', absents de l'aiguille : saut de 0, à l'infini.
    const b = 'x'.repeat(252)
    const r = attack(b, [
      `--${b}\r\nContent-Disposition: form-data; name="f"; filename="a.txt"\r\n\r\nhello\r\n--x`,
      'A'.repeat(1024),
      `\r\n--${b}--\r\n`,
    ])
    expect(r.error?.message ?? '', 'le processus a été tué au délai : boucle infinie').not.toContain('ETIMEDOUT')
    expect(r.stdout).toMatch(/STATUS \d{3}/)
  }, 15000)

  it('un en-tête de partie nommé __proto__ ne fait pas tomber le processus (GHSA-x8mw-p69m-v3mx)', () => {
    const b = 'nodyxboundary'
    const body = `--${b}\r\n__proto__: x\r\nContent-Disposition: form-data; name="t"\r\n\r\nhello\r\n--${b}--\r\n`
    const r = attack(b, [body])
    expect(r.status, r.stderr.slice(0, 300)).toBe(0)
    expect(r.stdout).toMatch(/STATUS \d{3}/)
  }, 15000)
})
