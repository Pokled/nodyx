// OctoGuard 2 : ce que l'écran montre d'une règle (cran, catégorie, phrase).
// Aucune chaîne affichée ici : uniquement des clés de traduction (og2.*).

export type Surface = 'chat' | 'forum' | 'profile' | 'poll' | 'wiki'
export const SURFACES: readonly Surface[] = ['chat', 'forum', 'profile', 'poll', 'wiki']
export const IMMUNE_ROLES = ['owner', 'admin', 'moderator'] as const

export type Duration = { value: number; unit: 'm' | 'h' | 'd' | 'w' | 'M' }
export interface Rule {
	id: string
	name: string
	type: string
	params: Record<string, any>
	action: string
	action_duration: Duration | null
	escalation: { warns_threshold: number; window_days: number; action: string; duration?: Duration | null } | null
	immunized_role_types: string[]
	dry_run: boolean
	enabled: boolean
	scopes: Surface[]
	conditions?: { account_max_age_days?: number }
	preset_key: string | null
	customized: boolean
}

// ─── Les crans ───────────────────────────────────────────────────────────────
// Le moteur connaît : observation (dry_run), report_only / notify_only, warn,
// hold (retenir pour relecture), delete, et deux sanctions (mute, ban_temp).
// L'écran les range en 5 crans ; une règle qui sanctionne s'affiche au cran
// Supprimer, sa sanction à côté.
export type Level = 'observe' | 'report' | 'hold' | 'warn' | 'delete'
export const LEVELS: readonly Level[] = ['observe', 'report', 'hold', 'warn', 'delete']
export type Acting = Exclude<Level, 'observe'>

export function intendedOf(r: Pick<Rule, 'action'>): Acting {
	if (r.action === 'report_only' || r.action === 'notify_only') return 'report'
	if (r.action === 'hold') return 'hold'
	if (r.action === 'warn') return 'warn'
	return 'delete'
}
export const levelOf = (r: Pick<Rule, 'action' | 'dry_run'>): Level => (r.dry_run ? 'observe' : intendedOf(r))

/** Ce qu'il faut envoyer au serveur pour mettre une règle à ce cran. */
export function patchForLevel(r: Pick<Rule, 'action'>, level: Level): { dry_run: boolean; action?: string } {
	if (level === 'observe') return { dry_run: true }
	if (level === 'delete' && (r.action === 'mute' || r.action === 'ban_temp')) return { dry_run: false }
	const action = level === 'report' ? 'report_only' : level
	return { dry_run: false, action }
}

/** La sanction en plus de la suppression (mute, ban_temp), s'il y en a une. */
export const sanctionOf = (r: Pick<Rule, 'action'>) => (r.action === 'mute' || r.action === 'ban_temp' ? r.action : null)

// Icônes des crans (24x24, trait) : les mêmes partout, avec leur couleur.
export const LEVEL_ICON: Record<Level, string> = {
	observe: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z M12 9a3 3 0 100 6 3 3 0 000-6z',
	report: 'M5 21V4h11l-1.5 4L16 12H5',
	hold: 'M12 3a9 9 0 100 18 9 9 0 000-18z M10 9v6 M14 9v6',
	warn: 'M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
	delete: 'M4 7h16 M10 11v6 M14 11v6 M5 7l1 13h12l1-13 M9 7V4h6v3',
}

// ─── Les catégories ──────────────────────────────────────────────────────────
export type Category = 'words' | 'spam' | 'newcomers' | 'content' | 'custom'
export const CATEGORIES: readonly Category[] = ['words', 'spam', 'newcomers', 'content', 'custom']
export const CATEGORY_ICON: Record<Category, string> = {
	words: 'M12 3a9 9 0 100 18 9 9 0 000-18z M5.6 5.6l12.8 12.8',
	spam: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
	newcomers: 'M12 21v-9 M12 12c0-4 3-6 7-6 0 4-3 6-7 6z M12 14c0-3-2.5-5-6-5 0 3 2.5 5 6 5z',
	content: 'M4 7h7 M14 7h6 M4 12h4 M11 12h9 M4 17h10 M17 17h3',
	custom: 'M5 7l5 5-5 5 M12 17h7',
}

