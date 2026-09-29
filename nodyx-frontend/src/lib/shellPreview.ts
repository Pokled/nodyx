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

/**
 * Aperçu d'une IDENTITÉ non publiée (logo, bannière) : même principe que
 * shellPreview. Un champ absent = on garde la valeur publiée ; null = retiré.
 */
export const identityPreview = writable<{ logo_url?: string | null; banner_url?: string | null } | null>(null)
