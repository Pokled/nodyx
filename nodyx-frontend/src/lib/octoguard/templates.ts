// Les modèles de communauté (page Modèles) : des profils OctoGuard complets,
// appliqués par le cœur (POST /profile/preview puis /profile/import).
import DATA from './templates.json'

export type TemplateRule = {
	name: { fr: string; en: string }
	type: string
	params: Record<string, any>
	action: string
	scopes: string[]
	dry_run: boolean
	enabled: boolean
	preset_key: string | null
	escalation?: Record<string, any>
	conditions?: Record<string, any>
}
export type Template = { id: string; tone: string; art: string; rules: TemplateRule[] }
export const TEMPLATES = DATA.templates as Template[]

const pick = (lang: string) => (String(lang).startsWith('fr') ? 'fr' : 'en') as 'fr' | 'en'

/** Une règle telle que le cœur l'attend, dans la langue de l'instance. */
export function resolveRule(r: TemplateRule, lang: string) {
	const l = pick(lang)
	const { words_by_lang, ...rest } = r.params as { words_by_lang?: Record<string, string[]> }
	const params = words_by_lang ? { ...rest, words: words_by_lang[l] ?? words_by_lang.en } : rest
	return { ...r, name: r.name[l], params, immunized_role_types: ['owner', 'admin', 'moderator'], preset_key: r.preset_key ?? null }
}

/** Le profil complet d'un modèle, au format d'échange d'OctoGuard. */
export function buildProfile(t: Template, lang: string, title: string) {
	return { format: 'nodyx-octoguard-profile' as const, version: 1 as const, name: title.slice(0, 100), rules: t.rules.map((r) => resolveRule(r, lang)) }
}
