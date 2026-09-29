/**
 * shellTheme.ts — l'Ambiance d'une instance transformée en variables du
 * contenant (SPECS/NODYX_APPARENCE_CDC.md, étape 2).
 *
 * L'admin choisit UN accent, un décor, une intensité et un mode par défaut
 * (validés côté core, nodyx-core/src/utils/shellTheme.ts). Tout le reste est
 * DÉRIVÉ ici, en clair et en sombre :
 *   - l'accent est ajusté par mode pour rester lisible comme texte sur les
 *     plaques (plancher WCAG AA 4,5:1) : un jaune pâle choisi pour le mode
 *     sombre est assombri juste assez en mode clair, pas remplacé ;
 *   - le texte posé SUR l'accent (--nx-on-accent) est noir ou blanc, celui
 *     qui contraste le mieux ;
 *   - les neutres (fonds, bordures, textes) prennent une pointe de la teinte
 *     de l'accent, comme les gris d'Apple teintés par la couleur système ;
 *   - l'intensité (0 « Sobre » à 100 « Immersif ») pilote ensemble le flou du
 *     décor, sa luminosité, le voile et la transparence du verre.
 *
 * Calculs en OKLCH (perception uniforme : baisser L assombrit sans dériver de
 * teinte, contrairement au HSL). Fonctions pures, testées dans shellTheme.test.ts.
 * La sortie ne contient que des valeurs calculées (nombres, #hex), jamais une
 * chaîne fournie par l'admin : aucune injection CSS possible.
 */

export interface ShellTheme {
	accent: string
	backdrop: 'banner' | 'custom' | 'none'
	backdrop_url?: string | null
	intensity: number
	default_mode: 'dark' | 'light' | 'system'
	/** Fonds : 'graphite' = gris de confort, indépendants de l'accent (le thème
	 *  Originel) ; 'tinted' = gris teintés d'une pointe de l'accent. Absent =
	 *  'tinted' (ambiances publiées avant l'apparition de ce réglage). */
	neutrals?: 'graphite' | 'tinted'
}

/**
 * L'Originel : l'ambiance par défaut de toute instance Nodyx (29/09).
 *
 * Calée sur ce qui rend l'interface de Discord confortable, MESURÉ en OKLCH
 * (voir neutrals() plus bas) : jamais de noir, des graphites à peine froids,
 * un texte blanc cassé vers 9:1 et non 21:1 (moins d'éblouissement), le texte
 * atténué au plancher AA. Notre identité : un ambre ADOUCI (moins saturé que
 * l'ambre d'origine, qui « vibrait » sur fond sombre), chaud sur gris froid,
 * comme un feu la nuit. Pas de bleu : un bleu saturé sur fond sombre bave à
 * l'œil (aberration chromatique), et l'indigo-violet est banni par le CDC.
 */
export const DEFAULT_SHELL_THEME: ShellTheme = {
	accent: '#f2ae4e', backdrop: 'banner', backdrop_url: null, intensity: 45, default_mode: 'system', neutrals: 'graphite',
}

// ── Couleur : sRGB ↔ OKLCH, contraste ─────────────────────────────────────

type RGB = [number, number, number]   // 0..1
type OKLCH = { l: number; c: number; h: number }

export function hexToRgb(hex: string): RGB {
	const m = /^#?([0-9a-f]{6})$/i.exec(hex)
	if (!m) throw new Error(`invalid hex color: ${hex}`)
	const n = parseInt(m[1], 16)
	return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

export function rgbToHex([r, g, b]: RGB): string {
	const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')
	return `#${to(r)}${to(g)}${to(b)}`
}

const toLinear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
const fromLinear = (v: number) => v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055

export function rgbToOklch(rgb: RGB): OKLCH {
	const [r, g, b] = rgb.map(toLinear)
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
	const h = (Math.atan2(B, A) * 180 / Math.PI + 360) % 360
	return { l: L, c: Math.hypot(A, B), h }
}

/** OKLCH → sRGB. `inGamut` dit si la couleur existait vraiment à l'écran. */
function oklchToRgbRaw({ l: L, c, h }: OKLCH): { rgb: RGB; inGamut: boolean } {
	const a = c * Math.cos(h * Math.PI / 180), b = c * Math.sin(h * Math.PI / 180)
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
	const lin = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	]
	const inGamut = lin.every(v => v >= -1e-4 && v <= 1 + 1e-4)
	return { rgb: lin.map(v => fromLinear(Math.min(1, Math.max(0, v)))) as RGB, inGamut }
}

