import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateEntry, latestVersion, type RegistryEntry } from './registry'

// Valide les entrees REELLES du registre, pas des fixtures.
//
// C'est ce qui fait qu'une PR de publication ne peut pas casser l'index : la
// verification tourne en CI comme n'importe quel test, sans dependre du
// depouillement de types de Node dans un script a part.

const DIR = join(process.cwd(), 'registry')
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))

describe('entrees reelles du registre', () => {
	it('le registre n est pas vide', () => {
		expect(files.length).toBeGreaterThan(0)
	})

	it.each(files)('%s est un JSON valide et une entree conforme', (file) => {
		const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
		const issues = validateEntry(raw)
		if (issues.length) {
			throw new Error(`${file} :\n` + issues.map((i) => `  ${i.path || '(racine)'} : ${i.message}`).join('\n'))
		}
	})

	it.each(files)('%s porte un identifiant egal a son nom de fichier', (file) => {
		// Sans cette regle, deux fichiers pourraient declarer le meme
		// identifiant et l'index en garderait un au hasard.
		const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as RegistryEntry
		expect(`${raw.id}.json`).toBe(file)
	})

	it.each(files)('%s a une version publiee exploitable', (file) => {
		const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as RegistryEntry
		const latest = latestVersion(raw)
		expect(latest).not.toBeNull()
		expect(latest!.url).toMatch(/^https:\/\//)
	})
})
