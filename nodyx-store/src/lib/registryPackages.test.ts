import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { RegistryEntry } from './registry'

// L'empreinte publiee doit correspondre au paquet REELLEMENT servi.
//
// C'est le test qui empeche la derive la plus insidieuse d'un magasin : une
// entree qui annonce une empreinte, un fichier qui a change depuis, et des
// instances qui refusent l'installation sans que personne comprenne pourquoi.
// Une version publiee est immuable : si le fichier bouge, c'est une NOUVELLE
// version, pas une correction de l'entree.

const REG = join(process.cwd(), 'registry')
const PKG = join(process.cwd(), 'static', 'p')

const entries = readdirSync(REG)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(REG, f), 'utf8')) as RegistryEntry)

const served = entries.flatMap((e) =>
  e.versions.map((v) => ({ id: e.id, version: v.version, sha256: v.sha256, url: v.url })),
)

describe('paquets servis par le magasin', () => {
  it.each(served)('$id $version : le fichier existe la ou l URL le promet', ({ url }) => {
    // L'URL publiee doit pointer vers ce que ce depot sert vraiment.
    const name = url.split('/').pop()!
    expect(existsSync(join(PKG, name)), `${name} absent de static/p/`).toBe(true)
  })

  it.each(served)('$id $version : l empreinte publiee correspond aux octets servis', ({ url, sha256 }) => {
    const name = url.split('/').pop()!
    const bytes = readFileSync(join(PKG, name))
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
  })

  it('aucune empreinte de remplissage ne subsiste', () => {
    for (const s of served) expect(s.sha256).not.toMatch(/^0+$/)
  })
})
