// L'heure d'un événement (audit du 14/11/2026, SPECS/NODYX_EVENEMENTS_AUDIT.md, B1 à B3).
//
// Le défaut : le formulaire envoyait « 2026-11-20T20:00 » sans fuseau, et c'est le
// SERVEUR (en UTC) qui le convertissait. 20 h tapé en France devenait 21 h affiché
// l'hiver, 22 h l'été. La valeur par défaut et le formulaire de modification
// passaient par `toISOString()` : en UTC aussi, donc décalés.
//
// La règle maintenant :
//  - le NAVIGATEUR, qui connaît le fuseau du membre, convertit l'heure tapée en
//    instant universel au moment de l'envoi (`sendIso`) ; le serveur ne devine plus ;
//  - les champs du formulaire montrent l'heure LOCALE (`inputValue`) ;
//  - « toute la journée » est une date de calendrier, pas un instant : enregistrée à
//    minuit UTC, affichée en UTC (`displayZone`), la même date pour tout le monde.

const pad = (n: number) => String(n).padStart(2, '0')

/** Ce qu'un champ date / datetime-local doit montrer, à l'heure du navigateur. */
export function inputValue(iso: string | null | undefined, allDay: boolean): string {
	if (!iso) return ''
	const d = new Date(iso)
	if (isNaN(d.getTime())) return ''
	if (allDay) return d.toISOString().slice(0, 10)   // date de calendrier (minuit UTC)
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** La valeur tapée devenue instant universel. null : vide ou illisible. */
export function isoFromInput(value: string, allDay: boolean): string | null {
	if (!value) return null
	if (allDay || /^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value.slice(0, 10)}T00:00:00.000Z`
	const d = new Date(value)                       // sans fuseau : lu à l'heure du navigateur
	return isNaN(d.getTime()) ? null : d.toISOString()
}

/** Demain à `hour` h (heure du membre), décalé de `plusHours`. */
export function defaultLocal(hour = 18, plusHours = 0): string {
	const d = new Date()
	d.setDate(d.getDate() + 1)
	d.setHours(hour + plusHours, 0, 0, 0)
	return inputValue(d.toISOString(), false)
}

/** Fuseau d'affichage : UTC pour une journée entière (une date), celui du lecteur sinon. */
export function displayZone(allDay: boolean): { timeZone?: string } {
	return allDay ? { timeZone: 'UTC' } : {}
}

/**
 * Action sur un champ date / datetime-local : au moment où le formulaire est envoyé
 * (événement `formdata`, déclenché par l'envoi normal comme par `use:enhance`), ajoute
 * `<nom>_iso`, l'instant universel calculé par le navigateur.
 */
export function sendIso(node: HTMLInputElement) {
	const form = node.form
	if (!form) return
	const onData = (e: FormDataEvent) => {
		const iso = isoFromInput(node.value, node.type === 'date')
		if (iso) e.formData.set(`${node.name}_iso`, iso)
		else e.formData.delete(`${node.name}_iso`)
	}
	form.addEventListener('formdata', onData)
	return { destroy() { form.removeEventListener('formdata', onData) } }
}

/** Côté serveur (actions SvelteKit) : l'instant envoyé par le navigateur, sinon l'ancien repli. */
export function isoFromForm(form: FormData, name: string): string | null {
	const sent = form.get(`${name}_iso`)
	if (typeof sent === 'string' && sent && !isNaN(Date.parse(sent))) return new Date(sent).toISOString()
	// Repli sans JavaScript : ancien comportement (le fuseau du serveur), signalé par l'absence de _iso
	const v = form.get(name)
	if (typeof v !== 'string' || !v) return null
	if (!v.includes('T')) return `${v}T00:00:00.000Z`
	const d = new Date(v)
	return isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * La phrase à montrer quand le cœur refuse un événement (clé i18n), au lieu de son
 * message technique (« ends_at: EVENT_ENDS_BEFORE_START »). null : message du cœur.
 */
export function eventErrorKey(json: { code?: string; error?: string } | null | undefined): string | null {
	const code = json?.code ?? '', msg = json?.error ?? ''
	if (code === 'COVER_URL_INVALID') return 'event.cover_invalid'
	if (code === 'EVENT_ENDS_BEFORE_START' || msg.includes('EVENT_ENDS_BEFORE_START')) return 'event.err_ends_before'
	if (msg.includes('TICKET_URL_INVALID')) return 'event.err_ticket_url'
	if (/location_l(at|ng)/.test(msg)) return 'event.err_coords'
	if (code === 'EVENT_FORBIDDEN') return 'event.err_forbidden'
	return null
}
