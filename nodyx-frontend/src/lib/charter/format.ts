// Petites mises en forme de la page Chartes (lot 7c) et du Journal : un temps de
// lecture (« 1 min 32 ») et un moment (« il y a 4 min »). Pur, testé.
type T = (key: string, vars?: Record<string, string | number>) => string

/** Une durée de lecture : « 58 s », « 1 min 32 », « 3 min ». */
export function fmtDuration(ms: number, tFn: T): string {
	const s = Math.max(0, Math.round(ms / 1000))
	if (s < 60) return tFn('og2.dur_s', { s })
	const m = Math.floor(s / 60), r = s % 60
	return r ? tFn('og2.dur_min_s', { m, s: String(r).padStart(2, '0') }) : tFn('og2.dur_min', { m })
}

/** « il y a 4 min », « hier », « il y a 3 jours » dans la langue de la page. */
export function ago(iso: string, loc: string, now = Date.now()): string {
	const diff = (Date.parse(iso) - now) / 1000
	const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' })
	const abs = Math.abs(diff)
	if (abs < 60) return rtf.format(Math.round(diff), 'second')
	if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute')
	if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour')
	if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), 'day')
	if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), 'month')
	return rtf.format(Math.round(diff / (86400 * 365)), 'year')
}
