<script lang="ts">
	// Barème des sanctions (maquette validée, CDC §E4i). Simple et intransigeant :
	// 4 étapes choisies dans une liste fermée, l'oubli, la double validation. Rien d'autre.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og, OgError } from '$lib/octoguard/api'
	import { SANCTIONS, optionKey, kindOf, LADDER_ERR, type Sanction, type LadderSettings } from '$lib/octoguard/ladder'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const access = $derived((page.data as any).access as { permissions: string[] } | undefined)
	const canEdit = $derived(!!access?.permissions.includes('manage_octoguard'))

	const init = untrack(() => (data.ladder?.settings ?? { steps: ['warn', 'mute_1h', 'mute_24h', 'ban_7d'], forget_days: 30, double_validation: false }) as LadderSettings)
	let steps = $state<Sanction[]>([...init.steps])
	let forget = $state(init.forget_days)
	let dv = $state(init.double_validation)
	const canDv = $derived(!!data.ladder?.can_double_validate)
	let busy = $state(false)
	let status = $state<{ ok: boolean; text: string } | null>(null)

	// Une étape ne peut pas être plus douce que la précédente : si on durcit l'étape 2,
	// les suivantes remontent avec elle (jamais l'inverse en silence)
	function setStep(i: number, s: Sanction) {
		const next = [...steps]
		next[i] = s
		for (let j = i + 1; j < next.length; j++) {
			if (SANCTIONS.indexOf(next[j]) < SANCTIONS.indexOf(s)) next[j] = s
		}
		steps = next
	}
	const milder = (i: number, s: Sanction) => i > 0 && SANCTIONS.indexOf(s) < SANCTIONS.indexOf(steps[i - 1])

	// Les marches de la maquette : titre selon la place, couleur selon la fermeté
	const TITLES = ['og2.lad_t1', 'og2.lad_t2', 'og2.lad_t3']
	const title = (i: number) => (i < 3 ? TITLES[i] : kindOf(steps[3]) === 'ban' ? 'og2.lad_t4_ban' : 'og2.lad_t4')
	const tone = (i: number) => (i < 2 ? 'og-k-warn' : 'og-k-delete')

	async function save() {
		busy = true; status = null
		try {
			const r = await og<{ settings: LadderSettings }>(token, '/ladder/settings', 'PUT', { steps, forget_days: forget, double_validation: dv })
			steps = [...r.settings.steps]; forget = r.settings.forget_days; dv = r.settings.double_validation
			status = { ok: true, text: tFn('og2.lad_saved') }
		} catch (e) {
			status = { ok: false, text: tFn((e instanceof OgError && e.code && LADDER_ERR[e.code]) || 'og2.err_save') }
		} finally { busy = false }
	}
	const SCALE = 'M12 3v18 M5 21h14 M6 7h12 M6 7l-3 7a3 3 0 006 0z M18 7l-3 7a3 3 0 006 0z'
</script>

<svelte:head><title>{tFn('og2.lad_title')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d={SCALE} /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.lad_title')}</h1>
				<p class="adm-desc">{tFn('og2.lad_desc')}</p>
			</div>
		</div>
		{#if canEdit}<button type="button" class="adm-btn adm-btn--primary" disabled={busy || data.failed} onclick={save}>{tFn('og2.save')}</button>{/if}
	</header>

	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}
	{#if status}<p class={status.ok ? 'og-okmsg' : 'og-error'} role="status">{status.text}</p>{/if}
	{#if !canEdit}<div class="og-note"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" />{tFn('og2.lad_readonly')}</div>{/if}

	<div class="lad-steps">
		{#each steps as s, i (i)}
			<div class="lad-st {tone(i)}">
				<div class="lad-bar" style="height:{(i + 1) * 20}px"></div>
				<span class="lad-n">{tFn('og2.lad_step_n', { n: i + 1 })}</span>
				<b>{tFn(title(i))}</b>
				<select class="adm-input" aria-label={tFn('og2.lad_step_n', { n: i + 1 })} disabled={!canEdit} value={s}
					onchange={(e) => setStep(i, (e.currentTarget as HTMLSelectElement).value as Sanction)}>
					{#each SANCTIONS as o (o)}<option value={o} disabled={milder(i, o)}>{tFn(optionKey(o))}</option>{/each}
				</select>
			</div>
		{/each}
		<div class="lad-st og-k-observe">
			<div class="lad-bar" style="height:100px"></div>
			<span class="lad-n">{tFn('og2.lad_beyond_n')}</span>
			<b>{tFn('og2.lad_t5')}</b>
			<span class="og-help">{tFn('og2.lad_never_auto')}</span>
		</div>
	</div>

	<div class="og-grid2">
		<section class="adm-card lad-card">
			<span class="og-ic og-k-ok"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2" /></span>
			<div class="og-field" style="flex:1">
				<span class="og-lbl">{tFn('og2.lad_forget')}</span>
				<p class="og-help">{tFn('og2.lad_forget_help')}</p>
				<div class="lad-inline">
					<span>{tFn('og2.lad_forget_pre')}</span>
					<select class="adm-input lad-sel" aria-label={tFn('og2.lad_forget')} disabled={!canEdit} bind:value={forget}>
						{#each [30, 60, 90] as d (d)}<option value={d}>{tFn('og2.lad_days', { n: d })}</option>{/each}
					</select>
					<span>{tFn('og2.lad_forget_post')}</span>
				</div>
			</div>
		</section>
		<section class="adm-card lad-card">
			<span class="og-ic og-k-report"><Icon d="M9 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M2.5 20a6.5 6.5 0 0113 0 M16 4.6a3.5 3.5 0 010 6.8 M21.5 20a6.5 6.5 0 00-4-6" /></span>
			<div class="og-field" style="flex:1">
				<span class="og-lbl">{tFn('og2.lad_dv')}</span>
				<p class="og-help">{tFn('og2.lad_dv_help')}</p>
				<label class="og-switch"><input type="checkbox" bind:checked={dv} disabled={!canEdit || (!canDv && !dv)} /><span class="og-track"></span>{tFn(dv ? 'og2.lad_on' : 'og2.lad_off')}</label>
				{#if !canDv}<p class="og-help" style="color:var(--nx-warn)">{tFn('og2.lad_dv_needs_two')}</p>{/if}
			</div>
		</section>
	</div>
</div>

<style>
	.lad-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; align-items: end; }
	.lad-st { border: 1px solid var(--nx-border); border-radius: 10px; background: var(--nx-surface); padding: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
	.lad-n { font-size: 11px; font-weight: 650; color: var(--nx-text-faint, var(--nx-text-muted)); }
	.lad-st b { font-size: 13px; }
	.lad-bar { border-radius: 6px; background: color-mix(in srgb, var(--k) 14%, transparent); border-top: 3px solid var(--k); }
	.lad-card { display: flex; gap: 14px; }
	.lad-inline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.8125rem; }
	.lad-sel { width: auto; }
	@media (max-width: 760px) { .lad-steps { grid-template-columns: 1fr; } }
</style>
