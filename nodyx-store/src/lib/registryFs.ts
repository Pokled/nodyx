// Lecture du registre depuis le disque, cote serveur uniquement.
//
// Separe de `registry.ts` a dessein : le modele reste pur et testable, et
// seule cette couche connait le systeme de fichiers.

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateEntry, type RegistryEntry } from './registry'

const DIR = join(process.cwd(), 'registry')

let cache: RegistryEntry[] | null = null

/**
 * Charge et VALIDE toutes les entrees.
 *
 * Une entree invalide est ignoree avec un avertissement plutot que de faire
 * tomber le site : un magasin qui refuse de s'afficher parce qu'une fiche sur
 * quarante est mal ecrite ne sert personne. Le verificateur en ligne de
 * commande, lui, refuse la PR en amont.
 */
export function loadRegistry(): RegistryEntry[] {
	if (cache) return cache

	const out: RegistryEntry[] = []
	let files: string[] = []
	try {
		files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
	} catch {
		return (cache = [])
	}

	for (const file of files) {
		try {
			const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'))
			const issues = validateEntry(raw)
			if (issues.length) {
				console.warn(`[registre] ${file} ignore : ${issues.map((i) => `${i.path} ${i.message}`).join(', ')}`)
				continue
			}
			out.push(raw as RegistryEntry)
		} catch (e) {
			console.warn(`[registre] ${file} illisible : ${(e as Error).message}`)
		}
	}

	return (cache = out)
}

/** Vide le cache. Utile aux tests et a un rechargement a chaud. */
export function resetRegistryCache(): void {
	cache = null
}
