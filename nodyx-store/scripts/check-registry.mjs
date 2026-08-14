#!/usr/bin/env node
// Valide toutes les entrees du registre. Tourne en CI sur chaque PR de
// publication : une entree cassee ne doit jamais atteindre l'index.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateEntry } from '../src/lib/registry.ts'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'registry')

let bad = 0
for (const file of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  let raw
  try {
    raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  } catch (e) {
    console.error(`${file} : JSON invalide, ${e.message}`)
    bad++
    continue
  }
  const issues = validateEntry(raw)
  if (issues.length) {
    bad++
    console.error(`${file} :`)
    for (const i of issues) console.error(`  ${i.path || '(racine)'} : ${i.message}`)
  }
}

if (bad) {
  console.error(`\n${bad} entree(s) refusee(s).`)
  process.exit(1)
}
console.log('registre : toutes les entrees sont valides.')
