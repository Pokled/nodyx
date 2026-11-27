// Le catalogue « Ajouter un bloc » du nouvel éditeur (lot L1b, SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md
// §3.1, maquette https://nodyx.org/builder-maquette.html). Les blocs sont rangés par USAGE, pas
// par famille technique : Accueillir, Montrer la vie, Mettre en avant. Chacun a un nom simple, une
// phrase et un petit croquis.
//
// Textes : des clés i18n (FR et EN), jamais du texte en dur. Croquis : des rectangles décrits en
// données (dessinés par l'éditeur en SVG), jamais du HTML. Un test vérifie que chaque bloc du
// registre a sa fiche ici : un bloc oublié ne disparaît pas du catalogue en silence.

export type CatalogGroup = 'welcome' | 'life' | 'highlight'
export const CATALOG_GROUPS: CatalogGroup[] = ['welcome', 'life', 'highlight']

/** Un rectangle du croquis, dans un cadre de 100 × 56. `ink` : texte, `accent` : couleur, `soft` : gris. */
export interface SketchRect { x: number; y: number; w: number; h: number; tone: 'ink' | 'accent' | 'soft' }

export interface CatalogEntry {
	id: string
	group: CatalogGroup
	nameKey: string
	descKey: string
	sketch: SketchRect[]
}

const r = (x: number, y: number, w: number, h: number, tone: SketchRect['tone']): SketchRect => ({ x, y, w, h, tone })
const k = (id: string) => ({ nameKey: `hpe.cat.${id}.name`, descKey: `hpe.cat.${id}.desc` })

export const CATALOG: CatalogEntry[] = [
	// ── Accueillir ──
	{ id: 'vitrine', group: 'welcome', ...k('vitrine'), sketch: [r(0, 6, 44, 10, 'ink'), r(0, 20, 38, 4, 'soft'), r(0, 27, 34, 4, 'soft'), r(0, 38, 22, 8, 'accent'), r(52, 0, 26, 56, 'ink'), r(81, 0, 19, 27, 'accent'), r(81, 29, 19, 27, 'soft')] },
	{ id: 'hero-banner', group: 'welcome', ...k('hero-banner'), sketch: [r(0, 0, 100, 56, 'ink'), r(28, 18, 44, 7, 'soft'), r(38, 32, 24, 8, 'accent')] },
	{ id: 'header', group: 'welcome', ...k('header'), sketch: [r(0, 0, 100, 56, 'soft'), r(8, 30, 18, 18, 'ink'), r(30, 34, 40, 7, 'ink')] },
	{ id: 'announcement-banner', group: 'welcome', ...k('announcement-banner'), sketch: [r(0, 22, 100, 12, 'accent'), r(8, 26, 50, 4, 'soft')] },
	{ id: 'join-card', group: 'welcome', ...k('join-card'), sketch: [r(14, 6, 72, 44, 'soft'), r(24, 14, 40, 6, 'ink'), r(24, 24, 52, 4, 'soft'), r(24, 34, 52, 9, 'accent')] },
	// ── Montrer la vie ──
	{ id: 'stats-bar', group: 'life', ...k('stats-bar'), sketch: [r(0, 16, 23, 24, 'accent'), r(25.6, 16, 23, 24, 'soft'), r(51.2, 16, 23, 24, 'soft'), r(76.8, 16, 23, 24, 'soft')] },
	{ id: 'recent-threads', group: 'life', ...k('recent-threads'), sketch: [r(0, 4, 8, 8, 'accent'), r(12, 5, 70, 6, 'ink'), r(0, 20, 8, 8, 'soft'), r(12, 21, 60, 6, 'ink'), r(0, 36, 8, 8, 'soft'), r(12, 37, 66, 6, 'ink')] },
	{ id: 'twitch-stream', group: 'life', ...k('twitch-stream'), sketch: [r(0, 0, 70, 56, 'ink'), r(4, 4, 16, 6, 'accent'), r(74, 0, 26, 56, 'soft')] },
	// ── Mettre en avant ──
	{ id: 'article-slideshow', group: 'highlight', ...k('article-slideshow'), sketch: [r(0, 0, 100, 44, 'ink'), r(40, 50, 6, 4, 'accent'), r(50, 50, 6, 4, 'soft'), r(60, 50, 6, 4, 'soft')] },
	{ id: 'articles-showcase', group: 'highlight', ...k('articles-showcase'), sketch: [r(0, 0, 31, 30, 'ink'), r(34.5, 0, 31, 30, 'accent'), r(69, 0, 31, 30, 'soft'), r(0, 36, 26, 5, 'soft'), r(34.5, 36, 26, 5, 'soft'), r(69, 36, 26, 5, 'soft')] },
	{ id: 'social-links-bar', group: 'highlight', ...k('social-links-bar'), sketch: [r(14, 20, 14, 14, 'accent'), r(32, 20, 14, 14, 'soft'), r(50, 20, 14, 14, 'soft'), r(68, 20, 14, 14, 'soft')] },
]

export function catalogEntry(id: string): CatalogEntry | undefined {
	return CATALOG.find(e => e.id === id)
}

/** Les fiches d'une famille, filtrées par la recherche (sur le nom et la phrase, déjà traduits). */
export function catalogGroup(group: CatalogGroup, query: string, t: (key: string) => string): CatalogEntry[] {
	const q = normalize(query)
	return CATALOG.filter(e => e.group === group && (!q || normalize(t(e.nameKey)).includes(q) || normalize(t(e.descKey)).includes(q)))
}

/** Recherche tolérante : sans accents, sans majuscules (« banniere » trouve « Bannière »). */
export function normalize(s: string): string {
	return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}
