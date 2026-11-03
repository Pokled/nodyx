// Mots interdits d'OctoGuard, côté navigateur.
//
// Copie fidèle du moteur (nodyx-core/src/services/octoguard/matchers2.ts) :
// l'essai en direct de l'écran « Mes règles » doit dire exactement ce que le
// serveur fera. Toute évolution du moteur se reporte ici, et keywords.test.ts
// rejoue les mêmes cas que les tests du cœur.
//
// Syntaxe stockée (params.words) : « mot » mot entier, « mot* » début de mot,
// « *mot* » n'importe où. L'écran ne montre jamais cette syntaxe : il range
// les mots en trois cases (splitWords / joinWords).

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '€': 'e' }

/** Forme comparable : minuscules, sans accents, chiffres « leet » remplacés. */
export function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{M}+/gu, '')
		.replace(/[013457@$!€]/g, (c) => LEET[c] ?? c)
}

const lettersOnly = (s: string) => normalize(s).replace(/[^\p{L}]/gu, '')

/** Mots du message, plus les mots épelés (c.o.n ou c o n) recollés. */
export function tokensOf(text: string): string[] {
	const n = normalize(text)
	const tokens = n.split(/[^\p{L}]+/u).filter(Boolean)
	const spelled = n.match(/(?:^|[^\p{L}])((?:\p{L}[\s.\-_*·]+){2,}\p{L})(?=$|[^\p{L}])/gu) ?? []
	for (const run of spelled) tokens.push(run.replace(/[^\p{L}]/gu, ''))
	return tokens
}

export type WordKind = 'exact' | 'prefix' | 'contains'
export type Pattern = { kind: WordKind; value: string; raw: string }

/** Même règle que le moteur : moins de 2 lettres, le mot est ignoré. */
export function compile(word: string): Pattern | null {
	const raw = word.trim()
	if (!raw) return null
	const starts = raw.startsWith('*')
	const ends = raw.endsWith('*')
	const value = lettersOnly(raw.replace(/^\*|\*$/g, ''))
	if (value.length < 2) return null
	return { kind: starts && ends ? 'contains' : ends ? 'prefix' : 'exact', value, raw }
}

export function hits(p: Pattern, token: string): boolean {
	return p.kind === 'exact' ? token === p.value : p.kind === 'prefix' ? token.startsWith(p.value) : token.includes(p.value)
}

/** Le verdict du moteur pour un message entier : le premier mot interdit trouvé. */
export function matchKeywords(content: string, words: string[], exceptions: string[] = []): Pattern | null {
	const patterns = words.slice(0, 500).map(compile).filter((p): p is Pattern => !!p)
	if (patterns.length === 0) return null
	const except = new Set(exceptions.map(lettersOnly))
	const tokens = tokensOf(content).filter((t) => !except.has(t))
	for (const p of patterns) if (tokens.some((t) => hits(p, t))) return p
	return null
}

// ─── Les trois cases de l'écran ──────────────────────────────────────────────

export type WordLists = { exact: string[]; prefix: string[]; contains: string[] }

/** Le mot tel que l'admin l'a tapé, sans les étoiles de la syntaxe stockée. */
export const bare = (raw: string) => raw.trim().replace(/^\*+|\*+$/g, '')

export function splitWords(words: string[]): WordLists {
	const out: WordLists = { exact: [], prefix: [], contains: [] }
	for (const w of words) {
		const p = compile(w)
		if (p) out[p.kind].push(bare(w))
	}
	return out
}

export function joinWords(l: WordLists): string[] {
	return [...l.exact, ...l.prefix.map((w) => `${w}*`), ...l.contains.map((w) => `*${w}*`)]
}

/** Un mot est-il assez long pour que le moteur le prenne en compte ? */
export const usable = (w: string) => lettersOnly(w).length >= 2

// ─── Affichage : surligner ce qui serait pris, texte tel que tapé ────────────

export type Segment =
	| { text: string; state: 'plain' }
	| { text: string; state: 'hit'; pattern: Pattern }
	| { text: string; state: 'allowed' }

// Un mot épelé (« c.o.n » ou « c o n ») reste UN segment ; sinon une suite de
// lettres ou de chiffres « leet » (« c0nn4rd »). Le reste passe tel quel.
const SEGMENT = /(?:[\p{L}013457@$!€][\s.\-_*·]+){2,}[\p{L}013457@$!€](?![\p{L}013457@$!€])|[\p{L}\p{M}013457@$!€]+/gu

export function scan(content: string, words: string[], exceptions: string[] = []): Segment[] {
	const patterns = words.map(compile).filter((p): p is Pattern => !!p)
	const except = new Set(exceptions.map(lettersOnly))
	const out: Segment[] = []
	let last = 0
	for (const m of content.matchAll(SEGMENT)) {
		const text = m[0]
		const at = m.index ?? 0
		if (at > last) out.push({ text: content.slice(last, at), state: 'plain' })
		last = at + text.length
		const parts = tokensOf(text)
		// Un mot épelé ne vaut que recollé ; un mot ordinaire peut contenir des
		// chiffres non « leet » qui le coupent (« abc9def ») : on teste chaque morceau.
		const token = parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? ''
		const candidates = /[\s.\-_*·]/.test(text) ? [token] : parts
		if (candidates.some((t) => except.has(t))) { out.push({ text, state: 'allowed' }); continue }
		const p = patterns.find((pat) => candidates.some((t) => hits(pat, t)))
		out.push(p ? { text, state: 'hit', pattern: p } : { text, state: 'plain' })
	}
	if (last < content.length) out.push({ text: content.slice(last), state: 'plain' })
	return out
}

/** Les mots innocents qu'un « début de mot » ou un « n'importe où » prendrait aussi. */
export function overreach(l: WordLists, exceptions: string[], sample: readonly string[]): Array<{ kind: WordKind; word: string; caught: string[] }> {
	const except = new Set(exceptions.map(lettersOnly))
	const out: Array<{ kind: WordKind; word: string; caught: string[] }> = []
	for (const kind of ['prefix', 'contains'] as const) {
		for (const word of l[kind]) {
			const p = compile(kind === 'prefix' ? `${word}*` : `*${word}*`)
			if (!p) continue
			const caught = sample.filter((s) => {
				const t = lettersOnly(s)
				return t !== p.value && !except.has(t) && hits(p, t)
			})
			if (caught.length) out.push({ kind, word, caught })
		}
	}
	return out
}
