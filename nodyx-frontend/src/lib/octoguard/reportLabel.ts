// Ce qu'on lit d'un signalement dans la file de l'équipe. Un signalement d'OctoGuard
// porte le nom de sa règle (« OctoGuard · Majuscules ») : c'est lui qu'on montre, et
// non la catégorie « Autre chose » qu'il reçoit faute de mieux (vu en prod le 20/11).

const OG_PREFIX = /^OctoGuard · (.+)$/

/** La clé de regroupement : la catégorie, ou « og:<règle> » pour OctoGuard. */
export function reportKey(r: { source?: string | null; category: string | null; reason: string }): string {
	if (r.source === 'octoguard') {
		const m = OG_PREFIX.exec(r.reason.trim())
		if (m) return 'og:' + m[1].trim()
	}
	return r.category ?? 'other'
}

/** Le texte d'une clé : le nom de la règle d'OctoGuard tel quel, sinon la catégorie traduite. */
export function reportKeyLabel(key: string, tFn: (k: string) => string): string {
	return key.startsWith('og:') ? key.slice(3) : tFn(`report.cat_${key}`)
}
