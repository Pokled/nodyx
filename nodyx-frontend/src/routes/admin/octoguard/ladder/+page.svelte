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
	// Monter ou descendre une marche d'un cran dans la liste fermée
	const floor = (i: number) => (i > 0 ? SANCTIONS.indexOf(steps[i - 1]) : 0)
	const canSofter = (i: number) => canEdit && SANCTIONS.indexOf(steps[i]) > floor(i)
	const canFirmer = (i: number) => canEdit && SANCTIONS.indexOf(steps[i]) < SANCTIONS.length - 1
	const nudge = (i: number, d: 1 | -1) => setStep(i, SANCTIONS[SANCTIONS.indexOf(steps[i]) + d])

	// Les marches de la maquette : titre selon la place, couleur selon la fermeté
	const TITLES = ['og2.lad_t1', 'og2.lad_t2', 'og2.lad_t3']
	const title = (i: number) => (i < 3 ? TITLES[i] : kindOf(steps[3]) === 'ban' ? 'og2.lad_t4_ban' : 'og2.lad_t4')
	const tone = (i: number) => (i < 2 ? 'og-k-warn' : 'og-k-delete')
	// L'icône suit la sanction choisie : on voit tout de suite ce que fait chaque marche
	const KIND_ICON = {
		warn: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
		mute: 'M11 5L6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6',
		ban: 'M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4 M10 17l5-5-5-5 M15 12H3',
	} as const
	const ADMIN_ICON = 'M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6z M12 11a2 2 0 100-4 2 2 0 000 4z M8.5 16a3.5 3.5 0 017 0'

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

	<div class="lad-wrap">
		<div class="lad-steps">
			{#each steps as s, i (i)}
				<div class="lad-st {tone(i)}">
					<div class="lad-stair"><div class="lad-bar" style="height:{40 + i * 15}%"><span class="lad-ico"><Icon d={KIND_ICON[kindOf(s)]} /></span></div></div>
					<span class="lad-n">{tFn('og2.lad_step_n', { n: i + 1 })}</span>
					<b>{tFn(title(i))}</b>
					<div class="lad-pick" role="group" aria-label={tFn('og2.lad_step_n', { n: i + 1 })}>
						<span class="lad-val" aria-live="polite">{tFn(optionKey(s))}</span>
						<div class="lad-btns">
							<button type="button" class="lad-nudge" disabled={!canSofter(i)} aria-label={tFn('og2.lad_softer_n', { n: i + 1 })} title={tFn('og2.lad_softer')} onclick={() => nudge(i, -1)}>−</button>
							<button type="button" class="lad-nudge" disabled={!canFirmer(i)} aria-label={tFn('og2.lad_firmer_n', { n: i + 1 })} title={tFn('og2.lad_firmer')} onclick={() => nudge(i, 1)}>+</button>
						</div>
					</div>
				</div>
			{/each}
			<div class="lad-st og-k-observe">
				<div class="lad-stair"><div class="lad-bar" style="height:100%"><span class="lad-ico"><Icon d={ADMIN_ICON} /></span></div></div>
				<span class="lad-n">{tFn('og2.lad_beyond_n')}</span>
				<b>{tFn('og2.lad_t5')}</b>
				<span class="og-help">{tFn('og2.lad_never_auto')}</span>
			</div>
		</div>
		<div class="lad-scale" aria-hidden="true"><span>{tFn('og2.lad_softer')}</span><i></i><span>{tFn('og2.lad_firmer')}</span></div>
		<p class="og-help lad-rule">{tFn('og2.lad_rule')}</p>
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
				{#if !canDv}<p class="og-help" style="color:var(--nx-warn)">{tFn(dv ? 'og2.lad_dv_stuck' : 'og2.lad_dv_needs_two')}</p>{/if}
			</div>
		</section>
	</div>
</div>

<style>
	.lad-wrap { container-type: inline-size; display: flex; flex-direction: column; gap: 8px; }
	/* Un escalier sur UNE ligne : les marches montent de gauche à droite */
	.lad-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; align-items: stretch; }
	/* La forme de l'escalier ne dépend pas des textes : une zone de hauteur fixe, le bloc y monte depuis le bas */
	.lad-stair { height: 96px; display: flex; flex-direction: column; justify-content: flex-end; }
	.lad-st { border: 1px solid var(--nx-border); border-radius: 12px; background: var(--nx-surface); padding: 10px; display: flex; flex-direction: column; gap: 5px; min-width: 0; }
	.lad-n { font-size: 11px; font-weight: 650; letter-spacing: .02em; color: var(--nx-text-faint, var(--nx-text-muted)); }
	.lad-st b { font-size: 13px; line-height: 1.25; }
	.lad-bar { position: relative; border-radius: 8px; background: color-mix(in srgb, var(--k) 16%, transparent); border-top: 3px solid var(--k); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 8px; transition: height .25s ease; }
	.lad-ico { width: 26px; height: 26px; border-radius: 99px; display: grid; place-items: center; color: var(--k); background: color-mix(in srgb, var(--k) 18%, var(--nx-surface)); }
	.lad-ico :global(svg) { width: 15px; height: 15px; }
	/* Le nom de la sanction en entier (jamais coupé), entre « plus doux » et « plus ferme » */
	.lad-pick { margin-top: auto; display: flex; flex-direction: column; align-items: stretch; gap: 5px; border: 1px solid var(--nx-border); border-radius: 9px; padding: 3px; background: color-mix(in srgb, var(--nx-text) 3%, transparent); }
	.lad-val { display: block; padding: 3px 2px 0; text-align: center; font-size: 0.8125rem; font-weight: 600; line-height: 1.2; overflow-wrap: normal; hyphens: none; min-width: 0; }
	.lad-btns { display: flex; justify-content: space-between; gap: 4px; }
	.lad-nudge { flex: 1; min-width: 0; height: 26px; border-radius: 7px; border: 0; background: color-mix(in srgb, var(--k) 16%, transparent); color: var(--nx-text); font-size: 16px; font-weight: 700; line-height: 1; cursor: pointer; transition: background-color .15s; }
	.lad-nudge:hover:not(:disabled) { background: color-mix(in srgb, var(--k) 32%, transparent); }
	.lad-nudge:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 1px; }
	.lad-nudge:disabled { opacity: .3; cursor: not-allowed; }
	.lad-scale { display: flex; align-items: center; gap: 10px; font-size: 11px; font-weight: 600; color: var(--nx-text-muted); }
	.lad-scale i { flex: 1; height: 4px; border-radius: 99px; background: linear-gradient(90deg, var(--og-warn), var(--og-delete), var(--og-observe)); }
	.lad-rule { margin: 0; }
	@media (prefers-reduced-motion: reduce) { .lad-bar { transition: none; } }
	/* Seulement sur un écran de téléphone : les marches s'empilent */
	@container (max-width: 560px) {
		.lad-steps { grid-template-columns: 1fr; }
		.lad-stair { height: 44px; }
		.lad-bar { height: 100% !important; }
	}
	.lad-card { display: flex; gap: 14px; }
	.lad-inline { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 0.8125rem; }
	.lad-sel { width: auto; }
</style>
