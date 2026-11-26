// Les polices de la base de design (planche « Les polices », validée le 26/11/2026 : Inter par
// défaut). Toutes auto-hébergées par l'instance, sous licence libre (OFL.txt à côté de chaque
// police dans static/fonts/) : aucun appel à un service tiers, rien ne part chez Google.
//
// Une police n'est chargée que si l'admin l'a choisie : on ajoute alors UNE feuille, `css`,
// et le navigateur ne télécharge que les alphabets dont la page a besoin (unicode-range).
// La liste est la même que celle du cœur (DESIGN_FONTS, nodyx-core/src/utils/shellTheme.ts) ;
// un test vérifie qu'elles ne divergent pas.

export type FontId = 'inter' | 'geist' | 'plex' | 'source' | 'atkinson' | 'system'

/** La police de l'appareil : aucun fichier à charger. Sert aussi de secours à toutes les autres. */
export const PILE_SYSTEME = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"

export interface Police {
	/** Nom affiché à l'admin (nom propre de la police, ne se traduit pas). */
	nom: string
	/** Valeur de font-family, avec la police de l'appareil en secours. */
	famille: string
	/** La feuille à charger, ou null pour la police de l'appareil. */
	css: string | null
}

export const POLICES: Record<FontId, Police> = {
	inter: { nom: 'Inter', famille: `'Inter Variable', ${PILE_SYSTEME}`, css: '/fonts/inter/font.css' },
	geist: { nom: 'Geist', famille: `'Geist Variable', ${PILE_SYSTEME}`, css: '/fonts/geist/font.css' },
	plex: { nom: 'IBM Plex Sans', famille: `'IBM Plex Sans Variable', ${PILE_SYSTEME}`, css: '/fonts/plex/font.css' },
	source: { nom: 'Source Sans 3', famille: `'Source Sans 3 Variable', ${PILE_SYSTEME}`, css: '/fonts/source/font.css' },
	atkinson: { nom: 'Atkinson Hyperlegible Next', famille: `'Atkinson Hyperlegible Next Variable', ${PILE_SYSTEME}`, css: '/fonts/atkinson-hyperlegible-next/font.css' },
	system: { nom: '', famille: PILE_SYSTEME, css: null },
}

export const POLICE_NODYX: FontId = 'inter'

/** La police d'un réglage, ou Inter si le réglage est absent ou inconnu (jamais une valeur saisie). */
export function policeDe(id: unknown): Police {
	return typeof id === 'string' && Object.hasOwn(POLICES, id) ? POLICES[id as FontId] : POLICES[POLICE_NODYX]
}
