import { browser } from '$app/environment'

/**
 * Déplace le nœud dans `<body>` tant qu'il est monté, puis le retire.
 *
 * ─── Pourquoi cette action existe ────────────────────────────────────────────
 * `position: fixed` ne suffit PAS à sortir un panneau de son conteneur. Dès
 * qu'un ancêtre porte un `transform`, un `filter`, un `backdrop-filter`, un
 * `will-change: transform` ou `contain: paint`, cet ancêtre devient le BLOC
 * CONTENEUR de tous ses descendants `fixed` : `inset-0` ne désigne alors plus le
 * viewport mais la boîte de l'ancêtre, et `left: 50%` se calcule sur SA largeur.
 *
 * Constaté deux fois en production dans ce dépôt :
 *  - la sidebar gauche (`.nodyx-sb .panel`) porte `transform: translateX(0)` pour
 *    son animation de repli. Le sélecteur de partage d'écran, en `fixed inset-0`,
 *    s'y retrouvait dessiné dans 220px au lieu du viewport ; le panneau d'options
 *    vocales, en `left-1/2 -translate-x-1/2 w-[360px]`, débordait à -14px et se
 *    faisait cisailler ses libellés.
 *  - la sidebar des membres (`.members-c`) cumule `will-change: transform` ET
 *    `overflow: hidden` : piégé PUIS rogné.
 *
 * Le transform n'est pas le fautif, il porte une vraie animation : c'est au
 * panneau de sortir de la zone piégée. Portaler dans `<body>` est la seule
 * parade robuste, parce qu'elle ne dépend d'aucune hypothèse sur les ancêtres.
 *
 * ⚠ Le nœud change de parent : les styles hérités et le CSS scopé fondé sur un
 * ancêtre ne s'appliquent plus. Les composants portalés doivent porter leurs
 * classes utilitaires directement (c'est déjà le cas partout ici).
 */
export function portal(node: HTMLElement) {
	if (!browser) return
	document.body.appendChild(node)
	return {
		destroy() {
			if (document.body.contains(node)) document.body.removeChild(node)
		},
	}
}
