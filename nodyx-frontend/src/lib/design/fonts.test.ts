import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { POLICES, POLICE_NODYX, PILE_SYSTEME, policeDe, type FontId } from './fonts'

const STATIC = resolve(__dirname, '../../../static')
const enStatic = (url: string) => resolve(STATIC, '.' + url)

describe('les polices servies par l’instance', () => {
	const avecFichier = (Object.entries(POLICES) as [FontId, (typeof POLICES)[FontId]][]).filter(([, p]) => p.css)

	it('la liste est exactement celle que le cœur accepte', () => {
		const coeur = readFileSync(resolve(__dirname, '../../../../nodyx-core/src/utils/shellTheme.ts'), 'utf-8')
		const m = coeur.match(/DESIGN_FONTS = \[([^\]]+)\]/)
		expect(m).not.toBeNull()
		const ids = [...m![1].matchAll(/'([a-z]+)'/g)].map(x => x[1]).sort()
		expect(Object.keys(POLICES).sort()).toEqual(ids)
	})

	for (const [id, p] of avecFichier) {
		it(`${id} : la feuille existe, chaque fichier qu’elle cite aussi, et la licence est à côté`, () => {
			const css = readFileSync(enStatic(p.css!), 'utf-8')
			const urls = [...css.matchAll(/url\('([^']+)'\)/g)].map(x => x[1])
			expect(urls.length).toBeGreaterThan(0)
			for (const u of urls) {
				expect(u.startsWith('/fonts/')).toBe(true)       // jamais une adresse extérieure
				expect(existsSync(enStatic(u))).toBe(true)
			}
			const dossier = p.css!.replace(/\/font\.css$/, '')
			expect(readFileSync(enStatic(dossier + '/OFL.txt'), 'utf-8')).toMatch(/SIL Open Font License/)
			// La famille déclarée dans la feuille est celle que l'on met dans font-family
			const familles = new Set([...css.matchAll(/font-family:\s*'([^']+)'/g)].map(x => x[1]))
			expect([...familles]).toEqual([p.famille.match(/^'([^']+)'/)![1]])
		})
	}

	it('toutes couvrent le latin étendu (le français, l’espagnol, le portugais…)', () => {
		for (const [, p] of avecFichier) expect(readFileSync(enStatic(p.css!), 'utf-8')).toMatch(/latin-ext/)
	})

	it('chaque police retombe sur celle de l’appareil, qui ne charge rien', () => {
		for (const p of Object.values(POLICES)) expect(p.famille.endsWith(PILE_SYSTEME)).toBe(true)
		expect(POLICES.system.css).toBeNull()
	})

	it('un réglage absent ou inconnu donne Inter, jamais la valeur reçue', () => {
		expect(POLICE_NODYX).toBe('inter')
		expect(policeDe(undefined)).toBe(POLICES.inter)
		expect(policeDe("inter';}body{display:none")).toBe(POLICES.inter)
		expect(policeDe('toString')).toBe(POLICES.inter)
		expect(policeDe('geist')).toBe(POLICES.geist)
	})
})
