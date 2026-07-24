#!/usr/bin/env node
// Vérifie que toute clé i18n RÉFÉRENCÉE dans le code existe bien dans fr.json.
//
// Le scanner (scan.mjs) garantit qu'il ne reste pas de texte FR en dur.
// Celui-ci garantit l'inverse : qu'aucune clé tFn('x') ne pointe dans le vide.
// Une clé absente de fr.json s'affiche EN BRUT à l'écran (« dm.reply »), et ni
// `svelte-check` ni le build ne l'attrapent : c'est un bug runtime invisible en CI.
//
//   node scripts/i18n/check-keys.mjs          # liste les clés manquantes
//   node scripts/i18n/check-keys.mjs --check   # exit 1 si au moins une manque
//
// Deux façons de référencer une clé sont couvertes :
//   1. appel direct  : tFn('x'), $t('x'), translate('x'), get(t)('x')  (tout namespace)
//   2. littéral clé  : 'namespace.sub' passé via un tableau/champ (labelKey, etc.)
//      -> limité aux namespaces déjà présents dans fr.json, pour éviter le bruit.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const SRC = join(ROOT, 'src')
const FR = join(SRC, 'lib', 'locales', 'fr.json')

const keys = new Set(Object.keys(JSON.parse(readFileSync(FR, 'utf8'))))
const namespaces = new Set([...keys].map((k) => k.split('.')[0]))

// Premiers segments qui RESSEMBLENT à un namespace mais n'en sont pas :
// 'channel.follow' etc. sont des types d'events Twitch (champ `key:`), pas des clés i18n.
const NOT_I18N = new Set(['channel', 'image', 'video', 'text'])

const KEYISH = /^[a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+$/
const CALL = /(?:tFn|\$t|translate)\(\s*'([^']+)'/g
const GETT = /get\(\s*t\s*\)\(\s*'([^']+)'/g
const LITERAL = /['"]([a-z][a-zA-Z0-9_]*(?:\.[a-zA-Z0-9_]+)+)['"]/g

// Un préfixe de concaténation (`tFn('a.b.' + x)`) finit par `.` ou `_` : non vérifiable.
const isPrefix = (s) => s.endsWith('.') || s.endsWith('_')

function walk(dir) {
	const out = []
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name)
		if (e.isDirectory()) out.push(...walk(p))
		else if ((e.name.endsWith('.svelte') || e.name.endsWith('.ts')) && !e.name.endsWith('.test.ts')) out.push(p)
	}
	return out
}

const missing = new Map()
for (const file of walk(SRC)) {
	const txt = readFileSync(file, 'utf8')
	const refs = new Set()
	for (const m of txt.matchAll(CALL)) if (!isPrefix(m[1])) refs.add(m[1])
	for (const m of txt.matchAll(GETT)) if (!isPrefix(m[1])) refs.add(m[1])
	for (const m of txt.matchAll(LITERAL)) {
		const s = m[1]
		const ns = s.split('.')[0]
		if (isPrefix(s) || NOT_I18N.has(ns) || !namespaces.has(ns)) continue
		refs.add(s)
	}
	const bad = [...refs].filter((k) => KEYISH.test(k) && !keys.has(k))
	if (bad.length) missing.set(file.replace(ROOT + '/', ''), bad.sort())
}

if (missing.size === 0) {
	console.log('✓ i18n keys: toutes les clés référencées existent dans fr.json')
	process.exit(0)
}

let total = 0
console.log('Clés i18n référencées mais ABSENTES de fr.json (affichées en brut à l\'écran) :\n')
for (const [file, ks] of [...missing].sort()) {
	for (const k of ks) { console.log(`  ${file}: ${k}`); total++ }
}
console.log(`\n${total} clé(s) manquante(s) dans ${missing.size} fichier(s).`)
process.exit(process.argv.includes('--check') ? 1 : 0)
