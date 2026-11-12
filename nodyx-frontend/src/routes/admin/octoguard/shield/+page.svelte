<script lang="ts">
	// Le bouclier anti-raid (lot 6, maquette validée, D21). Nodyx est parfois
	// administré par des enfants : le premier niveau est simple (un état, un
	// bouton, ce qui change), le détail technique se déplie pour les curieux.
	import { onMount, onDestroy, untrack } from 'svelte'
	import { page } from '$app/state'
	import { t, locale } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og, OgError } from '$lib/octoguard/api'
	import { getSocket } from '$lib/socket'
	import type { PageData } from './$types'

	type Trigger = { kind: 'accounts' | 'held'; count: number; window_minutes: number }
	type ShieldState = { until: string; raised_at: string; raised_by: string | null; raised_by_username: string | null; reason: 'manual' | 'auto'; trigger: Trigger | null }
	type Settings = { alert_accounts: number; alert_held: number; auto: boolean }

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const init = untrack(() => (data.shield ?? {}) as Record<string, any>)

	let shieldNow = $state<ShieldState | null>(init.state ?? null)
	const DURATIONS: number[] = init.durations ?? [15, 30, 60, 120]
	let minutes = $state<number>(init.default_minutes ?? 30)
	const ogOn: boolean = !!init.octoguard_enabled
	const canConfigure: boolean = !!init.can_configure
	const activity = init.activity ?? { signups_hour: 0, signups_usual_max: 0, held_hour: 0 }
	const slowS: number = init.slow_seconds ?? 10
	let settings = $state<Settings>({ ...(init.settings ?? { alert_accounts: 10, alert_held: 20, auto: false }) })
	let busy = $state(false)
	let msg = $state<{ ok: boolean; text: string } | null>(null)
	let setMsg = $state<{ ok: boolean; text: string } | null>(null)

	// Le compte à rebours, à la seconde ; le bouclier retombe tout seul à zéro
	let now = $state(Date.now())
	let tick: ReturnType<typeof setInterval> | null = null
	const left = $derived(shieldNow ? Math.max(0, Date.parse(shieldNow.until) - now) : 0)
	const active = $derived(!!shieldNow && left > 0)
	const mmss = $derived(`${Math.floor(left / 60_000)}:${String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}`)
	const clock = (iso: string) => new Date(iso).toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' })

	// Un autre membre de l'équipe lève ou baisse le bouclier : l'écran suit
	function onShield(p: { active: boolean; until: string | null }) {
		if (!p.active) { shieldNow = null; return }
		void refresh()
	}
	async function refresh() {
		try { const r = await og<{ state: ShieldState | null }>(token, '/shield'); shieldNow = r.state } catch { /* l'écran garde ce qu'il sait */ }
	}
	onMount(() => {
		tick = setInterval(() => { now = Date.now() }, 1000)
		getSocket()?.on('octoguard:shield', onShield)
	})
	onDestroy(() => { if (tick) clearInterval(tick); getSocket()?.off('octoguard:shield', onShield) })

	async function raise() {
		busy = true; msg = null
		try {
			const r = await og<{ state: ShieldState }>(token, '/shield/raise', 'POST', { minutes })
			shieldNow = r.state; now = Date.now()
			msg = { ok: true, text: tFn('og2.sh_raised_ok', { n: minutes }) }
		} catch { msg = { ok: false, text: tFn('og2.err_save') } } finally { busy = false }
	}
	async function lower() {
		if (!confirm(tFn('og2.sh_lower_confirm'))) return
		busy = true; msg = null
		try { await og(token, '/shield/lower', 'POST'); shieldNow = null; msg = { ok: true, text: tFn('og2.sh_lowered_ok') } }
		catch { msg = { ok: false, text: tFn('og2.err_save') } } finally { busy = false }
	}
	async function saveSettings() {
		busy = true; setMsg = null
		try {
			const r = await og<{ settings: Settings }>(token, '/shield/settings', 'PUT', { alert_accounts: Number(settings.alert_accounts), alert_held: Number(settings.alert_held), auto: settings.auto })
			settings = { ...r.settings }; setMsg = { ok: true, text: tFn('og2.sh_saved') }
		} catch (e) {
			setMsg = { ok: false, text: tFn(e instanceof OgError && e.status === 400 ? 'og2.sh_err_range' : 'og2.err_save') }
		} finally { busy = false }
	}

	const usual = $derived(activity.signups_usual_max > 0 ? tFn('og2.sh_usual', { n: activity.signups_usual_max }) : tFn('og2.sh_usual_none'))
	const whoRaised = $derived(!shieldNow ? '' : shieldNow.reason === 'auto'
		? tFn(shieldNow.trigger?.kind === 'held' ? 'og2.sh_by_auto_held' : 'og2.sh_by_auto_accounts', { n: shieldNow.trigger?.count ?? 0, m: shieldNow.trigger?.window_minutes ?? 10, at: clock(shieldNow.raised_at) })
		: tFn('og2.sh_by', { name: shieldNow.raised_by_username ?? tFn('og2.sh_someone'), at: clock(shieldNow.raised_at) }))

	const SHIELD = 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z'
	const ROWS = [
		{ k: 'new', tone: 'og-k-warn', d: 'M12 11a4 4 0 100-8 4 4 0 000 8z M4 21a8 8 0 0116 0 M19 3v4 M17 5h4' },
		{ k: 'links', tone: 'og-k-warn', d: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1' },
		{ k: 'slow', tone: 'og-k-acc', d: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2' },
		{ k: 'team', tone: 'og-k-team', d: 'M9 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M2.5 20a6.5 6.5 0 0113 0 M16 4.6a3.5 3.5 0 010 6.8 M21.5 20a6.5 6.5 0 00-4-6' },
	] as const
</script>

<svelte:head><title>{tFn('og2.sh_title')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d={SHIELD} /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.sh_title')}</h1>
				<p class="adm-desc">{tFn('og2.sh_desc')}</p>
			</div>
		</div>
	</header>

	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}

	<div class="og-grid2">
		<!-- L'état, et LE bouton -->
		<section class="adm-card sh-state" class:sh-on={active} aria-live="polite">
			<svg class="sh-art" viewBox="0 0 110 120" aria-hidden="true">
				<path d="M55 6l44 16v33c0 28-19 49-44 58C30 104 11 83 11 55V22z" class="sh-art-body" />
				{#if active}
					<path d="M40 56h30 M40 56v-8a15 15 0 0130 0v8 M36 56h38v26H36z" class="sh-art-mark" />
				{:else}
					<path d="M36 58l13 13 26-27" class="sh-art-mark" />
				{/if}
			</svg>
			<div class="sh-body">
				{#if active && shieldNow}
					<h2 class="sh-h">{tFn('og2.sh_on')} <span class="sh-clock" title={tFn('og2.sh_left_tip')}>{mmss}</span></h2>
					<p class="og-help sh-sub">{whoRaised} {tFn('og2.sh_until', { at: clock(shieldNow.until) })}</p>
					<button type="button" class="adm-btn" disabled={busy} onclick={lower}>
						<Icon d="M7 11V7a5 5 0 019.9-1 M5 11h14v10H5z" />{tFn('og2.sh_lower')}
					</button>
				{:else}
					<h2 class="sh-h">{tFn('og2.sh_calm')}</h2>
					<p class="og-help sh-sub">{tFn('og2.sh_calm_sub', { n: activity.signups_hour })} {usual}</p>
					<div class="sh-go">
						<button type="button" class="adm-btn adm-btn--danger sh-panic" disabled={busy || data.failed} onclick={raise}>
							<Icon d="M7 11V7a5 5 0 0110 0v4 M5 11h14v10H5z" />{tFn('og2.sh_raise', { n: minutes })}
						</button>
						<label class="sh-dur">
							<span>{tFn('og2.sh_for')}</span>
							<select class="adm-input" bind:value={minutes} aria-label={tFn('og2.sh_duration')}>
								{#each DURATIONS as d (d)}<option value={d}>{tFn(d < 60 ? 'og2.sh_min' : 'og2.sh_hour', { n: d < 60 ? d : d / 60 })}</option>{/each}
							</select>
						</label>
					</div>
					<p class="og-help">{tFn('og2.sh_self_lower')}</p>
				{/if}
				{#if msg}<p class={msg.ok ? 'og-okmsg' : 'og-error'} role="status">{msg.text}</p>{/if}
			</div>
		</section>

		<!-- Ce qui change, en quatre lignes -->
		<section class="adm-card">
			<h2 class="sh-h2">{tFn('og2.sh_what')}</h2>
			<div class="og-rows">
				{#each ROWS as r (r.k)}
					<div class="og-row">
						<span class="og-ic {r.tone}"><Icon d={r.d} /></span>
						<div class="og-row-body"><b>{tFn(`og2.sh_r_${r.k}`)}</b><div class="og-meta">{tFn(`og2.sh_r_${r.k}_sub`, { s: slowS })}</div></div>
					</div>
				{/each}
			</div>
		</section>
	</div>

	<!-- Quand te prévenir : l'alerte automatique -->
	<section class="adm-card sh-alert">
		<div class="sh-alert-head">
			<h2 class="sh-h2">{tFn('og2.sh_alert')}</h2>
			<span class="og-help">{tFn(settings.auto ? 'og2.sh_alert_auto_on' : 'og2.sh_alert_sub')}</span>
		</div>
		{#if !ogOn}
			<div class="og-note"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" /><span>{tFn('og2.sh_needs_og')} <a href="/admin/octoguard">{tFn('og2.sh_needs_og_link')}</a></span></div>
		{/if}
		<div class="sh-fields">
			<label class="sh-num"><input class="adm-input" type="number" min="2" max="1000" bind:value={settings.alert_accounts} disabled={!canConfigure} /><span>{tFn('og2.sh_f_accounts')}</span></label>
			<label class="sh-num"><input class="adm-input" type="number" min="2" max="1000" bind:value={settings.alert_held} disabled={!canConfigure} /><span>{tFn('og2.sh_f_held')}</span></label>
			<label class="og-switch"><input type="checkbox" bind:checked={settings.auto} disabled={!canConfigure} /><span class="og-track"></span>{tFn('og2.sh_f_auto')}</label>
			{#if canConfigure}<button type="button" class="adm-btn adm-btn--primary adm-btn--sm" disabled={busy} onclick={saveSettings}>{tFn('og2.save')}</button>{/if}
		</div>
		<p class="og-help">{tFn('og2.sh_f_auto_help')}</p>
		{#if !canConfigure}<p class="og-help">{tFn('og2.sh_readonly')}</p>{/if}
		{#if setMsg}<p class={setMsg.ok ? 'og-okmsg' : 'og-error'} role="status">{setMsg.text}</p>{/if}
	</section>

	<!-- Pour les curieux : le détail, sans rien cacher -->
	<details class="adm-card sh-more">
		<summary>{tFn('og2.sh_more')}</summary>
		<ul class="sh-tech">
			{#each ['age', 'team', 'links', 'dm', 'slow', 'clock', 'og', 'alert', 'trace', 'fail'] as k (k)}
				<li><b>{tFn(`og2.sh_t_${k}`)}</b> {tFn(`og2.sh_t_${k}_sub`, { s: slowS })}</li>
			{/each}
		</ul>
	</details>
</div>

<style>
	.sh-state { display: grid; grid-template-columns: auto 1fr; gap: 1.25rem; align-items: center; }
	.sh-art { width: 6rem; height: auto; flex: none; }
	.sh-art-body { fill: color-mix(in srgb, var(--nx-ok) 14%, var(--nx-surface)); stroke: var(--nx-ok); stroke-width: 2.5; stroke-linejoin: round; transition: fill .3s, stroke .3s; }
	.sh-art-mark { fill: none; stroke: var(--nx-ok); stroke-width: 6; stroke-linecap: round; stroke-linejoin: round; }
	.sh-on .sh-art-body { fill: color-mix(in srgb, var(--nx-header-accent) 18%, var(--nx-surface)); stroke: var(--nx-header-accent); }
	.sh-on .sh-art-mark { stroke: var(--nx-header-accent); stroke-width: 5; }
	.sh-on { border-color: color-mix(in srgb, var(--nx-header-accent) 55%, var(--nx-border)); }
	.sh-body { display: flex; flex-direction: column; gap: 0.5rem; align-items: flex-start; min-width: 0; }
	.sh-h { margin: 0; font-size: 1.15rem; font-weight: 650; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.5rem; }
	.sh-clock { font-variant-numeric: tabular-nums; color: var(--nx-header-accent); font-size: 1.05rem; }
	.sh-sub { font-size: 0.82rem; margin-bottom: 0.25rem; }
	.sh-go { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; }
	.sh-panic { font-weight: 650; }
	.sh-dur { display: inline-flex; align-items: center; gap: 0.375rem; font-size: 0.78rem; color: var(--nx-text-muted); }
	.sh-dur select { width: auto; min-height: 2rem; padding-block: 0; }
	.sh-h2 { margin: 0 0 0.75rem; font-size: 0.95rem; font-weight: 650; }
	.sh-alert { display: flex; flex-direction: column; gap: 0.75rem; }
	.sh-alert-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0.25rem 1rem; }
	.sh-alert-head .sh-h2 { margin: 0; }
	.sh-alert .og-note a { color: var(--nx-header-accent); font-weight: 600; }
	.sh-fields { display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem 1.5rem; }
	.sh-num { display: inline-flex; align-items: center; gap: 0.5rem; font-size: 0.82rem; }
	.sh-num input { width: 4.5rem; font-variant-numeric: tabular-nums; }
	.sh-more summary { cursor: pointer; font-size: 0.875rem; font-weight: 600; }
	.sh-tech { margin: 0.875rem 0 0; padding-left: 1.125rem; display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.8rem; line-height: 1.5; color: var(--nx-text-muted); }
	.sh-tech b { color: var(--nx-text); font-weight: 600; }
	@media (max-width: 520px) { .sh-state { grid-template-columns: 1fr; justify-items: start; } .sh-art { width: 4.5rem; } }
</style>