/** OKLCH → #hex, en réduisant la saturation (jamais la teinte) si besoin. */
export function oklchToHex(c: OKLCH): string {
	let lo = 0, hi = c.c
	if (oklchToRgbRaw(c).inGamut) return rgbToHex(oklchToRgbRaw(c).rgb)
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2
		if (oklchToRgbRaw({ ...c, c: mid }).inGamut) lo = mid; else hi = mid
	}
	return rgbToHex(oklchToRgbRaw({ ...c, c: lo }).rgb)
}

export function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map(toLinear)
	return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
	const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
	return (x + 0.05) / (y + 0.05)
}

/**
 * Déplace la luminosité de `hex` (teinte et saturation gardées) jusqu'à
 * atteindre `min` de contraste contre `bg`, dans le sens qui s'éloigne du
 * fond. Ne touche à rien si c'est déjà lisible.
 */
export function ensureContrast(hex: string, bg: string, min: number): string {
	if (contrast(hex, bg) >= min) return hex
	const base = rgbToOklch(hexToRgb(hex))
	const towardDark = luminance(bg) > 0.18
	let lo = towardDark ? 0 : base.l, hi = towardDark ? base.l : 1
	let best = towardDark ? oklchToHex({ ...base, l: 0 }) : oklchToHex({ ...base, l: 1 })
	for (let i = 0; i < 30; i++) {
		const mid = (lo + hi) / 2
		const cand = oklchToHex({ ...base, l: mid })
		const ok = contrast(cand, bg) >= min
		if (ok) best = cand
		// Chercher la luminosité la plus proche de l'originale qui passe.
		if (towardDark) { if (ok) lo = mid; else hi = mid }
		else { if (ok) hi = mid; else lo = mid }
	}
	return best
}

/** Noir ou blanc : celui qui se lit le mieux sur `bg`. */
export function onColor(bg: string): string {
	const dark = '#16120c'
	return contrast('#ffffff', bg) >= contrast(dark, bg) ? '#ffffff' : dark
}

// ── Dérivation des variables ──────────────────────────────────────────────

export type ShellVars = Record<string, string>

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const round = (v: number, d = 3) => Number(v.toFixed(d))

/**
 * Gris de confort (thème Originel), indépendants de l'accent. Échelle calée
 * sur les mesures de l'interface de Discord (OKLCH, 29/09) :
 *   Discord sombre : rail L 0,24 · sidebar 0,30 · fil 0,32, teinte ~265,
 *   chroma ~0,008 ; texte L 0,90 (9,4:1), titres 0,96, atténué pile 4,5:1.
 *   Discord clair  : fonds blancs à peine froids, texte L 0,32 (12,6:1).
 * Nos plaques se posent entre le rail et la sidebar de Discord (0,275) : le
 * décor flouté doit rester lisible autour sans que le verre paraisse délavé.
 * Teinte 255 : un gris un rien moins bleu que le leur, pour ne pas refroidir
 * l'ambre posé dessus.
 */
function graphite(dark: boolean): ShellVars {
	const n = (l: number, c: number) => oklchToHex({ l, c, h: 255 })
	return dark ? {
		'--nx-bg':             n(0.215, 0.007),
		'--nx-surface':        n(0.275, 0.009),
		'--nx-surface-raised': n(0.31, 0.010),
		'--nx-border':         n(0.36, 0.011),
		'--nx-border-soft':    n(0.325, 0.010),
		'--nx-text':           n(0.88, 0.006),
		'--nx-text-muted':     n(0.715, 0.013),
		'--nx-text-faint':     n(0.575, 0.012),
	} : {
		'--nx-bg':             n(0.955, 0.005),
		'--nx-surface':        n(0.993, 0.002),
		'--nx-surface-raised': '#ffffff',
		'--nx-border':         n(0.895, 0.006),
		'--nx-border-soft':    n(0.93, 0.005),
		'--nx-text':           n(0.32, 0.012),
		'--nx-text-muted':     n(0.5, 0.013),
		'--nx-text-faint':     n(0.635, 0.012),
	}
}

function neutrals(h: number, dark: boolean): ShellVars {
	// Neutres teintés : chroma très faible, juste assez pour que le gris
	// « appartienne » à l'accent (valeurs calées sur le contenant d'origine).
	const n = (l: number, c: number) => oklchToHex({ l, c, h })
	return dark ? {
		'--nx-bg':             n(0.165, 0.008),
		'--nx-surface':        n(0.195, 0.010),
		'--nx-surface-raised': n(0.225, 0.011),
		'--nx-border':         n(0.285, 0.014),
		'--nx-border-soft':    n(0.245, 0.012),
		'--nx-text':           n(0.965, 0.006),
		'--nx-text-muted':     n(0.73, 0.017),
		'--nx-text-faint':     n(0.53, 0.014),
	} : {
		'--nx-bg':             n(0.982, 0.006),
		'--nx-surface':        '#ffffff',
		'--nx-surface-raised': '#ffffff',
		'--nx-border':         n(0.905, 0.014),
		'--nx-border-soft':    n(0.935, 0.011),
		'--nx-text':           n(0.215, 0.010),
		'--nx-text-muted':     n(0.5, 0.016),
		'--nx-text-faint':     n(0.66, 0.016),
	}
}

