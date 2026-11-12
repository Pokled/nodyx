import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { escHtml } from './i18n'

// Sécurité (12/11/2026). Un texte traduit rendu en {@html} reçoit parfois une
// variable : un pseudo, un nom affiché, une recherche. La traduction ne
// l'échappe pas. Sans escHtml, un pseudo comme `<img src=x onerror=…>`
// s'exécutait chez qui lit la page (dont l'admin). Ce test fait échouer le
// build si une NOUVELLE variable arrive sans échappement.

const ROOT = join(__dirname, '..')
function svelteFiles(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name)
		if (statSync(p).isDirectory()) svelteFiles(p, out)
		else if (p.endsWith('.svelte')) out.push(p)
	}
	return out
}

/** Les variables d'un `{@html tFn('cle', { a: x, b: y })}` qui ne passent pas par escHtml. */
export function unescapedVars(source: string): string[] {
	const bad: string[] = []
	const re = /\{@html\s+(?:tFn|\$t)\(\s*'[^']+'\s*,\s*\{([^}]*)\}\s*\)\s*\}/g
	let m: RegExpExecArray | null
	while ((m = re.exec(source))) {
		const body = m[1]
		const keys = /([A-Za-z_]\w*)\s*:\s*/g
		let k: RegExpExecArray | null
		while ((k = keys.exec(body))) {
			const rest = body.slice(k.index + k[0].length)
			if (!rest.startsWith('escHtml(')) bad.push(`${k[1]} ← ${rest.split(',')[0].trim()}`)
		}
	}
	return bad
}

describe('les variables des textes traduits rendus en {@html}', () => {
	it('sont toutes échappées, dans tout le site', () => {
		const offenders = svelteFiles(ROOT).flatMap((f) => unescapedVars(readFileSync(f, 'utf8')).map((v) => `${f.replace(ROOT + '/', '')} : ${v}`))
		expect(offenders).toEqual([])
	})
	it('le détecteur attrape bien un oubli (sinon il ne garde rien)', () => {
		expect(unescapedVars(`{@html tFn('a.b', { name: user.name })}`)).toEqual(['name ← user.name'])
		expect(unescapedVars(`{@html tFn('a.b', { name: escHtml(user.name), n: count })}`)).toEqual(['n ← count'])
		expect(unescapedVars(`{@html tFn('a.b', { name: escHtml(user.name) })}`)).toEqual([])
		expect(unescapedVars(`{@html tFn('a.b')}`)).toEqual([])
	})
	it('escHtml neutralise le HTML et garde le texte', () => {
		expect(escHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
		expect(escHtml("Léa & Max's")).toBe('Léa &amp; Max&#39;s')
		expect(escHtml(null)).toBe('')
	})
})
