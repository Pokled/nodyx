// Interface commune à tous les plugins de widget homepage
// Un plugin est totalement auto-contenu : métadonnées + schema + composant Svelte

import type { Component } from 'svelte';

export type WidgetFamily = 'media' | 'gaming' | 'community' | 'esport' | 'social' | 'content'
export type WidgetPhase  = 1 | 2 | 3 | 4 | 5

export type FieldType = 'text' | 'textarea' | 'url' | 'number' | 'boolean' | 'select' | 'color' | 'image'
	// Nouvel éditeur (lot L0, SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md §4) : l'ancien formulaire ne les
	// connaît pas, seuls les widgets du nouvel éditeur s'en servent.
	| 'list'          // une liste qu'on ouvre, déplace, retire, complète (`fields`, `maxItems`, `newItem`)
	| 'media'         // une image choisie dans la médiathèque
	| 'link'          // une page de l'instance, ou une adresse https vérifiée
	| 'category' | 'categories' | 'tag'   // lus dans Nodyx, avec leur nombre de sujets
	| 'slider'        // un curseur (`min`, `max`, `step`)
	| 'choice-visual' // des choix avec croquis (`options[].sketch`)
	| 'measure'       // « ce qu'on compte » pour un chiffre, avec sa valeur du jour

export interface FieldSchema {
	key:          string
	type:         FieldType
	label:        string
	placeholder?: string
	default?:     unknown
	required?:    boolean
	/** `sketch` (choice-visual) : un petit croquis, rectangles dans un cadre de 100 × 56 */
	options?:     { value: string; label: string; sketch?: { x: number; y: number; w: number; h: number; tone: 'ink' | 'accent' | 'soft' }[] }[]
	min?:         number
	max?:         number
	hint?:        string
	/** Long explanation — shown in a collapsible info panel triggered by a (?) icon
	 *  next to the field label. Use \n for paragraph breaks. */
	details?:     string
	// ── Nouvel éditeur (lot L0) ──
	/** Un exemple concret, montré quand le champ est vide (règle R8). */
	example?:     string
	/** Le champ n'apparaît que si TOUTES ces valeurs correspondent dans la config. */
	showIf?:      Record<string, unknown>
	/** `list` : les champs de chaque élément */
	fields?:      FieldSchema[]
	/** `list` : la clé dont la valeur sert de nom à l'élément replié */
	itemLabelKey?: string
	/** `list` : nombre maximum d'éléments */
	maxItems?:    number
	/** `list` : le contenu d'un élément ajouté */
	newItem?:     Record<string, unknown>
	/** `slider` : le pas */
	step?:        number
}

/** Le rangement du catalogue par usage (remplace `family` à l'affichage). */
export type WidgetGroup = 'welcome' | 'life' | 'highlight'

/** Une ligne de « D'où vient ce qui s'affiche ? » : des clés i18n, jamais du texte en dur. */
export interface AnatomyLine { labelKey: string; textKey: string; vars?: Record<string, string> }

/** Ce que l'éditeur sait de l'instance quand il vérifie un bloc avant publication. */
export interface CheckContext {
	categories: Record<string, { name: string; threads: number }>
	events:     number
}
/** Un point de « Avant de publier » ; jamais bloquant (règle R11 / §3.4). */
export interface WidgetCheck {
	level:    'warning' | 'info'
	textKey:  string
	vars?:    Record<string, string>
	/** Le chemin du réglage à ouvrir pour corriger (ex. « items.2.img ») */
	field?:   string
}

export interface WidgetPlugin {
	id:           string
	label:        string
	icon:         string
	desc:         string
	family:       WidgetFamily
	phase:        WidgetPhase
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component:    Component<any, any, any>
	schema:       FieldSchema[]
	/** Si true, le builder affiche un panel de config custom au lieu du formulaire auto-généré */
	customPanel?: boolean
	// ── Nouvel éditeur (lot L0), tous facultatifs : un widget sans eux marche comme avant ──
	group?:       WidgetGroup
	/** Le petit croquis du catalogue (HTML statique, sans script) */
	sketch?:      string
	/** Les réglages repliés sous « Plus de réglages » */
	advanced?:    FieldSchema[]
	anatomy?:     (config: Record<string, unknown>) => AnatomyLine[]
	checks?:      (config: Record<string, unknown>, ctx: CheckContext) => WidgetCheck[]
	/** La forme actuelle d'une config enregistrée dans un format plus ancien (lot L1c). Pure et
	 *  idempotente ; l'éditeur ne l'applique qu'au premier réglage modifié, pour qu'une page
	 *  relue telle quelle reste « Publiée ». */
	normalize?:   (config: Record<string, unknown>) => Record<string, unknown>
}