/** Variables d'un mode (clair ou sombre) pour une ambiance donnée. */
export function deriveShellVars(theme: ShellTheme, dark: boolean): ShellVars {
	const base = rgbToOklch(hexToRgb(theme.accent))
	const vars = theme.neutrals === 'graphite' ? graphite(dark) : neutrals(base.h, dark)
	const surface = vars['--nx-surface']

	// Accent lisible comme TEXTE sur les plaques (lien actif, rôle…).
	const accent = ensureContrast(theme.accent.toLowerCase(), surface, 4.5)
	const a = rgbToOklch(hexToRgb(accent))
	const [r, g, b] = hexToRgb(accent).map(v => Math.round(v * 255))
	vars['--nx-header-accent'] = accent
	vars['--nx-header-accent-strong'] = oklchToHex({ ...a, l: Math.max(0, a.l - 0.07) })
	vars['--nx-header-accent-soft'] = `rgb(${r} ${g} ${b} / ${dark ? 0.16 : 0.12})`
	vars['--nx-on-accent'] = onColor(accent)

	// Textes secondaires : muted doit rester du vrai texte lisible (AA),
	// faint est réservé aux métadonnées (plancher 3:1, niveau AA « grand texte »).
	vars['--nx-text-muted'] = ensureContrast(vars['--nx-text-muted'], surface, 4.5)
	vars['--nx-text-faint'] = ensureContrast(vars['--nx-text-faint'], surface, 3)

	// Intensité : 0 = Sobre (décor très flou, voilé, verre presque plein),
	// 100 = Immersif (décor net et lumineux, verre très transparent).
	const t = Math.min(100, Math.max(0, theme.intensity)) / 100
	const [sr, sg, sb] = hexToRgb(surface).map(v => Math.round(v * 255))
	const glass = round(lerp(dark ? 0.86 : 0.9, dark ? 0.5 : 0.6, t), 2)
	const glassStrong = round(Math.min(0.95, glass + 0.18), 2)
	vars['--nx-glass'] = `rgb(${sr} ${sg} ${sb} / ${glass})`
	vars['--nx-glass-strong'] = `rgb(${sr} ${sg} ${sb} / ${glassStrong})`
	const blur = Math.round(lerp(44, 12, t))
	const bright = round(dark ? lerp(0.5, 0.92, t) : lerp(1.15, 1.02, t), 2)
	const sat = round(lerp(1.15, 1.45, t), 2)
	vars['--nx-wallpaper-filter'] = `blur(${blur}px) saturate(${sat}) brightness(${bright})`
	const [br, bg, bb] = hexToRgb(vars['--nx-bg']).map(v => Math.round(v * 255))
	vars['--nx-wallpaper-veil'] = `rgb(${br} ${bg} ${bb} / ${round(lerp(dark ? 0.6 : 0.72, dark ? 0.1 : 0.2, t), 2)})`
	return vars
}

const block = (vars: ShellVars) => Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')

/**
 * Anciennes variables de marque (--nx-accent*, --nx-cyan*, ~720 usages dans
 * 81 fichiers de pages) recalées sur l'ambiance, PAR RÔLE, mesuré dans le
 * code le 29/09 :
 *   - « soft », « mid », cyan : surtout des couleurs de TEXTE sur fond sombre
 *     → l'accent lisible sur fond sombre (≥ 4,5:1) ;
 *   - base, « strong », « deep » : surtout des FONDS de bouton, souvent sous
 *     du texte BLANC codé en dur → l'accent assombri juste assez pour que le
 *     blanc y reste lisible (≥ 4,5:1), ce qui le garde visible sur fond
 *     sombre (≥ 3:1) ; les deux contraintes ont toujours une solution ;
 *   - triplets -rgb (halos) → la teinte de l'ambiance.
 * Sombre dans les deux modes : les pages sont encore sombres (CDC contenant).
 * N'est émis que pour une ambiance PUBLIÉE (ou en aperçu) : une instance qui
 * a personnalisé ces variables via son ancien thème et n'a rien publié garde
 * son rendu.
 */
