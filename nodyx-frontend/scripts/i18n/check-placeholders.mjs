#!/usr/bin/env node
/**
 * i18n placeholder integrity checker (the translator safety net).
 *
 * A translation may change every word. It may NOT invent something the app is
 * supposed to fill in. This compares each locale against the source (fr).
 *
 * What is checked
 *   1. `{{var}}`   i18n interpolation, replaced at runtime by `tFn(key, vars)`
 *   2. `{var}`     single-brace template tokens (OctoGuard welcome messages,
 *                  alert templates, chat timers). NOT i18n variables: the
 *                  feature substitutes them later, so translating
 *                  `{userMention}` silently breaks that feature
 *   3. `<tag>`     markup inside strings rendered with `{@html}`
 *
 * The rule is deliberately ASYMMETRIC, because the two directions are not the
 * same kind of problem:
 *
 *   ERROR  something in the translation that the source does not have.
 *          The call site only passes the source's variables, so an invented
 *          `{{foo}}` is printed literally on screen. An invented or unclosed
 *          tag leaks raw markup. Both are guaranteed breakage.
 *
 *   WARN   something in the source that the translation drops. Usually a
 *          legitimate language choice: fr `({{n}} non lue{{s}})` carries a
 *          plural marker `{{s}}` that no other language needs. Worth seeing,
 *          never worth blocking a contributor's pull request over.
 *
 * This is the check Weblate would have run for us. We chose not to host
 * Weblate, so the repo carries the net itself and every translation PR gets
 * verified in CI.
 *
 *   node scripts/i18n/check-placeholders.mjs           full report
 *   node scripts/i18n/check-placeholders.mjs --check   exit 1 on any ERROR
 *   node scripts/i18n/check-placeholders.mjs --quiet   hide warnings
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '..', '..', 'src', 'lib', 'locales')
const SOURCE = 'fr' // strings are authored in French

const args = new Set(process.argv.slice(2))
const CHECK = args.has('--check')
const QUIET = args.has('--quiet')

// Tags that never carry a closing tag, so they must not count as unbalanced.
const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'source', 'wbr'])

const locales = {}
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  locales[f.replace('.json', '')] = JSON.parse(readFileSync(join(DIR, f), 'utf8'))
}

const src = locales[SOURCE]
if (!src) {
  console.error(`Source locale ${SOURCE}.json not found in ${DIR}`)
  process.exit(2)
}

function parts(str) {
  // Blank out `{{...}}` before hunting single braces, otherwise every `{{n}}`
  // would also register as a `{n}`.
  const singles = str.replace(/\{\{[^}]*\}\}/g, (m) => ' '.repeat(m.length))
  const tags = [...str.matchAll(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)/g)]
    .map((m) => ({ closing: m[1] === '/', name: m[2].toLowerCase() }))

  const balance = new Map()
  for (const t of tags) {
    if (VOID_TAGS.has(t.name)) continue
    balance.set(t.name, (balance.get(t.name) ?? 0) + (t.closing ? -1 : 1))
  }

  return {
    vars:   new Set([...str.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1])),
    tokens: new Set([...singles.matchAll(/\{\s*(\w+)\s*\}/g)].map((m) => m[1])),
    tags:   new Set(tags.map((t) => t.name)),
    balance,
  }
}

const KINDS = [
  ['vars',   '{{var}}'],
  ['tokens', '{token}'],
  ['tags',   '<tag>'],
]

let errors = 0
let warnings = 0
const report = []

for (const loc of Object.keys(locales).sort()) {
  if (loc === SOURCE) continue
  const dict = locales[loc]
  const rows = []

  for (const [key, srcVal] of Object.entries(src)) {
    const val = dict[key]
    // A missing key is coverage, not corruption: coverage.mjs owns that.
    if (typeof srcVal !== 'string' || typeof val !== 'string') continue

    const a = parts(srcVal)
    const b = parts(val)

    for (const [kind, label] of KINDS) {
      const invented = [...b[kind]].filter((x) => !a[kind].has(x))
      const dropped  = [...a[kind]].filter((x) => !b[kind].has(x))
      if (invented.length) rows.push({ lvl: 'ERROR', key, label, detail: `not in source: ${invented.join(', ')}` })
      if (dropped.length)  rows.push({ lvl: 'warn',  key, label, detail: `dropped: ${dropped.join(', ')}` })
    }

    // An unclosed tag leaks markup even when the tag name itself exists in the
    // source, so balance is checked on its own.
    for (const [name, delta] of b.balance) {
      if (delta !== (a.balance.get(name) ?? 0)) {
        rows.push({ lvl: 'ERROR', key, label: '<tag>', detail: `<${name}> is not closed the way the source closes it` })
      }
    }
  }

  errors   += rows.filter((r) => r.lvl === 'ERROR').length
  warnings += rows.filter((r) => r.lvl === 'warn').length
  report.push({ loc, rows })
}

for (const { loc, rows } of report) {
  const errs = rows.filter((r) => r.lvl === 'ERROR')
  const warns = rows.filter((r) => r.lvl === 'warn')
  const shown = QUIET ? errs : rows

  if (!errs.length && (QUIET || !warns.length)) {
    console.log(`  ${loc.padEnd(7)} ok`)
    continue
  }
  console.log(`  ${loc.padEnd(7)} ${errs.length} error(s), ${warns.length} warning(s)`)
  for (const r of shown) {
    console.log(`      ${r.lvl === 'ERROR' ? 'ERROR' : 'warn '}  ${r.key}  [${r.label}]  ${r.detail}`)
  }
}

const checked = Object.keys(locales).length - 1
console.log(
  errors === 0
    ? `\n✓ placeholders: ${checked} locale(s) invent nothing the app cannot fill (${warnings} warning(s)).`
    : `\n${errors} placeholder error(s) across ${checked} locale(s).`,
)

if (CHECK && errors > 0) process.exit(1)
