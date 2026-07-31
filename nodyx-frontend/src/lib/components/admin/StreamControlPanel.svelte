<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	interface Props {
		token:               string
		hasManageScope:      boolean   // false → on prompt reconnect
		currentTitle:        string | null
		currentGameName:     string | null
		isLive:              boolean
		onProfileUpdated?:   () => void  // triggered to refresh Hero data
	}

	let {
		token,
		hasManageScope,
		currentTitle,
		currentGameName,
		isLive,
		onProfileUpdated,
	}: Props = $props()

	type GameResult = { id: string; name: string; boxArtUrl: string }

	let title          = $state(currentTitle ?? '')
	let gameQuery      = $state(currentGameName ?? '')
	let selectedGameId = $state<string | null>(null)
	let searchResults  = $state<GameResult[]>([])
	let searching      = $state(false)
	let saving         = $state(false)
	let toast          = $state<{ text: string; ok: boolean } | null>(null)

	let markerDesc       = $state('')
	let placingMarker    = $state(false)
	let lastMarkerAt     = $state<string | null>(null)

	let searchTimer: ReturnType<typeof setTimeout> | null = null
	let suppressNextSearch = false  // évite un search après sélection

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	function debounceSearch(q: string): void {
		if (searchTimer) clearTimeout(searchTimer)
		if (suppressNextSearch) { suppressNextSearch = false; return }
		if (q.trim().length < 2) { searchResults = []; return }
		searchTimer = setTimeout(() => doSearch(q), 250)
	}

	async function doSearch(q: string): Promise<void> {
		searching = true
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/games/search?q=${encodeURIComponent(q)}`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { games: GameResult[] }
				searchResults = data.games ?? []
			} else {
				searchResults = []
			}
		} catch {
			searchResults = []
		} finally {
			searching = false
		}
	}

	function pickGame(g: GameResult): void {
		suppressNextSearch = true
		gameQuery = g.name
		selectedGameId = g.id
		searchResults = []
	}

	function clearGame(): void {
		suppressNextSearch = true
		gameQuery = ''
		selectedGameId = ''     // '' = unset côté Twitch
		searchResults = []
	}

	const titleChanged = $derived(title.trim() !== (currentTitle ?? '').trim())
	const gameChanged  = $derived(selectedGameId !== null)  // utilisateur a explicitement sélectionné OU vidé
	const canSave      = $derived(hasManageScope && (titleChanged || gameChanged) && !saving)

	async function save(): Promise<void> {
		if (!canSave) return
		saving = true
		const body: { title?: string; gameId?: string } = {}
		if (titleChanged) body.title = title.trim()
		if (gameChanged)  body.gameId = selectedGameId ?? ''

		try {
			const res = await apiFetch(fetch, '/streamer/twitch/channel', {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify(body),
			})
			if (res.ok) {
				flash(tFn('strmctl.updated'), true)
				// Le serveur invalide le cache Hero, on demande au parent de re-fetch.
				onProfileUpdated?.()
				selectedGameId = null  // reset le flag de modification
			} else {
				const data = await res.json().catch(() => ({})) as { error?: string }
				flash(data.error === 'missing_scope_manage_broadcast'
					? tFn('strmctl.err_scope')
					: tFn('strmctl.err_generic', { error: data.error ?? tFn('strmctl.err_twitch') }), false)
			}
		} catch {
			flash(tFn('strmctl.err_network'), false)
		} finally {
			saving = false
		}
	}

	async function placeMarker(): Promise<void> {
		if (!hasManageScope || !isLive || placingMarker) return
		placingMarker = true
		try {
			const res = await apiFetch(fetch, '/streamer/twitch/marker', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ description: markerDesc.trim() || undefined }),
			})
			if (res.ok) {
				const data = await res.json() as { marker: { id: string; createdAt: string; positionSeconds: number } }
				lastMarkerAt = data.marker.createdAt
				flash(tFn('strmctl.marker_placed', { pos: formatPosition(data.marker.positionSeconds) }), true)
				markerDesc = ''
			} else if (res.status === 409) {
				flash(tFn('strmctl.err_offline'), false)
			} else {
				flash(tFn('strmctl.err_marker'), false)
			}
		} catch {
			flash(tFn('strmctl.err_network'), false)
		} finally {
			placingMarker = false
		}
	}

	function formatPosition(sec: number): string {
		const h = Math.floor(sec / 3600)
		const m = Math.floor((sec % 3600) / 60)
		const s = sec % 60
		return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
	}

	function fmtRelative(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime()
		const m = Math.floor(diff / 60_000)
		if (m < 1)  return tFn('strmctl.just_now')
		if (m < 60) return tFn('strmctl.mins_ago', { n: m })
		const h = Math.floor(m / 60)
		return tFn('strmctl.hours_ago', { n: h })
	}
</script>

<section class="rounded-xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/30 via-slate-900/60 to-cyan-950/20 p-5 space-y-4">
	<header class="flex items-center justify-between gap-3">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.091 1.076-.071 2.264-.904 2.95l-.102.085m-1.745 1.437L5.909 7.5H4.5L2.25 3.75l1.5-1.5L7.5 4.5v1.409l4.26 4.26m-1.745 1.437l1.745-1.437m6.615 8.206L15.75 15.75M4.867 19.125h.008v.008h-.008v-.008z"/>
			</svg>
			<h2 class="text-sm font-semibold text-white">{tFn('strmctl.title')}</h2>
			{#if isLive}
				<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
					<span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse"></span>
					LIVE
				</span>
			{/if}
		</div>
		<span class="text-[11px] text-slate-500">{tFn('strmctl.subtitle')}</span>
	</header>

	{#if !hasManageScope}
		<div class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-2.5 text-xs">
			<svg class="w-4 h-4 text-amber-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
				<path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
			</svg>
			<div class="flex-1">
				<div class="font-semibold text-amber-200">{tFn('strmctl.scope_pre')} <code class="font-mono text-[11px] bg-black/30 px-1 rounded">channel:manage:broadcast</code> {tFn('strmctl.scope_post')}</div>
				<p class="text-amber-300/80 mt-1">
					{tFn('strmctl.scope_help')}
				</p>
			</div>
		</div>
	{/if}

	<!-- Toast inline (sticky en bas de la section pour ne pas masquer le formulaire) -->
	{#if toast}
		<div class="rounded-lg border p-3 text-xs flex items-center gap-2 {toast.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- 1. Title + Game -->
	<div class="space-y-3">
		<div>
			<div class="flex items-baseline justify-between mb-1.5">
				<label for="stream-title-input" class="text-[11px] uppercase tracking-widest font-semibold text-slate-400">{tFn('strmctl.title_label')}</label>
				<span class="text-[10px] text-slate-500">
					{tFn('strmctl.current')}
					<span class="text-slate-300 ml-1">{currentTitle ? `« ${currentTitle} »` : tFn('strmctl.none_m')}</span>
				</span>
			</div>
			<input
				id="stream-title-input"
				type="text"
				bind:value={title}
				maxlength="140"
				disabled={!hasManageScope}
				placeholder={tFn('strmctl.title_ph')}
				class="w-full rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-50"
			/>
			<div class="flex justify-between text-[10px] text-slate-500 mt-1">
				<span>{titleChanged ? tFn('strmctl.modified') : tFn('strmctl.same')}</span>
				<span class="font-mono tabular-nums">{title.length} / 140</span>
			</div>
		</div>

		<div>
			<div class="flex items-baseline justify-between mb-1.5">
				<label for="stream-category-input" class="text-[11px] uppercase tracking-widest font-semibold text-slate-400">{tFn('strmctl.category_label')}</label>
				<span class="text-[10px] text-slate-500">
					{tFn('strmctl.current')}
					<span class="text-slate-300 ml-1">{currentGameName ?? tFn('strmctl.none_f')}</span>
				</span>
			</div>
			<div class="relative">
				<input
					id="stream-category-input"
					type="text"
					bind:value={gameQuery}
					oninput={(e) => debounceSearch((e.target as HTMLInputElement).value)}
					disabled={!hasManageScope}
					placeholder={tFn('strmctl.category_ph')}
					autocomplete="off"
					class="w-full rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 pl-3 pr-9 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-50"
				/>
				{#if gameQuery}
					<button type="button" onclick={clearGame} class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300" aria-label={tFn('strmctl.clear_category')}>
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
					</button>
				{/if}

				{#if searchResults.length > 0}
					<ul class="absolute z-10 mt-1 w-full rounded-lg border border-slate-700/80 bg-slate-950 shadow-2xl max-h-72 overflow-y-auto">
						{#each searchResults as g (g.id)}
							<li>
								<button type="button" onclick={() => pickGame(g)} class="w-full flex items-center gap-3 px-3 py-2 hover:bg-cyan-500/10 text-left transition-colors">
									<img src={g.boxArtUrl} alt={g.name} class="w-9 h-12 rounded shrink-0 bg-slate-800" loading="lazy" />
									<span class="text-sm text-white">{g.name}</span>
								</button>
							</li>
						{/each}
					</ul>
				{:else if searching}
					<div class="absolute z-10 mt-1 w-full rounded-lg border border-slate-700/80 bg-slate-950 px-3 py-2 text-xs text-slate-400">{tFn('strmctl.searching')}</div>
				{/if}
			</div>
			{#if selectedGameId === ''}
				<div class="text-[10px] text-slate-500 mt-1">{tFn('strmctl.category_removed')}</div>
			{:else if selectedGameId}
				<div class="text-[10px] text-cyan-400/80 mt-1">{tFn('strmctl.category_new')}</div>
			{/if}
		</div>

		<button
			type="button"
			onclick={save}
			disabled={!canSave}
			title={!hasManageScope ? tFn('strmctl.scope_missing_title') : (!titleChanged && !gameChanged ? tFn('strmctl.no_change_title') : tFn('strmctl.send_title'))}
			class="w-full rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 disabled:cursor-not-allowed border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
		>
			{#if saving}
				<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
				{tFn('strmctl.sending')}
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
				{tFn('strmctl.apply')}
			{/if}
		</button>
		{#if hasManageScope && !titleChanged && !gameChanged && !saving}
			<div class="text-[11px] text-slate-500 text-center -mt-1">
				{tFn('strmctl.hint_activate')}
			</div>
		{/if}
	</div>

	<!-- 2. VOD Marker -->
	<div class="pt-3 border-t border-slate-700/40 space-y-2">
		<div class="flex items-center justify-between">
			<div>
				<div class="text-sm font-semibold text-white">Marker VOD</div>
				<div class="text-[11px] text-slate-500">{tFn('strmctl.marker_desc')}</div>
			</div>
			{#if lastMarkerAt}
				<span class="text-[10px] text-emerald-400">{tFn('strmctl.last')} {fmtRelative(lastMarkerAt)}</span>
			{/if}
		</div>
		<div class="flex gap-2">
			<input
				type="text"
				bind:value={markerDesc}
				maxlength="140"
				disabled={!hasManageScope || !isLive}
				placeholder={isLive ? tFn('strmctl.marker_ph_live') : tFn('strmctl.marker_ph_offline')}
				class="flex-1 rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-rose-500/60 focus:ring-2 focus:ring-rose-500/20 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-40"
			/>
			<button
				type="button"
				onclick={placeMarker}
				disabled={!hasManageScope || !isLive || placingMarker}
				class="rounded-lg bg-rose-500/15 hover:bg-rose-500/25 disabled:opacity-30 disabled:cursor-not-allowed border border-rose-500/40 text-rose-200 font-medium px-4 py-2 text-sm transition-colors flex items-center gap-2 shrink-0"
			>
				{#if placingMarker}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
				{:else}
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 3v18l9-5 9 5V3z"/></svg>
				{/if}
				{placingMarker ? tFn('strmctl.placing') : tFn('strmctl.mark_moment')}
			</button>
		</div>
	</div>
</section>
