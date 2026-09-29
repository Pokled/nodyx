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
	import { invalidateAll } from '$app/navigation'
	import { t } from '$lib/i18n'
	import { DEFAULT_SHELL_THEME, type ShellTheme } from '$lib/shellTheme'
	import { shellPreview, identityPreview } from '$lib/shellPreview'
	import { historyStart, historyPush, historyUndo, historyRedo, encodeAmbiance, decodeAmbiance, type History } from '$lib/ambianceTools'
	import AmbianceControls from '$lib/components/appearance/AmbianceControls.svelte'
	import IdentityControls from '$lib/components/appearance/IdentityControls.svelte'
	import ShellMiniPreview from '$lib/components/appearance/ShellMiniPreview.svelte'

	type Ident = { logo_url?: string | null; banner_url?: string | null }
	type Snapshot = { ambiance: ShellTheme; identity: Ident | null }

	const tFn = $derived($t)
	const token = $derived((page.data as any).token as string | null)

	type Status = 'loading' | 'published' | 'saving' | 'draft' | 'publishing' | 'error'
	let status = $state<Status>('loading')
	let errorMsg = $state('')
	let published = $state<ShellTheme | null>(null)
	let identityPublished = $state<{ logo_url: string | null; banner_url: string | null } | null>(null)
	let hist = $state<History<Snapshot>>(historyStart({ ambiance: { ...DEFAULT_SHELL_THEME }, identity: null }))
	const value = $derived(hist.present.ambiance)
	const identity = $derived(hist.present.identity)
	// Y a-t-il un brouillon d'ambiance côté serveur ? (l'identité seule en brouillon ne suffit pas à en créer un)
	let hasAmbianceDraft = $state(false)
	let tab = $state<'ambiance' | 'identity' | 'home'>('ambiance')

	// Bannière effective de l'aperçu : celle du brouillon d'identité si elle change.
	const banner = $derived(identity?.banner_url !== undefined ? identity.banner_url ?? null : identityPublished?.banner_url ?? null)

	const api = (path: string, init: RequestInit = {}) => fetch(`/api/v1/admin/appearance${path}`, {
		...init,
		headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers ?? {}) },
	})

	onMount(async () => {
		try {
			const res = await api('/')
			if (!res.ok) throw new Error()
			const json = await res.json()
			published = json.published
			identityPublished = json.identity?.published ?? null
			hasAmbianceDraft = !!json.draft
			hist = historyStart({
				ambiance: { ...DEFAULT_SHELL_THEME, ...(json.draft ?? json.published ?? {}) },
				identity: json.identity?.draft ?? null,
			})
			status = json.draft || json.identity?.draft ? 'draft' : 'published'
			if (json.draft) shellPreview.set(hist.present.ambiance)
			if (json.identity?.draft) identityPreview.set(json.identity.draft)
		} catch {
			status = 'error'; errorMsg = tFn('appr.load_error')
		}
	})
	// Quitter l'écran rend au site son apparence publiée (le brouillon reste
	// enregistré côté serveur, on le retrouvera en revenant).
	onDestroy(() => { shellPreview.set(null); identityPreview.set(null) })

	// ── Enregistrement automatique (500 ms après le dernier geste) ─────────
	let timer: ReturnType<typeof setTimeout> | undefined
	let pending: Promise<void> | null = null
	let dirtyParts = { ambiance: false, identity: false }

	function apply(next: Snapshot, merge = false) {
		const before = hist.present
		hist = historyPush(hist, next, merge)
		if (hist.present === before) return
		if (JSON.stringify(before.ambiance) !== JSON.stringify(next.ambiance)) { dirtyParts.ambiance = true; shellPreview.set(next.ambiance) }
		if (JSON.stringify(before.identity) !== JSON.stringify(next.identity)) { dirtyParts.identity = true; identityPreview.set(next.identity) }
		schedule()
	}
	function schedule() {
		status = 'saving'
		clearTimeout(timer)
		timer = setTimeout(() => { pending = save() }, 500)
	}
	async function save() {
		const parts = dirtyParts
		dirtyParts = { ambiance: false, identity: false }
		try {
			if (parts.ambiance) {
				const res = await api('/draft', { method: 'PUT', body: JSON.stringify(hist.present.ambiance) })
				if (!res.ok) { const j = await res.json().catch(() => ({})); status = 'error'; errorMsg = j.error ?? tFn('appr.save_error'); return }
				hasAmbianceDraft = true
			}
			if (parts.identity) {
				const id = hist.present.identity
				// Identité revenue à la version publiée : on retire son seul brouillon.
				const res = id
					? await api('/draft/identity', { method: 'PUT', body: JSON.stringify(id) })
					: await api('/draft/identity', { method: 'DELETE' })
				if (!res.ok) { const j = await res.json().catch(() => ({})); status = 'error'; errorMsg = j.error ?? tFn('appr.save_error'); return }
			}
			status = 'draft'
		} catch {
			status = 'error'; errorMsg = tFn('appr.save_error')
		}
	}

	// Glisser le curseur d'intensité ou le sélecteur de couleur produit des
	// dizaines de valeurs : le contrôle le SIGNALE (continuous), et elles
	// comptent pour un seul pas d'Annuler. Un clic (preset, pastille) n'est
	// jamais fusionné : deviner le glissé au chronomètre fusionnait deux clics
	// rapides (bug attrapé par le scénario du 29/09).
	let lastContinuous = ''
	function onAmbiance(v: ShellTheme, opts: { continuous?: boolean } = {}) {
		const cur = hist.present.ambiance
		const field = v.intensity !== cur.intensity ? 'intensity' : v.accent !== cur.accent ? 'accent' : 'other'
		const merge = !!opts.continuous && field === lastContinuous
		lastContinuous = opts.continuous ? field : ''
		apply({ ...hist.present, ambiance: v }, merge)
	}
	function onIdentity(next: Ident | null) { apply({ ...hist.present, identity: next }) }

	function undo() { move(historyUndo(hist)) }
	function redo() { move(historyRedo(hist)) }
	function move(next: History<Snapshot>) {
		if (next === hist) return
		const before = hist.present
		hist = next
		if (JSON.stringify(before.ambiance) !== JSON.stringify(next.present.ambiance)) { dirtyParts.ambiance = true; shellPreview.set(next.present.ambiance) }
		if (JSON.stringify(before.identity) !== JSON.stringify(next.present.identity)) { dirtyParts.identity = true; identityPreview.set(next.present.identity) }
		schedule()
	}
	function onKey(e: KeyboardEvent) {
		// Pas quand on tape dans un champ : Ctrl+Z y garde son sens natif.
		const el = e.target as HTMLElement
		if (el.closest('input[type="text"], input:not([type]), textarea')) return
		if (!(e.ctrlKey || e.metaKey)) return
		const k = e.key.toLowerCase()
		if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
		else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo() }
	}

	async function flush() {
		clearTimeout(timer)
		if (dirtyParts.ambiance || dirtyParts.identity) pending = save()
		if (pending) await pending
	}

	async function publish() {
		await flush()
		if (status === 'error') return
		status = 'publishing'
		try {
			const res = await api('/publish', { method: 'POST' })
			const json = await res.json().catch(() => ({}))
			if (!res.ok) { status = 'error'; errorMsg = json.error ?? tFn('appr.publish_error'); return }
			if (json.published) published = json.published
			if (json.identity) identityPublished = { logo_url: identityPublished?.logo_url ?? null, banner_url: identityPublished?.banner_url ?? null, ...json.identity }
			hasAmbianceDraft = false
			// Le site recharge ses données : la version publiée prend le relais
			// de l'aperçu, pour tout le monde cette fois.
			await invalidateAll()
			shellPreview.set(null); identityPreview.set(null)
			hist = historyStart({ ambiance: hist.present.ambiance, identity: null })
			status = 'published'
		} catch {
			status = 'error'; errorMsg = tFn('appr.publish_error')
		}
	}

	async function revert() {
		clearTimeout(timer)
		if (pending) await pending
		dirtyParts = { ambiance: false, identity: false }
		try { await api('/draft', { method: 'DELETE' }) } catch { /* rien à perdre : on réessaiera */ }
		hist = historyStart({ ambiance: { ...DEFAULT_SHELL_THEME, ...(published ?? {}) }, identity: null })
		hasAmbianceDraft = false
		shellPreview.set(null); identityPreview.set(null)
		status = 'published'
	}

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

	const dirty = $derived(status === 'draft' || status === 'saving')
	const statusLabel = $derived({
		loading: tFn('appr.status_loading'), published: tFn('appr.status_published'), saving: tFn('appr.status_saving'),
		draft: tFn('appr.status_draft'), publishing: tFn('appr.status_publishing'), error: errorMsg,
	}[status])
	const tabs = $derived([
		{ id: 'ambiance' as const, label: tFn('appr.tab_ambiance'), desc: tFn('appr.tab_ambiance_desc') },
		{ id: 'identity' as const, label: tFn('appr.tab_identity'), desc: tFn('appr.tab_identity_desc') },
		{ id: 'home'     as const, label: tFn('appr.tab_home'),     desc: tFn('appr.tab_home_desc') },
	])
	const identityChanged = $derived(!!identity)
