/**
 * ambianceTools.ts — les outils de l'écran Apparence autour de l'Ambiance
 * (SPECS/NODYX_APPARENCE_CDC.md) : historique Annuler/Rétablir, code
 * d'ambiance à partager entre instances, ambiances prêtes à l'emploi.
 * Fonctions pures, testées dans ambianceTools.test.ts.
 */
import { DEFAULT_SHELL_THEME, type ShellTheme } from './shellTheme'

// ── Historique Annuler / Rétablir ─────────────────────────────────────────

export interface History<T> { past: T[]; present: T; future: T[] }

const LIMIT = 50

export function historyStart<T>(present: T): History<T> {
	return { past: [], present, future: [] }
}

/**
 * Nouveau geste. `merge` fusionne avec le geste précédent au lieu d'empiler :
 * glisser le curseur d'intensité ou le sélecteur de couleur produit des
 * dizaines de valeurs, qu'on veut annuler d'un seul coup, pas une par une.
 */
export function historyPush<T>(h: History<T>, next: T, merge = false): History<T> {
	if (JSON.stringify(next) === JSON.stringify(h.present)) return h
	if (merge && h.past.length) return { past: h.past, present: next, future: [] }
	return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [] }
}

export function historyUndo<T>(h: History<T>): History<T> {
	if (!h.past.length) return h
	return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function historyRedo<T>(h: History<T>): History<T> {
	if (!h.future.length) return h
	return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

// ── Code d'ambiance à partager ────────────────────────────────────────────
// Une instance Nodyx peut donner son ambiance à une autre : un code court,
// versionné, à copier-coller. On n'y met que ce qui a du sens ailleurs :
// une image « personnalisée » est propre à son instance, elle devient la
// bannière de l'instance qui importe.

const PREFIX = 'NODYX-AMB-1:'

const b64url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))))

export function encodeAmbiance(t: ShellTheme): string {
	const backdrop = t.backdrop === 'custom' ? 'banner' : t.backdrop
	return PREFIX + b64url(JSON.stringify({ a: t.accent.toLowerCase(), b: backdrop, i: t.intensity, m: t.default_mode, n: t.neutrals ?? 'tinted' }))
}

/**
 * Code collé → ambiance, ou null si le code est invalide. Revalidé champ par
 * champ avec les MÊMES règles que le serveur : un code trafiqué ne peut rien
 * faire passer (le serveur revalide de toute façon à l'enregistrement).
 */
