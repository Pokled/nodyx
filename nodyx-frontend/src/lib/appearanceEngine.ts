/**
 * L'instance UNIQUE du moteur d'apparence pour l'onglet, reliée au vrai
 * réseau, à l'aperçu du contenant (shellPreview / identityPreview) et au
 * rechargement des données. Utilisée par l'écran Apparence ET le stylo en
 * direct : un seul brouillon côté navigateur (SPECS/NODYX_APPARENCE_CDC.md).
 *
 * Navigateur seulement : on ne l'appelle que depuis des événements et onMount.
 */
import { get } from 'svelte/store'
import { invalidateAll } from '$app/navigation'
import { t } from './i18n'
import { createAppearanceDraft } from './appearanceDraft'
import { shellPreview, identityPreview } from './shellPreview'

let token: string | null = null
/** Jeton de l'admin (page.data.token), à poser avant load(). */
export function setAppearanceToken(value: string | null) { token = value }

export const appearance = createAppearanceDraft({
	api: (path, init = {}) => fetch(`/api/v1/admin/appearance${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			...((init.headers as Record<string, string>) ?? {}),
		},
	}),
	preview: (ambiance, identity) => { shellPreview.set(ambiance); identityPreview.set(identity) },
	reload: () => invalidateAll(),
	messages: {
		load: () => get(t)('appr.load_error'),
		save: () => get(t)('appr.save_error'),
		publish: () => get(t)('appr.publish_error'),
	},
})
