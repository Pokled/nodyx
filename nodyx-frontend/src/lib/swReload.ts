// Quand recharger la page parce qu'un service worker a pris le contrôle ?
//
// Seulement quand une version en REMPLACE une autre (déploiement) : c'est là
// que les anciens morceaux de l'application disparaissent et qu'il faut
// repartir sur les nouveaux. À la première visite, le service worker
// s'installe et prend le contrôle d'une page qui n'en avait aucun : rien n'est
// périmé. Recharger à ce moment (comportement jusqu'au 11/10/2026) faisait
// charger deux fois la première page de chaque visiteur, et consommait deux
// fois son quota de requêtes.

/**
 * @param auMontage  navigator.serviceWorker.controller au montage (null = aucun)
 * @param recharger  appelé au plus une fois, quand une version en remplace une autre
 * @returns le signal à appeler avec le service worker qui vient de se manifester
 *          (controller après `controllerchange`, event.source d'un `sw:updated`)
 */
export function surveillerServiceWorker<T>(auMontage: T | null, recharger: () => void) {
	let connu: T | null = auMontage
	let fait = false
	return (sw: T | null | undefined) => {
		if (!sw || fait) return
		if (connu === null) { connu = sw; return }   // première prise de contrôle
		if (sw === connu) return                     // le même, qui se signale encore
		fait = true
		recharger()
	}
}
