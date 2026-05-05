// Couche de fusion natifs <-> widgets installés pour le builder admin.
//
// Pourquoi ce fichier existe (Phase 1) :
//   - PLUGIN_REGISTRY ne contient que les widgets natifs hardcodés (Component
//     Svelte importé statiquement, schema typé, phase, etc.).
//   - installed_widgets en DB stocke des manifests JSON de widgets uploadés
//     qui exposent leur runtime via un Web Component (widget.iife.js).
//   - Le builder a besoin d'une vue *commune* pour son picker, sa résolution
//     d'icône, son formulaire de config, et la preview live.
//
// Ce module ne touche pas au type WidgetPlugin natif. Il introduit une
// vue de surface (CatalogEntry) qui sera vraiment unifiée en Phase 2.

import { PLUGIN_LIST, PLUGIN_REGISTRY } from './plugins'
import type { WidgetPlugin, FieldSchema, FieldType, WidgetFamily } from './plugins/_types'

// Manifest d'un widget installé tel que renvoyé par /api/v1/widget-store-public.
export interface InstalledWidgetManifest {
	id:           string
	label:        string
	version:      string
	author?:      string
	icon?:        string
	family?:      string
	description?: string
	entry:        string
	schema?:      unknown[]
}

// Vue unifiée pour le picker et la résolution par id. Union discriminée
// plutôt que d'élargir WidgetPlugin (qui exige `component`, `phase`, etc.
// inadaptés à un widget chargé en runtime).
export type CatalogEntry =
	| {
			kind:   'native'
			id:     string
			label:  string
			icon:   string
			family: WidgetFamily
			desc:   string
			schema: FieldSchema[]
			plugin: WidgetPlugin
		}
	| {
			kind:    'installed'
			id:      string
			label:   string
			icon:    string
			family:  WidgetFamily | string
			desc:    string
			schema:  FieldSchema[]
			entry:   string
			version: string
			author?: string
		}

// Les SDK externes utilisent souvent `checkbox` là où le builder attend
// `boolean`. On accepte les deux à l'entrée pour ne pas casser les widgets
// déjà publiés (le SDK officiel devra à terme imposer `boolean`).
function canonFieldType(raw: string): FieldType {
	if (raw === 'checkbox') return 'boolean'
	return raw as FieldType
}

function canonField(raw: unknown): FieldSchema | null {
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

function manifestToEntry(m: InstalledWidgetManifest): CatalogEntry {
	const schema = (m.schema ?? [])
		.map(canonField)
		.filter((f): f is FieldSchema => f !== null)
	return {
		kind:    'installed',
		id:      m.id,
		label:   m.label,
		icon:    m.icon ?? '🧩',
		family:  m.family ?? 'content',
		desc:    m.description ?? '',
		schema,
		entry:   m.entry,
		version: m.version,
		author:  m.author,
	}
}

function pluginToEntry(p: WidgetPlugin): CatalogEntry {
	return {
		kind:   'native',
		id:     p.id,
		label:  p.label,
		icon:   p.icon,
		family: p.family,
		desc:   p.desc,
		schema: p.schema,
		plugin: p,
	}
}

// Catalogue complet pour le picker du builder. Natifs phase 1 d'abord
// (toujours disponibles), puis widgets installés non-shadowés par un natif.
export function buildCatalog(installed: InstalledWidgetManifest[] = []): CatalogEntry[] {
	const natives = PLUGIN_LIST
		.filter(p => p.phase === 1)
		.map(pluginToEntry)
	const dyns = installed
		.filter(m => !PLUGIN_REGISTRY[m.id]) // un installed ne masque jamais un natif
		.map(manifestToEntry)
	return [...natives, ...dyns]
}

// Index par id pour la résolution O(1) (icône, schema, etc.) côté UI.
export function buildCatalogIndex(entries: CatalogEntry[]): Record<string, CatalogEntry> {
	const out: Record<string, CatalogEntry> = {}
	for (const e of entries) out[e.id] = e
	return out
}

// Format attendu par GridRenderer / WidgetZone pour la prop `installedWidgets`.
export function toInstalledWidgetsMap(installed: InstalledWidgetManifest[] = []): Record<string, { entry: string; [k: string]: unknown }> {
	const out: Record<string, { entry: string; [k: string]: unknown }> = {}
	for (const m of installed) {
		if (PLUGIN_REGISTRY[m.id]) continue // natif gagne
		out[m.id] = { entry: m.entry, label: m.label, icon: m.icon }
	}
	return out
}
