// Le panneau d'aide « Tout ce que tu peux taper », ouvert PAR-DESSUS la page
// (HelpOverlay, monté une fois dans le layout). Un lien « Tout voir » ne quitte
// plus le chat ou le forum : on ne perd ni sa place ni ce qu'on écrivait.
//
// Le lien garde son vrai `href="/help"` : clic du milieu, Ctrl/Cmd + clic ou
// Maj + clic ouvrent toujours la page dans un nouvel onglet, comme tout lien.
import { writable } from 'svelte/store'

export const helpOverlayOpen = writable(false)

let returnTo: HTMLElement | null = null

/**
 * À brancher sur le `onclick` d'un lien vers /help. `focusBack` : l'élément qui
 * reprend le focus à la fermeture (par défaut, celui qui l'avait à l'ouverture).
 */
export function openHelpOverlay(e?: MouseEvent, focusBack?: HTMLElement | null): void {
	if (e && (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) return
	e?.preventDefault()
	returnTo = focusBack ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
	helpOverlayOpen.set(true)
}

export function closeHelpOverlay(): void {
	helpOverlayOpen.set(false)
	const el = returnTo
	returnTo = null
	// Après le démontage du panneau : le focus revient où on écrivait
	setTimeout(() => { if (el?.isConnected) el.focus() }, 0)
}
