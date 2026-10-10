/**
 * Mode édition « au stylo » (SPECS/NODYX_APPARENCE_CDC.md, partie 2, volet B).
 *
 * Activé par le stylo du bouton scindé [ Administration | stylo ] du header,
 * admins et propriétaire seulement. Rien ne change en navigation normale : les
 * stylos n'existent qu'en mode édition, et un clic DANS une zone garde son
 * comportement (les liens naviguent) ; seul le stylo ouvre le panneau.
 */
import { writable } from 'svelte/store'
import type { ShellZone } from './shellTheme'

export type EditZone = 'logo' | 'ambiance' | 'decor' | 'members' | 'home' | 'sheet'

/** La plaque du contenant que chaque stylo stylise (CDC partie 3). */
export const ZONE_OF: Record<EditZone, ShellZone> = {
	logo: 'rail', ambiance: 'sidebar', decor: 'header', members: 'members', home: 'sheet', sheet: 'sheet',
}

export const editMode = writable(false)

/** Panneau ouvert : sa zone et le bouton stylo auquel il s'ancre. */
export const editPanel = writable<{ zone: EditZone; anchor: HTMLElement } | null>(null)
