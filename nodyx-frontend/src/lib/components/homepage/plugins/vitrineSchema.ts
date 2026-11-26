import type { FieldSchema } from './_types'

// La vitrine de la maquette « Polygone dans l'application » (validée le 26/11/2026).
// Libellés : des clés i18n (préfixe « hpw. »), traduites par le builder ; jamais de texte en dur.
export const K = 'hpw.vitrine.'

const tuile = (n: 1 | 2 | 3): FieldSchema[] => [
	{ key: `img${n}`, type: 'image', label: `${K}img${n}`, hint: `${K}img_hint`, placeholder: '/uploads/…' },
	{ key: `img${n}_kicker`, type: 'text', label: `${K}img_kicker`, placeholder: `${K}img${n}_kicker_ph` },
	{ key: `img${n}_title`, type: 'text', label: `${K}img_title`, placeholder: `${K}img${n}_title_ph` },
	{ key: `img${n}_link`, type: 'url', label: `${K}img_link`, placeholder: '/forum' },
]

export const VITRINE_SCHEMA: FieldSchema[] = [
		{ key: 'title', type: 'text', label: `${K}title`, placeholder: `${K}title_ph`, required: true },
		{ key: 'text', type: 'textarea', label: `${K}text`, placeholder: `${K}text_ph` },
		{ key: 'cta_text', type: 'text', label: `${K}cta_text`, placeholder: `${K}cta_text_ph` },
		{ key: 'cta_url', type: 'url', label: `${K}cta_url`, hint: `${K}url_hint`, placeholder: '/forum' },
		{ key: 'cta2_text', type: 'text', label: `${K}cta2_text`, placeholder: `${K}cta2_text_ph` },
		{ key: 'cta2_url', type: 'url', label: `${K}cta2_url`, placeholder: '/forum' },
		{ key: 'img1_badge', type: 'text', label: `${K}img1_badge`, placeholder: `${K}img1_badge_ph` },
		...tuile(1), ...tuile(2), ...tuile(3),
]
