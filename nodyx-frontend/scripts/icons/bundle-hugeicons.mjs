#!/usr/bin/env node
/**
 * Fabrique le jeu d'icônes local, à partir des SEULES icônes réellement employées.
 *
 * Le jeu complet HugeIcons pèse 2,9 Mo pour 5091 icônes. En embarquer la totalité
 * pour en afficher trente serait absurde, et charger depuis un CDN est exclu :
 * une instance auto-hébergée ne doit dépendre d'aucun service extérieur, c'est
 * la promesse du projet. On bundle donc localement, exactement comme Twemoji.
 *
 * Deux sources, réunies :
 *   - la table `src/lib/uiIcons.ts`, source de vérité des remplacements ;
 *   - tout `hugeicons:nom` écrit en dur ailleurs dans `src`.
 *
 * Une icône demandée mais introuvable ARRÊTE la fabrication. Un bundle amputé
 * en silence donnerait des trous dans l'interface, visibles seulement en
 * production, et seulement sur la page que personne n'ouvre en développement.
 *
 *   node scripts/icons/bundle-hugeicons.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
const RACINE = join(ICI, '..', '..')
const SRC = join(RACINE, 'src')
const JEU = join(RACINE, 'node_modules', '@iconify-json', 'hugeicons', 'icons.json')
const SORTIE = join(SRC, 'lib', 'icons', 'hugeicons-bundled.json')

if (!existsSync(JEU)) {
	console.error(`Jeu d'icônes introuvable : ${JEU}`)
	console.error(`Installer d'abord : npm i -D @iconify-json/hugeicons`)
	process.exit(1)
}

// ── Ce dont l'application a besoin ───────────────────────────────────────────
const REF = /hugeicons:([a-z0-9-]+)/g

function parcourir(dir, out = []) {
	for (const e of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, e.name)
		if (e.isDirectory()) parcourir(p, out)
		else if (/\.(svelte|ts)$/.test(e.name)) out.push(p)
	}
	return out
}

const demandes = new Set()
for (const f of parcourir(SRC)) {
	const txt = readFileSync(f, 'utf8')
	for (let m; (m = REF.exec(txt)); ) demandes.add(m[1])
}

if (!demandes.size) {
	console.log('Aucune icône `hugeicons:` référencée. Bundle vide écrit.')
}

// ── Extraction ───────────────────────────────────────────────────────────────
const jeu = JSON.parse(readFileSync(JEU, 'utf8'))
const icons = {}
const manquantes = []

for (const nom of [...demandes].sort()) {
	const ic = jeu.icons[nom]
	if (!ic) { manquantes.push(nom); continue }
	icons[nom] = ic
}

if (manquantes.length) {
	console.error(`\n${manquantes.length} icône(s) demandée(s) mais absente(s) du jeu :`)
	for (const n of manquantes) console.error(`  hugeicons:${n}`)
	console.error(`\nCorriger le nom dans src/lib/uiIcons.ts. Rien n'a été écrit :`)
	console.error(`un bundle amputé donnerait des trous invisibles en développement.`)
	process.exit(1)
}

const bundle = {
	prefix: jeu.prefix,
	width:  jeu.width  ?? 24,
	height: jeu.height ?? 24,
	icons,
}

mkdirSync(dirname(SORTIE), { recursive: true })
writeFileSync(SORTIE, JSON.stringify(bundle, null, 0) + '\n')

const poids = (JSON.stringify(bundle).length / 1024).toFixed(1)
console.log(`${Object.keys(icons).length} icône(s) bundlée(s), ${poids} Ko`)
console.log(`-> ${SORTIE.replace(RACINE + '/', '')}`)
