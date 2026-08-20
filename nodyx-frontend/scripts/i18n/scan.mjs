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
 *
 * `--ts` scans `.ts` files instead, which the gate ignored entirely until
 * 2026-08-20. That blind spot hid ~300 user-facing strings: icon labels, module
 * names, widget schemas. Clearing them is a long job, so this mode is a RATCHET
 * rather than a wall: the existing debt is frozen in `dette-ts.json`, and the
 * gate fails only when a file gains new strings or a new file appears.
 *
 * The debt can shrink freely and can never grow. That is the whole point: the
 * July 2026 extraction marathon happened because nothing stopped it building up.
 *
 *   node scripts/i18n/scan.mjs --ts --check     CI gate, against the baseline
 *   node scripts/i18n/scan.mjs --ts --baseline  rewrite the baseline after work
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripI18n } from './strip.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = join(HERE, '..', '..', 'src')

const args = new Set(process.argv.slice(2))
const LIST = args.has('--list')
const CHECK = args.has('--check')
const PUBLIC_ONLY = args.has('--public')
const TS = args.has('--ts')
const WRITE_BASELINE = args.has('--baseline')
const BASELINE = join(HERE, 'dette-ts.json')

// French signal: accented letters, or a common French UI word.
// NB : beaucoup de français n'a PAS d'accent (« Se connecter », « Rejoindre »,
// « membres »…) — c'est l'angle mort qui a laissé passer des chaînes en dur.
// La wordlist ci-dessous couvre ces cas sans accent (verbes/labels UI courants).
const ACC = /[àâäéèêëïîôùûüÿçœÀÂÄÉÈÊËÏÎÔÙÛÜŸÇŒ]/
const FR = /\b([Ss]upprimer|[Aa]nnuler|[Ee]nregistrer|[Mm]odifier|[Aa]jouter|[Ee]nvoyer|[Ff]ermer|[Rr]etour|[Ss]uivant|[Rr]echercher|Aucune?|Nouvelle?|Nouveau|[Cc]harger|[Mm]embres?|Connexion|Inscription|Brouillon|[Pp]ublier|[Cc]hoisir|[Cc]opier|[Pp]artager|[Ee]ffacer|[Ee]nlever|[Oo]uvrir|Bienvenue|Erreur|Chargement|[Rr]ejoindre|[Qq]uitter|[Ss]uivre|[Ss]uivi|[Cc]onnecte[rz]|[Cc]onnecte-toi|[Cc]ontinuer|[Vv]alider|[Cc]ontacte[rz]|[Pp]articiper|[Dd]iffuse|Lancer pour|Attribution|[Cc]arte|Annuaire|Profil\b|Actu\b|Biblio\b|Reseau|Accueil|Parametres?|Deconnexion|Sondages?|Taches?|Calendrier|Jardin|Bibliotheque)\b/
// Contractions et pronoms français : quasi impossibles en anglais → forte fiabilité.
const FR_FUNC = /(\bvous\b|\bvotre\b|\bvos\b|\bcette\b|qu'il|s'agit|d'une|d'un\b|n'est|c'est|l'instant|parlez|Sois le premier)/

const isAdmin = (p) =>
  p.includes('/routes/admin/') || p.includes('/components/admin/') ||
  /(streamer-hub|\/obs\/|StreamControl|StudioEngagement|RewardsManager|PlaylistSidebar|SoundLibrary|ChatTimers|ChatCommands|DeckEditor|OverlayManager|AlertBox)/.test(p)

// Les fichiers de test contiennent du francais VOLONTAIREMENT : ce sont les
// fixtures qui verifient que ce scanner attrape bien ce qu'il doit attraper.
// Les signaler reviendrait a demander de traduire l'appat.
const isFixture = (nom) => /\.(test|spec)\.ts$/.test(nom)

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (TS) { if (e.name.endsWith('.ts') && !isFixture(e.name)) out.push(p) }
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
    //
    // On NEUTRALISE les appels i18n au lieu d'exempter la ligne entiere. Avant,
    // `!l.includes('tFn(')` laissait passer TOUTE ligne contenant un appel, donc
    // celle-ci echappait au controle alors qu'elle porte une chaine en dur :
    //
    //     {cond ? 'Remplacer' : tFn('editor.insert')}
    //
    // Cas reel, trouve le 2026-08-19 : la porte annoncait 0 chaine en dur.
    const reste = stripI18n(l)
    const frHit = ACC.test(reste) || FR.test(reste) || FR_FUNC.test(reste)
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

if (!TS) {
  if (CHECK && total > 0) process.exit(1)
  process.exit(0)
}

// ── Mode `--ts` : le cliquet ──────────────────────────────────────────────────
const courant = Object.fromEntries(perFile.map(({ f, hits }) => [f, hits.length]))

if (WRITE_BASELINE) {
  const trie = Object.fromEntries(Object.entries(courant).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(BASELINE, JSON.stringify(trie, null, 2) + '\n')
  console.log(`\nBaseline écrite : ${relative(process.cwd(), BASELINE)} (${Object.keys(trie).length} fichiers)`)
  process.exit(0)
}

if (!existsSync(BASELINE)) {
  console.error(`\nBaseline absente. La créer : node scripts/i18n/scan.mjs --ts --baseline`)
  process.exit(1)
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'))

const nouveaux = []   // fichier absent de la baseline, mais qui contient du français
const aggraves = []   // fichier connu, dont le compte a AUGMENTÉ
const ameliores = []  // fichier connu, dont le compte a baissé : bonne nouvelle

for (const [f, n] of Object.entries(courant)) {
  if (!(f in base)) nouveaux.push([f, n])
  else if (n > base[f]) aggraves.push([f, n, base[f]])
  else if (n < base[f]) ameliores.push([f, n, base[f]])
}
// Un fichier entièrement nettoyé disparaît de `courant` : c'est aussi un progrès.
const nettoyes = Object.keys(base).filter((f) => !(f in courant))

const dette = Object.values(base).reduce((a, b) => a + b, 0)
console.log(`\nDette gelée : ${dette} chaîne(s) dans ${Object.keys(base).length} fichier(s).`)

for (const [f, n, avant] of ameliores) console.log(`  mieux    ${f} : ${avant} -> ${n}`)
for (const f of nettoyes)              console.log(`  nettoyé  ${f}`)

if (!nouveaux.length && !aggraves.length) {
  const gagne = ameliores.reduce((a, [, n, avant]) => a + (avant - n), 0)
             + nettoyes.reduce((a, f) => a + base[f], 0)
  if (gagne > 0) {
    console.log(`\n✓ ${gagne} chaîne(s) de moins qu'au gel. Penser à : npm run i18n:ts:baseline`)
  } else {
    console.log(`\n✓ aucune nouvelle chaîne en dur dans les .ts.`)
  }
  process.exit(0)
}

console.error('\n✗ La dette a GRANDI :')
for (const [f, n] of nouveaux)          console.error(`  nouveau  ${f} : ${n} chaîne(s)`)
for (const [f, n, avant] of aggraves)   console.error(`  aggravé  ${f} : ${avant} -> ${n}`)
console.error(`\nCes chaînes doivent devenir des clés i18n (fr.json ET en.json),`)
console.error(`comme n'importe quelle chaîne d'un .svelte. La dette existante est`)
console.error(`tolérée le temps d'être résorbée, elle n'a pas vocation à croître.`)
process.exit(1)
