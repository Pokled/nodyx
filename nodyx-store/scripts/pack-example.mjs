#!/usr/bin/env node
// Fabrique le paquet .nyx d'une extension du depot et rend son empreinte.
//
//   node scripts/pack-example.mjs next-event
//
// Le paquet produit est COMMITTE : une version publiee est immuable, et le zip
// n'est pas reproductible a l'octet (il embarque des dates). L'artefact fait
// donc foi, et `registryPackages.test.ts` verifie que l'empreinte publiee
// correspond aux octets servis.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const HERE = dirname(fileURLToPath(import.meta.url))
const name = process.argv[2]
if (!name) {
  console.error('usage : node scripts/pack-example.mjs <nom-de-l-extension>')
  process.exit(1)
}

const SRC = join(HERE, '..', '..', 'nodyx-core', 'examples', name)
const OUT = join(HERE, '..', 'static', 'p')

const manifest = JSON.parse(readFileSync(join(SRC, 'manifest.json'), 'utf8'))
const zip = new AdmZip()

const walk = (rel) => {
  for (const e of readdirSync(join(SRC, rel || '.'), { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) walk(child)
    else zip.addFile(child, readFileSync(join(SRC, child)))
  }
}
walk('')

const buf = zip.toBuffer()
const file = `${manifest.id}-${manifest.version}.nyx`
mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, file), buf)

const sha = createHash('sha256').update(buf).digest('hex')
console.log(`paquet : static/p/${file}`)
console.log(`taille : ${buf.length} octets`)
console.log(`sha256 : ${sha}`)
console.log('\nA reporter dans registry/%s.json, versions[].sha256', manifest.id)
