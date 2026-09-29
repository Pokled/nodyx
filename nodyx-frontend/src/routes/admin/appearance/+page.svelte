<script lang="ts">
	/**
	 * Écran Apparence : l'entrée « globale » (SPECS/NODYX_APPARENCE_CDC.md).
	 *
	 * On règle un BROUILLON, partagé avec l'édition au stylo : rien ne change
	 * pour les membres avant « Publier ». Pendant l'édition, le vrai contenant
	 * autour de cet écran (header, rail, décor) montre déjà le brouillon, via
	 * le store shellPreview, pour l'admin seul. Les deux réductions clair et
	 * sombre montrent les deux modes sans toucher à sa propre préférence.
	 */
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/state'
	import { invalidateAll } from '$app/navigation'
	import { t } from '$lib/i18n'
	import { DEFAULT_SHELL_THEME, type ShellTheme } from '$lib/shellTheme'
	import { shellPreview } from '$lib/shellPreview'
	import AmbianceControls from '$lib/components/appearance/AmbianceControls.svelte'
	import ShellMiniPreview from '$lib/components/appearance/ShellMiniPreview.svelte'

	const tFn = $derived($t)
	const token = $derived((page.data as any).token as string | null)
	const banner = $derived((page.data as any).communityBannerUrl as string | null)
	const logo = $derived((page.data as any).communityLogoUrl as string | null)

	type Status = 'loading' | 'published' | 'saving' | 'draft' | 'publishing' | 'error'
	let status = $state<Status>('loading')
	let errorMsg = $state('')
	let published = $state<ShellTheme | null>(null)
	let value = $state<ShellTheme>({ ...DEFAULT_SHELL_THEME })
	let tab = $state<'ambiance' | 'identity' | 'home'>('ambiance')

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
			value = { ...DEFAULT_SHELL_THEME, ...(json.draft ?? json.published ?? {}) }
			status = json.draft ? 'draft' : 'published'
			if (json.draft) shellPreview.set(value)
		} catch {
			status = 'error'; errorMsg = tFn('appr.load_error')
		}
	})
	// Quitter l'écran rend au site son ambiance publiée (le brouillon reste
	// enregistré côté serveur, on le retrouvera en revenant).
	onDestroy(() => shellPreview.set(null))

	// Enregistrement automatique du brouillon, 500 ms après le dernier geste.
	// L'aperçu, lui, suit chaque geste sans attendre le serveur.
	let timer: ReturnType<typeof setTimeout> | undefined
	let pending: Promise<void> | null = null
	function onchange(v: ShellTheme) {
		value = v
		shellPreview.set(v)
		status = 'saving'
		clearTimeout(timer)
		timer = setTimeout(() => { pending = saveDraft() }, 500)
	}
	async function saveDraft() {
		try {
			const res = await api('/draft', { method: 'PUT', body: JSON.stringify(value) })
			const json = await res.json().catch(() => ({}))
			if (!res.ok) { status = 'error'; errorMsg = json.error ?? tFn('appr.save_error'); return }
			status = 'draft'
		} catch {
			status = 'error'; errorMsg = tFn('appr.save_error')
		}
	}

	async function publish() {
		clearTimeout(timer)
		if (status === 'saving') { pending = saveDraft() }
		if (pending) await pending
		if (status === 'error') return
		status = 'publishing'
		try {
			const res = await api('/publish', { method: 'POST' })
			const json = await res.json().catch(() => ({}))
			if (!res.ok) { status = 'error'; errorMsg = json.error ?? tFn('appr.publish_error'); return }
			published = json.published
			// Le site recharge ses données : l'ambiance publiée prend le relais
			// de l'aperçu, pour tout le monde cette fois.
			await invalidateAll()
			shellPreview.set(null)
			status = 'published'
		} catch {
			status = 'error'; errorMsg = tFn('appr.publish_error')
		}
	}

	async function revert() {
		clearTimeout(timer)
		if (pending) await pending
		try { await api('/draft', { method: 'DELETE' }) } catch { /* rien à perdre : le brouillon reste, on réessaiera */ }
		value = { ...DEFAULT_SHELL_THEME, ...(published ?? {}) }
		shellPreview.set(null)
		status = 'published'
	}

	const dirty = $derived(status === 'draft' || status === 'saving')
	const statusLabel = $derived({
		loading: tFn('appr.status_loading'), published: tFn('appr.status_published'), saving: tFn('appr.status_saving'),
		draft: tFn('appr.status_draft'), publishing: tFn('appr.status_publishing'), error: errorMsg,
	}[status])
	const tabs = $derived([
		{ id: 'ambiance' as const, label: tFn('appr.tab_ambiance') },
		{ id: 'identity' as const, label: tFn('appr.tab_identity') },
		{ id: 'home'     as const, label: tFn('appr.tab_home') },
	])
