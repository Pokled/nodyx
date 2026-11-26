// La base de design de Nodyx : les couleurs (planche « Les couleurs », validée le 26/11/2026,
// https://nodyx.org/couleurs-maquette.html). Module pur, testé sans navigateur.
//
// Principe : l'admin choisit UNE couleur ; tout le reste se calcule en OKLCH, pour le clair
// ET pour le sombre, avec un contraste garanti (WCAG AA, 4,5:1) :
//   - le bouton principal, son survol et son appui, la sélection, les liens ;
//   - en sombre, la couleur s'éclaircit et se calme (saturation plafonnée) au lieu d'être
//     inversée ;
//   - les gris restent neutres, ou prennent une pointe de la couleur si l'admin le veut.
// Les quatre états (problème, attention, fait, à savoir) et les huit couleurs d'étiquette ont
// un sens FIXE : ils ne dépendent jamais de la couleur de l'instance.
//
// Même famille de calcul que lib/shellTheme.ts (deriveShellVars), qui sert aujourd'hui
// l'Apparence ; ce module est la version des planches, que la refonte branchera.

export type Mode = 'clair' | 'sombre'
type RGB = [number, number, number]
export interface Oklch { l: number; c: number; h: number }

// ── sRGB ⇄ OKLCH ──────────────────────────────────────────────────────────

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const delin = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)

