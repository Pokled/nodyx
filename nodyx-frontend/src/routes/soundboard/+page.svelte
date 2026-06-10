<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'

	// ─── Page publique Soundboard ────────────────────────────────────────────
	// Accessible sans auth. Affiche en temps réel ce que le streamer joue
	// (now playing depuis Redis) + sa bibliothèque publique. Plus tard, la
	// queue à venir (commande !next sound) viendra s'ajouter ici.
	//
	// Polling 2s côté client : suffisant pour de l'ambiance, robuste, sans
	// surface Socket.IO publique à exposer.

	interface Track {
		id:           string
		title:        string
		artist:       string | null
		album:        string | null
		durationMs:   number | null
		thumbnailUrl: string | null
		fileUrl:      string
		mimeType:     string
		volumeDefault: number
		loop:         boolean
		royaltyFree:  boolean | null
		tags:         string[]
	}

	interface NowPlaying {
		trackId:      string
		title:        string
		artist:       string | null
		thumbnailUrl: string | null
		durationMs:   number | null
		loop:         boolean
		startedAt:    number
	}

	interface Streamer {
		login:       string | null
		displayName: string | null
	}

	interface QueueEntry {
		trackId:      string
		title:        string
		artist:       string | null
		thumbnailUrl: string | null
		durationMs:   number | null
		addedBy:      string
		addedAt:      number
		source:       'web' | 'chat'
	}

	// Une playlist publique = méta + liste ordonnée des ids des tracks qu'elle
	// contient. Les détails de chaque track sont dans `tracks` (on évite de
	// dupliquer la payload côté API).
	interface PublicPlaylist {
		id:          string
		name:        string
		description: string | null
		color:       string | null
		trackCount:  number
		trackIds:    string[]
	}

	let streamer     = $state<Streamer | null>(null)
	let tracks       = $state<Track[]>([])
	let nowPlaying   = $state<NowPlaying | null>(null)
	let queue        = $state<QueueEntry[]>([])
	let queueEnabled = $state(true)
	let playlists    = $state<PublicPlaylist[]>([])
	let selectedPlaylistId = $state<string | null>(null)
	let loading      = $state(true)
	let pollTimer: ReturnType<typeof setInterval> | null = null

	// Feedback ajout queue : toast éphémère affiché en haut.
	let toast = $state<{ text: string; ok: boolean } | null>(null)
	let addingId = $state<string | null>(null)
	let toastTimer: ReturnType<typeof setTimeout> | null = null
	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (toastTimer) clearTimeout(toastTimer)
		toastTimer = setTimeout(() => { toast = null }, 3500)
	}

	const REASON_LABELS: Record<string, string> = {
		disabled:         'Les ajouts viewers sont désactivés par le streamer.',
		rate_limit:       'Attends 30 secondes avant ton prochain ajout.',
		cap_per_ip:       'Tu as déjà 3 sons en queue. Patiente qu\'ils passent.',
		queue_full:       'La queue est pleine, retente plus tard.',
		duplicate:        'Ce son est déjà dans la queue.',
		track_not_found:  'Ce son n\'existe plus.',
		track_not_public: 'Ce son n\'est pas (ou plus) public.',
		no_streamer:      'Aucun streamer connecté pour le moment.',
	}

	// Preview audio (un seul à la fois pour pas saturer l'oreille du viewer).
	let previewEl: HTMLAudioElement | null = null
	let previewingId = $state<string | null>(null)
	let query        = $state('')

	// Progress du now playing : recalculé toutes les 200ms côté client à partir
	// de startedAt (timestamp serveur). Pas de fetch supplémentaire.
	let nowProgressMs = $state(0)
	let progressTimer: ReturnType<typeof setInterval> | null = null

	function absoluteUrl(rel: string): string {
		if (!rel) return ''
		if (rel.startsWith('http')) return rel
		const base = PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '')
		return `${base}${rel}`
	}

	function fmtTime(ms: number | null): string {
		if (!ms || ms <= 0) return '—'
		const total = Math.max(0, Math.round(ms / 1000))
		const m = Math.floor(total / 60)
		const s = total % 60
		return `${m}:${s.toString().padStart(2, '0')}`
	}

	async function refresh(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/soundboard/public`)
			if (!res.ok) return
			const data = await res.json() as {
				ok: boolean
				streamer: Streamer | null
				tracks: Track[]
				nowPlaying: NowPlaying | null
				queue?: QueueEntry[]
				queueEnabled?: boolean
				playlists?: PublicPlaylist[]
			}
			streamer     = data.streamer
			tracks       = data.tracks ?? []
			nowPlaying   = data.nowPlaying ?? null
			queue        = data.queue ?? []
			queueEnabled = data.queueEnabled !== false
			playlists    = data.playlists ?? []
			// Si la playlist active vient d'être dépubliée/supprimée côté streamer,
			// on retombe gracieusement sur "Toutes".
			if (selectedPlaylistId && !playlists.some(p => p.id === selectedPlaylistId)) {
				selectedPlaylistId = null
			}
		} finally {
			loading = false
		}
	}

	// Ajoute un track à la queue côté serveur. Le polling rafraîchira la
	// section "À suivre" dans les 2 secondes suivantes.
	async function addToQueue(t: Track): Promise<void> {
		if (addingId) return
		addingId = t.id
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/soundboard/queue`, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ trackId: t.id }),
			})
			const data = await res.json().catch(() => ({})) as { ok?: boolean; reason?: string }
			if (data.ok) {
				flash(`"${t.title}" ajouté à la queue.`, true)
				void refresh()
			} else {
				flash(REASON_LABELS[data.reason ?? ''] ?? 'Ajout impossible.', false)
			}
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			addingId = null
		}
	}

	// Trackés en queue depuis CE navigateur (pas par IP — on s'aligne sur ce que
	// le viewer voit). Utilisé pour griser le bouton + Queue sur les sons déjà
	// en attente. Pas anti-cheat (le serveur vérifie aussi), juste UX.
	const queueTrackIds = $derived(new Set(queue.map(e => e.trackId)))

	function tickProgress(): void {
		if (!nowPlaying) { nowProgressMs = 0; return }
		nowProgressMs = Math.max(0, Date.now() - nowPlaying.startedAt)
	}

	function togglePreview(t: Track): void {
		if (previewingId === t.id) { stopPreview(); return }
		stopPreview()
		if (!browser) return
		previewEl = new Audio(absoluteUrl(t.fileUrl))
		previewEl.volume = Math.min(1, Math.max(0, t.volumeDefault))
		previewEl.onended = () => { previewingId = null }
		previewEl.onerror = () => { previewingId = null }
		previewEl.play().catch(() => { previewingId = null })
		previewingId = t.id
	}

	function stopPreview(): void {
		if (previewEl) { previewEl.pause(); previewEl.src = ''; previewEl = null }
		previewingId = null
	}

	// Sélection playlist (null = toutes les pistes). Si une playlist est active,
	// on borne la base aux trackIds de cette playlist en respectant leur ordre,
	// puis on applique la recherche par-dessus.
	const baseTracks = $derived.by(() => {
		if (!selectedPlaylistId) return tracks
		const pl = playlists.find(p => p.id === selectedPlaylistId)
		if (!pl) return tracks
		const map = new Map(tracks.map(t => [t.id, t]))
		return pl.trackIds.map(id => map.get(id)).filter((t): t is Track => !!t)
	})

	const filtered = $derived(query.trim()
		? baseTracks.filter(t => {
			const q = query.trim().toLowerCase()
			return t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q)
		})
		: baseTracks)

	const nowProgressPct = $derived(
		nowPlaying?.durationMs && nowPlaying.durationMs > 0
			? Math.min(100, (nowProgressMs / nowPlaying.durationMs) * 100)
			: 0
	)

	onMount(() => {
		refresh()
		pollTimer = setInterval(refresh, 2_000)
		progressTimer = setInterval(tickProgress, 200)
	})
	onDestroy(() => {
		if (pollTimer)     clearInterval(pollTimer)
		if (progressTimer) clearInterval(progressTimer)
		stopPreview()
	})
