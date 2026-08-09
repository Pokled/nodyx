// ── Ancien système (positions fixes) ──────────────────────────────────────────
export interface HomepageWidget {
	id:           string;
	position_id:  string;
	widget_type:  string;
	title:        string | null;
	config:       Record<string, unknown>;
	sort_order:   number;
	enabled:      boolean;
	visibility:   { audience?: 'all' | 'guests' | 'members'; roles?: string[]; start_date?: string; end_date?: string };
	width:        string;
	mobile_height: string | null;
	hide_mobile:  boolean;
	hide_tablet:  boolean;
}

export interface HomepagePosition {
	id:          string;
	label:       string;
	layout:      string;
	max_widgets: number | null;
	sort_order:  number;
	widgets:     HomepageWidget[];
}

export interface HomepageData {
	positions: HomepagePosition[];
}

// ── Grid Builder v2 ───────────────────────────────────────────────────────────

export interface GridTheme {
	primary:             string;   // ex: "#a78bfa"
	accent:              string;   // ex: "#06b6d4"
	link_color:          string;   // ex: "#a78bfa" — couleur des liens/CTA, distincte de primary/accent
	bg:                  string;   // ex: "#05050a"
	card_bg:             string;   // ex: "rgba(255,255,255,.03)"
	border_color:        string;   // ex: "rgba(255,255,255,.08)"
	border_width:        string;   // ex: "1px"
	border_radius:       string;   // ex: "10px"
	font_family:         string;   // ex: "Space Grotesk"
	font_size_base:      string;   // ex: "15px"
	font_weight_heading: string;   // ex: "700"
	text_primary:        string;   // ex: "#e2e8f0"
	text_secondary:      string;   // ex: "#6b7280"
	shadow:              string;   // ex: "0 4px 24px rgba(0,0,0,.4)"
}

export const DEFAULT_THEME: GridTheme = {
	primary:             '#a78bfa',
	accent:              '#06b6d4',
	link_color:          '#a78bfa',
	bg:                  '#05050a',
	card_bg:             'rgba(255,255,255,.03)',
	border_color:        'rgba(255,255,255,.08)',
	border_width:        '1px',
	border_radius:       '10px',
	font_family:         'Space Grotesk',
	font_size_base:      '15px',
	font_weight_heading: '700',
	text_primary:        '#e2e8f0',
	text_secondary:      '#6b7280',
	shadow:              '0 4px 24px rgba(0,0,0,.4)',
}

/**
 * Préthèmes prêts à l'emploi : point de départ pour un admin qui n'ose pas
 * toucher aux couleurs une par une. Un clic remplace le thème entier (couleurs
 * ET typographie ET forme), avec Réinitialiser pour toujours pouvoir revenir
 * en arrière sans perte.
 */
export interface GridThemePreset {
	id:    string;
	label: string;
	emoji: string;
	theme: GridTheme;
}

export const GRID_THEME_PRESETS: GridThemePreset[] = [
	{ id: 'default', label: 'Nodyx', emoji: '🌑', theme: DEFAULT_THEME },
	{
		id: 'midnight', label: 'Minuit', emoji: '🌌',
		theme: {
			primary: '#3b82f6', accent: '#22d3ee', link_color: '#60a5fa', bg: '#020617',
			card_bg: 'rgba(59,130,246,.05)', border_color: 'rgba(59,130,246,.14)', border_width: '1px',
			border_radius: '10px', font_family: 'Space Grotesk', font_size_base: '15px',
			font_weight_heading: '700', text_primary: '#e2e8f0', text_secondary: '#64748b',
			shadow: '0 4px 24px rgba(0,0,0,.5)',
		},
	},
	{
		id: 'forest', label: 'Forêt', emoji: '🌲',
		theme: {
			primary: '#22c55e', accent: '#84cc16', link_color: '#4ade80', bg: '#031f0f',
			card_bg: 'rgba(34,197,94,.05)', border_color: 'rgba(34,197,94,.14)', border_width: '1px',
			border_radius: '8px', font_family: 'Inter', font_size_base: '15px',
			font_weight_heading: '700', text_primary: '#f0fdf4', text_secondary: '#6b9a7d',
			shadow: '0 4px 24px rgba(0,0,0,.45)',
		},
	},
	{
		id: 'warm', label: 'Chaleur', emoji: '🔥',
		theme: {
			primary: '#f97316', accent: '#facc15', link_color: '#fb923c', bg: '#1c0a00',
			card_bg: 'rgba(249,115,22,.06)', border_color: 'rgba(249,115,22,.16)', border_width: '1px',
			border_radius: '12px', font_family: 'Space Grotesk', font_size_base: '16px',
			font_weight_heading: '800', text_primary: '#fff7ed', text_secondary: '#c99a72',
			shadow: '0 4px 24px rgba(0,0,0,.45)',
		},
	},
	{
		id: 'rose', label: 'Rose', emoji: '🌸',
		theme: {
			primary: '#ec4899', accent: '#a78bfa', link_color: '#f472b6', bg: '#1a0010',
			card_bg: 'rgba(236,72,153,.05)', border_color: 'rgba(236,72,153,.15)', border_width: '1px',
			border_radius: '14px', font_family: 'Space Grotesk', font_size_base: '15px',
			font_weight_heading: '700', text_primary: '#fdf2f8', text_secondary: '#c48aa8',
			shadow: '0 4px 24px rgba(0,0,0,.4)',
		},
	},
	{
		id: 'minimal', label: 'Minimal', emoji: '◻️',
		theme: {
			primary: '#e2e8f0', accent: '#94a3b8', link_color: '#e2e8f0', bg: '#0a0a0a',
			card_bg: 'rgba(255,255,255,.02)', border_color: 'rgba(255,255,255,.10)', border_width: '1px',
			border_radius: '2px', font_family: 'Inter', font_size_base: '15px',
			font_weight_heading: '600', text_primary: '#f5f5f5', text_secondary: '#8a8a8a',
			shadow: '0 2px 12px rgba(0,0,0,.3)',
		},
	},
]

