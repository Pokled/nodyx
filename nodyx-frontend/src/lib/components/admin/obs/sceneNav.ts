// Petit helper de navigation vers le tab "Scènes" du Streamer Hub avec focus
// sur une scène précise. Contournement nécessaire : le composant parent
// (admin/streamer-hub/+page.svelte) a un $effect qui réécrit l'URL hash à
// `#tab=X` à chaque changement d'activeTab, ce qui écrasait nos paramètres
// additionnels (&scene=ID). On passe donc l'intent via sessionStorage, lu
// par ObsScenesPanel.onMount qui set activeId puis nettoie la clé.

const FOCUS_KEY = 'nodyx:focus-scene'
const FOCUS_OVERLAY_KEY = 'nodyx:focus-overlay-token'

// Navigation utilitaire vers un tab quelconque du Streamer Hub. Mêmes
// garanties que focusSceneAfterNav : setTimeout pour laisser commit le
// state appelant, pushState + dispatch manuel pour fire hashchange même
// si le navigateur swallow l'assignment.
function navigateToTab(tab: string): void {
	if (typeof window === 'undefined') return
	setTimeout(() => {
		const target = `#tab=${tab}`
		if (window.location.hash === target) return
		try {
			window.history.pushState(null, '', window.location.pathname + target)
			window.dispatchEvent(new HashChangeEvent('hashchange', {
				oldURL: window.location.href.replace(target, ''),
				newURL: window.location.href,
			}))
		} catch {
			window.location.hash = target
		}
	}, 0)
}

export function focusSceneAfterNav(sceneId: string): void {
	if (typeof window === 'undefined') return
	try { sessionStorage.setItem(FOCUS_KEY, sceneId) } catch { /* sessionStorage saturé : tant pis */ }
	// On laisse Svelte commit le state update qui ferme le modal appelant
	// avant de toucher au hash. Sans ce délai, certains navigateurs ne firent
	// pas le hashchange (assignation au milieu d'une réaction DOM).
	setTimeout(() => {
		const target = '#tab=scenes'
		const already = window.location.hash === target
		if (!already) {
			// pushState + dispatch manuel de hashchange : ceinture + bretelles.
			// Si on était sur un autre tab, le parent réagit au hashchange et
			// switch activeTab. Si l'utilisateur était déjà sur Scènes, le
			// CustomEvent ci-dessous suffit (le panel reste monté).
			try {
				window.history.pushState(null, '', window.location.pathname + target)
				window.dispatchEvent(new HashChangeEvent('hashchange', {
					oldURL: window.location.href.replace(target, ''),
					newURL: window.location.href,
				}))
			} catch {
				// Fallback brutal si pushState/HashChangeEvent indisponibles.
				window.location.hash = target
			}
		}
		// Notifie aussi un panel déjà monté pour bouger l'activeId sans attendre
		// un remount (cas "j'étais déjà sur le tab Scènes").
		try { window.dispatchEvent(new CustomEvent('nodyx:focus-scene', { detail: { sceneId } })) } catch { /* noop */ }
	}, 0)
}

export function consumeFocusedSceneId(): string | null {
	if (typeof window === 'undefined') return null
	try {
		const v = sessionStorage.getItem(FOCUS_KEY)
		if (v) sessionStorage.removeItem(FOCUS_KEY)
		return v
	} catch {
		return null
	}
}

// Navigation vers le tab Overlays OBS avec focus sur un overlay précis
// (par token). Le composant OverlayManager lit la clé au mount et déplie
// la config + scroll vers la ligne. Pattern symétrique à focusSceneAfterNav.
export function focusOverlayAfterNav(overlayToken: string): void {
	if (typeof window === 'undefined') return
	try { sessionStorage.setItem(FOCUS_OVERLAY_KEY, overlayToken) } catch { /* tant pis */ }
	try { window.dispatchEvent(new CustomEvent('nodyx:focus-overlay', { detail: { token: overlayToken } })) } catch { /* noop */ }
	navigateToTab('overlays')
}

export function consumeFocusedOverlayToken(): string | null {
	if (typeof window === 'undefined') return null
	try {
		const v = sessionStorage.getItem(FOCUS_OVERLAY_KEY)
		if (v) sessionStorage.removeItem(FOCUS_OVERLAY_KEY)
		return v
	} catch {
		return null
	}
}