</script>

<svelte:head>
	<title>Soundboard{streamer?.displayName ? ` — ${streamer.displayName}` : ''}</title>
	<meta name="description" content="La bibliothèque audio en live, alimentée par le Stream Deck du créateur."/>
</svelte:head>

<div class="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-zinc-100">
	<div class="max-w-5xl mx-auto px-4 py-8 space-y-8">

		<!-- Toast feedback ajout queue -->
		{#if toast}
			<div class="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg border text-sm font-medium shadow-2xl backdrop-blur
				{toast.ok ? 'border-emerald-500/60 bg-emerald-950/85 text-emerald-100' : 'border-rose-500/60 bg-rose-950/85 text-rose-100'}">
				<span class="mr-1">{toast.ok ? '✓' : '✕'}</span>{toast.text}
			</div>
		{/if}

		<!-- Header -->
		<header class="flex items-start justify-between gap-4 flex-wrap">
			<div>
				<div class="text-[11px] uppercase tracking-widest font-medium text-purple-300/80">Soundboard public</div>
				<h1 class="text-2xl font-bold text-white mt-1">
					{streamer?.displayName ? `Les sons de ${streamer.displayName}` : 'Soundboard'}
				</h1>
				<p class="text-sm text-zinc-500 mt-1">Bibliothèque audio que le streamer met à dispo. Bientôt : demande des sons via <code class="text-purple-200 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm text-xs font-mono">!next sound &lt;nom&gt;</code> dans le chat Twitch.</p>
			</div>
			<a href="/" class="text-xs text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1.5 mt-1">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
				Retour
			</a>
		</header>

		<!-- Now playing -->
		<section>
			<div class="flex items-baseline gap-2 mb-2">
				<h2 class="text-xs uppercase tracking-widest font-medium text-zinc-400">En cours</h2>
				{#if nowPlaying}<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>{/if}
			</div>

			{#if nowPlaying}
				<div class="rounded-lg border border-purple-500/40 bg-gradient-to-br from-purple-950/40 via-zinc-900 to-indigo-950/30 p-4 shadow-xl ring-1 ring-purple-500/10">
					<div class="flex items-center gap-4">
						<div class="w-20 h-20 rounded bg-zinc-950 border border-zinc-800 overflow-hidden grid place-items-center shrink-0">
							{#if nowPlaying.thumbnailUrl}
								<img src={absoluteUrl(nowPlaying.thumbnailUrl)} alt="" class="w-full h-full object-cover"/>
							{:else}
								<svg class="w-8 h-8 text-purple-300/70" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
									<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
								</svg>
							{/if}
						</div>
						<div class="flex-1 min-w-0">
							<div class="text-lg font-semibold text-white truncate" title={nowPlaying.title}>{nowPlaying.title}</div>
							<div class="text-sm text-zinc-400 truncate">{nowPlaying.artist ?? '—'}</div>
							<div class="mt-2 flex items-center gap-2">
								<div class="flex-1 h-1.5 bg-zinc-950 rounded-sm overflow-hidden">
									<div class="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-[width] duration-200"
										style="width: {nowProgressPct}%;"></div>
								</div>
								<div class="text-[11px] font-mono text-zinc-500 whitespace-nowrap">
									{fmtTime(nowProgressMs)}{nowPlaying.durationMs ? ` / ${fmtTime(nowPlaying.durationMs)}` : ''}
								</div>
							</div>
							{#if nowPlaying.loop}
								<div class="mt-1 text-[10px] uppercase tracking-wide text-purple-300">↻ Loop</div>
							{/if}
						</div>
					</div>
				</div>
			{:else}
				<div class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-6 text-center text-sm text-zinc-500">
					Aucun son en cours. {streamer?.displayName ?? 'Le streamer'} reprend bientôt.
				</div>
			{/if}
		</section>

		<!-- Queue à venir -->
		<section>
			<div class="flex items-baseline gap-2 mb-2">
				<h2 class="text-xs uppercase tracking-widest font-medium text-zinc-400">À suivre</h2>
				{#if queue.length > 0}
					<span class="text-[10px] text-zinc-600">{queue.length} son{queue.length > 1 ? 's' : ''} en attente</span>
				{/if}
			</div>

			{#if queue.length === 0}
				<div class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/30 px-4 py-4 text-center text-xs text-zinc-500">
					{#if queueEnabled}
						Aucun son en queue. Clique <span class="text-purple-300">+ Queue</span> sur un son de la bibliothèque, ou tape <code class="text-purple-200 bg-zinc-950 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">!next sound &lt;nom&gt;</code> dans le chat Twitch.
					{:else}
						Les ajouts viewers sont désactivés par le streamer pour le moment.
					{/if}
				</div>
			{:else}
				<ol class="rounded-lg border border-zinc-800 bg-zinc-900/60 divide-y divide-zinc-800 overflow-hidden">
					{#each queue as e, i (e.trackId)}
						<li class="flex items-center gap-3 px-3 py-2">
							<span class="text-xs font-mono text-zinc-600 w-5 text-center shrink-0">{i + 1}</span>
							<div class="w-10 h-10 rounded bg-zinc-950 border border-zinc-800 overflow-hidden grid place-items-center shrink-0">
								{#if e.thumbnailUrl}
									<img src={absoluteUrl(e.thumbnailUrl)} alt="" class="w-full h-full object-cover" loading="lazy"/>
								{:else}
									<svg class="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
									</svg>
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<div class="text-sm text-zinc-100 truncate" title={e.title}>{e.title}</div>
								<div class="text-[11px] text-zinc-500 truncate">{e.artist ?? '—'}</div>
							</div>
							<div class="text-[10px] text-zinc-500 shrink-0 flex items-center gap-1.5">
								{#if e.source === 'chat'}
									<svg class="w-3 h-3 text-purple-300" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
								{:else}
									<svg class="w-3 h-3 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
								{/if}
								<span class="truncate max-w-[100px]">{e.addedBy}</span>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</section>

		<!-- Bibliothèque -->
		<section>
			<div class="flex items-baseline justify-between gap-3 flex-wrap mb-3">
				<h2 class="text-xs uppercase tracking-widest font-medium text-zinc-400">Bibliothèque</h2>
				<span class="text-[10px] text-zinc-600">{filtered.length} / {baseTracks.length} son{baseTracks.length > 1 ? 's' : ''}</span>
			</div>

			{#if loading}
				<div class="text-center text-sm text-zinc-500 py-8">Chargement…</div>
			{:else if tracks.length === 0}
				<div class="rounded-lg border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-10 text-center text-sm text-zinc-500 space-y-1">
					<div class="text-2xl mb-2">🎵</div>
					<div>{streamer?.displayName ?? 'Le streamer'} n'a pas encore mis de sons en public.</div>
					<div class="text-[11px] text-zinc-600">Si tu es l'admin, passe quelques pistes en <span class="font-mono text-zinc-400">visibility: public</span> depuis le tab Soundboard.</div>
				</div>
			{:else}
				<!-- Pills playlists : visible uniquement quand le streamer a au moins
				     une playlist publique. Sinon on garde l'UI plate d'avant. -->
				{#if playlists.length > 0}
					<div class="flex items-center gap-1.5 flex-wrap mb-3">
						<button type="button" onclick={() => selectedPlaylistId = null}
							class="text-xs px-2.5 py-1 rounded-full border transition-colors {selectedPlaylistId === null
								? 'bg-purple-500/20 border-purple-500/60 text-purple-100 font-medium'
								: 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'}">
							Tout
							<span class="ml-1 text-[10px] {selectedPlaylistId === null ? 'text-purple-300' : 'text-zinc-600'}">{tracks.length}</span>
						</button>
						{#each playlists as p (p.id)}
							{@const isOn = selectedPlaylistId === p.id}
							{@const accent = p.color ?? '#a78bfa'}
							<button type="button" onclick={() => selectedPlaylistId = p.id}
								class="text-xs inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-colors {isOn
									? 'border-purple-500/60 text-zinc-100 font-medium'
									: 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-100 hover:border-zinc-700'}"
								style={isOn ? `background: color-mix(in srgb, ${accent} 22%, transparent);` : ''}>
								<span class="w-2 h-2 rounded-full" style="background: {accent};"></span>
								<span class="truncate max-w-[120px]" title={p.name}>{p.name}</span>
								<span class="text-[10px] {isOn ? 'text-zinc-300' : 'text-zinc-600'}">{p.trackCount}</span>
							</button>
						{/each}
					</div>
				{/if}

				<div class="relative mb-4">
					<svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
						<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
					</svg>
					<input type="search" bind:value={query} placeholder="Chercher par titre ou artiste"
						class="w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 pl-10 pr-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none rounded-sm transition-colors"/>
				</div>

				<!-- Liste verticale full-width : un son par ligne, titre entier visible
				     (peut wrap sur 2 lignes pour les titres très longs). -->
				<ul class="rounded-lg border border-zinc-800 bg-zinc-900/40 divide-y divide-zinc-800 overflow-hidden">
					{#each filtered as t (t.id)}
						<li class="group flex items-center gap-3 sm:gap-4 px-3 py-3 hover:bg-purple-500/[0.04] transition-colors">
							<div class="relative w-12 h-12 sm:w-14 sm:h-14 rounded bg-zinc-950 border border-zinc-800 overflow-hidden grid place-items-center shrink-0">
								{#if t.thumbnailUrl}
									<img src={absoluteUrl(t.thumbnailUrl)} alt="" class="w-full h-full object-cover" loading="lazy"/>
								{:else}
									<svg class="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
									</svg>
								{/if}
								<!-- Overlay play/pause au hover -->
								<button type="button" onclick={() => togglePreview(t)}
									class="absolute inset-0 grid place-items-center bg-zinc-950/0 hover:bg-zinc-950/60 transition-colors"
									aria-label={previewingId === t.id ? 'Stop preview' : 'Preview'}>
									<span class="{previewingId === t.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity text-white">
										{#if previewingId === t.id}
											<svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><rect x="5" y="4" width="3" height="12"/><rect x="12" y="4" width="3" height="12"/></svg>
										{:else}
											<svg class="w-5 h-5 drop-shadow" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84a1 1 0 011.04.06l9 6a1 1 0 010 1.66l-9 6A1 1 0 016 16V4a1 1 0 01.3-.84z"/></svg>
										{/if}
									</span>
								</button>
							</div>

							<!-- Bloc texte : titre wrap sur 2 lignes max, plus tronqué façon
							     "...". Le titre entier est visible, c'est ça l'idée. -->
							<div class="flex-1 min-w-0">
								<div class="text-sm font-medium text-zinc-100 leading-snug break-words line-clamp-2" title={t.title}>{t.title}</div>
								<div class="text-xs text-zinc-500 truncate mt-0.5">{t.artist ?? '—'}</div>
								<div class="text-[10px] text-zinc-600 mt-1 flex items-center gap-2 flex-wrap">
									{#if t.durationMs}<span class="font-mono">{fmtTime(t.durationMs)}</span>{/if}
									{#if t.royaltyFree === true}<span class="text-emerald-400">libre de droits</span>{/if}
									{#if t.loop}<span class="text-purple-300">↻ loop</span>{/if}
								</div>
							</div>

							{#if queueEnabled}
								{@const isQueued = queueTrackIds.has(t.id)}
								<button type="button" onclick={() => addToQueue(t)} disabled={isQueued || addingId === t.id}
									class="shrink-0 text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border transition-colors
										{isQueued
											? 'bg-zinc-800/40 border-zinc-800 text-zinc-500 cursor-not-allowed'
											: 'bg-purple-500/15 hover:bg-purple-500/30 border-purple-500/40 hover:border-purple-500/70 text-purple-100'}"
									title={isQueued ? 'Déjà dans la queue' : 'Ajouter à la queue'}>
									{#if isQueued}
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
										<span class="hidden sm:inline">En queue</span>
									{:else if addingId === t.id}
										<svg class="w-3.5 h-3.5 animate-spin" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" stroke-dasharray="40" stroke-dashoffset="10"/></svg>
									{:else}
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
										<span class="hidden sm:inline">Queue</span>
									{/if}
								</button>
							{/if}
						</li>
					{/each}
					{#if filtered.length === 0}
						<li class="text-center text-sm text-zinc-500 py-6">Aucun résultat.</li>
					{/if}
				</ul>
			{/if}
		</section>

		<footer class="pt-6 border-t border-zinc-800/60 text-center text-[10px] text-zinc-600">
			Propulsé par <a href="https://nodyx.org" class="text-zinc-500 hover:text-purple-300 transition-colors">Nodyx</a> · Soundboard ouvert et public.
		</footer>
	</div>
</div>