export function decodeAmbiance(code: string): ShellTheme | null {
	const s = code.trim()
	if (!s.startsWith(PREFIX) || s.length > 400) return null
	try {
		const o = JSON.parse(unb64url(s.slice(PREFIX.length)))
		if (typeof o !== 'object' || o === null) return null
		if (typeof o.a !== 'string' || !/^#[0-9a-f]{6}$/i.test(o.a)) return null
		if (o.b !== 'banner' && o.b !== 'none') return null
		if (!Number.isInteger(o.i) || o.i < 0 || o.i > 100) return null
		if (o.m !== 'dark' && o.m !== 'light' && o.m !== 'system') return null
		// `n` (fonds) est venu après les premiers codes : absent = gris teintés.
		if (o.n !== undefined && o.n !== 'graphite' && o.n !== 'tinted') return null
		return { accent: o.a.toLowerCase(), backdrop: o.b, backdrop_url: null, intensity: o.i, default_mode: o.m, neutrals: o.n ?? 'tinted' }
	} catch {
		return null
	}
}

// ── Ambiances prêtes à l'emploi ───────────────────────────────────────────
// Des ambiances COMPLÈTES (29/09, demande de Jonathan : « genre Matrix,
// cyberpunk, journal... ») : chacune fixe ce qui fait son caractère, et
// seulement ça. Un champ absent garde le réglage de l'admin (une ambiance
// nature ne force ni le mode ni le décor). Teintes choisies HORS des familles
// cyan et indigo-violet que le CDC contenant bannit (vérifié par les tests).

export interface AmbiancePreset { id: string; labelKey: string; theme: Partial<ShellTheme> }

export const ORIGINEL: AmbiancePreset = { id: 'originel', labelKey: 'appr.preset_originel', theme: { ...DEFAULT_SHELL_THEME } }

export const AMBIANCE_PRESETS: AmbiancePreset[] = [
	// Univers : ils fixent tout, décor et mode compris.
	{ id: 'matrix',    labelKey: 'appr.preset_matrix',    theme: { accent: '#22e36b', neutrals: 'tinted',   intensity: 85,  default_mode: 'dark',  backdrop: 'none' } },
	{ id: 'cyberpunk', labelKey: 'appr.preset_cyberpunk', theme: { accent: '#fcee0a', neutrals: 'tinted',   intensity: 100, default_mode: 'dark',  backdrop: 'banner' } },
	{ id: 'synthwave', labelKey: 'appr.preset_synthwave', theme: { accent: '#ff3fa4', neutrals: 'tinted',   intensity: 95,  default_mode: 'dark',  backdrop: 'banner' } },
	{ id: 'gazette',   labelKey: 'appr.preset_gazette',   theme: { accent: '#1c1c1c', neutrals: 'graphite', intensity: 0,   default_mode: 'light', backdrop: 'none' } },
	{ id: 'sepia',     labelKey: 'appr.preset_sepia',     theme: { accent: '#9c5b2e', neutrals: 'tinted',   intensity: 30,  default_mode: 'light', backdrop: 'banner' } },
	// Couleurs : elles ne touchent qu'à la teinte, aux fonds et à l'intensité.
	{ id: 'embers',    labelKey: 'appr.preset_embers',    theme: { accent: '#ff7a3d', neutrals: 'tinted',   intensity: 70 } },
	{ id: 'forest',    labelKey: 'appr.preset_forest',    theme: { accent: '#3fae6a', neutrals: 'tinted',   intensity: 45 } },
	{ id: 'ocean',     labelKey: 'appr.preset_ocean',     theme: { accent: '#2d8cf0', neutrals: 'graphite', intensity: 55 } },
	{ id: 'coral',     labelKey: 'appr.preset_coral',     theme: { accent: '#ff5a6e', neutrals: 'graphite', intensity: 65 } },
	{ id: 'frost',     labelKey: 'appr.preset_frost',     theme: { accent: '#8fb8d8', neutrals: 'graphite', intensity: 25 } },
	{ id: 'mono',      labelKey: 'appr.preset_mono',      theme: { accent: '#d4d4d4', neutrals: 'graphite', intensity: 15 } },
]

/** L'ambiance « Ta bannière » : construite sur la couleur principale de la bannière. */
export function bannerPreset(accent: string): AmbiancePreset {
	return { id: 'banner', labelKey: 'appr.preset_banner', theme: { accent, neutrals: 'tinted', intensity: 70, backdrop: 'banner' } }
}

export function applyPreset(t: ShellTheme, p: AmbiancePreset): ShellTheme {
	const next: ShellTheme = { ...t, ...p.theme }
	if (p.theme.backdrop && p.theme.backdrop !== 'custom') next.backdrop_url = null
	return next
}

/** L'ambiance courante correspond-elle à ce preset (sur les champs qu'il fixe) ? */
export function presetMatches(t: ShellTheme, p: AmbiancePreset): boolean {
	return (Object.keys(p.theme) as (keyof ShellTheme)[])
		.filter(k => k !== 'backdrop_url')
		.every(k => {
			const a = t[k] ?? (k === 'neutrals' ? 'tinted' : undefined)
			const b = p.theme[k]
			return typeof a === 'string' && typeof b === 'string' ? a.toLowerCase() === b.toLowerCase() : a === b
		})
}
