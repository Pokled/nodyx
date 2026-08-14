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
import type { WidgetPlugin, FieldSchema, WidgetFamily } from './plugins/_types'
import { canonField, extensionWidgetEntries, type PublicExtension } from './extensionCatalog'

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
			kind:        'extension'
			id:          string      // identifiant de mise en page, prefixe `ext:`
			label:       string
			icon:        string
			family:      WidgetFamily | string
			desc:        string
			schema:      FieldSchema[]
			extensionId: string
			surfaceId:   string
			version:     string
			entry:       string
			messages:    Record<string, string>
			defaultHeight: number
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
export function buildCatalog(
	installed: InstalledWidgetManifest[] = [],
	extensions: PublicExtension[] = [],
): CatalogEntry[] {
	const natives = PLUGIN_LIST
		.filter(p => p.phase === 1)
		.map(pluginToEntry)
	const dyns = installed
		.filter(m => !PLUGIN_REGISTRY[m.id]) // un installed ne masque jamais un natif
		.map(manifestToEntry)
	// Les surfaces d'extension ne peuvent masquer personne : leur identifiant
	// est prefixe, et aucun identifiant natif ne contient de deux-points.
	const exts = extensionWidgetEntries(extensions).map((e): CatalogEntry => ({
		kind:          'extension',
		id:            e.id,
		label:         e.label,
		icon:          e.icon ?? '🧩',
		family:        e.family,
		desc:          e.desc,
		schema:        e.schema,
		extensionId:   e.extensionId,
		surfaceId:     e.surfaceId,
		version:       e.version,
		entry:         e.entry,
		messages:      e.messages,
		defaultHeight: e.defaultHeight,
	}))
	return [...natives, ...dyns, ...exts]
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
