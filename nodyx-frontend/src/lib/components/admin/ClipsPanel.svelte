<script lang="ts">
	import { onMount } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'

	// Clips Twitch dans Studio Live : 2 onglets internes.
	//  - Mes top clips : top clips de la chaine connectée, 7j / 30j / total
	//  - Clips des raiders : derniers raids reçus + leurs clips à showcase

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	type Clip = {
		id:              string
		url:             string
		embedUrl:        string
		broadcasterName: string
		creatorName:     string
		title:           string
		viewCount:       number
		createdAt:       string
		thumbnailUrl:    string
		duration:        number
	}

	type RecentRaid = {
		id:                       string
		occurredAt:               string
		fromBroadcasterUserId:    string
		fromBroadcasterUserLogin: string
		fromBroadcasterUserName:  string
		viewers:                  number
	}

	type TabId = 'own' | 'raiders'
	let tab = $state<TabId>('own')

	// ── Clips_player overlays disponibles pour le trigger admin ─────────────
	type OverlayRow = { id: string; overlayType: string; label: string | null }
	let clipsOverlays = $state<OverlayRow[]>([])
	let selectedOverlayId = $state<string>('')
	let triggering        = $state(false)

	async function loadClipsOverlays(): Promise<void> {
		const res = await apiFetch(fetch, '/streamer/overlays', { headers: { Authorization: `Bearer ${token}` } })
		if (res.ok) {
			const data = await res.json() as { overlays: OverlayRow[] }
			clipsOverlays = (data.overlays ?? []).filter(o => o.overlayType === 'clips_player')
			if (clipsOverlays.length > 0 && !selectedOverlayId) selectedOverlayId = clipsOverlays[0].id
		}
	}

	async function triggerClips(args: { period?: 'top_own_7d' | 'top_own_30d' | 'top_own_all'; broadcasterId?: string; count: number }): Promise<void> {
		if (!selectedOverlayId) { flash('Crée d\'abord une overlay Clips Player dans l\'onglet Overlays OBS.', false); return }
		if (triggering) return
		triggering = true
		try {
			const body: Record<string, unknown> = { count: args.count }
			if (args.broadcasterId) { body.period = 'raider'; body.broadcasterId = args.broadcasterId }
			else                     body.period = args.period
			const res = await apiFetch(fetch, `/streamer/overlays/${selectedOverlayId}/play-clips`, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify(body),
			})
			if (res.ok) {
				const data = await res.json() as { count: number }
				flash(`Session lancée : ${data.count} clip${data.count > 1 ? 's' : ''} envoyés vers l'overlay.`, true)
			} else if (res.status === 404) {
				flash('Aucun clip trouvé sur ce filtre. Choisis une autre période ou un autre raider.', false)
			} else {
				flash('Échec du déclenchement.', false)
			}
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			triggering = false
		}
	}

	// ── State : own clips ───────────────────────────────────────────────────
	let ownPeriod = $state<'7d' | '30d' | 'all'>('7d')
	let ownClips  = $state<Clip[]>([])
	let ownLoading = $state(true)

	// ── State : raiders ─────────────────────────────────────────────────────
	let raids = $state<RecentRaid[]>([])
	let raidsLoading = $state(false)
	let raiderClips = $state<Record<string, Clip[]>>({})
	let raiderClipsLoading = $state<Set<string>>(new Set())

	// ── Player modal ────────────────────────────────────────────────────────
	let playingClip = $state<Clip | null>(null)

	let toast = $state<{ text: string; ok: boolean } | null>(null)
	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3000)
	}

	async function loadOwnClips(): Promise<void> {
		ownLoading = true
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/clips/own?period=${ownPeriod}&limit=24`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { clips: Clip[] }
				ownClips = data.clips ?? []
			}
		} finally {
			ownLoading = false
		}
	}

	async function loadRaids(): Promise<void> {
		raidsLoading = true
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/raids/recent?limit=12`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { raids: RecentRaid[] }
				raids = data.raids ?? []
			}
		} finally {
			raidsLoading = false
		}
	}

	async function loadRaiderClips(broadcasterId: string): Promise<void> {
		if (raiderClips[broadcasterId] || raiderClipsLoading.has(broadcasterId)) return
		const next = new Set(raiderClipsLoading); next.add(broadcasterId); raiderClipsLoading = next
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/clips/raider/${broadcasterId}?limit=5`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { clips: Clip[] }
				raiderClips = { ...raiderClips, [broadcasterId]: data.clips ?? [] }
				if ((data.clips?.length ?? 0) === 0) flash('Aucun clip trouvé pour ce raider (clips trop vieux ou compte sans clip).', false)
			} else flash('Échec du fetch des clips raider.', false)
		} finally {
			const next2 = new Set(raiderClipsLoading); next2.delete(broadcasterId); raiderClipsLoading = next2
		}
	}

	onMount(() => { loadOwnClips(); loadClipsOverlays() })

	// Quand on change de période ou de tab, on recharge ce qu'il faut
	let lastPeriod = $state<'7d' | '30d' | 'all'>('7d')
	$effect(() => {
		if (ownPeriod !== lastPeriod) {
			lastPeriod = ownPeriod
			loadOwnClips()
		}
	})

	function switchTab(t: TabId): void {
		tab = t
		if (t === 'raiders' && raids.length === 0 && !raidsLoading) loadRaids()
	}

	function fmtDuration(sec: number): string {
		const m = Math.floor(sec / 60)
		const s = Math.floor(sec % 60)
		return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`
	}

	function fmtNumber(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
		if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
		return n.toString()
	}

	function fmtRelative(iso: string): string {
		const diff = Date.now() - new Date(iso).getTime()
		const m = Math.floor(diff / 60_000)
		if (m < 60)  return `il y a ${m}min`
		const h = Math.floor(m / 60)
		if (h < 24)  return `il y a ${h}h`
		const d = Math.floor(h / 24)
		if (d < 30)  return `il y a ${d}j`
		return new Date(iso).toLocaleDateString('fr-FR')
	}

	// Embed URL Twitch exige un parent= correspondant au host courant pour
	// passer le check anti-clickjacking. On lit le host côté browser.
	const embedParent = $derived(browser ? window.location.hostname : '')