</script>

<svelte:head><title>{tFn('appr.page_title')}</title></svelte:head>
<svelte:window onkeydown={onKey} />

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

<!-- Barre de publication : même logique que le Grid Builder (brouillon, puis Publier). -->
<div class="appr-bar" class:dirty class:error={status === 'error'}>
	<span class="appr-dot"></span>
	<!-- Seul le texte d'état est annoncé en direct, pas les boutons. -->
	<span class="appr-status" role="status" aria-live="polite">{statusLabel}</span>
	<span class="appr-sep" aria-hidden="true"></span>
	<button type="button" class="appr-icon" disabled={!hist.past.length} onclick={undo} title={tFn('appr.undo')} aria-label={tFn('appr.undo')}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>
	</button>
	<button type="button" class="appr-icon" disabled={!hist.future.length} onclick={redo} title={tFn('appr.redo')} aria-label={tFn('appr.redo')}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg>
	</button>
	<button type="button" class="appr-ghost" disabled={!dirty} onclick={revert}>{tFn('appr.revert')}</button>
	<button type="button" class="appr-primary" disabled={!dirty || status === 'saving'} onclick={publish}>{tFn('appr.publish')}</button>
</div>

<style>
	.appr-tabs { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: #111827; border: 1px solid #1f2937; }
	.appr-tabs button {
		position: relative; padding: 7px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; color: #9ca3af;
		background: transparent; border: none; cursor: pointer; transition: background-color .15s, color .15s;
	}
	.appr-tabs button:hover { color: #f3f4f6; }
	.appr-tabs button.on { background: #374151; color: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .4); }
	.appr-tab-dot { display: inline-block; width: 6px; height: 6px; border-radius: 999px; margin-left: 6px; vertical-align: middle; background: var(--nx-header-accent); }
	/* Info-bulle maison : apparaît sous l'onglet au survol ET au focus clavier. */
	.appr-tip {
		position: absolute; top: calc(100% + 8px); left: 50%; transform: translate(-50%, -4px); z-index: 30;
		width: max-content; max-width: 280px; padding: 8px 11px; border-radius: 9px; text-align: left; white-space: normal;
		font-size: 12px; font-weight: 400; line-height: 1.4; color: #e5e7eb;
		background: #0b0f17; box-shadow: 0 0 0 1px #374151, 0 10px 24px -8px rgb(0 0 0 / .8);
		opacity: 0; pointer-events: none; transition: opacity .15s, transform .25s var(--ease-out-soft);
	}
	.appr-tabs button:hover .appr-tip, .appr-tabs button:focus-visible .appr-tip { opacity: 1; transform: translate(-50%, 0); transition-delay: .25s; }

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

	.appr-bar {
		/* Au-dessus de la barre de navigation du bas sur mobile. */
		position: fixed; left: 50%; bottom: calc(var(--bottom-nav-h, 0px) + var(--shell-gap, 0px) + 18px); transform: translateX(-50%); z-index: 60;
		display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 16px; border-radius: 999px; max-width: calc(100vw - 24px);
		background: rgb(17 24 39 / .88); backdrop-filter: blur(16px) saturate(1.5);
		box-shadow: 0 0 0 1px rgb(255 255 255 / .08), 0 12px 32px -8px rgb(0 0 0 / .7);
		font-size: 13px; color: #d1d5db;
	}
	.appr-dot { width: 8px; height: 8px; border-radius: 999px; background: #22c55e; flex-shrink: 0; }
	.appr-bar.dirty .appr-dot { background: var(--nx-header-accent); box-shadow: 0 0 10px var(--nx-header-accent); }
	.appr-bar.error .appr-dot { background: #ef4444; }
	.appr-status { min-width: 150px; margin-right: 4px; }
	.appr-sep { width: 1px; height: 18px; background: rgb(255 255 255 / .1); }
	.appr-icon { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: none; background: transparent; color: #d1d5db; cursor: pointer; }
	.appr-icon svg { width: 16px; height: 16px; }
	.appr-icon:hover:not(:disabled) { background: rgb(255 255 255 / .06); color: #fff; }
	.appr-ghost, .appr-primary { padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; white-space: nowrap; }
	.appr-ghost { background: transparent; color: #d1d5db; }
	.appr-ghost:hover:not(:disabled) { background: rgb(255 255 255 / .06); }
	.appr-primary { background: var(--nx-header-accent); color: var(--nx-on-accent); }
	.appr-ghost:disabled, .appr-primary:disabled, .appr-icon:disabled { opacity: .35; cursor: default; }
	.appr-ghost:focus-visible, .appr-primary:focus-visible, .appr-icon:focus-visible, .appr-tabs button:focus-visible, .appr-btn:focus-visible, .appr-link:focus-visible {
		outline: 2px solid var(--nx-header-accent); outline-offset: 2px;
	}
	@media (max-width: 640px) {
		.appr-status { display: none; }
	}
</style>
