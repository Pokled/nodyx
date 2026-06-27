<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { SOURCE_TYPE_META, SOURCE_TYPE_ORDER, type ObsSceneSourceType } from '$lib/types/obsScenes'

	// ─── Modal "+ Source" ───────────────────────────────────────────────────
	// Flow en 2 étapes :
	//   1. Catégorie : choix du type (placeholder vidéo, overlay Nodyx, URL libre).
	//   2. Picker contextuel selon le type :
	//        • overlays Nodyx → liste des overlays existants du type + bouton
	//          "+ Créer un nouveau" qui POST /streamer/overlays et sélectionne
	//          le nouveau dans la foulée.
	//        • playlist → liste des playlists + auto-ensure du token overlay
	//          playlist (un seul par streamer, partagé entre toutes les playlists).
	//        • browser_source → saisie d'URL HTTPS.
	//        • placeholder_video → pas d'étape 2, on ajoute direct.
	//
	// Objectif : tout converge vers les overlays/playlists déjà créés dans le
	// hub. Pas de duplication, pas de re-saisie de tokens. La Phase B pourra
	// pousser à OBS exactement le bon token sans devoir demander quoi que ce
	// soit de plus à l'utilisateur.

	// Mapping ObsSceneSourceType → OverlayType backend (slug envoyé à l'API).
	// Pour les types qui mappent sur un overlay Nodyx token-gated.
	type BackendOverlayType =
		| 'alert_box' | 'event_ticker' | 'soundboard' | 'goal_bar'
		| 'leaderboard' | 'clips_player' | 'playlist' | 'stream_timer'

	const BACKEND_TYPE_FOR: Partial<Record<ObsSceneSourceType, BackendOverlayType>> = {
		alert_box:      'alert_box',
		ticker:         'event_ticker',
		soundboard_osd: 'soundboard',
		goal_bar:       'goal_bar',
		leaderboard:    'leaderboard',
		clips_player:   'clips_player',
		playlist:       'playlist',
		stream_timer:   'stream_timer',
	}

	interface Props {
		token:   string
		// Si fourni, on saute l'étape "choisir une catégorie" et on démarre
		// directement sur le picker du type donné. Utilisé pour "Changer
		// l'overlay/playlist" depuis le panneau Propriétés d'une source
		// existante : le streamer ne veut pas re-choisir le type, juste
		// l'overlay/playlist cible.
		initialType?: ObsSceneSourceType
		// Texte du header. Par défaut "Ajouter une source". En mode swap, le
		// parent passe "Changer l'overlay" ou similaire pour ne pas induire
		// en erreur.
		title?:   string
		onPick:  (type: ObsSceneSourceType, config: Record<string, unknown>, label: string) => void
		onClose: () => void
	}
	let { token, initialType, title, onPick, onClose }: Props = $props()

	type Step = 'category' | 'overlay-picker' | 'playlist-picker' | 'browser-url'
	// Si initialType est fourni, on saute la catégorie. browser_source et
	// placeholder_video sautent directement à leur étape dédiée.
	const initialStep: Step =
		!initialType                              ? 'category'
		: initialType === 'browser_source'        ? 'browser-url'
		: initialType === 'playlist'              ? 'playlist-picker'
		: initialType === 'placeholder_video'     ? 'category'   // placeholder n'a pas d'étape 2
		: 'overlay-picker'
	let step = $state<Step>(initialStep)
	let pickedType = $state<ObsSceneSourceType | null>(initialType ?? null)

	// Auto-load la liste si on a démarré direct sur une étape 2.
	$effect(() => {
		if (!initialType) return
		if (initialType === 'playlist') void loadPlaylistsAndToken()
		else if (initialType !== 'browser_source' && initialType !== 'placeholder_video') {
			void loadOverlaysFor(initialType)
		}
	})

	// Picker overlay : état + liste + création inline.
	interface OverlayRow {
		id:          string
		token:       string
		overlayType: BackendOverlayType
		label:       string | null
	}
	let overlays = $state<OverlayRow[]>([])
	let overlaysLoading = $state(false)
	let createOpen   = $state(false)
	let createLabel  = $state('')
	let createBusy   = $state(false)
	let createError  = $state<string | null>(null)

	// Picker playlist.
	interface PlaylistRow { id: string; name: string; color: string | null; trackCount: number }
	let playlists = $state<PlaylistRow[]>([])
	let playlistOverlayToken = $state<string | null>(null)
	let playlistLoading = $state(false)

	// Browser URL.
	let urlInput = $state('')

	function pickCategory(type: ObsSceneSourceType): void {
		pickedType = type
		if (type === 'placeholder_video') {
			// Ajouté direct, le streamer le configure côté Propriétés.
			onPick(type, { kind: 'webcam' }, SOURCE_TYPE_META[type].label)
			return
		}
		if (type === 'browser_source') {
			step = 'browser-url'
			return
		}
		if (type === 'playlist') {
			step = 'playlist-picker'
			void loadPlaylistsAndToken()
			return
		}
		// Autres types mappent sur un overlay Nodyx → picker
		step = 'overlay-picker'
		void loadOverlaysFor(type)
	}

	async function loadOverlaysFor(type: ObsSceneSourceType): Promise<void> {
		const backendType = BACKEND_TYPE_FOR[type]
		if (!backendType) return
		overlaysLoading = true
		try {
			const res = await apiFetch(fetch, '/streamer/overlays', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const d = await res.json() as { overlays: OverlayRow[] }
				overlays = (d.overlays ?? []).filter(o => o.overlayType === backendType)
			}
		} finally {
			overlaysLoading = false
		}
	}

	async function loadPlaylistsAndToken(): Promise<void> {
		playlistLoading = true
		try {
			// Liste des playlists.
			const r1 = await apiFetch(fetch, '/streamer/audio-library/playlists', { headers: { Authorization: `Bearer ${token}` } })
			if (r1.ok) {
				const d = await r1.json() as { playlists: PlaylistRow[] }
				playlists = d.playlists ?? []
			}
			// Token overlay playlist : ensure (créé si pas encore).
			const r2 = await apiFetch(fetch, '/streamer/audio-library/playlists/overlay-token', {
				method:  'POST',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (r2.ok) {
				const d = await r2.json() as { token: string }
				playlistOverlayToken = d.token
			}
		} finally {
			playlistLoading = false
		}
	}

	async function createOverlay(): Promise<void> {
		if (!pickedType || createBusy) return
		const backendType = BACKEND_TYPE_FOR[pickedType]
		if (!backendType) return
		createBusy = true
		createError = null
		try {
			const res = await apiFetch(fetch, '/streamer/overlays', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({
					overlayType: backendType,
					label:       createLabel.trim() || null,
				}),
			})
			if (res.ok) {
				const d = await res.json() as { overlay: OverlayRow }
				overlays = [d.overlay, ...overlays]
				// Sélection automatique du nouveau pour ne pas obliger un 2e clic.
				pickOverlay(d.overlay)
			} else {
				createError = `Création impossible (HTTP ${res.status}).`
			}
		} catch {
			createError = 'Erreur réseau.'
		} finally {
			createBusy = false
		}
	}

	function pickOverlay(o: OverlayRow): void {
		if (!pickedType) return
		const m = SOURCE_TYPE_META[pickedType]
		onPick(pickedType, { overlayToken: o.token }, o.label?.trim() || m.label)
	}

	function pickPlaylist(p: PlaylistRow): void {
		if (!playlistOverlayToken) return
		onPick('playlist', {
			overlayToken: playlistOverlayToken,
			playlistId:   p.id,
		}, p.name)
	}

	function confirmBrowserUrl(): void {
		const url = urlInput.trim()
		if (!/^https?:\/\//i.test(url)) {
			urlInput = ''
			return
		}
		// Le label par défaut = host de l'URL pour aider à s'y retrouver.
		let host = 'Browser Source'
		try { host = new URL(url).host } catch { /* keep fallback */ }
		onPick('browser_source', { url }, host)
	}

	function back(): void {
		// En mode swap (initialType fourni), il n'y a pas d'étape précédente :
		// on ferme directement plutôt que de proposer un retour au catalogue
		// qui n'aurait pas de sens.
		if (initialType) { onClose(); return }
		step = 'category'
		pickedType = null
		createOpen = false
		createLabel = ''
		createError = null
		urlInput = ''
	}
</script>

<div class="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose() }}
	role="dialog" aria-modal="true" tabindex="-1">
	<div class="w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="document">
		<header class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
			<div class="min-w-0">
				<div class="text-xs uppercase tracking-widest font-semibold text-purple-300/80">{title ?? 'Ajouter une source'}</div>
				<h3 class="text-base font-semibold text-zinc-100 mt-0.5 truncate">
					{#if step === 'category'}Choisis un type
					{:else if pickedType}{SOURCE_TYPE_META[pickedType].icon} {SOURCE_TYPE_META[pickedType].label}
					{/if}
				</h3>
			</div>
			<button type="button" onclick={onClose} class="text-zinc-500 hover:text-zinc-200 w-7 h-7 grid place-items-center shrink-0" title="Fermer">✕</button>
		</header>

		{#if step !== 'category' && !initialType}
			<div class="px-4 pt-2">
				<button type="button" onclick={back} class="text-xs text-zinc-500 hover:text-zinc-200 inline-flex items-center gap-1">
					<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
						<polyline points="15 18 9 12 15 6"/>
					</svg>
					Retour au catalogue
				</button>
			</div>
		{/if}

		<!-- ── Étape 1 : catalogue catégories ──────────────────────────── -->
		{#if step === 'category'}
			<div class="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
				{#each SOURCE_TYPE_ORDER as type (type)}
					{@const m = SOURCE_TYPE_META[type]}
					<button type="button" onclick={() => pickCategory(type)}
						class="text-left flex items-start gap-3 p-3 rounded-md bg-zinc-900/60 border border-zinc-800 hover:bg-zinc-800/60 transition-colors group"
						style="border-left: 3px solid #{m.accent};">
						<span class="text-2xl leading-none mt-0.5">{m.icon}</span>
						<div class="min-w-0 flex-1">
							<div class="text-sm font-medium text-zinc-100">{m.label}</div>
							<div class="text-[11px] text-zinc-500 mt-0.5 leading-snug">{m.description}</div>
						</div>
					</button>
				{/each}
			</div>
			<footer class="px-4 py-2.5 border-t border-zinc-800 text-[11px] text-zinc-600 leading-snug">
				La taille initiale est centrée sur le canvas. Tu pourras la repositionner / redimensionner après ajout.
			</footer>

		<!-- ── Étape 2A : picker overlay Nodyx ─────────────────────────── -->
		{:else if step === 'overlay-picker' && pickedType}
			<div class="p-4 space-y-3">
				{#if overlaysLoading}
					<div class="text-center text-xs text-zinc-500 py-6">Chargement…</div>
				{:else if overlays.length === 0 && !createOpen}
					<div class="rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-5 text-center text-xs text-zinc-500 leading-snug">
						Aucun overlay <span class="text-zinc-300">{SOURCE_TYPE_META[pickedType].label}</span> n'existe encore.<br/>
						Crée-en un ci-dessous, il s'ajoutera à ta liste d'overlays.
					</div>
				{:else}
					<div class="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">Choisir un overlay existant</div>
					<ul class="space-y-1.5 max-h-72 overflow-y-auto">
						{#each overlays as o (o.id)}
							<li>
								<button type="button" onclick={() => pickOverlay(o)}
									class="w-full text-left flex items-center gap-3 p-2.5 rounded-md bg-zinc-900/60 border border-zinc-800 hover:border-purple-500/60 hover:bg-purple-500/5 transition-colors">
									<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background: #{SOURCE_TYPE_META[pickedType].accent};"></span>
									<div class="min-w-0 flex-1">
										<div class="text-sm text-zinc-100 truncate">{o.label?.trim() || SOURCE_TYPE_META[pickedType].label}</div>
										<div class="text-[10px] text-zinc-600 font-mono truncate" title={o.token}>token : {o.token.slice(0, 12)}…</div>
									</div>
									<svg class="w-3.5 h-3.5 text-zinc-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
								</button>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Création inline d'un nouvel overlay du même type -->
				<div class="border-t border-zinc-800 pt-3">
					{#if !createOpen}
						<button type="button" onclick={() => { createOpen = true; createLabel = '' }}
							class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 hover:border-purple-500/70 text-purple-100 rounded-md transition-colors">
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
							Créer un nouvel overlay {SOURCE_TYPE_META[pickedType].label}
						</button>
					{:else}
						<div class="space-y-2">
							<label class="block">
								<span class="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">Label (optionnel)</span>
								<input type="text" bind:value={createLabel} maxlength="60"
									placeholder="ex : Alert principale"
									onkeydown={(e) => { if (e.key === 'Enter') createOverlay() }}
									class="mt-1 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 px-3 py-1.5 text-xs text-zinc-100 outline-none rounded-sm"
									autofocus/>
							</label>
							{#if createError}
								<div class="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-sm px-2 py-1.5">{createError}</div>
							{/if}
							<div class="flex items-center gap-2">
								<button type="button" onclick={createOverlay} disabled={createBusy}
									class="flex-1 text-xs font-medium bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-3 py-1.5 rounded-sm transition-colors">
									{createBusy ? 'Création…' : 'Créer et ajouter'}
								</button>
								<button type="button" onclick={() => { createOpen = false; createError = null }}
									class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-sm">
									Annuler
								</button>
							</div>
						</div>
					{/if}
				</div>
			</div>

		<!-- ── Étape 2B : picker playlist ──────────────────────────────── -->
		{:else if step === 'playlist-picker'}
			<div class="p-4 space-y-3">
				{#if playlistLoading}
					<div class="text-center text-xs text-zinc-500 py-6">Chargement…</div>
				{:else if playlists.length === 0}
					<div class="rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-5 text-center text-xs text-zinc-500 leading-snug">
						Aucune playlist. Crée-en une depuis le tab <span class="text-zinc-300">Soundboard</span>, elle apparaîtra ici.
					</div>
				{:else}
					<div class="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">Choisir une playlist</div>
					<ul class="space-y-1.5 max-h-72 overflow-y-auto">
						{#each playlists as p (p.id)}
							<li>
								<button type="button" onclick={() => pickPlaylist(p)} disabled={!playlistOverlayToken}
									class="w-full text-left flex items-center gap-3 p-2.5 rounded-md bg-zinc-900/60 border border-zinc-800 hover:border-purple-500/60 hover:bg-purple-500/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
									<span class="w-2 h-2 rounded-full shrink-0" style="background: {p.color ?? 'var(--nx-accent-2-soft)'};"></span>
									<div class="min-w-0 flex-1">
										<div class="text-sm text-zinc-100 truncate">{p.name}</div>
										<div class="text-[10px] text-zinc-600 font-mono">{p.trackCount} piste{p.trackCount > 1 ? 's' : ''}</div>
									</div>
									<svg class="w-3.5 h-3.5 text-zinc-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
								</button>
							</li>
						{/each}
					</ul>
					<div class="text-[10px] text-zinc-600 leading-snug pt-1">
						Le token overlay playlist est partagé entre toutes tes playlists. Tu peux l'éditer depuis le tab <span class="text-zinc-300">Overlays OBS</span> si besoin.
					</div>
				{/if}
			</div>

		<!-- ── Étape 2C : Browser Source URL libre ─────────────────────── -->
		{:else if step === 'browser-url'}
			<div class="p-5 space-y-3">
				<div>
					<div class="flex items-center gap-2 mb-2">
						<span class="text-xl leading-none">🌐</span>
						<div>
							<div class="text-sm font-medium text-zinc-100">Browser Source</div>
							<div class="text-[11px] text-zinc-500">N'importe quelle URL HTTPS (widget externe).</div>
						</div>
					</div>
					<label class="block">
						<span class="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">URL</span>
						<input type="url" bind:value={urlInput}
							placeholder="https://..."
							onkeydown={(e) => { if (e.key === 'Enter') confirmBrowserUrl() }}
							class="mt-1 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none rounded-sm font-mono"
							autofocus/>
					</label>
				</div>
				<div class="flex items-center justify-end gap-2">
					<button type="button" onclick={onClose}
						class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-sm">
						Annuler
					</button>
					<button type="button" onclick={confirmBrowserUrl} disabled={!/^https?:\/\//i.test(urlInput.trim())}
						class="text-xs bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-4 py-1.5 rounded-sm font-medium">
						Ajouter
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>
