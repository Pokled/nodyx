// Catalogue des surfaces d'extension, et normalisation des champs de config.
//
// Module PUR : il n'importe aucun composant Svelte, uniquement des types. C'est
// ce qui le rend testable dans le harnais node du depot, et ce qui permet de le
// relire comme une frontiere plutot que comme du code d'interface.

import type { FieldSchema, FieldType } from './plugins/_types'

// Les SDK externes utilisent souvent `checkbox` là où le builder attend
// `boolean`. On accepte les deux à l'entrée pour ne pas casser les widgets
// déjà publiés (le SDK officiel devra à terme imposer `boolean`).
export function canonFieldType(raw: string): FieldType {
	if (raw === 'checkbox') return 'boolean'
	return raw as FieldType
}

export function canonField(raw: unknown): FieldSchema | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (typeof r.key !== 'string' || typeof r.label !== 'string' || typeof r.type !== 'string') return null
	return {
		key:         r.key,
		label:       r.label,
		type:        canonFieldType(r.type),
		placeholder: typeof r.placeholder === 'string' ? r.placeholder : undefined,
		default:     r.default,
		required:    typeof r.required === 'boolean' ? r.required : undefined,
		options:     Array.isArray(r.options) ? r.options as { value: string; label: string }[] : undefined,
		min:         typeof r.min === 'number' ? r.min : undefined,
		max:         typeof r.max === 'number' ? r.max : undefined,
		hint:        typeof r.hint === 'string' ? r.hint : undefined,
		details:     typeof r.details === 'string' ? r.details : undefined,
	}
}

// ── Extensions installees (SDK api 1) ────────────────────────────────────────
//
// Une surface d'extension entre dans le catalogue du builder comme n'importe
// quel widget, avec un identifiant PREFIXE : `ext:<extension>:<surface>`. Le
// prefixe n'est pas cosmetique, il garantit qu'une extension ne peut jamais
// prendre l'identite d'un widget natif dans une mise en page enregistree.

export const EXTENSION_WIDGET_PREFIX = 'ext:'

export interface PublicExtensionSurface {
	type:          'widget' | 'page'
	id?:           string
	path?:         string
	entry:         string
	label:         string
	defaultHeight?: number | null
	schema?:       FieldSchema[]
}

export interface PublicExtension {
	id:          string
	version:     string
	label:       string
	description: string
	icon:        string | null
	family:      string
	messages:    Record<string, string>
	surfaces:    PublicExtensionSurface[]
}

/** Identifiant de mise en page d'une surface widget d'extension. */
export function extensionWidgetId(extensionId: string, surfaceId: string): string {
	return `${EXTENSION_WIDGET_PREFIX}${extensionId}:${surfaceId}`
}

/** Decompose un identifiant, ou rend null si ce n'en est pas un. */
export function parseExtensionWidgetId(raw: string): { extensionId: string; surfaceId: string } | null {
	if (!raw.startsWith(EXTENSION_WIDGET_PREFIX)) return null
	const [extensionId, surfaceId] = raw.slice(EXTENSION_WIDGET_PREFIX.length).split(':')
	if (!extensionId || !surfaceId) return null
	return { extensionId, surfaceId }
}

export interface ExtensionSurfaceEntry {
	kind:        'extension'
	id:          string          // identifiant de mise en page, prefixe
	extensionId: string
	surfaceId:   string
	version:     string
	entry:       string
	label:       string
	/** Caractere affiche a cote du libelle. JAMAIS une URL. */
	icon:        string
	/** Icone livree par l'extension, pour un rendu en image. */
	iconUrl:     string | null
	family:      string
	desc:        string
	schema:      FieldSchema[]
	messages:    Record<string, string>
	defaultHeight: number
}

/** Surfaces widget de toutes les extensions activees, pretes pour le builder. */
export function extensionWidgetEntries(extensions: PublicExtension[] = []): ExtensionSurfaceEntry[] {
	const out: ExtensionSurfaceEntry[] = []
	for (const ext of extensions) {
		for (const s of ext.surfaces) {
			if (s.type !== 'widget' || !s.id) continue
			out.push({
				kind:          'extension',
				id:            extensionWidgetId(ext.id, s.id),
				extensionId:   ext.id,
				surfaceId:     s.id,
				version:       ext.version,
				entry:         s.entry,
				label:         s.label || ext.label,
				// Le builder rend `icon` comme du TEXTE a cote du libelle : y
				// mettre l'URL l'affichait en clair dans le picker, a la place
				// du nom. Vu en production.
				icon:          '🧩',
				iconUrl:       ext.icon ?? null,
				family:        ext.family,
				desc:          ext.description,
				schema:        (s.schema ?? []).map(canonField).filter((f): f is FieldSchema => f !== null),
				messages:      ext.messages,
				defaultHeight: s.defaultHeight ?? 160,
			})
		}
	}
	return out
}

/** Index par identifiant de mise en page, pour la resolution au rendu. */
export function extensionIndex(extensions: PublicExtension[] = []): Record<string, ExtensionSurfaceEntry> {
	const out: Record<string, ExtensionSurfaceEntry> = {}
	for (const e of extensionWidgetEntries(extensions)) out[e.id] = e
	return out
}