export function legacyAccentVars(theme: ShellTheme): ShellVars {
	const dark = deriveShellVars(theme, true)
	const text = dark['--nx-header-accent']
	// Assombri pour le blanc posé dessus, PUIS éclairci s'il se perdait dans
	// le fond sombre (accent déjà très foncé : bleu nuit, noir). Éclaircir
	// jusqu'à 3:1 sur #0b0c0f laisse le blanc à plus de 6:1 : pas de conflit.
	const band = ensureContrast(ensureContrast(theme.accent.toLowerCase(), '#ffffff', 4.5), '#0b0c0f', 3)
	const shift = (hex: string, dl: number) => { const o = rgbToOklch(hexToRgb(hex)); return oklchToHex({ ...o, l: Math.min(0.97, Math.max(0.05, o.l + dl)) }) }
	const trip = hexToRgb(text).map(v => Math.round(v * 255)).join(' ')
	return {
		'--nx-accent': band, '--nx-accent-strong': shift(band, -0.05), '--nx-accent-deep': shift(band, -0.08),
		'--nx-accent-2': band, '--nx-accent-2-strong': band, '--nx-cyan-deep': band,
		'--nx-accent-soft': text, '--nx-accent-2-mid': text, '--nx-accent-2-soft': text, '--nx-cyan': text,
		'--nx-accent-2-soft2': shift(text, 0.06), '--nx-cyan-soft': shift(text, 0.06),
		'--nx-accent-rgb': trip, '--nx-accent-2-rgb': trip, '--nx-cyan-rgb': trip,
	}
}

/**
 * Feuille de style complète de l'ambiance, même structure qu'app.css :
 * clair par défaut, sombre via prefers-color-scheme ou data-theme forcé.
 * Injectée après app.css, elle en remplace les valeurs codées en dur.
 */
export function shellThemeCss(theme: ShellTheme, opts: { legacy?: boolean } = {}): string {
	const light = block(deriveShellVars(theme, false))
	const dark = block(deriveShellVars(theme, true))
	// `:root:root` : même élément, mais une priorité STRICTEMENT supérieure à
	// celle d'app.css. Sans ce doublement, l'ordre de chargement décidait, et la
	// feuille principale du site (chargée après la balise injectée par le
	// layout) écrasait l'ambiance : vécu le 29/09, accent resté ambre.
	// La feuille centrale prend la TEINTE de l'ambiance en mode sombre, mais
	// reste profonde (fond mêlé de noir) : les pages ont encore leurs gris codés
	// en dur, pensés pour un fond presque noir ; sur un graphite aussi clair
	// que les plaques, leurs textes secondaires perdraient en lisibilité. En
	// clair, la feuille garde son fond actuel tant que les pages ne sont pas
	// migrées (hors périmètre, CDC contenant).
	const sheet = '--nx-sheet-bg:color-mix(in oklab, var(--nx-bg) 58%, #000)'
	return [
		`:root:root{${light}}`,
		`@media (prefers-color-scheme: dark){:root:root:not([data-theme="light"]){${dark};${sheet}}}`,
		`:root:root[data-theme="dark"]{${dark};${sheet}}`,
		// Reprise de la règle d'accessibilité d'app.css, au même niveau de
		// priorité, sinon l'ambiance rendrait le verre transparent même pour qui
		// a demandé moins de transparence au système.
		`@media (prefers-reduced-transparency: reduce){:root:root,:root:root[data-theme]{--nx-glass:var(--nx-surface);--nx-glass-strong:var(--nx-surface)}}`,
		...(opts.legacy ? [`:root:root{${block(legacyAccentVars(theme))}}`] : []),
	].join('\n')
}

/**
 * Palette de l'ambiance telle qu'elle s'affiche sur fond sombre : ce que la
 * grille d'accueil reprend quand elle « suit l'ambiance ». TOUTE la palette,
 * pas seulement l'accent : une grille réglée pour un fond clair (titres gris,
 * descriptions pâles) devenait illisible sur la feuille sombre si seul
 * l'accent suivait (vécu sur vieuxlooters, 29/09). Sombre dans les deux
 * modes : la feuille centrale reste sombre tant que les pages ne sont pas
 * migrées (CDC contenant).
 */
export interface AmbiancePalette { accent: string; text: string; muted: string; card: string; border: string }

export function ambiancePalette(theme: ShellTheme | null | undefined): AmbiancePalette {
	const v = deriveShellVars(theme ?? DEFAULT_SHELL_THEME, true)
	const rgb = (hex: string) => hexToRgb(hex).map(x => Math.round(x * 255)).join(' ')
	return {
		accent: v['--nx-header-accent'],
		text:   v['--nx-text'],
		muted:  v['--nx-text-muted'],
		card:   `rgb(${rgb(v['--nx-surface'])} / 0.55)`,
		border: `rgb(${rgb(v['--nx-border'])} / 0.7)`,
	}
}

/** Source du papier peint selon le décor choisi (null = pas de décor). */
export function backdropSource(theme: ShellTheme | null, banner: string | null): string | null {
	if (!theme) return banner
	if (theme.backdrop === 'none') return null
	if (theme.backdrop === 'custom') return theme.backdrop_url ?? null
	return banner
}
