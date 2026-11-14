<script lang="ts">
	// « Trouver sur la carte » (création et modification d'un événement). On tape un lieu,
	// on clique, on choisit le bon résultat : la latitude et la longitude se remplissent
	// seules (avant : à chercher ailleurs et recopier à la main).
	//
	// Le serveur Nodyx pose la question à OpenStreetMap (services/geocode.ts du cœur) :
	// le navigateur du membre ne lui parle jamais. Recherche sur un CLIC seulement :
	// l'autocomplétion est interdite par les règles du service.
	import { onMount } from 'svelte'
	import { PUBLIC_API_URL } from '$app/env/public'
	import { t, locale } from '$lib/i18n'

	type Result = { label: string; lat: number; lng: number; kind: string }
	let { query, token, onpick, picked = null }: {
		/** Le texte du champ « Lieu ». */
		query: string
		token: string | null
		onpick: (r: { lat: number; lng: number; label: string }) => void
		/** Le libellé du lieu choisi (affiché tant qu'il est retenu). */
		picked?: string | null
	} = $props()

	let enabled = $state(true)
	let busy = $state(false)
	let results = $state<Result[] | null>(null)
	let error = $state<string | null>(null)
	let chosen = $state<string | null>(null)
	let lastQuery = $state('')

	const ready = $derived(query.trim().length >= 3 && !busy)

	onMount(async () => {
		try {
			const r = await fetch(`${PUBLIC_API_URL}/api/v1/geo/status`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
			if (r.ok) enabled = (await r.json()).enabled !== false
		} catch { /* le bouton reste, l'erreur s'affichera au clic */ }
	})

	async function find() {
		if (!ready) return
		busy = true; error = null; results = null; chosen = null
		lastQuery = query.trim()
		try {
			const r = await fetch(`${PUBLIC_API_URL}/api/v1/geo/search?q=${encodeURIComponent(lastQuery)}&lang=${encodeURIComponent($locale)}`,
				{ headers: token ? { Authorization: `Bearer ${token}` } : {} })
			const json = await r.json().catch(() => ({}))
			if (!r.ok) {
				error = json.code === 'GEO_BUSY' ? $t('event.geo_busy') : json.code === 'GEO_DISABLED' ? $t('event.geo_disabled') : $t('event.geo_unavailable')
				if (json.code === 'GEO_DISABLED') enabled = false
				return
			}
			results = json.results ?? []
			if (results!.length === 1) choose(results![0])     // un seul : choisi d'office, « Pas le bon ? » reste possible
		} catch {
			error = $t('event.geo_unavailable')
		} finally {
			busy = false
		}
	}

	function choose(r: Result) {
		chosen = r.label
		onpick({ lat: r.lat, lng: r.lng, label: r.label })
	}
</script>

{#if enabled}
	<div class="lf">
		<button type="button" class="lf-btn" onclick={find} disabled={!ready} title={query.trim().length < 3 ? $t('event.geo_type_first') : ''}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
			{busy ? $t('event.geo_searching') : $t('event.geo_find')}
		</button>

		{#if error}
			<p class="lf-msg bad" role="alert">{error}</p>
		{:else if results && results.length === 0}
			<p class="lf-msg" role="status">{$t('event.geo_none', { q: lastQuery })}</p>
		{:else if results && results.length > 0}
			<div class="lf-list" role="listbox" aria-label={$t('event.geo_results_aria')}>
				{#if results.length > 1}<p class="lf-msg">{$t('event.geo_pick')}</p>{/if}
				{#each results as r, i (i)}
					<button type="button" role="option" aria-selected={chosen === r.label} class="lf-opt" class:on={chosen === r.label} onclick={() => choose(r)}>
						<span class="lf-dot" aria-hidden="true"></span>
						<span class="lf-label">{r.label}</span>
					</button>
				{/each}
				<p class="lf-attr">{$t('event.geo_attribution')}</p>
			</div>
		{:else if picked}
			<p class="lf-msg ok">{$t('event.geo_current', { place: picked })}</p>
		{/if}
	</div>
{/if}

<style>
	.lf { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	.lf-btn { align-self: flex-start; display: inline-flex; align-items: center; gap: 7px; border-radius: 10px; padding: 7px 14px; font-size: 13px; font-weight: 600; border: 1px solid color-mix(in srgb, var(--nx-header-accent) 55%, transparent); background: color-mix(in srgb, var(--nx-header-accent) 12%, var(--nx-surface)); color: var(--nx-text); cursor: pointer; }
	.lf-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--nx-header-accent) 20%, var(--nx-surface)); }
	.lf-btn:disabled { opacity: .55; cursor: default; }
	.lf-btn svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
	.lf-msg { margin: 0; font-size: 12.5px; color: var(--nx-text-muted); }
	.lf-msg.bad { color: var(--nx-bad); }
	.lf-msg.ok { color: var(--nx-ok); }
	.lf-list { display: flex; flex-direction: column; gap: 4px; border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 12px; padding: 8px; background: var(--nx-surface); }
	.lf-opt { display: flex; align-items: flex-start; gap: 9px; width: 100%; text-align: left; border: 0; background: transparent; border-radius: 8px; padding: 7px 8px; color: var(--nx-text); font-size: 13px; cursor: pointer; }
	.lf-opt:hover { background: color-mix(in srgb, var(--nx-text) 5%, transparent); }
	.lf-opt.on { background: color-mix(in srgb, var(--nx-header-accent) 14%, transparent); }
	.lf-dot { width: 12px; height: 12px; flex: none; margin-top: 3px; border-radius: 99px; border: 2px solid color-mix(in srgb, var(--nx-text) 30%, transparent); }
	.lf-opt.on .lf-dot { border-color: var(--nx-header-accent); background: var(--nx-header-accent); box-shadow: inset 0 0 0 2px var(--nx-surface); }
	.lf-label { line-height: 1.35; }
	.lf-attr { margin: 4px 8px 0; font-size: 11px; color: var(--nx-text-faint); }
</style>
