<script lang="ts">
	/**
	 * Écran Apparence : l'entrée « globale » (SPECS/NODYX_APPARENCE_CDC.md).
	 *
	 * On règle un BROUILLON (ambiance + identité), partagé avec l'édition au
	 * stylo : rien ne change pour les membres avant « Publier ». Pendant
	 * l'édition, le vrai contenant autour de cet écran (header, rail, décor,
	 * logo) montre déjà le brouillon, via shellPreview / identityPreview, pour
	 * l'admin seul. Les réductions clair et sombre montrent les deux modes
	 * sans toucher à sa propre préférence.
	 */
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/state'
	import { t } from '$lib/i18n'
	import type { ShellTheme } from '$lib/shellTheme'
	import { encodeAmbiance, decodeAmbiance } from '$lib/ambianceTools'
	import { appearance, setAppearanceToken } from '$lib/appearanceEngine'
	import type { Ident } from '$lib/appearanceDraft'
	import AmbianceControls from '$lib/components/appearance/AmbianceControls.svelte'
	import IdentityControls from '$lib/components/appearance/IdentityControls.svelte'
	import ShellMiniPreview from '$lib/components/appearance/ShellMiniPreview.svelte'
	import PublishBar from '$lib/components/appearance/PublishBar.svelte'

	const tFn = $derived($t)
	const token = $derived((page.data as any).token as string | null)

	// Tout l'état vient du moteur partagé (lib/appearanceDraft.ts) : l'écran
	// et le stylo en direct travaillent sur le MÊME brouillon.
	const value = $derived($appearance.hist.present.ambiance)
	const identity = $derived($appearance.hist.present.identity)
	const identityPublished = $derived($appearance.identityPublished)
	const status = $derived($appearance.status)
	let tab = $state<'ambiance' | 'identity' | 'home'>('ambiance')

	// Bannière effective de l'aperçu : celle du brouillon d'identité si elle change.
	const banner = $derived(identity?.banner_url !== undefined ? identity.banner_url ?? null : identityPublished?.banner_url ?? null)

	onMount(() => {
		setAppearanceToken(token)
		appearance.load(true)
	})
	// Quitter l'écran rend au site son apparence publiée (le brouillon reste
	// enregistré côté serveur, on le retrouvera en revenant).
	onDestroy(() => appearance.hidePreview())

	const onAmbiance = (v: ShellTheme, opts?: { continuous?: boolean }) => appearance.setAmbiance(v, opts)
	const onIdentity = (next: Ident | null) => appearance.setIdentity(next)

	// ── Code d'ambiance à partager ─────────────────────────────────────────
	let shareCode = $derived(encodeAmbiance(value))
	let copied = $state(false)
	let importCode = $state('')
	let importError = $state(false)
	async function copyCode() {
		try { await navigator.clipboard.writeText(shareCode); copied = true; setTimeout(() => copied = false, 1800) } catch { /* sélection manuelle possible */ }
	}
	function importAmbiance() {
		const t = decodeAmbiance(importCode)
		importError = !t
		if (t) { onAmbiance(t); importCode = '' }
	}

	const tabs = $derived([
		{ id: 'ambiance' as const, label: tFn('appr.tab_ambiance'), desc: tFn('appr.tab_ambiance_desc') },
		{ id: 'identity' as const, label: tFn('appr.tab_identity'), desc: tFn('appr.tab_identity_desc') },
		{ id: 'home'     as const, label: tFn('appr.tab_home'),     desc: tFn('appr.tab_home_desc') },
	])
	const identityChanged = $derived(!!identity)
</script>

<svelte:head><title>{tFn('appr.page_title')}</title></svelte:head>

