import { writable } from 'svelte/store'

export type VoicePanelTarget =
    | { type: 'peer'; socketId: string }
    | { type: 'self'; username: string; avatar: string | null }
    | null

/** Écrire dans ce store depuis n'importe quel composant pour ouvrir le panneau vocal.
 *  VoicePanel consomme et remet à null immédiatement. */
export const voicePanelTarget = writable<VoicePanelTarget>(null)
