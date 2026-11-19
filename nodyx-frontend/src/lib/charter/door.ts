// La porte des membres (lot 7d ; maquette v3 validée le 19/11/2026, CDC §E4j) :
// les règles pures, testées sans navigateur. Le serveur garde le dernier mot (la fausse
// case, le chrono, l'arrivée en bas, la version) ; ce qui est vérifié ici l'est pour
// guider l'humain, pas pour arrêter un robot qui piloterait un vrai navigateur.

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * Les variables d'une charte, remplacées pour celui qui lit. Les deux langues sont
 * reconnues ({communauté} / {community}, {pseudo} / {username}). Les valeurs sont
 * ÉCHAPPÉES : un pseudo « <img onerror> » reste du texte, même dans un attribut.
 */
export function fillVars(html: string, community: string, user: string): string {
	// NFC : un « é » tapé en deux caractères (e + accent) reste reconnu
	return html.normalize('NFC')
		.replace(/\{(communaut\u00e9|community)\}/g, () => esc(community))
		.replace(/\{(pseudo|username)\}/g, () => esc(user))
}

/** « environ 2 min » : à 180 mots par minute, au moins une. */
export function readingMinutes(text: string): number {
	const words = text.trim().split(/\s+/).filter(Boolean).length
	return Math.max(1, Math.round(words / 180))
}

export type Point = { x: number; y: number }

/**
 * Un vrai geste ? (maquette, heuristique validée le 12/11 après un faux refus) : on compte
 * les RETOURNEMENTS (aller puis revenir, monter puis descendre), pas les angles vifs,
 * qu'une signature cursive n'a pas. Trait droit, point, gribouillis minuscule : non.
 */
export function strokeStats(strokes: Point[][]) {
	let turns = 0, len = 0
	let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
	for (const st of strokes) {
		let sx = 0, sy = 0
		for (let i = 0; i < st.length; i++) {
			const p = st[i]
			minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
			if (!i) continue
			const q = st[i - 1], dx = p.x - q.x, dy = p.y - q.y
			const nx = Math.abs(dx) > 1.5 ? Math.sign(dx) : 0, ny = Math.abs(dy) > 1.5 ? Math.sign(dy) : 0
			if (nx && sx && nx !== sx) turns++
			if (ny && sy && ny !== sy) turns++
			if (nx) sx = nx
			if (ny) sy = ny
			len += Math.hypot(dx, dy)
		}
	}
	const w = strokes.length ? maxX - minX : 0, h = strokes.length ? maxY - minY : 0
	return { turns, len, w, h, ok: len > 140 && w > 60 && h > 14 && turns >= 3 }
}

/** La phrase recopiée : ni la casse, ni la ponctuation, ni les espaces ne comptent. */
export function samePhrase(a: string, b: string): boolean {
	const norm = (s: string) => s.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
	return norm(a) !== '' && norm(a) === norm(b)
}

/** Le refus du serveur, en mots pour le membre (un robot reçoit le même que tout le monde). */
export function refusalKey(code: string | null | undefined): string {
	switch (code) {
		case 'CHARTER_TYPE_IT': return 'charter.err_type_it'
		case 'CHARTER_NOT_READ': return 'charter.err_not_read'
		case 'CHARTER_VERSION_CHANGED': return 'charter.err_version'
		case 'CHARTER_PLEDGE_REQUIRED': return 'charter.err_pledge'
		default: return 'charter.err_refused'
	}
}
