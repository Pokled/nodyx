#!/usr/bin/env node
/**
 * i18n hardcoded-string scanner (the guardrail).
 *
 * Flags French text living in Svelte markup OUTSIDE an i18n call (`tFn(` / `$t(`).
 * Rationale: translation keys are written in English, so any French left in a
 * template is, by construction, a string that was never extracted. Getting this
 * to 0 (and keeping it there via CI) is how we guarantee "nothing hardcoded".
 *
 *   node scripts/i18n/scan.mjs            summary per file + total
 *   node scripts/i18n/scan.mjs --list     also print every offending line
 *   node scripts/i18n/scan.mjs --public   ignore admin / studio (owner-only) pages
 *   node scripts/i18n/scan.mjs --check    exit 1 if anything is found (CI gate)
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..', 'src')

const args = new Set(process.argv.slice(2))
const LIST = args.has('--list')
const CHECK = args.has('--check')
const PUBLIC_ONLY = args.has('--public')

// French signal: accented letters, or a common French UI word.
// NB : beaucoup de français n'a PAS d'accent (« Se connecter », « Rejoindre »,
// « membres »…) — c'est l'angle mort qui a laissé passer des chaînes en dur.
// La wordlist ci-dessous couvre ces cas sans accent (verbes/labels UI courants).
const ACC = /[àâäéèêëïîôùûüÿçœÀÂÄÉÈÊËÏÎÔÙÛÜŸÇŒ]/
const FR = /\b([Ss]upprimer|[Aa]nnuler|[Ee]nregistrer|[Mm]odifier|[Aa]jouter|[Ee]nvoyer|[Ff]ermer|[Rr]etour|[Ss]uivant|[Rr]echercher|Aucune?|Nouvelle?|Nouveau|[Cc]harger|[Mm]embres?|Connexion|Inscription|Brouillon|[Pp]ublier|[Cc]hoisir|[Cc]opier|[Pp]artager|[Ee]ffacer|[Ee]nlever|[Oo]uvrir|Bienvenue|Erreur|Chargement|[Rr]ejoindre|[Qq]uitter|[Ss]uivre|[Ss]uivi|[Cc]onnecte[rz]|[Cc]onnecte-toi|[Cc]ontinuer|[Vv]alider|[Cc]ontacte[rz]|[Pp]articiper|[Dd]iffuse|Lancer pour|Attribution|[Cc]arte)\b/
// Contractions et pronoms français : quasi impossibles en anglais → forte fiabilité.
const FR_FUNC = /(\bvous\b|\bvotre\b|\bvos\b|\bcette\b|qu'il|s'agit|d'une|d'un\b|n'est|c'est|l'instant|parlez|Sois le premier)/

const isAdmin = (p) =>
  p.includes('/routes/admin/') || p.includes('/components/admin/') ||
  /(streamer-hub|\/obs\/|StreamControl|StudioEngagement|RewardsManager|PlaylistSidebar|SoundLibrary|ChatTimers|ChatCommands|DeckEditor|OverlayManager|AlertBox)/.test(p)

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.svelte')) out.push(p)
  }
  return out
}

// Blank out comments/styles but KEEP newlines, so line numbers stay accurate.
// Comments are code, never UI: we don't translate them, so they must not be flagged.
const blank = (m) => m.replace(/[^\n]/g, ' ')
const clean = (txt) => txt
  .replace(/<style[\s\S]*?<\/style>/g, blank)
  .replace(/<!--[\s\S]*?-->/g, blank)
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  // inline `// ...` comments, but not the `//` inside a URL (`https://`)
  .split('\n')
  .map((l) => l.replace(/(?<!:)\/\/.*$/, (m) => ' '.repeat(m.length)))
  .join('\n')

// Hardcoded translatable attributes, in ANY language (catches English too, which
// the French heuristic misses). A literal value holding a letter is user-facing.
// `attr={tFn(...)}` uses braces, not quotes, so it is never matched here.
const ATTR = /(?:aria-label|title|placeholder|alt|data-tip)="([^"]*)"/g
const LETTER = /[A-Za-zÀ-ÖØ-öø-ÿ]/

const files = walk(SRC).sort()
let total = 0
const perFile = []
for (const f of files) {
  if (PUBLIC_ONLY && isAdmin(f)) continue
  const hits = []
  clean(readFileSync(f, 'utf8')).split('\n').forEach((l, i) => {
    const s = l.trim()
    if (!s || s.startsWith('//') || s.startsWith('*') || s.startsWith('import ') || s.startsWith('console.')) return
    // (a) a translatable attribute holding hardcoded literal text (any language)
    let attrHit = false
    ATTR.lastIndex = 0
    for (let m; (m = ATTR.exec(l)); ) { if (LETTER.test(m[1])) { attrHit = true; break } }
    // (b) French text sitting outside an i18n call
    const frHit = !l.includes('tFn(') && !l.includes('$t(') && (ACC.test(l) || FR.test(l) || FR_FUNC.test(l))
    if (attrHit || frHit) hits.push({ n: i + 1, s: s.slice(0, 100) })
  })
  if (hits.length) { perFile.push({ f: relative(SRC, f), hits }); total += hits.length }
}

perFile.sort((a, b) => b.hits.length - a.hits.length)
for (const { f, hits } of perFile) {
  console.log(`${String(hits.length).padStart(4)}  ${f}`)
  if (LIST) for (const h of hits) console.log(`        ${h.n}: ${h.s}`)
}
console.log(`\n${total} hardcoded French string(s) in ${perFile.length} file(s)${PUBLIC_ONLY ? ' (public only)' : ''}.`)
if (CHECK && total > 0) process.exit(1)
