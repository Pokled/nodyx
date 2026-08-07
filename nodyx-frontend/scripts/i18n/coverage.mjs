#!/usr/bin/env node
/**
 * i18n coverage / parity report.
 *
 * The canonical key set is the union of every locale file. For each locale it
 * reports how many keys are present vs missing (a missing key falls back to fr
 * at runtime, so it silently shows French). This is the "what is left to
 * translate, per language" surface for contributors.
 *
 *   node scripts/i18n/coverage.mjs             coverage table
 *   node scripts/i18n/coverage.mjs --emit de   print { key: source } for the keys
 *                                              missing in `de`, ready to translate
 *   node scripts/i18n/coverage.mjs --check     exit 1 if any locale is incomplete
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '..', '..', 'src', 'lib', 'locales')
const SOURCE = 'fr' // strings are authored in French

const data = {}
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  data[f.replace('.json', '')] = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
}

const canonical = new Set()
for (const d of Object.values(data)) for (const k of Object.keys(d)) canonical.add(k)
const total = canonical.size
const src = data[SOURCE] ?? {}

const argv = process.argv.slice(2)
const emit = argv.includes('--emit') ? argv[argv.indexOf('--emit') + 1] : null
const check = argv.includes('--check')
// Locales qui DOIVENT rester a parite totale avec la source. `en` en fait partie :
// c'est le repli universel a l'execution, donc des qu'il decroche, tout le monde
// hors francophone revoit du francais. Le defaut vaut `en` sans argument.
const requireIdx = argv.indexOf('--require')
const required = requireIdx === -1
  ? []
  : (argv[requireIdx + 1] && !argv[requireIdx + 1].startsWith('--')
      ? argv[requireIdx + 1].split(',')
      : ['en'])

if (emit) {
  if (!data[emit]) { console.error(`Unknown locale: ${emit}`); process.exit(2) }
  const have = new Set(Object.keys(data[emit]))
  const stub = {}
  for (const k of canonical) if (!have.has(k)) stub[k] = src[k] ?? data.en?.[k] ?? ''
  console.log(JSON.stringify(stub, null, 2))
  process.exit(0)
}

console.log(`Canonical keys: ${total}  (source: ${SOURCE})\n`)
console.log('locale    keys   missing   coverage')
console.log('-------   ----   -------   --------')
let incomplete = 0
for (const loc of Object.keys(data).sort()) {
  const have = Object.keys(data[loc]).length
  const missing = total - have
  if (missing > 0) incomplete++
  const pct = ((have / total) * 100).toFixed(1)
  console.log(`${loc.padEnd(7)}  ${String(have).padStart(4)}   ${String(missing).padStart(6)}    ${pct.padStart(6)}%`)
}
console.log(`\nTip: node scripts/i18n/coverage.mjs --emit <locale>  ->  keys left to translate.`)

// ── Porte de parite (CI) ────────────────────────────────────────────────────
// Mesuree contre la SOURCE et non contre l'union canonique : une cle ajoutee par
// un traducteur dans sa seule langue ne doit pas faire echouer l'anglais.
let breaches = 0
for (const loc of required) {
  if (!data[loc]) { console.error(`\nUnknown locale in --require: ${loc}`); process.exit(2) }
  const have = new Set(Object.keys(data[loc]))
  const missing = Object.keys(src).filter((k) => !have.has(k))
  if (missing.length === 0) {
    console.log(`\n\u2713 ${loc}.json is at full parity with ${SOURCE}.json.`)
    continue
  }
  breaches += missing.length
  console.error(`\n${loc}.json is missing ${missing.length} key(s) present in ${SOURCE}.json:`)
  for (const k of missing.slice(0, 20)) console.error(`    ${k}`)
  if (missing.length > 20) console.error(`    ... and ${missing.length - 20} more`)
  console.error(`\n  Every user-facing string ships translated. Add these to ${loc}.json`)
  console.error(`  in the same pull request, or run:`)
  console.error(`      node scripts/i18n/coverage.mjs --emit ${loc}`)
}

if (breaches > 0) process.exit(1)
if (check && incomplete > 0) process.exit(1)
