<script lang="ts">
	import { onMount } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import AlertBoxConfigEditor    from './AlertBoxConfigEditor.svelte'
	import GoalBarConfigEditor     from './GoalBarConfigEditor.svelte'
	import EventTickerConfigEditor from './EventTickerConfigEditor.svelte'
	import LeaderboardConfigEditor from './LeaderboardConfigEditor.svelte'
	import StreamTimerConfigEditor from './StreamTimerConfigEditor.svelte'
	import PlaceInSceneModal       from './obs/PlaceInSceneModal.svelte'
	import { focusSceneAfterNav, consumeFocusedOverlayToken } from './obs/sceneNav'
	import { onDestroy }            from 'svelte'
	import type { ObsSceneSourceType } from '$lib/types/obsScenes'

	// Quels types d'overlay backend peuvent être placés dans une scène Nodyx.
	// playlist nécessite une playlistId qu'on ne peut pas demander ici sans le
	// contexte Soundboard, donc on le route via le tab Soundboard où le streamer
	// aura le bon picker.
	const SCENE_PLACEABLE: Partial<Record<string, ObsSceneSourceType>> = {
		alert_box:    'alert_box',
		event_ticker: 'ticker',
		soundboard:   'soundboard_osd',
		goal_bar:     'goal_bar',
		leaderboard:  'leaderboard',
		clips_player: 'clips_player',
		stream_timer: 'stream_timer',
	}

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	type OverlayType = 'alert_box' | 'goal_bar' | 'stream_timer' | 'event_ticker' | 'leaderboard' | 'clips_player' | 'soundboard' | 'playlist'

	type OverlayRow = {
		id:           string
		token:        string
		overlayType:  OverlayType
		label:        string | null
		config:       Record<string, unknown>
		createdAt:    string
		updatedAt:    string
		lastSeenAt:   string | null
	}

	// Pour le slice 1, seul alert_box est implémenté. Les autres types
	// sont créables mais leur page route n'existe pas encore (placeholder).
	const TYPE_META: Record<OverlayType, { label: string; desc: string; routeSlug: string; ready: boolean }> = {
		alert_box:    { label: 'Alert Box',    desc: 'Notifications follow/sub/raid/cheer qui slide à l\'écran.', routeSlug: 'alert',    ready: true  },
		goal_bar:     { label: 'Goal Bar',     desc: 'Barre de progression vers un objectif (followers totaux, subs/bits de la session, ou custom).',  routeSlug: 'goal',     ready: true  },
		stream_timer: { label: 'Stream Timer', desc: 'Chrono du stream en cours, 6 thèmes, 5 positions, 3 formats d\'affichage.', routeSlug: 'timer',    ready: true  },
		event_ticker: { label: 'Event Ticker', desc: 'Bandeau défilant des derniers events en bas d\'écran. Combo + event weight + 6 thèmes.', routeSlug: 'ticker',   ready: true  },
		leaderboard:  { label: 'Leaderboard',  desc: 'Podium top 3 + liste rang 4-N. 4 catégories (subs/bits/raids/chatteurs) × 4 périodes. Mode récap fin de stream.', routeSlug: 'board', ready: true },
		clips_player: { label: 'Clips Player', desc: 'Player full screen qui joue une session de clips (top chaine ou raider) déclenchée depuis Studio Live.', routeSlug: 'clips', ready: true },
		soundboard:   { label: 'Soundboard',   desc: 'Joue les sons déclenchés depuis ton Stream Deck. OSD discrète (vignette + titre + progress) en coin d\'écran. Crée plusieurs overlays si tu veux le son sur plusieurs scènes OBS.', routeSlug: 'soundboard', ready: true },
		playlist:     { label: 'Playlist',     desc: 'Lit une de tes playlists Soundboard en autoplay loop pour servir de musique d\'ambiance. URL par playlist via le tab Soundboard (icône 📺). Token partagé, paramètre ?id=… pour cibler la playlist.', routeSlug: 'playlist', ready: true },
	}

	let overlays    = $state<OverlayRow[]>([])
	let loading     = $state(true)
	let toast       = $state<{ text: string; ok: boolean } | null>(null)
	let configOpen  = $state<Set<string>>(new Set())   // ids overlays dont le panneau config est déplié

	// Modal "Placer dans une scène" : id overlay actif, null = fermé. On
	// expose token+label+type pour que la modal puisse créer la source.
	let placeOverlay = $state<OverlayRow | null>(null)
	const placeSceneType = $derived<ObsSceneSourceType | null>(
		placeOverlay ? SCENE_PLACEABLE[placeOverlay.overlayType] ?? null : null,
	)

	function toggleConfig(id: string): void {
		const next = new Set(configOpen)
		if (next.has(id)) next.delete(id); else next.add(id)
		configOpen = next
	}

	// Form create
	let formType:  OverlayType = $state('alert_box')
	let formLabel = $state('')
	let creating  = $state(false)

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	async function reload(): Promise<void> {
		// Loading est garanti à false en sortie, peu importe ce qui foire :
		// réseau coupé, token expiré, JSON invalide. Sans ce try/finally, un
		// throw silencieux laissait l'UI en "Chargement…" éternellement.
		try {
			const res = await apiFetch(fetch, '/streamer/overlays', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const data = await res.json() as { overlays: OverlayRow[] }
				overlays = data.overlays
			} else if (res.status === 401) {
				flash('Session expirée. Recharge la page.', false)
			} else {
				flash(`Chargement des overlays impossible (HTTP ${res.status}).`, false)
			}
		} catch (err) {
			console.warn('[overlay-manager] reload failed', err)
			flash('Erreur réseau au chargement des overlays.', false)
		} finally {
			loading = false
		}
	}

	// Si l'utilisateur arrive ici via "Modifier les couleurs / sons" depuis
	// le tab Scènes, on déplie le panneau config de l'overlay ciblé et on
	// scroll dessus. Token plutôt qu'id car c'est ce que la scène stocke.
	function focusOverlay(targetToken: string): void {
		const target = overlays.find(o => o.token === targetToken)
		if (!target) return
		const next = new Set(configOpen)
		next.add(target.id)
		configOpen = next
		setTimeout(() => {
			const el = document.getElementById(`overlay-row-${target.id}`)
			if (el && 'scrollIntoView' in el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
		}, 80)
	}

	function onFocusEvent(e: Event): void {
		const detail = (e as CustomEvent<{ token: string }>).detail
		if (detail?.token) focusOverlay(detail.token)
	}

	onMount(() => {
		void reload().then(() => {
			const t = consumeFocusedOverlayToken()
			if (t) focusOverlay(t)
		})
		window.addEventListener('nodyx:focus-overlay', onFocusEvent)
	})
	onDestroy(() => {
		window.removeEventListener('nodyx:focus-overlay', onFocusEvent)
	})

	async function create(): Promise<void> {
		if (creating) return
		creating = true
		try {
			const res = await apiFetch(fetch, '/streamer/overlays', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ overlayType: formType, label: formLabel.trim() || null }),
			})
			if (res.ok) {
				flash('Overlay créée. URL prête à coller dans OBS.', true)
				formLabel = ''
				await reload()
			} else {
				flash('Création échouée.', false)
			}
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			creating = false
		}
	}

	async function revoke(id: string): Promise<void> {
		if (!confirm('Révoquer cette overlay ? L\'URL ne fonctionnera plus dans OBS. Tu pourras en créer une nouvelle.')) return
		const res = await apiFetch(fetch, `/streamer/overlays/${id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			flash('Overlay révoquée.', true)
			await reload()
		} else flash('Révocation échouée.', false)
	}

	// Fallback safe pour un type d'overlay inconnu (ex : nouveau type ajouté
	// backend mais pas encore listé dans TYPE_META). Évite le crash render
	// global qui bloquait toute la liste à "Chargement…" jusqu'au refresh.
	const UNKNOWN_META = { label: 'Overlay', desc: 'Type inconnu côté admin.', routeSlug: 'unknown', ready: false }
	function metaFor(t: OverlayType | string): { label: string; desc: string; routeSlug: string; ready: boolean } {
		return (TYPE_META as Record<string, typeof UNKNOWN_META>)[t] ?? UNKNOWN_META
	}

	function urlFor(o: OverlayRow): string {
		const meta = metaFor(o.overlayType)
		// L'overlay tourne sur le frontend (route SvelteKit /overlay/...), donc
		// on prend l'origin du navigateur. En SSR (jamais ce composant), fallback
		// chaine vide pour ne pas crasher.
		const base = (browser ? window.location.origin : '').replace(/\/+$/, '')
		return `${base}/overlay/${meta.routeSlug}/${o.token}`
	}

	async function copyUrl(o: OverlayRow): Promise<void> {
		try {
			await navigator.clipboard.writeText(urlFor(o))
			flash('URL copiée. Colle-la dans OBS → Browser Source.', true)
		} catch {
			flash('Copie échouée, sélectionne manuellement l\'URL.', false)
		}
	}

	function fmtRelative(iso: string | null): string {
		if (!iso) return 'jamais connectée'
		const diff = Date.now() - new Date(iso).getTime()
		const m = Math.floor(diff / 60_000)
		if (m < 1)  return 'à l\'instant'
		if (m < 60) return `il y a ${m} min`
		const h = Math.floor(m / 60)
		if (h < 24) return `il y a ${h}h`
		const d = Math.floor(h / 24)
		return `il y a ${d}j`
	}
</script>

<section class="rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 via-slate-900/60 to-indigo-950/20 p-5 space-y-5">
	<header class="flex items-center justify-between gap-3 flex-wrap">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
			<h2 class="text-sm font-semibold text-white">Browser Sources OBS</h2>
		</div>
		<a href="https://obsproject.com/kb/browser-source" target="_blank" rel="noopener noreferrer"
			class="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1">
			Comment ajouter un Browser Source dans OBS
			<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
		</a>
	</header>

	{#if toast}
		<div class="rounded-lg border p-3 text-xs flex items-center gap-2 {toast.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Form: créer une nouvelle overlay -->
	<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-4 space-y-3">
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400">Nouvelle overlay</div>
		<div class="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2">
			<select bind:value={formType}
				class="rounded-lg bg-slate-900 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors">
				{#each Object.entries(TYPE_META) as [k, m] (k)}
					<option value={k} disabled={!m.ready}>
						{m.label}{m.ready ? '' : ' (Soon)'}
					</option>
				{/each}
			</select>
			<input type="text" bind:value={formLabel} maxlength="60"
				placeholder="Label optionnel (ex: Alert principale)"
				class="rounded-lg bg-slate-900 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors"/>
			<button type="button" onclick={create} disabled={creating || !TYPE_META[formType].ready}
				class="rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 disabled:cursor-not-allowed border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2 text-sm transition-colors">
				{creating ? 'Création…' : 'Créer'}
			</button>
		</div>
		<div class="text-[11px] text-slate-500">{TYPE_META[formType].desc}</div>
	</div>

	<!-- Liste des overlays -->
	<div class="space-y-2">
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400">Overlays actives ({overlays.length})</div>

		{#if loading}
			<div class="text-xs text-slate-500 text-center py-6">Chargement…</div>
		{:else if overlays.length === 0}
			<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-6 text-center text-xs text-slate-500">
				Aucune overlay créée. Lance ta première Alert Box ci-dessus, copie l'URL, colle-la dans OBS comme Browser Source en 1920×1080 transparent.
			</div>
		{:else}
			{#each overlays as o (o.id)}
				{@const meta = metaFor(o.overlayType)}
				{@const url  = urlFor(o)}
				<div id="overlay-row-{o.id}" class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-4 space-y-3 scroll-mt-4 transition-colors {configOpen.has(o.id) ? 'border-purple-500/50' : ''}">
					<div class="flex items-start justify-between gap-3 flex-wrap">
						<div class="flex items-center gap-2.5">
							<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
								{meta?.label ?? o.overlayType}
							</span>
							<div>
								<div class="text-sm font-semibold text-white">{o.label || 'Sans label'}</div>
								<div class="text-[10px] text-slate-500">
									Créée {fmtRelative(o.createdAt)} · Dernière connexion OBS : <span class={o.lastSeenAt ? 'text-emerald-400' : 'text-slate-600'}>{fmtRelative(o.lastSeenAt)}</span>
								</div>
							</div>
						</div>
						<div class="flex items-center gap-1.5 flex-wrap">
							{#if SCENE_PLACEABLE[o.overlayType]}
								<button type="button" onclick={() => placeOverlay = o}
									class="text-[11px] text-purple-200 hover:text-white border border-purple-500/40 hover:border-purple-500/70 bg-purple-500/15 hover:bg-purple-500/25 px-2.5 py-1 rounded transition-colors inline-flex items-center gap-1.5 font-medium">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<rect x="3" y="3" width="18" height="18" rx="2"/>
										<path d="M9 9h6v6H9z"/>
									</svg>
									Placer dans une scène
								</button>
							{/if}
							{#if o.overlayType === 'alert_box' || o.overlayType === 'goal_bar' || o.overlayType === 'event_ticker' || o.overlayType === 'leaderboard' || o.overlayType === 'stream_timer'}
								<button type="button" onclick={() => toggleConfig(o.id)}
									class="text-[11px] text-cyan-300 hover:text-cyan-200 border border-cyan-500/30 hover:border-cyan-500/50 px-2.5 py-1 rounded transition-colors inline-flex items-center gap-1">
									<svg class="w-3 h-3 transition-transform {configOpen.has(o.id) ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
									{configOpen.has(o.id) ? 'Fermer' : 'Configurer'}
								</button>
							{/if}
							<button type="button" onclick={() => revoke(o.id)}
								class="text-[11px] text-rose-300 hover:text-rose-200 border border-rose-500/30 hover:border-rose-500/50 px-2.5 py-1 rounded transition-colors">
								Révoquer
							</button>
						</div>
					</div>
					<div class="flex gap-2">
						<code class="flex-1 text-[11px] font-mono text-slate-300 bg-slate-900 border border-slate-700/60 rounded px-3 py-2 truncate" title={url}>{url}</code>
						<button type="button" onclick={() => copyUrl(o)}
							class="rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 px-3 py-2 text-xs font-medium transition-colors shrink-0 inline-flex items-center gap-1.5">
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
							Copier
						</button>
					</div>
					{#if o.overlayType === 'alert_box' && configOpen.has(o.id)}
						<AlertBoxConfigEditor token={token} overlayId={o.id} initial={o.config} onSaved={reload} />
					{:else if o.overlayType === 'goal_bar' && configOpen.has(o.id)}
						<GoalBarConfigEditor token={token} overlayId={o.id} initial={o.config} onSaved={reload} />
					{:else if o.overlayType === 'event_ticker' && configOpen.has(o.id)}
						<EventTickerConfigEditor token={token} overlayId={o.id} initial={o.config} onSaved={reload} />
					{:else if o.overlayType === 'leaderboard' && configOpen.has(o.id)}
						<LeaderboardConfigEditor token={token} overlayId={o.id} initial={o.config} onSaved={reload} />
					{:else if o.overlayType === 'stream_timer' && configOpen.has(o.id)}
						<StreamTimerConfigEditor token={token} overlayId={o.id} initial={o.config} onSaved={reload} />
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<!-- Quick-start OBS -->
	<details class="rounded-lg border border-slate-700/60 bg-slate-900/30 group">
		<summary class="px-4 py-2.5 text-xs font-medium text-slate-300 cursor-pointer hover:text-white">
			Comment intégrer dans OBS (3 étapes)
		</summary>
		<div class="px-4 pb-4 pt-1 text-xs text-slate-400 space-y-2 leading-relaxed">
			<p><strong class="text-slate-200">1.</strong> Dans OBS, dans Sources, clic droit → "Ajouter" → "Browser Source".</p>
			<p><strong class="text-slate-200">2.</strong> Colle l'URL de l'overlay. Largeur 1920, Hauteur 1080. Coche "Shutdown source when not visible" pour économiser la RAM.</p>
			<p><strong class="text-slate-200">3.</strong> Place la source au-dessus de ta scène. Le fond est transparent, seul le contenu des alertes apparait.</p>
		</div>
	</details>
</section>

{#if placeOverlay && placeSceneType}
	<PlaceInSceneModal
		{token}
		sourceType={placeSceneType}
		sourceLabel={placeOverlay.label?.trim() || metaFor(placeOverlay.overlayType).label}
		sourceConfig={{ overlayToken: placeOverlay.token }}
		onPlaced={(sceneId, _sceneName, _isNew) => {
			// On redirige systématiquement vers la scène ciblée. L'utilisateur
			// vient de faire un placement : la suite logique est de voir le
			// résultat et positionner. Le toast aurait été ignoré au profit
			// de la transition de tab.
			placeOverlay = null
			focusSceneAfterNav(sceneId)
		}}
		onClose={() => placeOverlay = null}
	/>
{/if}
