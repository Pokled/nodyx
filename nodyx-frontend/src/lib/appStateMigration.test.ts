import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * `$app/stores` est formellement déprécié, on ne le réintroduit pas.
 *
 * Pourquoi (2026-08-17)
 * ────────────────────
 * SvelteKit marque `page`, `navigating` et `updated` de `$app/stores` en
 * `@deprecated` au profit de `$app/state`, qui exige Svelte 5 — ce que ce projet
 * utilise. L'API partira en SvelteKit 3.
 *
 * La migration a touché 45 fichiers et 140 occurrences. Sans ce contrôle, un
 * seul copier-coller depuis un vieux fichier ou une réponse d'assistant suffit à
 * réintroduire l'ancienne API, et on repart pour une deuxième migration.
 *
 * Ce que ce contrôle NE prétend PAS régler : l'alerte « Cannot find module
 * '$app/stores' » d'un éditeur. Elle vient du serveur TypeScript qui ne charge
 * pas le tsconfig du projet, pas du code. Vérifié : `.svelte-kit/ambient.d.ts`
 * porte déjà le `/// <reference types="@sveltejs/kit" />` nécessaire, et `tsc`
 * résout `$app/*` dès qu'on lui donne ce fichier.
 */

const SRC = new URL('..', import.meta.url).pathname

function fichiers(dir: string, acc: string[] = []): string[] {
	for (const e of readdirSync(dir)) {
		if (e === 'node_modules' || e === '.svelte-kit') continue
		const p = join(dir, e)
		if (statSync(p).isDirectory()) fichiers(p, acc)
		else if (/\.(svelte|ts|js)$/.test(e)) acc.push(p)
	}
	return acc
}

// Ce fichier CITE l'ancienne API dans ses commentaires : sans cette exclusion,
// le controle se denonce lui-meme.
const MOI = 'appStateMigration.test.ts'
const TOUS = fichiers(SRC)
	.filter((p) => !p.endsWith(MOI))
	.map((p) => [p, readFileSync(p, 'utf-8')] as const)

describe('migration vers $app/state', () => {
	it('ne réintroduit aucun import de $app/stores', () => {
		const coupables = TOUS.filter(([, s]) => s.includes('$app/stores')).map(([p]) =>
			p.slice(p.indexOf('/src/') + 1),
		)
		expect(coupables, 'ces fichiers utilisent une API dépréciée').toEqual([])
	})

	it("n'utilise plus la syntaxe de store $page", () => {
		// `$app/state` expose un objet réactif, pas un store : `$page` ne compile
		// simplement plus. Le contrôle attrape surtout les copier-coller.
		const coupables = TOUS.filter(([, s]) => /\$page\b/.test(s)).map(([p]) =>
			p.slice(p.indexOf('/src/') + 1),
		)
		expect(coupables, 'ces fichiers utilisent encore $page').toEqual([])
	})
})
