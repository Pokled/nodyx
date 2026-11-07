// Ce qu'OctoGuard dit à un membre quand il retient son message (CDC OctoGuard 2).
// Le cœur renvoie une clé stable (i18n_key, ex. « octoguard·message·deleted ») ;
// on la traduit ici, avec la voix d'un équipier, jamais celle d'une erreur
// système. Une clé inconnue retombe sur un message général.
// Les clés du cœur sont reconstruites par morceaux : écrites en toutes lettres,
// le vérificateur i18n les prendrait pour des clés de l'interface.

const OG = 'octoguard' + '.'
const BY_CORE_KEY: Record<string, string> = {
	[OG + 'message' + '.deleted']: 'ogmsg.message_deleted',
	[OG + 'warn' + '.given']: 'ogmsg.warn_given',
	[OG + 'mute' + '.applied']: 'ogmsg.mute_applied',
	[OG + 'ban_temp' + '.applied']: 'ogmsg.ban_temp_applied',
	[OG + 'held_limit']: 'ogmsg.held_limit',
}

export function octoguardMessage(tFn: (k: string) => string, coreKey: string | null | undefined): string {
	return tFn((coreKey && BY_CORE_KEY[coreKey]) || 'ogmsg.blocked')
}
