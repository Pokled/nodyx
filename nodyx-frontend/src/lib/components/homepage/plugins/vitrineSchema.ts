import type { AnatomyLine, FieldSchema } from './_types'

// La vitrine de la maquette « Polygone dans l'application » (validée le 26/11/2026).
// Libellés : des clés i18n (préfixe « hpw. »), traduites par l'éditeur ; jamais de texte en dur.
export const K = 'hpw.vitrine.'

export const MAX_TILES = 6

const r = (x: number, y: number, w: number, h: number, tone: 'ink' | 'accent' | 'soft') => ({ x, y, w, h, tone })

/** Une affiche de la vitrine : une image de la médiathèque, une petite ligne, un nom, un lien. */
export interface VitrineTile { img: string; kicker: string; title: string; link: string }

export const VITRINE_SCHEMA: FieldSchema[] = [
	{ key: 'title', type: 'text', label: `${K}title`, example: `${K}title_ph`, required: true },
	{ key: 'text', type: 'textarea', label: `${K}text`, hint: `${K}text_hint`, example: `${K}text_ph` },
	{ key: 'cta_text', type: 'text', label: `${K}cta_text`, example: `${K}cta_text_ph` },
	{ key: 'cta_url', type: 'link', label: `${K}cta_url` },
	{ key: 'cta2_text', type: 'text', label: `${K}cta2_text`, example: `${K}cta2_text_ph` },
	{ key: 'cta2_url', type: 'link', label: `${K}cta2_url` },
	{
		key: 'tiles', type: 'list', label: `${K}tiles`, hint: `${K}tiles_hint`, maxItems: MAX_TILES, itemLabelKey: 'title',
		newItem: { img: '', kicker: '', title: '', link: '' },
		fields: [
			{ key: 'img', type: 'media', label: `${K}img` },
			{ key: 'kicker', type: 'text', label: `${K}img_kicker`, example: `${K}img1_kicker_ph` },
			{ key: 'title', type: 'text', label: `${K}img_title`, example: `${K}img1_title_ph` },
			{ key: 'link', type: 'link', label: `${K}img_link` },
		],
	},
	{
		key: 'disp', type: 'choice-visual', label: `${K}disp`, default: 'grande',
		options: [
			{ value: 'grande', label: `${K}disp_grande`, sketch: [r(0, 0, 44, 56, 'accent'), r(48, 0, 24, 26, 'soft'), r(76, 0, 24, 26, 'soft'), r(48, 30, 52, 26, 'soft')] },
			{ value: 'egales', label: `${K}disp_egales`, sketch: [r(0, 0, 48, 26, 'accent'), r(52, 0, 48, 26, 'soft'), r(0, 30, 48, 26, 'soft'), r(52, 30, 48, 26, 'soft')] },
			{ value: 'bande', label: `${K}disp_bande`, sketch: [r(0, 8, 23, 40, 'accent'), r(25.6, 8, 23, 40, 'soft'), r(51.2, 8, 23, 40, 'soft'), r(76.8, 8, 23.2, 40, 'soft')] },
		],
	},
	{ key: 'badge', type: 'text', label: `${K}img1_badge`, hint: `${K}badge_hint`, example: `${K}img1_badge_ph` },
]

/** D'où vient ce qui s'affiche (R7) : tout ce que montre la vitrine, c'est l'admin qui l'écrit. */
export function vitrineAnatomy(): AnatomyLine[] {
	return [
		{ labelKey: `${K}anat_text_l`, textKey: `${K}anat_text` },
		{ labelKey: `${K}anat_tiles_l`, textKey: `${K}anat_tiles` },
		{ labelKey: `${K}anat_links_l`, textKey: `${K}anat_links` },
	]
}

const s = (v: unknown) => (typeof v === 'string' ? v : '')

/**
 * La forme actuelle d'une config de vitrine. Les premières vitrines (avant le lot L1c)
 * enregistraient leurs images à plat (img1, img1_title…, img1_badge) : on les lit comme une
 * liste d'affiches, sans rien perdre. Une config déjà sous forme de liste est rendue telle
 * quelle. Fonction pure, idempotente.
 */
export function normalizeVitrine(config: Record<string, unknown>): Record<string, unknown> {
	if (Array.isArray(config.tiles)) return config
	const { img1_badge, ...rest } = config
	const tiles: VitrineTile[] = []
	for (const n of [1, 2, 3]) {
		const img = s(config[`img${n}`])
		if (img) tiles.push({ img, kicker: s(config[`img${n}_kicker`]), title: s(config[`img${n}_title`]), link: s(config[`img${n}_link`]) })
		for (const k of ['', '_kicker', '_title', '_link']) delete rest[`img${n}${k}`]
	}
	return { ...rest, tiles, badge: s(config.badge) || s(img1_badge) }
}