</script>

<svelte:head><title>{tFn('appr.page_title')}</title></svelte:head>

<div class="space-y-6 pb-24">
	<div>
		<h1 class="text-2xl font-bold text-white">{tFn('appr.title')}</h1>
		<p class="text-sm text-gray-500 mt-0.5">{tFn('appr.subtitle')}</p>
	</div>

	<div class="appr-tabs" role="tablist" aria-label={tFn('appr.title')}>
		{#each tabs as tb (tb.id)}
			<button type="button" role="tab" aria-selected={tab === tb.id} class:on={tab === tb.id} onclick={() => tab = tb.id}>{tb.label}</button>
		{/each}
	</div>

	{#if tab === 'ambiance'}
		<div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
			<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
				{#if status === 'loading'}
					<p class="text-sm text-gray-500">{tFn('appr.status_loading')}</p>
				{:else}
					<AmbianceControls {value} {banner} {token} {onchange} />
				{/if}
			</div>
			<div class="space-y-3">
				<ShellMiniPreview theme={value} dark={true}  {banner} label={tFn('appr.preview_dark')} />
				<ShellMiniPreview theme={value} dark={false} {banner} label={tFn('appr.preview_light')} />
				<p class="text-xs text-gray-500">{tFn('appr.preview_live_hint')}</p>
			</div>
		</div>
	{:else if tab === 'identity'}
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-4">
			<div class="flex items-center gap-4">
				{#if logo}<img src={logo} alt={tFn('common.logo_alt')} class="w-14 h-14 rounded-xl object-cover" />{/if}
				{#if banner}<img src={banner} alt="" class="h-14 w-40 rounded-xl object-cover" />{/if}
			</div>
			<p class="text-sm text-gray-400">{tFn('appr.identity_help')}</p>
			<a href="/admin/settings" class="appr-link">{tFn('appr.identity_open')}</a>
		</div>
	{:else}
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5 space-y-4">
			<p class="text-sm text-gray-400">{tFn('appr.home_help')}</p>
			<a href="/admin/homepage/builder" class="appr-link">{tFn('appr.home_open')}</a>
		</div>
	{/if}
</div>

<!-- Barre de publication : même logique que le Grid Builder (brouillon, puis Publier). -->
<div class="appr-bar" class:dirty class:error={status === 'error'} role="status" aria-live="polite">
	<span class="appr-dot"></span>
	<span class="appr-status">{statusLabel}</span>
	<button type="button" class="appr-ghost" disabled={!dirty} onclick={revert}>{tFn('appr.revert')}</button>
	<button type="button" class="appr-primary" disabled={!dirty || status === 'saving'} onclick={publish}>{tFn('appr.publish')}</button>
</div>

<style>
	.appr-tabs { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: #111827; border: 1px solid #1f2937; }
	.appr-tabs button {
		padding: 7px 16px; border-radius: 8px; font-size: 13px; font-weight: 500; color: #9ca3af; background: transparent; border: none; cursor: pointer;
		transition: background-color .15s, color .15s;
	}
	.appr-tabs button:hover { color: #f3f4f6; }
	.appr-tabs button.on { background: #374151; color: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .4); }
	.appr-link {
		display: inline-flex; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 500;
		background: #1f2937; border: 1px solid #374151; color: #e5e7eb; text-decoration: none;
	}
	.appr-link:hover { border-color: #4b5563; color: #fff; }

	/* Barre flottante en bas : discrète quand tout est publié, elle s'allume
	   (accent du brouillon) dès qu'il y a quelque chose à publier. */
	.appr-bar {
		position: fixed; left: 50%; bottom: calc(var(--shell-gap, 0px) + 18px); transform: translateX(-50%); z-index: 60;
		display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; border-radius: 999px;
		background: rgb(17 24 39 / .88); backdrop-filter: blur(16px) saturate(1.5);
		box-shadow: 0 0 0 1px rgb(255 255 255 / .08), 0 12px 32px -8px rgb(0 0 0 / .7);
		font-size: 13px; color: #d1d5db;
	}
	.appr-dot { width: 8px; height: 8px; border-radius: 999px; background: #22c55e; }
	.appr-bar.dirty .appr-dot { background: var(--nx-header-accent); box-shadow: 0 0 10px var(--nx-header-accent); }
	.appr-bar.error .appr-dot { background: #ef4444; }
	.appr-status { min-width: 150px; }
	.appr-ghost, .appr-primary { padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; }
	.appr-ghost { background: transparent; color: #d1d5db; }
	.appr-ghost:hover:not(:disabled) { background: rgb(255 255 255 / .06); }
	.appr-primary { background: var(--nx-header-accent); color: var(--nx-on-accent); }
	.appr-ghost:disabled, .appr-primary:disabled { opacity: .4; cursor: default; }
</style>
