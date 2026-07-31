<script lang="ts">
	import { onMount } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fade, fly } from 'svelte/transition'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	// Modale qui liste les sons uploadés dans la médiathèque Nodyx et
	// retourne au callback `onPick` l'URL complète du son choisi. Utilisé
	// par AlertBoxConfigEditor pour qu'un streamer puisse piocher dans ses
	// propres uploads sans avoir à copier-coller une URL externe.

	interface Props {
		token:   string
		open:    boolean
		onPick:  (url: string, label: string) => void
		onClose: () => void
	}

	let { token, open, onPick, onClose }: Props = $props()

	type Asset = {
		id:        string
		name:      string
		file_path: string
		mime_type: string
		file_size: number
	}

	const baseUrl = PUBLIC_API_URL.replace('/api/v1', '')

	let assets   = $state<Asset[]>([])
	let loading  = $state(false)
	let loaded   = $state(false)
	let playingId = $state<string | null>(null)
	let audioEl  = $state<HTMLAudioElement | null>(null)

	async function load(): Promise<void> {
		if (loading || loaded) return
		loading = true
		try {
			const res = await apiFetch(fetch, '/assets?type=sound&limit=100', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { assets: Asset[] }
				assets = data.assets ?? []
			}
		} finally {
			loading = false
			loaded  = true
		}
	}

	// Charger les assets uniquement quand la modale s'ouvre (lazy)
	$effect(() => {
		if (open && !loaded) load()
	})

	function urlOf(a: Asset): string {
		return `${baseUrl}/uploads/${a.file_path}`
	}

	function fmtSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} o`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
		return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
	}

	function preview(a: Asset): void {
		// Arrête le son en cours si on rejoue un autre
		if (audioEl) { audioEl.pause(); audioEl = null }
		try {
			const audio = new Audio(urlOf(a))
			audio.volume = 0.7
			audio.play().catch(() => { /* swallow */ })
			audioEl   = audio
			playingId = a.id
			audio.addEventListener('ended', () => {
				if (playingId === a.id) playingId = null
			}, { once: true })
		} catch { /* invalid url */ }
	}

	function pick(a: Asset): void {
		if (audioEl) { audioEl.pause(); audioEl = null }
		onPick(urlOf(a), a.name)
		onClose()
	}

	function handleClose(): void {
		if (audioEl) { audioEl.pause(); audioEl = null }
		playingId = null
		onClose()
	}

	function onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Escape') handleClose()
	}

	onMount(() => {
		if (browser) window.addEventListener('keydown', onKeydown)
		return () => { if (browser) window.removeEventListener('keydown', onKeydown) }
	})
</script>

{#if open}
	<!-- Backdrop -->
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
	     transition:fade={{ duration: 150 }}
	     onclick={(e) => { if (e.target === e.currentTarget) handleClose() }}>
		<div class="w-full max-w-2xl max-h-[80vh] rounded-2xl border border-slate-700/60 bg-slate-950 shadow-2xl flex flex-col"
		     transition:fly={{ y: 20, duration: 220 }}>
			<!-- Header -->
			<header class="px-5 py-3.5 border-b border-slate-700/60 flex items-center justify-between gap-3">
				<div>
					<h2 class="text-sm font-semibold text-white">{tFn('mspick.title')}</h2>
					<p class="text-[11px] text-slate-500 mt-0.5">
						{tFn('mspick.desc_pre')} <a href="/admin/media" target="_blank" rel="noopener" class="text-cyan-400 hover:underline">{tFn('mspick.media_library')}</a>.
					</p>
				</div>
				<button type="button" onclick={handleClose}
					class="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-slate-800 transition-colors"
					aria-label={tFn('mspick.close')}>
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
				</button>
			</header>

			<!-- Body -->
			<div class="flex-1 overflow-y-auto p-3 space-y-2">
				{#if loading}
					<div class="text-center py-12 text-xs text-slate-500">{tFn('mspick.loading')}</div>
				{:else if assets.length === 0}
					<div class="text-center py-12 space-y-3">
						<div class="text-sm text-slate-400">{tFn('mspick.empty')}</div>
						<a href="/admin/media" target="_blank" rel="noopener"
							class="inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 underline decoration-cyan-500/40">
							{tFn('mspick.upload_link')}
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
						</a>
					</div>
				{:else}
					{#each assets as a (a.id)}
						{@const isPlaying = playingId === a.id}
						<div class="rounded-lg border border-slate-700/60 bg-slate-900/40 hover:border-cyan-500/40 transition-colors p-3 flex items-center gap-3">
							<button type="button" onclick={() => preview(a)}
								class="shrink-0 w-9 h-9 rounded-full bg-slate-800 hover:bg-cyan-500/20 border border-slate-700 hover:border-cyan-500/50 text-cyan-300 flex items-center justify-center transition-colors"
								aria-label={isPlaying ? tFn('mspick.playing') : tFn('mspick.preview')}>
								{#if isPlaying}
									<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M5.5 3.5A1.5 1.5 0 017 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5zm9 0A1.5 1.5 0 0116 5v10a1.5 1.5 0 01-3 0V5a1.5 1.5 0 011.5-1.5z"/></svg>
								{:else}
									<svg class="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84a1 1 0 011.04.06l9 6a1 1 0 010 1.66l-9 6A1 1 0 016 16V4a1 1 0 01.3-.84z"/></svg>
								{/if}
							</button>
							<div class="flex-1 min-w-0">
								<div class="text-sm text-slate-200 font-medium truncate" title={a.name}>{a.name}</div>
								<div class="text-[10px] text-slate-500 font-mono">{a.mime_type} · {fmtSize(a.file_size)}</div>
							</div>
							<button type="button" onclick={() => pick(a)}
								class="shrink-0 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 px-3 py-1.5 text-xs font-medium transition-colors">
								{tFn('mspick.select')}
							</button>
						</div>
					{/each}
				{/if}
			</div>

			<!-- Footer -->
			<footer class="px-5 py-3 border-t border-slate-700/60 flex items-center justify-between text-[11px] text-slate-500">
				<span>{assets.length > 1 ? tFn('mspick.available_many', { n: assets.length }) : tFn('mspick.available_one', { n: assets.length })}</span>
				<button type="button" onclick={handleClose}
					class="text-slate-400 hover:text-slate-200 transition-colors">
					{tFn('mspick.cancel')}
				</button>
			</footer>
		</div>
	</div>
{/if}