export function hexToRgb(hex: string): RGB {
	let h = hex.trim().replace('#', '')
	if (h.length === 3) h = [...h].map(c => c + c).join('')
	if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Invalid color: ${hex}`)
	return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as RGB
}
const rgbToHex = (c: RGB) => '#' + c.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')

export function toOklch(hex: string): Oklch {
	const [r, g, b] = hexToRgb(hex).map(lin)
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	return { l: L, c: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 }
}

function rawRgb(L: number, C: number, H: number): RGB {
	const a = C * Math.cos(H * Math.PI / 180), b = C * Math.sin(H * Math.PI / 180)
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	].map(delin) as RGB
}

/** OKLCH vers #hex ; si la couleur sort de l'écran, on réduit sa saturation jusqu'à ce qu'elle tienne. */
export function oklch(L: number, C: number, H: number): string {
	let c = C
	for (let i = 0; i < 40; i++) {
		const v = rawRgb(L, c, H)
		if (v.every(x => x >= -0.001 && x <= 1.001)) return rgbToHex(v)
		c *= 0.9
	}
	return rgbToHex(rawRgb(L, 0, H))
}

// ── Contraste (WCAG 2) ─────────────────────────────────────────────────────

export function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map(lin)
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
	return (x + 0.05) / (y + 0.05)
}
export const AA = 4.5

// ── Les gris (planche « Encadrés, bordures et fonds » : quatre plans) ──────

export interface Neutres { fond: string; panneau: string; retrait: string; flotte: string; trait: string; traitFort: string; texte: string; texte2: string; texte3: string }

/** Les gris d'un mode. `teinte` : une pointe de la couleur de l'instance (choix de l'admin). */
export function neutres(mode: Mode, teinte?: { c: number; h: number }): Neutres {
	const t = teinte ? Math.min(teinte.c, 0.02) : 0.004
	const h = teinte ? teinte.h : 265
	return mode === 'clair'
		? { fond: oklch(0.968, t, h), panneau: '#ffffff', retrait: oklch(0.968, t, h), flotte: '#ffffff', trait: oklch(0.915, t * 1.2, h), traitFort: oklch(0.85, t * 1.2, h), texte: oklch(0.2, t, h), texte2: oklch(0.47, t * 1.5, h), texte3: oklch(0.6, t, h) }
		: { fond: oklch(0.17, t, h), panneau: oklch(0.21, t, h), retrait: oklch(0.24, t, h), flotte: oklch(0.27, t, h), trait: oklch(0.29, t, h), traitFort: oklch(0.36, t, h), texte: oklch(0.94, t * 0.5, h), texte2: oklch(0.75, t, h), texte3: oklch(0.6, t, h) }
}

// ── La couleur de l'instance et tous ses usages ────────────────────────────

export interface Action { action: string; survol: string; appui: string; surAction: string; choisi: string; lien: string; focus: string; ajustee: boolean }

/** Tous les usages d'une couleur, pour un mode, contre un panneau donné. */
export function action(hex: string, mode: Mode, panneau: string): Action {
	const o = toOklch(hex)
	if (mode === 'clair') {
		// Texte blanc sur le bouton : on assombrit jusqu'à 4,5:1 (et jamais au-delà d'une L de 0,62)
		let L = Math.min(o.l, 0.62)
		while (contrast('#ffffff', oklch(L, o.c, o.h)) < AA && L > 0.15) L -= 0.01
		const a = oklch(L, o.c, o.h)
		return { action: a, survol: oklch(L - 0.05, o.c, o.h), appui: oklch(L - 0.09, o.c, o.h), surAction: '#ffffff', choisi: oklch(0.955, Math.min(o.c, 0.035), o.h), lien: a, focus: a, ajustee: Math.abs(L - o.l) > 0.02 }
	}
	// En sombre : saturation plafonnée (une couleur vive « bave » sur fond sombre), on éclaircit jusqu'à 4,5:1
	const C = Math.min(o.c, 0.13)
	let L = Math.max(o.l, 0.7)
	while (contrast(oklch(L, C, o.h), panneau) < AA && L < 0.97) L += 0.01
	const a = oklch(L, C, o.h)
	return { action: a, survol: oklch(L + 0.04, C, o.h), appui: oklch(L + 0.08, C, o.h), surAction: '#0d1420', choisi: oklch(0.3, Math.min(o.c, 0.05), o.h), lien: a, focus: a, ajustee: Math.abs(L - o.l) > 0.02 || C < o.c - 0.01 }
}

// ── Les quatre états et les huit couleurs d'étiquette : un sens fixe ───────

export const ETATS = { probleme: 25, attention: 75, fait: 150, savoir: 255 } as const
export type Etat = keyof typeof ETATS
export interface CouleurEtat { texte: string; fond: string; trait: string }

export function etat(e: Etat, mode: Mode): CouleurEtat {
	const h = ETATS[e]
	if (mode === 'clair') {
		const fond = oklch(0.965, 0.025, h)
		let L = 0.5; while (contrast(oklch(L, 0.14, h), fond) < AA && L > 0.2) L -= 0.01
		return { texte: oklch(L, 0.14, h), fond, trait: oklch(0.88, 0.06, h) }
	}
	const fond = oklch(0.25, 0.04, h)
	let L = 0.78; while (contrast(oklch(L, 0.12, h), fond) < AA && L < 0.97) L += 0.01
	return { texte: oklch(L, 0.12, h), fond, trait: oklch(0.36, 0.07, h) }
}

export const ETIQUETTES = { bleu: 255, sarcelle: 195, vert: 150, olive: 118, ambre: 78, rouge: 28, rose: 355, violet: 300 } as const
export type Etiquette = keyof typeof ETIQUETTES
export function etiquette(e: Etiquette, mode: Mode): { texte: string; fond: string; point: string } {
	const h = ETIQUETTES[e]
	return mode === 'clair'
		? { fond: oklch(0.94, 0.045, h), texte: oklch(0.42, 0.12, h), point: oklch(0.62, 0.16, h) }
		: { fond: oklch(0.3, 0.06, h), texte: oklch(0.86, 0.09, h), point: oklch(0.72, 0.14, h) }
}

// ── Tout, d'un coup ────────────────────────────────────────────────────────

export const COULEUR_NODYX = '#1f56c9'   // Cobalt, la couleur d'une instance neuve (décidé le 26/11)

export interface Palette extends Neutres, Action { etats: Record<Etat, CouleurEtat> }

export function palette(hex: string = COULEUR_NODYX, mode: Mode = 'clair', grisTeintes = false): Palette {
	const o = toOklch(hex)
	const n = neutres(mode, grisTeintes ? { c: o.c, h: o.h } : undefined)
	const etats = Object.fromEntries((Object.keys(ETATS) as Etat[]).map(e => [e, etat(e, mode)])) as Record<Etat, CouleurEtat>
	return { ...n, ...action(hex, mode, n.panneau), etats }
}
