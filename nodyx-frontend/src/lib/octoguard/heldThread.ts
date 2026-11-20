// Le fil d'un dossier « À relire » (#1064) : deux défauts vus sur les vraies données de
// nodyx.org le 20/11. Des messages de septembre ne montraient que leur heure (on les
// croyait du jour), et un sondage sans texte s'affichait vide.

/** Le jour d'un instant, dans le fuseau de l'écran : AAAA-MM-JJ. */
export function dayKey(iso: string): string {
	const d = new Date(iso)
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Faut-il un séparateur de jour avant ce message ? (le premier du fil, ou un jour nouveau) */
export function startsDay(ats: string[], i: number): boolean {
	return i === 0 || dayKey(ats[i]) !== dayKey(ats[i - 1])
}

/** « Aujourd'hui », « Hier », sinon le jour en toutes lettres (l'année seulement si ce n'est pas celle-ci). */
export function dayLabel(iso: string, now: Date, locale: string, tFn: (k: string) => string): string {
	const d = new Date(iso)
	const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
	if (dayKey(iso) === dayKey(now.toISOString())) return tFn('og2.rv_today')
	if (dayKey(iso) === dayKey(yesterday.toISOString())) return tFn('og2.rv_yesterday')
	const s = d.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) })
	return s.charAt(0).toLocaleUpperCase(locale) + s.slice(1)
}

/** Ce qu'est un message sans texte : un sondage, un jeu, une image, sinon « sans texte ». null : il a du texte. */
export function noTextKind(text: string | null, html: string | null, flags: { poll?: boolean; game?: boolean } = {}): 'poll' | 'game' | 'image' | 'empty' | null {
	if (text !== null && text.trim() !== '') return null
	if (flags.poll) return 'poll'
	if (flags.game) return 'game'
	if (html && /<img\b/i.test(html)) return 'image'
	return 'empty'
}
