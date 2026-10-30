/**
 * Page d'accueil : une grille, deux polarités (SPECS/NODYX_ACCUEIL_THEME_CDC.md).
 *
 * L'admin dessine sa grille une fois, sombre OU claire. Pour l'autre thème,
 * on calcule la contre-palette par inversion de contraste : la luminosité de
 * chaque couleur neutre est retournée (OKLCH, L' = 1 - L), sa teinte et sa
 * saturation gardées. Les accents ne s'inversent pas : ils gardent leur
 * teinte et ne bougent en luminosité que pour rester lisibles.
 *
 * Calcul pur, sans état ni appel réseau : identique en SSR et au client,
 * basculer de thème est instantané.
 */
import { contrast, ensureContrast, oklchToHex, rgbToHex, rgbToOklch } from '$lib/shellTheme'
import type { GridTheme } from '$lib/types/homepage'

export type Polarity = 'dark' | 'light'

/** Couleur décomposée : r, g, b et a entre 0 et 1. */
export interface Rgba { r: number; g: number; b: number; a: number }

// Fonds de référence quand la grille n'a pas de fond opaque (transparent,
// translucide) : la surface du thème de l'app (app.css, --nx-surface).
const REF_BG: Record<Polarity, Rgba> = {
	dark:  { r: 0x17 / 255, g: 0x14 / 255, b: 0x0f / 255, a: 1 },
	light: { r: 1, g: 1, b: 1, a: 1 },
}

// Contrastes garantis (CDC §3.2) : texte principal confortable, texte
// secondaire et accents au plancher AA.
const MIN_TEXT = 7
const MIN_MUTED = 4.5
const MIN_ACCENT = 4.5

/** Lit #rgb, #rrggbb, #rrggbbaa, rgb() et rgba() (virgules ou espaces), transparent.
 *  Toute autre valeur (var(), dégradé, mot-clé) : null, et on n'y touche pas. */
export function parseColor(s: string | null | undefined): Rgba | null {
	if (!s) return null
	const v = s.trim().toLowerCase()
	if (v === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
	let m = /^#([0-9a-f]{3})$/.exec(v)
	if (m) {
		const [r, g, b] = m[1].split('').map(c => parseInt(c + c, 16) / 255)
		return { r, g, b, a: 1 }
	}
	m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v)
	if (m) {
		const n = parseInt(m[1], 16)
		return { r: (n >> 16 & 255) / 255, g: (n >> 8 & 255) / 255, b: (n & 255) / 255, a: m[2] ? parseInt(m[2], 16) / 255 : 1 }
	}
	m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v)
	if (m) {
		const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])
		return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: Math.min(1, Math.max(0, a)) }
	}
	return null
}

/** Opaque : #rrggbb. Translucide : rgba(r,g,b,a), le format des préréglages. */
export function formatColor(c: Rgba): string {
	if (c.a >= 0.999) return rgbToHex([c.r, c.g, c.b])
	const to = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 255)
	return `rgba(${to(c.r)},${to(c.g)},${to(c.b)},${Math.round(c.a * 1000) / 1000})`
}

/** `top` posé sur `bottom` (opaque) : la couleur réellement vue. */
function over(top: Rgba, bottom: Rgba): Rgba {
	const a = top.a
	return { r: top.r * a + bottom.r * (1 - a), g: top.g * a + bottom.g * (1 - a), b: top.b * a + bottom.b * (1 - a), a: 1 }
}

const hex = (c: Rgba) => rgbToHex([c.r, c.g, c.b])

// Repères de luminosité (OKLCH) d'une interface : un fond sombre tourne autour
// de 0,15, un fond clair autour de 0,97. L'inversion ÉCHANGE ces repères, plutôt
// que noir et blanc : un simple 1 - L donnait #05050a -> #d7d7e1 (gris terne) et
// #e6e6e6 -> #010101 (noir absolu), mesuré le 29/10.
const L_DARK = 0.15
const L_LIGHT = 0.97

/** Luminosité inversée : affine par morceaux par (0,1), (L_DARK,L_LIGHT),
 *  (L_LIGHT,L_DARK), (1,0). Involution exacte : f(f(l)) = l. */
export function invertLightness(l: number): number {
	if (l <= L_DARK) return 1 - l * (1 - L_LIGHT) / L_DARK
	if (l >= L_LIGHT) return (1 - l) * L_DARK / (1 - L_LIGHT)
	return L_DARK + L_LIGHT - l
}

/** Luminosité inversée (OKLCH), teinte, saturation et opacité gardées.
 *  Une valeur illisible (var(), dégradé…) est rendue telle quelle. */
export function invertColor(s: string): string {
	const c = parseColor(s)
	if (!c) return s
	const o = rgbToOklch([c.r, c.g, c.b])
	const inv = parseColor(oklchToHex({ ...o, l: invertLightness(o.l) }))!
	return formatColor({ ...inv, a: c.a })
}

/** Polarité de conception : le fond s'il est opaque, sinon le texte principal
 *  (un texte clair suppose un fond sombre). */
