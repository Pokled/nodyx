import { writable } from 'svelte/store'
import type { ShellTheme } from './shellTheme'

/**
 * Aperçu d'une ambiance NON publiée (SPECS/NODYX_APPARENCE_CDC.md).
 *
 * L'écran Apparence et le stylo en direct y posent le brouillon en cours :
 * le layout l'applique à la place de l'ambiance publiée, pour l'admin seul
 * (c'est un état du navigateur, jamais envoyé aux autres). null = on revient
 * à la version publiée.
 */
export const shellPreview = writable<ShellTheme | null>(null)
