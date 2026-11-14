// Tout ce qu'on peut taper (SPECS/NODYX_COMMANDES_CDC.md, maquette
// https://nodyx.org/commandes-maquette.html) : la SOURCE UNIQUE. Les propositions
// du « / », la bulle « ? » et la page /help lisent cette liste : elles ne peuvent
// pas se contredire.
//
// On n'annonce que ce qui marche : une touche ou une commande n'entre ici que le
// jour où elle fonctionne (pas de « # » avant son lot).

export type Trigger = '@' | '/'
export type Place = 'chat' | 'forum'

export interface CommandDef {
	/** Identifiant stable (jamais affiché). */
	id: string
	trigger: Trigger
	/** Ce qui s'écrit après la touche (`roll`), ou une clé i18n pour un nom traduit. */
	name: string
	nameKey?: string
	/** Arguments montrés après le nom (texte neutre, ou clé i18n). */
	args?: string
	argsKey?: string
	descKey: string
	exampleKey?: string
	/** Famille, pour regrouper la liste du « / ». */
	group: 'help' | 'call' | 'play'
	/** Autres noms acceptés (`/?`), trouvés aussi par la liste. Jamais rien en « ai » (réservé). */
	aliases?: string[]
	/** Action locale : la commande ne s'envoie pas, elle agit dans la page. */
	local?: 'help'
	where: Place[]
	/** Réservé à l'équipe : montré à l'équipe seulement (le serveur refuse de toute façon). */
	team?: boolean
	/** Mots-clés de recherche (clé i18n, mots séparés par des espaces). */
	keywordsKey: string
}

export const COMMANDS: CommandDef[] = [
	// @ : appeler (les mentions, SPECS/NODYX_MENTIONS_CDC.md)
	{ id: 'at-person', trigger: '@', name: '', argsKey: 'cmd.arg_username', descKey: 'cmd.at_person', exampleKey: 'cmd.at_person_ex', group: 'call', where: ['chat', 'forum'], keywordsKey: 'cmd.kw_at_person' },
	{ id: 'at-online', trigger: '@', name: '', nameKey: 'mention.g_ici', descKey: 'cmd.at_online', exampleKey: 'cmd.at_online_ex', group: 'call', where: ['chat', 'forum'], keywordsKey: 'cmd.kw_at_group' },
	{ id: 'at-team', trigger: '@', name: '', nameKey: 'mention.g_equipe', descKey: 'cmd.at_team', exampleKey: 'cmd.at_team_ex', group: 'call', where: ['chat', 'forum'], keywordsKey: 'cmd.kw_at_team' },
	{ id: 'at-mods', trigger: '@', name: '', nameKey: 'mention.g_moderation', descKey: 'cmd.at_mods', group: 'call', where: ['chat', 'forum'], keywordsKey: 'cmd.kw_at_mods' },
	{ id: 'at-grade', trigger: '@', name: '', argsKey: 'cmd.arg_grade', descKey: 'cmd.at_grade', exampleKey: 'cmd.at_grade_ex', group: 'call', where: ['chat', 'forum'], keywordsKey: 'cmd.kw_at_grade' },
	{ id: 'at-all', trigger: '@', name: '', nameKey: 'mention.g_tous', descKey: 'cmd.at_all', group: 'call', where: ['chat', 'forum'], team: true, keywordsKey: 'cmd.kw_at_all' },
	// / : l'aide, EN TÊTE de la liste du « / » (ouvre le pop-up, rien n'est envoyé).
	// Pas d'alias « aide » : « /ai » est RÉSERVÉ à une future commande d'IA (Jonathan, 14/11).
	{ id: 'help', trigger: '/', name: 'help', aliases: ['?'], local: 'help', descKey: 'cmd.help_cmd', exampleKey: 'cmd.help_cmd_ex', group: 'help', where: ['chat'], keywordsKey: 'cmd.kw_help' },
	// / : jouer (le chat)
	{ id: 'roll', trigger: '/', name: 'roll', args: '2d6', descKey: 'cmd.roll', exampleKey: 'cmd.roll_ex', group: 'play', where: ['chat'], keywordsKey: 'cmd.kw_roll' },
	{ id: 'flip', trigger: '/', name: 'flip', descKey: 'cmd.flip', group: 'play', where: ['chat'], keywordsKey: 'cmd.kw_flip' },
	{ id: '8ball', trigger: '/', name: '8ball', argsKey: 'cmd.arg_question', descKey: 'cmd.8ball', exampleKey: 'cmd.8ball_ex', group: 'play', where: ['chat'], keywordsKey: 'cmd.kw_8ball' },
	{ id: 'rps', trigger: '/', name: 'rps', args: '🪨 📄 ✂️', descKey: 'cmd.rps', group: 'play', where: ['chat'], keywordsKey: 'cmd.kw_rps' },
]

/** Le nom tel qu'il s'écrit (traduit pour un groupe, `roll` pour une commande). */
export function nameOf(c: CommandDef, tFn: (k: string) => string): string {
	return c.nameKey ? tFn(c.nameKey) : c.name
}

export function argsOf(c: CommandDef, tFn: (k: string) => string): string {
	return c.argsKey ? tFn(c.argsKey) : (c.args ?? '')
}

/** Ce que la personne peut voir : sans les commandes d'équipe si elle n'en est pas. */
export function visibleCommands(isTeam: boolean): CommandDef[] {
	return COMMANDS.filter(c => !c.team || isTeam)
}

/** Les commandes « / » qui commencent par ce qui est tapé après la barre. */
export function slashMatches(typed: string, isTeam = false): CommandDef[] {
	const q = fold(typed)
	return visibleCommands(isTeam).filter(c => c.trigger === '/' && [c.name, ...(c.aliases ?? [])].some(n => fold(n).startsWith(q)))
}

/** La commande écrite en entier (nom ou autre nom), ou null : « /help », « /? ». */
export function exactSlash(text: string): CommandDef | null {
	const m = /^\/(\S+)\s*$/.exec(text.trim())
	if (!m) return null
	const q = fold(m[1])
	return COMMANDS.find(c => c.trigger === '/' && [c.name, ...(c.aliases ?? [])].some(n => fold(n) === q)) ?? null
}

/** Minuscules sans accents. */
export function fold(s: string): string {
	return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * Recherche de la page d'aide : au DÉBUT d'un mot du nom ou des mots-clés. « dé »
 * trouve /roll (« dés »), et pas chaque « de » d'une description.
 */
export function searchCommands(list: CommandDef[], query: string, tFn: (k: string) => string): CommandDef[] {
	const q = fold(query.trim()).replace(/^[@#/!]/, '')
	if (!q) return list
	return list.filter(c => {
		const words = fold(`${nameOf(c, tFn)} ${tFn(c.keywordsKey)}`).split(/[^a-z0-9]+/)
		return words.some(w => w.startsWith(q))
	})
}

/** L'équipe, côté affichage (le serveur décide pour de vrai). */
export function isTeamRole(role: string | null | undefined): boolean {
	return role === 'owner' || role === 'admin' || role === 'moderator'
}
