/**
 * Nombre de RÉPONSES d'un sujet, à partir de son nombre de messages.
 *
 * Pourquoi ce helper existe (2026-08-14)
 * ──────────────────────────────────────
 * À la création d'un sujet, le corps du message est inséré comme une ligne de
 * la table `posts` (`forums.ts`, `PostModel.create` juste après `createThread`).
 * Le `post_count` renvoyé par l'API compte donc le message d'ouverture.
 *
 * Conséquence, avant ce helper : un sujet sans la moindre réponse affichait
 * « 1 réponse », et le filtre « sans réponse » cherchait `post_count === 0`,
 * une condition qu'AUCUN sujet ne pouvait satisfaire. Sur nodyx.org, 14 sujets
 * sur 58 étaient réellement sans réponse et le filtre en affichait zéro.
 *
 * Le backend connaissait déjà la distinction : la réputation n'accorde pas le
 * bonus « réponse » au premier message. Seul l'affichage l'ignorait.
 *
 * `post_count` reste juste et n'est PAS modifié : c'est bien un nombre de
 * messages. C'est l'appeler « réponses » qui était faux.
 *
 * ATTENTION : ne s'applique QU'AU compteur d'un sujet. Le `post_count` d'un
 * utilisateur (profil, tableau des membres) ou d'une catégorie compte de vrais
 * messages et ne doit surtout pas être décrémenté.
 */
export function replyCount(postCount: number | null | undefined): number {
	// `Math.max(0, …)` n'est pas de la superstition : rien n'empêche aujourd'hui
	// de supprimer le premier message d'un sujet (`DELETE /posts/:id` ne le
	// protège pas), ce qui laisserait un sujet à 0 message et produirait un
	// « -1 réponse » à l'écran.
	return Math.max(0, (postCount ?? 0) - 1)
}

/** Un sujet est sans réponse quand il ne porte que son message d'ouverture. */
export function isUnanswered(postCount: number | null | undefined): boolean {
	return replyCount(postCount) === 0
}
