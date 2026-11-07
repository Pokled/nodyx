// « Ce que l'auteur a modifié » : différence mot à mot entre la version
// d'origine et la version actuelle (plus longue sous-suite commune).
// Borné : au-delà de 1500 mots de chaque côté, on ne calcule pas (le coût
// est quadratique) et l'écran montre les deux versions l'une sous l'autre.
export type DiffPart = { kind: 'same' | 'del' | 'ins'; text: string }
export const DIFF_MAX_WORDS = 1500

const words = (s: string) => s.split(/(\s+)/).filter((w) => w.length > 0)

export function wordDiff(before: string, after: string): DiffPart[] | null {
	const a = words(before), b = words(after)
	if (a.length > DIFF_MAX_WORDS || b.length > DIFF_MAX_WORDS) return null
	const n = a.length, m = b.length
	const L: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
	for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
		L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
	const out: DiffPart[] = []
	const push = (kind: DiffPart['kind'], text: string) => {
		const last = out[out.length - 1]
		if (last && last.kind === kind) last.text += text
		else out.push({ kind, text })
	}
	let i = 0, j = 0
	while (i < n && j < m) {
		if (a[i] === b[j]) { push('same', a[i]); i++; j++ }
		else if (L[i + 1][j] >= L[i][j + 1]) push('del', a[i++])
		else push('ins', b[j++])
	}
	while (i < n) push('del', a[i++])
	while (j < m) push('ins', b[j++])
	return regroup(out)
}

/**
 * « va crever » → « quitte le serveur » doit se lire comme UN remplacement,
 * pas « va » barré, une espace, « crever » barré : un blanc seul entre deux
 * changements rejoint le changement, puis tout ce qui est retiré passe avant
 * tout ce qui est ajouté.
 */
function regroup(parts: DiffPart[]): DiffPart[] {
	const out: DiffPart[] = []
	let del = '', ins = ''
	const flush = () => {
		if (del) out.push({ kind: 'del', text: del })
		if (ins) out.push({ kind: 'ins', text: ins })
		del = ''; ins = ''
	}
	parts.forEach((p, k) => {
		const between = p.kind === 'same' && /^\s+$/.test(p.text) && (del || ins) && parts[k + 1] && parts[k + 1].kind !== 'same'
		if (p.kind === 'del' || between) del += p.text
		if (p.kind === 'ins' || between) ins += p.text
		if (p.kind === 'same' && !between) { flush(); out.push(p) }
	})
	flush()
	return out
}