</script>

<section class="rounded-xl border border-indigo-500/25 bg-gradient-to-br from-indigo-950/30 via-slate-900/60 to-cyan-950/20 p-5 space-y-4">
	<header class="flex items-center justify-between gap-3 flex-wrap">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
			<h2 class="text-sm font-semibold text-white">Clips Twitch</h2>
		</div>
		<!-- Tabs internes -->
		<div class="inline-flex rounded-lg border border-slate-700/60 bg-slate-950/60 p-0.5">
			<button type="button" onclick={() => switchTab('own')}
				class="px-3 py-1 text-xs font-medium rounded-md transition-colors {tab === 'own' ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}">
				Mes top clips
			</button>
			<button type="button" onclick={() => switchTab('raiders')}
				class="px-3 py-1 text-xs font-medium rounded-md transition-colors {tab === 'raiders' ? 'bg-rose-500/20 text-rose-200' : 'text-slate-500 hover:text-slate-300'}">
				Clips des raiders
			</button>
		</div>
	</header>

	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Trigger overlay : choisir l'overlay cible + boutons play -->
	<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div>
				<div class="text-[11px] uppercase tracking-widest font-semibold text-cyan-400">Lancer dans une Clips Player overlay</div>
				<div class="text-[10px] text-slate-500 mt-0.5">La session jouera plein écran dans OBS, auto-advance entre clips.</div>
			</div>
			{#if clipsOverlays.length > 0}
				<select bind:value={selectedOverlayId}
					class="rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-3 py-1.5 text-xs text-white outline-none transition-colors min-w-48">
					{#each clipsOverlays as o (o.id)}
						<option value={o.id}>{o.label || `Clips Player #${o.id.slice(0, 6)}`}</option>
					{/each}
				</select>
			{:else}
				<a href="#tab=overlays" class="text-[11px] text-cyan-400 hover:text-cyan-300 underline">→ Crée une overlay Clips Player</a>
			{/if}
		</div>
		{#if clipsOverlays.length > 0}
			<div class="flex flex-wrap gap-2 pt-1">
				<button type="button" onclick={() => triggerClips({ period: 'top_own_7d',  count: 5 })} disabled={triggering}
					class="text-[11px] bg-indigo-500/15 hover:bg-indigo-500/25 disabled:opacity-30 border border-indigo-500/40 text-indigo-200 px-3 py-1.5 rounded transition-colors">
					Top 5 (7j)
				</button>
				<button type="button" onclick={() => triggerClips({ period: 'top_own_30d', count: 5 })} disabled={triggering}
					class="text-[11px] bg-indigo-500/15 hover:bg-indigo-500/25 disabled:opacity-30 border border-indigo-500/40 text-indigo-200 px-3 py-1.5 rounded transition-colors">
					Top 5 (30j)
				</button>
				<button type="button" onclick={() => triggerClips({ period: 'top_own_all', count: 5 })} disabled={triggering}
					class="text-[11px] bg-indigo-500/15 hover:bg-indigo-500/25 disabled:opacity-30 border border-indigo-500/40 text-indigo-200 px-3 py-1.5 rounded transition-colors">
					Top 5 (Total)
				</button>
				<button type="button" onclick={() => triggerClips({ period: 'top_own_7d', count: 10 })} disabled={triggering}
					class="text-[11px] bg-indigo-500/15 hover:bg-indigo-500/25 disabled:opacity-30 border border-indigo-500/40 text-indigo-200 px-3 py-1.5 rounded transition-colors">
					Top 10 (7j)
				</button>
			</div>
		{/if}
	</div>

	<!-- ══ Tab : Mes top clips ════════════════════════════════════════════ -->
	{#if tab === 'own'}
		<div class="flex items-center justify-between gap-3 flex-wrap">
			<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400">Période</div>
			<div class="inline-flex rounded-lg border border-slate-700/60 bg-slate-950/40 p-0.5">
				<button type="button" onclick={() => ownPeriod = '7d'}   class="px-3 py-1 text-xs font-medium rounded-md transition-colors {ownPeriod === '7d'   ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}">7 jours</button>
				<button type="button" onclick={() => ownPeriod = '30d'}  class="px-3 py-1 text-xs font-medium rounded-md transition-colors {ownPeriod === '30d'  ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}">30 jours</button>
				<button type="button" onclick={() => ownPeriod = 'all'}  class="px-3 py-1 text-xs font-medium rounded-md transition-colors {ownPeriod === 'all'  ? 'bg-indigo-500/20 text-indigo-200' : 'text-slate-500 hover:text-slate-300'}">Total</button>
			</div>
		</div>

		{#if ownLoading}
			<div class="text-xs text-slate-500 text-center py-8">Chargement…</div>
		{:else if ownClips.length === 0}
			<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
				Aucun clip sur cette période. Les viewers Twitch peuvent créer des clips pendant ton live avec le bouton "Clip it !" sous le player.
			</div>
		{:else}
			<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
				{#each ownClips as c (c.id)}
					<button type="button" onclick={() => playingClip = c}
						class="group text-left rounded-lg border border-slate-700/60 bg-slate-950/40 overflow-hidden hover:border-indigo-500/50 transition-colors">
						<div class="relative aspect-video bg-slate-900">
							<img src={c.thumbnailUrl} alt={c.title} class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy"/>
							<div class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] font-mono text-white">{fmtDuration(c.duration)}</div>
							<div class="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/70 backdrop-blur text-[10px] text-white inline-flex items-center gap-1">
								<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/></svg>
								{fmtNumber(c.viewCount)}
							</div>
							<div class="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
								<div class="w-12 h-12 rounded-full bg-indigo-500/90 flex items-center justify-center">
									<svg class="w-5 h-5 ml-0.5 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84a1 1 0 011.04.06l9 6a1 1 0 010 1.66l-9 6A1 1 0 016 16V4a1 1 0 01.3-.84z"/></svg>
								</div>
							</div>
						</div>
						<div class="p-2.5 space-y-1">
							<div class="text-xs font-semibold text-white line-clamp-2" title={c.title}>{c.title}</div>
							<div class="text-[10px] text-slate-500 flex justify-between">
								<span>par {c.creatorName}</span>
								<span>{fmtRelative(c.createdAt)}</span>
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	{/if}

	<!-- ══ Tab : Clips des raiders ════════════════════════════════════════ -->
	{#if tab === 'raiders'}
		{#if raidsLoading}
			<div class="text-xs text-slate-500 text-center py-8">Chargement des raids récents…</div>
		{:else if raids.length === 0}
			<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-8 text-center text-xs text-slate-500">
				Aucun raid reçu pour l'instant. Quand un streamer te raid, son nom apparaitra ici avec ses meilleurs clips récents prêts à showcase.
			</div>
		{:else}
			<div class="space-y-3">
				{#each raids as raid (raid.id)}
					{@const clips    = raiderClips[raid.fromBroadcasterUserId]}
					{@const loading  = raiderClipsLoading.has(raid.fromBroadcasterUserId)}
					<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
						<div class="flex items-center justify-between gap-3 flex-wrap">
							<div class="flex items-center gap-2">
								<svg class="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6"/></svg>
								<div>
									<div class="text-sm font-semibold text-white">
										<a href="https://twitch.tv/{raid.fromBroadcasterUserLogin}" target="_blank" rel="noopener noreferrer" class="hover:text-rose-300 transition-colors">{raid.fromBroadcasterUserName}</a>
									</div>
									<div class="text-[10px] text-slate-500">{raid.viewers} viewers · {fmtRelative(raid.occurredAt)}</div>
								</div>
							</div>
							<div class="flex items-center gap-2">
								{#if !clips && !loading}
									<button type="button" onclick={() => loadRaiderClips(raid.fromBroadcasterUserId)}
										class="text-[11px] bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 px-3 py-1.5 rounded transition-colors">
										Voir ses clips
									</button>
								{:else if loading}
									<span class="text-[11px] text-slate-500">Chargement…</span>
								{/if}
								{#if clips && clips.length > 0 && clipsOverlays.length > 0}
									<button type="button" onclick={() => triggerClips({ broadcasterId: raid.fromBroadcasterUserId, count: 5 })} disabled={triggering}
										class="text-[11px] bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 px-3 py-1.5 rounded transition-colors">
										▶ Lancer dans overlay
									</button>
								{/if}
							</div>
						</div>
						{#if clips && clips.length > 0}
							<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-1">
								{#each clips as c (c.id)}
									<button type="button" onclick={() => playingClip = c}
										class="group text-left rounded border border-slate-700/60 bg-slate-900 overflow-hidden hover:border-rose-500/50 transition-colors">
										<div class="relative aspect-video">
											<img src={c.thumbnailUrl} alt={c.title} class="w-full h-full object-cover" loading="lazy"/>
											<div class="absolute bottom-1 left-1 px-1 py-0.5 rounded bg-black/70 text-[9px] text-white">{fmtNumber(c.viewCount)} vues</div>
											<div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/30 transition-opacity">
												<svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84a1 1 0 011.04.06l9 6a1 1 0 010 1.66l-9 6A1 1 0 016 16V4a1 1 0 01.3-.84z"/></svg>
											</div>
										</div>
										<div class="p-1.5 text-[10px] text-slate-300 line-clamp-2" title={c.title}>{c.title}</div>
									</button>
								{/each}
							</div>
						{:else if clips && clips.length === 0}
							<div class="text-[11px] text-slate-500 italic">Pas de clips trouvés pour ce raider (30 derniers jours).</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>

<!-- ── Player modal (iframe Twitch embed) ──────────────────────────────── -->
{#if playingClip}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[100] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
	     onclick={(e) => { if (e.target === e.currentTarget) playingClip = null }}>
		<div class="w-full max-w-4xl">
			<div class="flex items-center justify-between gap-3 mb-2">
				<div class="flex-1 min-w-0">
					<div class="text-sm font-semibold text-white truncate">{playingClip.title}</div>
					<div class="text-[11px] text-slate-400">par {playingClip.creatorName} · {fmtNumber(playingClip.viewCount)} vues · {fmtDuration(playingClip.duration)}</div>
				</div>
				<button type="button" onclick={() => playingClip = null}
					class="p-2 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition-colors" aria-label="Fermer">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
				</button>
			</div>
			<div class="aspect-video bg-black rounded-lg overflow-hidden">
				<iframe
					src="{playingClip.embedUrl}&parent={embedParent}&autoplay=true&muted=false"
					title={playingClip.title}
					class="w-full h-full"
					allowfullscreen
					allow="autoplay; fullscreen"
				></iframe>
			</div>
			<div class="text-[11px] text-slate-500 mt-2 text-right">
				<a href={playingClip.url} target="_blank" rel="noopener noreferrer" class="hover:text-indigo-300">Ouvrir sur Twitch ↗</a>
			</div>
		</div>
	</div>
{/if}
