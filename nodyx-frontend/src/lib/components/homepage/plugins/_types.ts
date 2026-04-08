// Interface commune à tous les plugins de widget homepage
// Un plugin est totalement auto-contenu : métadonnées + schema + composant Svelte

import type { Component } from 'svelte';

export type WidgetFamily = 'media' | 'gaming' | 'community' | 'esport' | 'social' | 'content'
export type WidgetPhase  = 1 | 2 | 3 | 4 | 5

export type FieldType = 'text' | 'textarea' | 'url' | 'number' | 'boolean' | 'select' | 'color' | 'image'

export interface FieldSchema {
	key:          string
	type:         FieldType
	label:        string
	placeholder?: string
	default?:     unknown
	required?:    boolean
	options?:     { value: string; label: string }[]
	min?:         number
	max?:         number
	hint?:        string
}

export interface WidgetPlugin {
	id:        string
	label:     string
	icon:      string
	desc:      string
	family:    WidgetFamily
	phase:     WidgetPhase
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	component: Component<any, any, any>
	schema:    FieldSchema[]
}
