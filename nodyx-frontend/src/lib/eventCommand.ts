// « /événement Pizza vendredi 20h » (lot C3, maquette https://nodyx.org/commandes-maquette.html,
// D57) : ce que Nodyx comprend AVANT toute publication. Rien n'est jamais créé ici : le
// formulaire s'ouvre déjà rempli, la personne vérifie et publie. L'outil propose.
//
// Compris, en français et en anglais : aujourd'hui / today, demain / tomorrow, un jour de
// la semaine (le prochain ; le jour même s'il reste du temps), 21/11 ou 21/11/2027
// (jour/mois), et l'heure : 20h, 20h30, 20:30, 8pm, 8:30pm. Le reste est le titre.
// Rien de compris : pas de date, l'aperçu le dit et le formulaire garde sa date par défaut.

// « /événement », « /évènement », « /evenement », « /event » (\u00e9 é, \u00e8 è ; majuscules par le drapeau i)
export const EVENT_COMMAND = /^\/(?:[e\u00e9]v[e\u00e9\u00e8]nement|event)(?=\s|$)\s*([\s\S]*)$/i

export interface EventDraft {
	title: string
	/** Le jour compris (heure locale du navigateur), ou null. */
	day: { y: number; m: number; d: number } | null
	/** L'heure comprise, ou null. */
	time: { h: number; mi: number } | null
}

const DAYS: Record<string, number> = {
	dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
	sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')

/** Un jour qui existe vraiment (pas de 31/02). */
function realDay(y: number, m: number, d: number): boolean {
	const t = new Date(y, m - 1, d)
	return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d
}

export function parseEventDraft(text: string, now: Date = new Date()): EventDraft {
	let words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
	let time: EventDraft['time'] = null
	let day: EventDraft['day'] = null
	let weekday: number | null = null
	let relative: 0 | 1 | null = null
	const keep: string[] = []

	for (let i = 0; i < words.length; i++) {
		const w = words[i]
		const f = fold(w).replace(/[.,;!?]+$/, '')
		// « à 20h », « at 8pm » : le petit mot part avec l'heure
		const next = words[i + 1] ? fold(words[i + 1]) : ''
		if ((f === 'a' || f === 'at') && /^\d{1,2}(h\d{0,2}|:\d{2}|(:\d{2})?(am|pm))$/.test(next) && !time) continue
		let m: RegExpExecArray | null
		if (!time && (m = /^(\d{1,2})h(\d{2})?$/.exec(f)) && +m[1] < 24 && +(m[2] ?? 0) < 60) { time = { h: +m[1], mi: +(m[2] ?? 0) }; continue }
		if (!time && (m = /^(\d{1,2}):(\d{2})$/.exec(f)) && +m[1] < 24 && +m[2] < 60) { time = { h: +m[1], mi: +m[2] }; continue }
		if (!time && (m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(f)) && +m[1] >= 1 && +m[1] <= 12 && +(m[2] ?? 0) < 60) {
			time = { h: (+m[1] % 12) + (m[3] === 'pm' ? 12 : 0), mi: +(m[2] ?? 0) }; continue
		}
		if (!day && weekday === null && relative === null) {
			if (f === "aujourd'hui" || f === 'aujourd’hui' || f === 'today') { relative = 0; continue }
			if (f === 'demain' || f === 'tomorrow') { relative = 1; continue }
			if (f in DAYS) { weekday = DAYS[f]; continue }
			if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/.exec(f))) {
				const d = +m[1], mo = +m[2]
				let y = m[3] ? +m[3] : now.getFullYear()
				if (realDay(y, mo, d)) {
					// Sans année et déjà passé cette année : l'an prochain
					if (!m[3] && new Date(y, mo - 1, d, 23, 59) < now) y += 1
					if (realDay(y, mo, d)) { day = { y, m: mo, d }; continue }
				}
			}
		}
		keep.push(w)
	}

	const at = (offset: number) => {
		const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset)
		return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() }
	}
	const passed = (d: { y: number; m: number; d: number }) =>
		time ? new Date(d.y, d.m - 1, d.d, time.h, time.mi) <= now : false

	if (relative !== null) day = at(relative)
	else if (weekday !== null) {
		let offset = (weekday - now.getDay() + 7) % 7
		// Le jour même : seulement s'il reste du temps (« vendredi 20h » dit un vendredi à 18 h)
		if (offset === 0 && (!time || passed(at(0)))) offset = 7
		day = at(offset)
	} else if (!day && time) {
		// L'heure seule : aujourd'hui, ou demain si elle est passée
		day = passed(at(0)) ? at(1) : at(0)
	}
	return { title: keep.join(' ').trim().slice(0, 200), day, time }
}

/** La valeur à donner au formulaire (heure locale, sans fuseau), ou null. */
export function draftStart(d: EventDraft): string | null {
	if (!d.day) return null
	const day = `${d.day.y}-${pad(d.day.m)}-${pad(d.day.d)}`
	return d.time ? `${day}T${pad(d.time.h)}:${pad(d.time.mi)}` : day
}

/** L'adresse du formulaire prérempli. */
export function draftUrl(d: EventDraft): string {
	const q = new URLSearchParams()
	if (d.title) q.set('title', d.title)
	const s = draftStart(d)
	if (s) q.set('start', s)
	const qs = q.toString()
	return '/calendar/new' + (qs ? `?${qs}` : '')
}

/**
 * Ce que le formulaire accepte de `?start=` : une date (AAAA-MM-JJ) ou une date et une
 * heure (AAAA-MM-JJTHH:MM) qui existent, et pas dans le passé. Sinon null.
 */
export function readStartParam(v: string | null, now: Date = new Date()): { date: string; time: string | null } | null {
	if (!v) return null
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(v)
	if (!m) return null
	const [y, mo, d] = [+m[1], +m[2], +m[3]]
	if (!realDay(y, mo, d)) return null
	if (m[4] !== undefined && (+m[4] > 23 || +m[5] > 59)) return null
	const when = new Date(y, mo - 1, d, m[4] !== undefined ? +m[4] : 23, m[4] !== undefined ? +m[5] : 59)
	if (when < now) return null
	return { date: `${m[1]}-${m[2]}-${m[3]}`, time: m[4] !== undefined ? `${m[4]}:${m[5]}` : null }
}

/** Le titre de `?title=` : texte simple, une ligne, 200 caractères au plus. */
export function readTitleParam(v: string | null): string {
	return (v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}
