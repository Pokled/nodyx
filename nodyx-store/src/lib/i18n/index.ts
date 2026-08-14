// i18n du magasin. Dictionnaires plats, interpolation {{}}, aucun pluriel :
// le meme contrat que le reste de Nodyx, pour qu'un contributeur n'ait pas a
// apprendre deux systemes.

import fr from './fr.json'
import en from './en.json'

export const LOCALES = { fr, en } as const
export type Locale = keyof typeof LOCALES
export const DEFAULT_LOCALE: Locale = 'fr'

export function isLocale(raw: unknown): raw is Locale {
	return typeof raw === 'string' && raw in LOCALES
}

/** Negocie une langue depuis un en-tete Accept-Language, sans dependance. */
export function negotiate(header: string | null): Locale {
	for (const part of (header ?? '').split(',')) {
		const tag = part.split(';')[0].trim().slice(0, 2).toLowerCase()
		if (isLocale(tag)) return tag
	}
	return DEFAULT_LOCALE
}

/**
 * Rend le traducteur d'une langue.
 *
 * Une cle absente rend la CLE, visiblement moche : un trou de traduction doit
 * se voir en developpement plutot que se cacher derriere un texte plausible.
 */
export function translator(locale: Locale) {
	const dict = LOCALES[locale] as Record<string, string>
	const fallback = LOCALES[DEFAULT_LOCALE] as Record<string, string>
	return function t(key: string, values?: Record<string, string | number>): string {
		const raw = dict[key] ?? fallback[key]
		if (raw === undefined) return key
		if (!values) return raw
		return raw.replace(/\{\{(\w+)\}\}/g, (whole, k) =>
			Object.prototype.hasOwnProperty.call(values, k) ? String(values[k]) : whole)
	}
}
