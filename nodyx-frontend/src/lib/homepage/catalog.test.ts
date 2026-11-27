import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import fr from '$lib/locales/fr.json'
import en from '$lib/locales/en.json'
import { CATALOG, CATALOG_GROUPS, catalogGroup, normalize } from './catalog'

// Les identifiants du registre, lus dans les fichiers des plugins (le registre importe des
// composants Svelte, que ces tests ne savent pas charger).
const PLUGINS_DIR = resolve(__dirname, '../components/homepage/plugins')
const registre = readFileSync(resolve(PLUGINS_DIR, 'index.ts'), 'utf-8')
const idsDuRegistre = readdirSync(PLUGINS_DIR)
	.filter(f => f.endsWith('.ts') && !f.startsWith('_') && f !== 'index.ts' && !f.endsWith('Schema.ts'))
	.filter(f => registre.includes(`from './${f.replace(/\.ts$/, '')}'`))
	.map(f => readFileSync(resolve(PLUGINS_DIR, f), 'utf-8').match(/^\s*id:\s*'([^']+)'/m)?.[1])
	.filter((x): x is string => !!x)
	.sort()

const t = (k: string) => (fr as Record<string, string>)[k] ?? k

describe('le catalogue « Ajouter un bloc »', () => {
	it('chaque bloc du registre a sa fiche, et aucune fiche ne vise un bloc qui n’existe pas', () => {
		expect(idsDuRegistre.length).toBeGreaterThanOrEqual(11)
		expect(CATALOG.map(e => e.id).sort()).toEqual(idsDuRegistre)
	})

	it('chaque fiche a son nom et sa phrase en français ET en anglais', () => {
		for (const e of CATALOG) for (const key of [e.nameKey, e.descKey]) {
			expect((fr as Record<string, string>)[key], key).toBeTruthy()
			expect((en as Record<string, string>)[key], key).toBeTruthy()
		}
	})

	it('chaque famille a des blocs, et les familles ont leur titre traduit', () => {
		for (const g of CATALOG_GROUPS) {
			expect(CATALOG.some(e => e.group === g)).toBe(true)
			expect((fr as Record<string, string>)[`hpe.group_${g}`]).toBeTruthy()
			expect((en as Record<string, string>)[`hpe.group_${g}`]).toBeTruthy()
		}
	})

	it('chaque croquis tient dans son cadre de 100 × 56', () => {
		for (const e of CATALOG) {
			expect(e.sketch.length).toBeGreaterThan(0)
			for (const s of e.sketch) {
				expect(s.x).toBeGreaterThanOrEqual(0); expect(s.y).toBeGreaterThanOrEqual(0)
				expect(s.x + s.w).toBeLessThanOrEqual(100.01); expect(s.y + s.h).toBeLessThanOrEqual(56.01)
			}
		}
	})

	it('la recherche ignore accents et majuscules, et cherche aussi dans la phrase', () => {
		expect(normalize('  Bannière ')).toBe('banniere')
		expect(catalogGroup('welcome', 'banniere', t).map(e => e.id)).toContain('hero-banner')
		expect(catalogGroup('life', 'FORUM', t).map(e => e.id)).toContain('recent-threads')
		expect(catalogGroup('welcome', 'zzz-rien', t)).toEqual([])
		expect(catalogGroup('life', '', t).length).toBe(CATALOG.filter(e => e.group === 'life').length)
	})
})