export function categoryOf(r: Pick<Rule, 'type' | 'conditions'>): Category {
	if (r.conditions?.account_max_age_days) return 'newcomers'
	switch (r.type) {
		case 'keywords':
		case 'caps':
			return 'words'
		case 'link_spam':
		case 'link_domain':
		case 'mention_spam':
		case 'flood':
			return 'spam'
		case 'zalgo':
			return 'content'
		default:
			return 'custom'
	}
}

export const RULE_ICON: Record<string, string> = {
	keywords: CATEGORY_ICON.words,
	caps: 'M3 18L7.5 6 12 18 M4.6 14h5.8 M15 18V6h3.5a3 3 0 010 6H15m0 0h4a3 3 0 010 6h-4',
	link_spam: CATEGORY_ICON.spam,
	link_domain: 'M14 4h5v16h-5 M10 8l4 4-4 4 M14 12H3',
	mention_spam: 'M12 8a4 4 0 100 8 4 4 0 000-8z M16 8v5a3 3 0 006 0v-1a10 10 0 10-4 8',
	flood: 'M2 8c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2 M2 14c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2 M2 20c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2',
	zalgo: CATEGORY_ICON.content,
	regex: CATEGORY_ICON.custom,
}
export const ruleIcon = (r: Pick<Rule, 'type' | 'conditions'>) =>
	categoryOf(r) === 'newcomers' ? CATEGORY_ICON.newcomers : (RULE_ICON[r.type] ?? CATEGORY_ICON.custom)

type T = (key: string, vars?: Record<string, string | number>) => string

/** Une phrase qui dit ce que la règle surveille, avec ses vrais réglages. */
export function describe(r: Rule, t: T): string {
	const p = r.params ?? {}
	if (categoryOf(r) === 'newcomers') return t('og2.desc_newcomers', { d: r.conditions?.account_max_age_days ?? 2 })
	switch (r.type) {
		case 'keywords': return t('og2.desc_keywords')
		case 'caps': return t('og2.desc_caps', { len: p.min_length ?? 15, pct: p.threshold_percent ?? 70 })
		case 'link_spam': return t('og2.desc_link_spam', { n: p.max_links ?? 3 })
		case 'mention_spam': return t('og2.desc_mention_spam', { n: p.max_mentions ?? 5 })
		case 'flood': return t('og2.desc_flood', { r: p.max_repeats ?? 4, rw: p.repeat_window_s ?? 60, m: p.max_messages ?? 8, bw: p.burst_window_s ?? 10 })
		case 'zalgo': return t('og2.desc_zalgo', { n: p.max_combining ?? 3 })
		case 'link_domain': {
			const all: string[] = p.domains ?? []
			const list = all.slice(0, 4).join(', ') + (all.length > 4 ? t('og2.list_more', { n: all.length - 4 }) : '')
			return t(p.mode === 'whitelist' ? 'og2.desc_domains_allow' : 'og2.desc_domains_block', { list })
		}
		default: return t('og2.desc_regex')
	}
}

export function durationText(d: Duration | null | undefined, t: T): string {
	if (!d) return t('og2.dur_permanent')
	return t(`og2.dur_${d.unit}`, { n: d.value })
}

/** « Où » en une ligne : « Partout » ou la liste des endroits. */
export function scopeText(r: Pick<Rule, 'scopes'>, t: T): string {
	const s = r.scopes?.length ? r.scopes : (['chat'] as Surface[])
	return s.length === SURFACES.length ? t('og2.scope_everywhere') : s.map((x) => t(`og2.surface_${x}`)).join(', ')
}
