export interface ProfileThemeVars {
	bg: string
	cardBg: string
	cardBorder: string
	accent: string
	text: string
	textMuted: string
	bgImage: string
}

export interface ProfilePreset {
	id: string
	name: string
	emoji: string
	vars: ProfileThemeVars
}

export const DEFAULT_THEME: ProfileThemeVars = {
	bg:          '#030712',
	cardBg:      'rgba(17,24,39,0.8)',
	cardBorder:  '#1f2937',
	accent:      '#6366f1',
	text:        '#f9fafb',
	textMuted:   '#6b7280',
	bgImage:     '',
}

export const PROFILE_PRESETS: ProfilePreset[] = [
	{
		id: 'default',
		name: 'Défaut',
		emoji: '🌑',
		vars: DEFAULT_THEME,
	},
	{
		id: 'midnight',
		name: 'Minuit',
		emoji: '🌌',
		vars: {
			bg:         '#020617',
			cardBg:     'rgba(15,23,42,0.85)',
			cardBorder: '#1e3a5f',
			accent:     '#3b82f6',
			text:       '#e2e8f0',
			textMuted:  '#64748b',
			bgImage:    '',
		},
	},
	{
		id: 'forest',
		name: 'Forêt',
		emoji: '🌲',
		vars: {
			bg:         '#052e16',
			cardBg:     'rgba(5,46,22,0.85)',
			cardBorder: '#166534',
			accent:     '#22c55e',
			text:       '#f0fdf4',
			textMuted:  '#86efac',
			bgImage:    '',
		},
	},
	{
		id: 'warm',
		name: 'Chaleur',
		emoji: '🔥',
		vars: {
			bg:         '#1c0a00',
			cardBg:     'rgba(41,21,3,0.85)',
			cardBorder: '#92400e',
			accent:     '#f97316',
			text:       '#fff7ed',
			textMuted:  '#d97706',
			bgImage:    '',
		},
	},
	{
		id: 'rose',
		name: 'Rose',
		emoji: '🌸',
		vars: {
			bg:         '#1a0010',
			cardBg:     'rgba(36,4,28,0.85)',
			cardBorder: '#9d174d',
			accent:     '#ec4899',
			text:       '#fdf2f8',
			textMuted:  '#f9a8d4',
			bgImage:    '',
		},
	},
	{
		id: 'glass',
		name: 'Verre',
		emoji: '💎',
		vars: {
			bg:         '#0f172a',
			cardBg:     'rgba(255,255,255,0.05)',
			cardBorder: 'rgba(255,255,255,0.12)',
			accent:     '#a78bfa',
			text:       '#f8fafc',
			textMuted:  '#94a3b8',
			bgImage:    '',
		},
	},
]

/** Merge saved partial theme with defaults */
export function resolveTheme(saved: Partial<ProfileThemeVars> | null | undefined): ProfileThemeVars {
	return { ...DEFAULT_THEME, ...(saved ?? {}) }
}

/** CSS variable declarations only — use on parent containers for app-wide theming */
export function themeToVars(t: ProfileThemeVars): string {
	return [
		`--p-bg:${t.bg}`,
		`--p-card-bg:${t.cardBg}`,
		`--p-card-border:${t.cardBorder}`,
		`--p-accent:${t.accent}`,
		`--p-text:${t.text}`,
		`--p-text-muted:${t.textMuted}`,
	].join(';')
}

/** Build the inline style string injected on .profile-scope */
export function themeToStyle(t: ProfileThemeVars): string {
	// Validate bgImage: only allow https URLs to prevent data:/javascript: CSS injection
	const safeImage = t.bgImage && /^https:\/\//i.test(t.bgImage) ? t.bgImage : ''
	const bg = safeImage
		? `url("${safeImage}") center/cover no-repeat, ${t.bg}`
		: t.bg
	return [
		`--p-bg:${t.bg}`,
		`--p-card-bg:${t.cardBg}`,
		`--p-card-border:${t.cardBorder}`,
		`--p-accent:${t.accent}`,
		`--p-text:${t.text}`,
		`--p-text-muted:${t.textMuted}`,
		`background:${bg}`,
		`color:${t.text}`,
	].join(';')
}