<div class="space-y-6 pb-28">
	<div>
		<h1 class="text-2xl font-bold text-white">{tFn('appr.title')}</h1>
		<p class="text-sm text-gray-500 mt-0.5">{tFn('appr.subtitle')}</p>
	</div>

	<!-- Onglets : au survol ou au focus, une ligne dit ce que chacun contient. -->
	<div class="appr-tabs" role="tablist" aria-label={tFn('appr.title')}>
		{#each tabs as tb (tb.id)}
			<button type="button" role="tab" aria-selected={tab === tb.id} class:on={tab === tb.id} aria-describedby="appr-tab-desc-{tb.id}" onclick={() => tab = tb.id}>
				{tb.label}
				{#if tb.id === 'identity' && identityChanged}<span class="appr-tab-dot" aria-hidden="true"></span>{/if}
				<span class="appr-tip" id="appr-tab-desc-{tb.id}" role="tooltip">{tb.desc}</span>
			</button>
		{/each}
	</div>

	{#if tab === 'ambiance'}
		<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
			<div class="space-y-6">
				<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
					{#if status === 'loading'}
						<p class="text-sm text-gray-500">{tFn('appr.status_loading')}</p>
					{:else}
						<AmbianceControls {value} {banner} {token} onchange={onAmbiance} />
					{/if}
				</div>
				<!-- Partager une ambiance entre instances Nodyx (fédération oblige). -->
				<details class="appr-share rounded-xl border border-gray-800 bg-gray-900/40">
					<summary>{tFn('appr.share_title')}</summary>
					<div class="p-5 pt-0 space-y-4">
						<p class="text-sm text-gray-400">{tFn('appr.share_help')}</p>
						<div class="flex gap-2">
							<input class="appr-code" readonly value={shareCode} aria-label={tFn('appr.share_code')} onfocus={(e) => (e.currentTarget as HTMLInputElement).select()} />
							<button type="button" class="appr-btn" onclick={copyCode}>{copied ? tFn('appr.share_copied') : tFn('appr.share_copy')}</button>
						</div>
						<div class="flex gap-2">
							<input class="appr-code" bind:value={importCode} placeholder={tFn('appr.share_paste_ph')} aria-label={tFn('appr.share_paste')}
							       onkeydown={(e) => e.key === 'Enter' && importAmbiance()} />
							<button type="button" class="appr-btn" disabled={!importCode.trim()} onclick={importAmbiance}>{tFn('appr.share_apply')}</button>
						</div>
						{#if importError}<p class="text-xs text-red-400">{tFn('appr.share_invalid')}</p>{/if}
					</div>
				</details>
			</div>
			<div class="space-y-3">
				<ShellMiniPreview theme={value} dark={true}  {banner} label={tFn('appr.preview_dark')} />
				<ShellMiniPreview theme={value} dark={false} {banner} label={tFn('appr.preview_light')} />
				<p class="text-xs text-gray-500">{tFn('appr.preview_live_hint')}</p>
			</div>
		</div>
	{:else if tab === 'identity'}
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
			<p class="text-sm text-gray-400 mb-5">{tFn('appr.identity_intro')}</p>
			<IdentityControls published={identityPublished} draft={identity} {token} onchange={onIdentity} />
		</div>
	{:else}
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-4">
			<p class="text-sm text-gray-400">{tFn('appr.home_help')}</p>
			<a href="/admin/homepage/builder" class="appr-link">{tFn('appr.home_open')}</a>
		</div>
	{/if}
</div>

<!-- Barre de publication partagée avec le stylo en direct. -->
<PublishBar />

<style>
	.appr-tabs { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: #111827; border: 1px solid #1f2937; }
	.appr-tabs button {
		position: relative; padding: 7px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; color: #9ca3af;
		background: transparent; border: none; cursor: pointer; transition: background-color .15s, color .15s;
	}
	.appr-tabs button:hover { color: #f3f4f6; }
	.appr-tabs button.on { background: #374151; color: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .4); }
	.appr-tab-dot { display: inline-block; width: 6px; height: 6px; border-radius: 999px; margin-left: 6px; vertical-align: middle; background: var(--nx-header-accent); }
	/* Info-bulle maison : apparaît sous l'onglet au survol ET au focus clavier.
	   Alignée sur le BORD GAUCHE de l'onglet, jamais centrée : centrée, celle du
	   premier onglet débordait à gauche et passait sous la sidebar de l'admin
	   (signalé par Jonathan le 29/09). Monter le z-index n'y changeait rien,
	   c'est le conteneur de l'admin qui la coupait. */
	.appr-tip {
		position: absolute; top: calc(100% + 8px); left: 0; transform: translateY(-4px); z-index: 30;
		width: max-content; max-width: 280px; padding: 8px 11px; border-radius: 9px; text-align: left; white-space: normal;
		font-size: 12px; font-weight: 400; line-height: 1.4; color: #e5e7eb;
		background: #0b0f17; box-shadow: 0 0 0 1px #374151, 0 10px 24px -8px rgb(0 0 0 / .8);
		opacity: 0; pointer-events: none; transition: opacity .15s, transform .25s var(--ease-out-soft);
	}
	.appr-tabs button:hover .appr-tip, .appr-tabs button:focus-visible .appr-tip { opacity: 1; transform: none; transition-delay: .25s; }

	.appr-link, .appr-btn {
		display: inline-flex; align-items: center; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
		background: #1f2937; border: 1px solid #374151; color: #e5e7eb; text-decoration: none; cursor: pointer; white-space: nowrap;
	}
	.appr-link:hover, .appr-btn:hover:not(:disabled) { border-color: #4b5563; color: #fff; }
	.appr-btn:disabled { opacity: .4; cursor: default; }
	.appr-code {
		flex: 1; min-width: 0; padding: 8px 10px; border-radius: 8px; font: 12px ui-monospace, monospace;
		background: #111827; border: 1px solid #374151; color: #e5e7eb;
	}
	.appr-code:focus { outline: none; border-color: var(--nx-header-accent); }
	.appr-share summary { padding: 16px 20px; font-size: 14px; font-weight: 600; color: #f3f4f6; cursor: pointer; list-style: none; }
	.appr-share summary::-webkit-details-marker { display: none; }
	.appr-share summary::after { content: '+'; float: right; color: #6b7280; }
	.appr-share[open] summary::after { content: '−'; }

</style>
