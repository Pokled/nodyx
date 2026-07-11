// ── La Scène (StageView) : état d'ouverture PARTAGÉ ───────────────────────────
//
// StageView est monté par VoicePanel, lui-même monté dans +layout.svelte : la
// scène vit donc AU-DESSUS des pages et survit à la navigation (c'est ce qui
// permet la fenêtre flottante qui suit l'utilisateur d'une page à l'autre).
//
// Son ouverture était un état LOCAL de VoicePanel, donc impossible à déclencher
// d'ailleurs (le salon ne pouvait pas dire « ouvre ça en grand »). On le sort ici
// pour que n'importe quel composant puisse ouvrir la scène.

import { writable } from 'svelte/store'

/** La scène plein écran est-elle ouverte ? */
export const stageOpenStore = writable<boolean>(false)

/** Ouvrir la scène (ex. clic sur un écran partagé depuis le salon). */
export function openStage(): void {
  stageOpenStore.set(true)
}

/** Fermer la scène. */
export function closeStage(): void {
  stageOpenStore.set(false)
}
