// La base de design de Nodyx : formes et espace (planche « Encadrés, bordures et fonds »,
// validée le 26/11/2026) et les styles que l'admin choisit puis affine (maquette
// « Personnaliser mon instance »). Module pur, testé sans navigateur.

/** L'espace : toujours un multiple de 4 pixels. */
export const ESPACE = [4, 8, 12, 16, 24, 32, 48, 64] as const

export type Arrondi = 'carre' | 'leger' | 'moyen' | 'rond'
export type Bordure = 'aucune' | 'fin' | 'marque'
export type Ombre = 'aucune' | 'flotte' | 'partout'
export type Coins = 'aucun' | 'un' | 'quatre'

/** Les arrondis suivent la taille : étiquette, bouton ou champ, panneau, fenêtre. */
export const ARRONDIS: Record<Arrondi, { etiquette: number; controle: number; panneau: number; fenetre: number }> = {
	carre: { etiquette: 0, controle: 0, panneau: 0, fenetre: 0 },
	leger: { etiquette: 3, controle: 4, panneau: 6, fenetre: 10 },
	moyen: { etiquette: 4, controle: 6, panneau: 10, fenetre: 14 },
	rond: { etiquette: 6, controle: 10, panneau: 16, fenetre: 20 },
}

export interface Reglages { arrondi: Arrondi; bord: Bordure; ombre: Ombre; coins: Coins }
export type StyleId = 'net' | 'arrondi' | 'coupe'

/** Les trois points de départ. Celui de Nodyx : « Arrondi ». */
export const STYLES: Record<StyleId, Reglages> = {
	net: { arrondi: 'leger', bord: 'fin', ombre: 'flotte', coins: 'aucun' },
	arrondi: { arrondi: 'moyen', bord: 'fin', ombre: 'flotte', coins: 'aucun' },
	coupe: { arrondi: 'carre', bord: 'fin', ombre: 'aucune', coins: 'un' },
}

/** Le style de départ qui correspond exactement à ces réglages, ou 'perso' si l'admin a affiné. */
export function styleDe(r: Reglages): StyleId | 'perso' {
	const hit = (Object.keys(STYLES) as StyleId[]).find(k => {
		const s = STYLES[k]
		return s.arrondi === r.arrondi && s.bord === r.bord && s.ombre === r.ombre && s.coins === r.coins
	})
	return hit ?? 'perso'
}

/** Ce qui va dans le CSS. Valeurs calculées uniquement (nombres, mots connus) : rien de saisi
 *  par l'admin n'arrive tel quel dans une feuille de style. */
export function styleVars(r: Reglages): Record<string, string> {
	const a = ARRONDIS[r.arrondi] ?? ARRONDIS.moyen
	return {
		'--nx-r-etiquette': `${a.etiquette}px`,
		'--nx-r-controle': `${a.controle}px`,
		'--nx-r-panneau': `${a.panneau}px`,
		'--nx-r-fenetre': `${a.fenetre}px`,
		'--nx-bord': ({ aucune: '0px', fin: '1px', marque: '2px' } as const)[r.bord] ?? '1px',
		'--nx-coupe': r.coins === 'aucun' ? '0px' : '12px',
		'--nx-coupe-quatre': r.coins === 'quatre' ? '1' : '0',
		'--nx-ombre-posee': r.ombre === 'partout' ? '1' : '0',
		'--nx-ombre-flotte': r.ombre === 'aucune' ? '0' : '1',
	}
}