/** Parse une couleur "rgba(r,g,b,a)" ou hex en { hex, alpha } pour un color picker natif + curseur d'opacité. */
export function parseColorAlpha(input: string): { hex: string; alpha: number } {
	const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/i.exec(input ?? '')
	if (rgba) {
		const [, r, g, b, a] = rgba
		const hex = '#' + [r, g, b].map(v => Math.max(0, Math.min(255, parseInt(v, 10))).toString(16).padStart(2, '0')).join('')
		return { hex, alpha: a !== undefined ? parseFloat(a) : 1 }
	}
	const hexMatch = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input?.trim() ?? '')
	if (hexMatch) return { hex: '#' + (hexMatch[1].length === 3 ? hexMatch[1].split('').map(c => c + c).join('') : hexMatch[1]), alpha: 1 }
	return { hex: '#a78bfa', alpha: 1 }
}

/** Recompose "rgba(r,g,b,a)" à partir d'un hex (color picker) + une opacité 0-1 (slider). */
export function composeRgba(hex: string, alpha: number): string {
	const { hex: h } = parseColorAlpha(hex)
	const triplet = hexToRgbTriplet(h)
	return `rgba(${triplet.split(' ').join(',')},${Math.round(alpha * 100) / 100})`
}

export interface GridColumn {
	id:           string;
	span:         number;          // 1–12 (desktop lg ≥ 1024px)
	span_md?:     number;          // 640–1023px (auto si absent)
	span_sm?:     number;          // < 640px (défaut: 12)
	widget:       string | null;   // ID du widget ou null si vide
	config:       Record<string, unknown>;
	title?:       string | null;
	hide_mobile?: boolean;
	hide_tablet?: boolean;
}

export interface GridRow {
	id:           string;
	gap:          string;          // '0' | '0.5rem' | '1rem' | '2rem'
	padding_y:    string;          // '0' | '1rem' | '2rem' | '3rem'
	bg_override?: string | null;   // couleur de fond spécifique à cette ligne
	columns:      GridColumn[];
}

export interface GridLayout {
	rows:  GridRow[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Génère un id unique (court) pour rows et columns */
export function genId(): string {
	return Math.random().toString(36).slice(2, 9)
}

/**
 * Triplet RGB "R G B" (espaces, sans virgules) à partir d'un hex #rgb/#rrggbb,
 * pour composer des rgb(var(--x) / alpha) comme le fait déjà --nx-*-rgb dans
 * app.css. Les widgets natifs (Hero Banner, Stats Bar...) étaient câblés sur
 * ce palette --nx-* statique et ignoraient le thème du Homepage Builder ;
 * cette fonction leur donne l'équivalent GridTheme pour la transparence.
 * Repli sur le violet par défaut du thème (167 139 250) si le hex est invalide.
 */
export function hexToRgbTriplet(hex: string): string {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex?.trim() ?? '')
	if (!m) return '167 139 250'
	let h = m[1]
	if (h.length === 3) h = h.split('').map(c => c + c).join('')
	const r = parseInt(h.slice(0, 2), 16)
	const g = parseInt(h.slice(2, 4), 16)
	const b = parseInt(h.slice(4, 6), 16)
	return `${r} ${g} ${b}`
}

/** Retourne le span_md automatique selon le span desktop */
export function autoSpanMd(span: number): number {
	if (span >= 8) return 12
	if (span >= 6) return 12
	if (span >= 4) return 6
	if (span >= 3) return 6
	if (span >= 2) return 4
	return 6
}

/** Retourne le span_sm automatique */
export function autoSpanSm(span: number): number {
	if (span >= 4) return 12
	if (span >= 2) return 6
	return 12
}

/** Vérifie que la somme des spans d'une ligne = 12 */
export function validateRow(row: GridRow): boolean {
	return row.columns.reduce((sum, c) => sum + c.span, 0) === 12
}

/** Crée une ligne vide avec N colonnes égales */
export function makeRow(cols: number): GridRow {
	const span = Math.floor(12 / cols)
	const remainder = 12 - span * cols
	return {
		id:        genId(),
		gap:       '1rem',
		padding_y: '0',
		columns:   Array.from({ length: cols }, (_, i) => ({
			id:     genId(),
			span:   i === cols - 1 ? span + remainder : span,
			widget: null,
			config: {},
		}))
	}
}

/** Crée une ligne depuis une config spans explicite ex: [8,4] */
export function makeRowFromSpans(spans: number[]): GridRow {
	return {
		id:        genId(),
		gap:       '1rem',
		padding_y: '0',
		columns:   spans.map(span => ({
			id:     genId(),
			span,
			widget: null,
			config: {},
		}))
	}
}
