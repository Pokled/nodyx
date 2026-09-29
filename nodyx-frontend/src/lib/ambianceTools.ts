/**
 * ambianceTools.ts — les outils de l'écran Apparence autour de l'Ambiance
 * (SPECS/NODYX_APPARENCE_CDC.md) : historique Annuler/Rétablir, code
 * d'ambiance à partager entre instances, ambiances prêtes à l'emploi.
 * Fonctions pures, testées dans ambianceTools.test.ts.
 */
import type { ShellTheme } from './shellTheme'

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
	return PREFIX + b64url(JSON.stringify({ a: t.accent.toLowerCase(), b: backdrop, i: t.intensity, m: t.default_mode }))
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
		return { accent: o.a.toLowerCase(), backdrop: o.b, backdrop_url: null, intensity: o.i, default_mode: o.m }
	} catch {
		return null
	}
}

// ── Ambiances prêtes à l'emploi ───────────────────────────────────────────
// Un point de départ, pas un thème imposé : un preset ne touche qu'à l'accent
// et à l'intensité, jamais au décor ni au mode choisis par l'admin. Teintes
// choisies HORS de la paire violet-cyan que le CDC contenant identifie comme
// la signature du « design généré ».

export interface AmbiancePreset { id: string; labelKey: string; accent: string; intensity: number }

export const AMBIANCE_PRESETS: AmbiancePreset[] = [
	{ id: 'embers',  labelKey: 'appr.preset_embers',  accent: '#ff7a3d', intensity: 70 },
	{ id: 'gold',    labelKey: 'appr.preset_gold',    accent: '#ffb020', intensity: 60 },
	{ id: 'forest',  labelKey: 'appr.preset_forest',  accent: '#3fae6a', intensity: 45 },
	{ id: 'ocean',   labelKey: 'appr.preset_ocean',   accent: '#2d8cf0', intensity: 55 },
	{ id: 'coral',   labelKey: 'appr.preset_coral',   accent: '#ff5a6e', intensity: 65 },
	{ id: 'frost',   labelKey: 'appr.preset_frost',   accent: '#8fb8d8', intensity: 25 },
	{ id: 'mono',    labelKey: 'appr.preset_mono',    accent: '#d4d4d4', intensity: 15 },
]

export function applyPreset(t: ShellTheme, p: AmbiancePreset): ShellTheme {
	return { ...t, accent: p.accent, intensity: p.intensity }
}
