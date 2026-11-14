<script lang="ts">
	// Administration › Mentions (SPECS/NODYX_MENTIONS_CDC.md, D51, Q1, Q2) : les trois
	// choix que l'admin fait pour SA communauté, chacun avec un exemple concret.
	// Défauts du côté le plus protecteur. Réservé aux admins (adminOnly au cœur).
	import { onMount } from 'svelte'
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import { apiFetch } from '$lib/api'

	const tFn = $derived($t)
	const token = $derived(((page.data as any)?.token ?? null) as string | null)
	let groupConfirm = $state(10)
	let retention = $state(0)
	let showUntil = $state(false)
	let loaded = $state(false)
	let saving = $state(false)
	let saved = $state(false)
	let error = $state('')

	const auth = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {})

	onMount(async () => {
		try {
			const r = await apiFetch(fetch, '/mentions/admin/settings', { headers: auth() })
			if (r.ok) {
				const { settings } = await r.json()
				groupConfirm = settings.group_confirm; retention = settings.ghost_retention_days; showUntil = settings.show_quiet_until
			} else error = tFn('amen.err_load')
		} catch { error = tFn('amen.err_load') }
		loaded = true
	})

	async function save() {
		saving = true; error = ''; saved = false
		try {
			const n = Math.round(Number(groupConfirm))
			const r = await apiFetch(fetch, '/mentions/admin/settings', {
				method: 'PUT', headers: auth(),
				body: JSON.stringify({ group_confirm: n, ghost_retention_days: retention, show_quiet_until: showUntil }),
			})
			if (!r.ok) { error = tFn('amen.err_save'); return }
			saved = true; setTimeout(() => (saved = false), 2500)
		} catch { error = tFn('amen.err_save') } finally { saving = false }
	}
</script>

<svelte:head><title>{tFn('amen.title')} · Nodyx</title></svelte:head>

<div class="adm-page amen">
	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('amen.title')}</h1>
			<p class="adm-desc">{tFn('amen.desc')}</p>
		</div>
	</header>

	{#if error}<p class="adm-notice adm-notice--warn" role="alert">{error}</p>{/if}

	{#if loaded}
	<section class="adm-card amen-card" aria-labelledby="amen-groups">
		<h2 id="amen-groups" class="amen-h2">{tFn('amen.groups_title')}</h2>
		<p class="amen-ex"><b>{tFn('amen.example')}</b> {tFn('amen.groups_example', { n: groupConfirm })}</p>
		<label class="amen-field">
			<span>{tFn('amen.groups_label')}</span>
			<input class="adm-input amen-num" type="number" min="2" max="500" bind:value={groupConfirm} />
			<span class="adm-muted">{tFn('amen.groups_unit')}</span>
		</label>
		<p class="amen-hint">{tFn('amen.groups_hint')}</p>
	</section>

	<section class="adm-card amen-card" aria-labelledby="amen-ghost">
		<h2 id="amen-ghost" class="amen-h2">{tFn('amen.ghost_title')}</h2>
		<p class="amen-ex"><b>{tFn('amen.example')}</b> {tFn('amen.ghost_example')}</p>
		<div class="amen-choices" role="radiogroup" aria-labelledby="amen-ghost">
			{#each [0, 7, 30, 90] as d (d)}
				<label class="amen-choice" class:on={retention === d}>
					<input type="radio" name="amen-ret" value={d} checked={retention === d} onchange={() => (retention = d)} />
					<span><b>{d === 0 ? tFn('amen.ghost_none') : tFn('amen.ghost_days', { n: d })}</b>
						<small>{d === 0 ? tFn('amen.ghost_none_sub') : tFn('amen.ghost_days_sub', { n: d })}</small></span>
				</label>
			{/each}
		</div>
		<p class="amen-hint">{tFn('amen.ghost_hint')}</p>
	</section>

	<section class="adm-card amen-card" aria-labelledby="amen-quiet">
		<h2 id="amen-quiet" class="amen-h2">{tFn('amen.quiet_title')}</h2>
		<p class="amen-ex"><b>{tFn('amen.example')}</b> {showUntil ? tFn('amen.quiet_example_on') : tFn('amen.quiet_example_off')}</p>
		<label class="amen-toggle">
			<input type="checkbox" bind:checked={showUntil} />
			<span>{tFn('amen.quiet_label')}</span>
		</label>
		<p class="amen-hint">{tFn('amen.quiet_hint')}</p>
	</section>

	<div class="amen-save">
		<button type="button" class="adm-btn adm-btn--primary" onclick={save} disabled={saving}>{tFn('amen.save')}</button>
		<span class="amen-saved" role="status" aria-live="polite">{saved ? tFn('amen.saved') : ''}</span>
	</div>

	<details class="adm-card amen-more">
		<summary>{tFn('amen.tech_title')}</summary>
		<ul>
			<li>{tFn('amen.tech_1')}</li>
			<li>{tFn('amen.tech_2')}</li>
			<li>{tFn('amen.tech_3')}</li>
		</ul>
	</details>
	{/if}
</div>

<style>
	.amen-card { display: flex; flex-direction: column; gap: 10px; }
	.amen-h2 { margin: 0; font-size: 15px; font-weight: 650; }
	.amen-ex { margin: 0; font-size: 13px; color: var(--nx-text-muted); background: color-mix(in srgb, var(--nx-header-accent) 7%, transparent); border-left: 3px solid var(--nx-header-accent); border-radius: 6px; padding: 8px 10px; }
	.amen-ex b { color: var(--nx-text); }
	.amen-field { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 13.5px; }
	.amen-num { width: 5.5rem; }
	.amen-hint { margin: 0; font-size: 12px; color: var(--nx-text-muted); }
	.amen-choices { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
	.amen-choice { display: flex; gap: 8px; align-items: flex-start; border: 1px solid var(--nx-border); border-radius: 10px; padding: 9px 10px; cursor: pointer; font-size: 13px; }
	.amen-choice.on { border-color: var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 7%, transparent); }
	.amen-choice input { accent-color: var(--nx-header-accent); margin-top: 3px; }
	.amen-choice small { display: block; color: var(--nx-text-muted); font-size: 11.5px; margin-top: 2px; }
	.amen-toggle { display: flex; gap: 8px; align-items: center; font-size: 13.5px; cursor: pointer; }
	.amen-toggle input { accent-color: var(--nx-header-accent); }
	.amen-save { display: flex; align-items: center; gap: 12px; margin: 4px 0 14px; }
	.amen-saved { font-size: 12.5px; color: var(--nx-ok); }
	.amen-more summary { cursor: pointer; font-size: 13px; font-weight: 600; }
	.amen-more ul { margin: 8px 0 0; padding-left: 18px; font-size: 12.5px; color: var(--nx-text-muted); display: flex; flex-direction: column; gap: 4px; }
</style>
