import { getContext, setContext } from 'svelte'

/**
 * « Suivre l'ambiance » (SPECS/NODYX_APPARENCE_CDC.md), côté widgets.
 *
 * Quand la grille suit l'ambiance de l'instance, l'ambiance est la SEULE
 * source des couleurs d'accent : un widget ignore alors la couleur d'accent
 * réglée pour lui seul (vitrine d'articles, stream Twitch, bannière
 * d'annonce), sinon un orange fixé il y a des mois restait au milieu d'une
 * ambiance Synthwave (retour de Jonathan, 29/09). L'interrupteur est
 * désactivé par défaut : rien ne change pour qui ne l'active pas.
 */
const KEY = 'nx-follow-ambiance'

/** GridRenderer : publie l'état (getter, pour rester réactif). */
export function provideFollowAmbiance(get: () => boolean): void {
	setContext(KEY, get)
}

/** Widget : à appeler à l'initialisation ; renvoie un getter. */
export function useFollowAmbiance(): () => boolean {
	return getContext<(() => boolean) | undefined>(KEY) ?? (() => false)
}