export function polarityOf(theme: Pick<GridTheme, 'bg' | 'text_primary'>): Polarity {
	const bg = parseColor(theme.bg)
	if (bg && bg.a >= 0.5) return rgbToOklch([bg.r, bg.g, bg.b]).l < 0.5 ? 'dark' : 'light'
	const t = parseColor(theme.text_primary)
	if (t) return rgbToOklch([t.r, t.g, t.b]).l > 0.5 ? 'dark' : 'light'
	return 'dark'
}

/** Une ombre reste sombre ; elle s'adoucit en clair et retrouve sa force en
 *  sombre (x0,5 / x2 : aller-retour exact). */
function adaptShadow(shadow: string, to: Polarity): string {
	const k = to === 'light' ? 0.5 : 2
	return shadow.replace(/rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*([\d.]+)\s*\)/g,
		(_, a) => `rgba(0,0,0,${Math.round(Math.min(1, parseFloat(a) * k) * 1000) / 1000})`)
}

/** Fond réellement vu sous la grille, opaque. */
function effectiveBg(theme: GridTheme, pol: Polarity): Rgba {
	const bg = parseColor(theme.bg)
	return bg ? over(bg, REF_BG[pol]) : REF_BG[pol]
}

/** Amène une couleur de texte à `min` de contraste sur le fond ET sur les
 *  cartes. Une couleur illisible ou non hexadécimale est rendue telle quelle. */
function guard(color: string, bg: Rgba, card: Rgba, min: number): string {
	const c = parseColor(color)
	if (!c) return color
	let out = hex(c.a < 1 ? over(c, bg) : c)
	for (const surface of [bg, card]) out = ensureContrast(out, hex(surface), min)
	return out
}

/** Palette lisible : textes et accents ramenés aux contrastes du CDC sur le
 *  fond et les cartes. Ne change rien à une couleur déjà lisible. */
export function guardGridTheme(theme: GridTheme): GridTheme {
	const pol = polarityOf(theme)
	const bg = effectiveBg(theme, pol)
	const cardC = parseColor(theme.card_bg)
	const card = cardC ? over(cardC, bg) : bg
	return {
		...theme,
		text_primary:   guard(theme.text_primary, bg, card, MIN_TEXT),
		text_secondary: guard(theme.text_secondary, bg, card, MIN_MUTED),
		primary:        guard(theme.primary, bg, card, MIN_ACCENT),
		accent:         guard(theme.accent, bg, card, MIN_ACCENT),
		link_color:     guard(theme.link_color, bg, card, MIN_ACCENT),
	}
}

/** Contre-palette : neutres inversés, accents gardés, ombre adaptée, puis
 *  garde-fous de contraste sur le nouveau fond. */
export function invertGridTheme(theme: GridTheme): GridTheme {
	const to: Polarity = polarityOf(theme) === 'dark' ? 'light' : 'dark'
	// Un fond transparent reste transparent : c'est alors la feuille qui se voit.
	const bg = parseColor(theme.bg)
	const inverted: GridTheme = {
		...theme,
		bg:             bg && bg.a === 0 ? theme.bg : invertColor(theme.bg),
		card_bg:        invertColor(theme.card_bg),
		border_color:   invertColor(theme.border_color),
		text_primary:   invertColor(theme.text_primary),
		text_secondary: invertColor(theme.text_secondary),
		shadow:         adaptShadow(theme.shadow, to),
	}
	// Fond transparent : la polarité ne se lit plus sur le fond, on la donne
	// par le texte principal, déjà inversé.
	return guardGridTheme(inverted)
}

/** Couleur d'un élément (fond de rangée, couleur d'un widget) pour le mode du
 *  visiteur, depuis la polarité de conception de la grille. */
export function adaptColorForMode(color: string, designed: Polarity, dark: boolean): string {
	return (designed === 'dark') === dark ? color : invertColor(color)
}

/** Palette à rendre pour le visiteur : telle que dessinée si son thème a la
 *  même polarité, sinon la contre-palette. Garde-fous de contraste dans les
 *  deux cas. `adapt_to_mode: false` coupe l'inversion (CDC D1 : active par
 *  défaut, y compris pour les grilles existantes). */
export function gridThemeForMode(theme: GridTheme, dark: boolean): GridTheme {
	const designed = polarityOf(theme)
	const wanted: Polarity = dark ? 'dark' : 'light'
	if (designed === wanted || theme.adapt_to_mode === false) return guardGridTheme(theme)
	return invertGridTheme(theme)
}

/** Contraste effectif d'un texte de la palette sur son fond (tests, recette). */
export function textContrast(theme: GridTheme, key: 'text_primary' | 'text_secondary' | 'primary' | 'accent' | 'link_color', on: 'bg' | 'card' = 'bg'): number {
	const pol = polarityOf(theme)
	const bg = effectiveBg(theme, pol)
	const cardC = parseColor(theme.card_bg)
	const surface = on === 'card' && cardC ? over(cardC, bg) : bg
	const c = parseColor(theme[key])!
	return contrast(hex(c.a < 1 ? over(c, surface) : c), hex(surface))
}
