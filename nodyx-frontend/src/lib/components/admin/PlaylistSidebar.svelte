<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import SendToDeckModal from './SendToDeckModal.svelte'
	import PlaceInSceneModal from './obs/PlaceInSceneModal.svelte'
	import { focusSceneAfterNav } from './obs/sceneNav'
	import type { DeckButton } from '$lib/types/deck'

	// Sidebar de gauche du tab Soundboard : liste les playlists du streamer,
	// permet d'en créer/renommer/supprimer/réordonner et émet la sélection
	// vers le parent pour filtrer la bibliothèque affichée à droite.
	//
	// "Toutes les pistes" = pseudo-playlist en haut, selectedId === null.

	export type PlaylistVisibility = 'private' | 'public'

	export interface Playlist {
		id:          string
		ownerUserId: string
		name:        string
		description: string | null
		color:       string | null
		visibility:  PlaylistVisibility
		position:    number
		trackCount:  number
		createdAt:   string
		updatedAt:   string
	}

	interface Props {
		token:               string
		playlists:           Playlist[]
		selectedPlaylistId:  string | null
		onSelectPlaylist:    (id: string | null) => void
		onPlaylistsChanged:  () => void
	}

	let {
		token,
		playlists,
		selectedPlaylistId,
		onSelectPlaylist,
		onPlaylistsChanged,
	}: Props = $props()

	let creating = $state(false)
	let newName  = $state('')
	let busy     = $state(false)
	let editingId = $state<string | null>(null)
	let editName  = $state('')
	let editColor = $state('')
	let editVisibility = $state<PlaylistVisibility>('private')

	let toast = $state<{ text: string; ok: boolean } | null>(null)
	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3000)
	}

	// Token d'overlay "playlist" du streamer, lazy-loaded au premier appel à
	// copyOverlayUrl. Un seul token par streamer, partagé entre toutes ses
	// playlists. L'URL OBS prend la playlist en query (?id=).
	let overlayToken = $state<string | null>(null)

	// Modal "Placer dans une scène" pour une playlist donnée. On charge le
	// token overlay playlist (ensure) avant d'ouvrir le modal pour avoir une
	// config valide à passer.
	let placePlaylist = $state<Playlist | null>(null)
	let placeOverlayToken = $state<string | null>(null)

	async function openPlaceInScene(p: Playlist): Promise<void> {
		const t = await ensureOverlayToken()
		if (!t) { flash('Impossible de récupérer le token overlay.', false); return }
		placeOverlayToken = t
		placePlaylist = p
	}

	async function ensureOverlayToken(): Promise<string | null> {
		if (overlayToken) return overlayToken
		// Pas de Content-Type ici : Fastify rejette tout POST déclarant
		// application/json sans body (FST_ERR_CTP_EMPTY_JSON_BODY). On envoie
		// la requête nue, le backend n'attend rien dans le body.
		const res = await apiFetch(fetch, '/streamer/audio-library/playlists/overlay-token', {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return null
		const d = await res.json() as { token: string }
		overlayToken = d.token
		return overlayToken
	}

	// SendToDeckModal : ouvert avec un buttonTemplate déjà prêt selon ce que
	// l'admin a choisi. null = fermé.
	let deckModalTemplate = $state<Omit<DeckButton, 'id' | 'x' | 'y' | 'w' | 'h'> | null>(null)
	let deckModalTitle    = $state('')
	let deckModalSubtitle = $state('')

	function openDeckModalStartPlaylist(p: Playlist): void {
		// Bouton "Démarrer la playlist X" : couleur dérivée de la playlist
		// pour qu'on retrouve visuellement le bouton dans le deck.
		const accent = (p.color ?? '#a78bfa').replace('#', '').toLowerCase()
		deckModalTemplate = {
			label:     p.name.slice(0, 40),
			icon:      '🎵',
			iconScale: 1,
			gradient:  `${accent}/8b5cf6`,
			action:    { type: 'playlist_control', cmd: 'play', playlistId: p.id },
		}
		deckModalTitle    = 'Ajouter au Stream Deck'
		deckModalSubtitle = `▶ Démarrer "${p.name}"`
	}

	function openDeckModalGlobal(cmd: 'toggle' | 'skip' | 'prev' | 'stop', label: string, icon: string): void {
		deckModalTemplate = {
			label,
			icon,
			iconScale: 1.4,
			gradient:  'minimal',
			action:    { type: 'playlist_control', cmd },
		}
		deckModalTitle    = 'Ajouter au Stream Deck'
		deckModalSubtitle = label
	}

	async function copyOverlayUrl(p: Playlist): Promise<void> {
		if (!browser) return
		const t = await ensureOverlayToken()
		if (!t) { flash('Impossible de générer le lien.', false); return }
		const url = `${window.location.origin}/overlay/playlist/${t}?id=${p.id}`
		try {
			await navigator.clipboard.writeText(url)
			flash(`Lien overlay "${p.name}" copié.`, true)
		} catch {
			// Fallback : on affiche le lien dans une prompt pour permettre la copie manuelle.
			window.prompt('Copie ce lien dans OBS Browser Source :', url)
		}
	}

	async function createOne(): Promise<void> {
		const name = newName.trim()
		if (!name || busy) return
		busy = true
		try {
			const res = await apiFetch(fetch, '/streamer/audio-library/playlists', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ name }),
			})
			if (res.ok) {
				newName = ''
				creating = false
				onPlaylistsChanged()
			} else if (res.status === 409) {
				flash('Une playlist avec ce nom existe déjà.', false)
			} else {
				flash('Création échouée.', false)
			}
		} finally {
			busy = false
		}
	}

	function startEdit(p: Playlist): void {
		editingId = p.id
		editName = p.name
		editColor = p.color ?? ''
		editVisibility = p.visibility
	}

	function cancelEdit(): void { editingId = null }

	async function saveEdit(): Promise<void> {
		if (!editingId || busy) return
		busy = true
		try {
			const body: Record<string, unknown> = {
				name:       editName.trim(),
				color:      editColor.trim() || null,
				visibility: editVisibility,
			}
			const res = await apiFetch(fetch, `/streamer/audio-library/playlists/${editingId}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify(body),
			})
			if (res.ok) {
				editingId = null
				onPlaylistsChanged()
			} else if (res.status === 409) {
				flash('Ce nom est déjà pris par une autre playlist.', false)
			} else {
				flash('Mise à jour échouée.', false)
			}
		} finally {
			busy = false
		}
	}

	async function deleteOne(p: Playlist): Promise<void> {
		const msg = p.trackCount > 0
			? `Supprimer la playlist "${p.name}" ? Les ${p.trackCount} sons restent dans ta bibliothèque, ils sont juste retirés de cette playlist.`
			: `Supprimer la playlist "${p.name}" ?`
		if (!confirm(msg)) return
		busy = true
		try {
			const res = await apiFetch(fetch, `/streamer/audio-library/playlists/${p.id}`, {
				method:  'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				if (selectedPlaylistId === p.id) onSelectPlaylist(null)
				onPlaylistsChanged()
			} else {
				flash('Suppression échouée.', false)
			}
		} finally {
			busy = false
		}
	}
</script>

<aside class="border border-zinc-800 bg-zinc-900 flex flex-col min-h-[400px]">
	<header class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-2">
		<h3 class="text-xs uppercase tracking-wide font-medium text-zinc-400">Playlists</h3>
		{#if !creating}
			<button type="button" onclick={() => { creating = true; newName = '' }}
				class="text-xs inline-flex items-center gap-1 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 hover:border-purple-500/70 text-purple-100 px-2 py-1 rounded-sm transition-colors font-medium"
				title="Créer une playlist">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
				Nouvelle
			</button>
		{/if}
	</header>

	{#if toast}
		<div class="mx-2 my-1.5 border-l-2 px-2 py-1.5 text-[11px] flex items-center gap-2 {toast.ok ? 'border-emerald-500 bg-emerald-500/5 text-emerald-200' : 'border-rose-500 bg-rose-500/5 text-rose-200'}">
			{toast.text}
		</div>
	{/if}

	{#if creating}
		<div class="px-2 py-2 border-b border-zinc-800 bg-zinc-950/50 flex items-center gap-1.5">
			<input type="text" bind:value={newName} maxlength="100" placeholder="Nom (ex: Intro, Dev, Chill...)"
				onkeydown={(e) => { if (e.key === 'Enter') createOne(); if (e.key === 'Escape') creating = false }}
				class="flex-1 bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-2 py-1 text-xs text-zinc-100 placeholder-zinc-600 outline-none rounded-sm transition-colors"
				autofocus/>
			<button type="button" onclick={createOne} disabled={busy || !newName.trim()}
				class="text-xs bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-2 py-1 rounded-sm transition-colors font-medium">
				Créer
			</button>
			<button type="button" onclick={() => creating = false}
				class="text-xs text-zinc-500 hover:text-zinc-300 px-1 transition-colors" title="Annuler">✕</button>
		</div>
	{/if}

	<ul class="flex-1 overflow-y-auto py-1">
		<!-- Toutes les pistes : sélection par défaut, pas un vrai item DB -->
		<li class="relative">
			<button type="button" onclick={() => onSelectPlaylist(null)}
				class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left
					{selectedPlaylistId === null ? 'bg-purple-500/15 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}">
				{#if selectedPlaylistId === null}
					<span class="absolute left-0 w-0.5 h-6 bg-purple-500"></span>
				{/if}
				<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
					<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
				</svg>
				<span class="flex-1 truncate">Toutes les pistes</span>
			</button>
		</li>

		{#each playlists as p (p.id)}
			{@const isSelected = selectedPlaylistId === p.id}
			{@const accent = p.color ?? 'var(--nx-accent-2-soft)'}
			<li class="group relative">
				{#if editingId === p.id}
					<div class="px-2 py-2 bg-zinc-950/60 flex flex-col gap-1.5">
						<input type="text" bind:value={editName} maxlength="100"
							class="bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 px-2 py-1 text-xs text-zinc-100 outline-none rounded-sm"/>
						<div class="flex items-center gap-1.5">
							<label class="cursor-pointer relative shrink-0" title="Couleur d'accent">
								<span class="block w-5 h-5 rounded-full ring-1 ring-white/20"
									style="background: {editColor || 'var(--nx-accent-2-soft)'};"></span>
								<input type="color" value={editColor || 'var(--nx-accent-2-soft)'}
									oninput={(e) => editColor = e.currentTarget.value}
									class="absolute inset-0 opacity-0 cursor-pointer w-full h-full"/>
							</label>
							<select bind:value={editVisibility}
								class="flex-1 bg-zinc-900 border border-zinc-800 px-1.5 py-1 text-[11px] text-zinc-100 outline-none rounded-sm">
								<option value="private">Privée</option>
								<option value="public">Publique</option>
							</select>
						</div>
						<div class="flex items-center gap-1.5">
							<button type="button" onclick={saveEdit} disabled={busy}
								class="flex-1 text-[11px] bg-purple-500 hover:bg-purple-400 disabled:opacity-50 text-white px-2 py-1 rounded-sm transition-colors font-medium">
								OK
							</button>
							<button type="button" onclick={cancelEdit}
								class="text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2 py-1 rounded-sm transition-colors">
								Annuler
							</button>
						</div>
					</div>
				{:else}
					<button type="button" onclick={() => onSelectPlaylist(p.id)}
						class="w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors text-left
							{isSelected ? 'bg-purple-500/15 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}">
						{#if isSelected}
							<span class="absolute left-0 w-0.5 h-6 bg-purple-500"></span>
						{/if}
						<span class="w-2 h-2 rounded-full shrink-0 ring-1 ring-white/10" style="background: {accent};"></span>
						<span class="flex-1 truncate" title={p.name}>{p.name}</span>
						<span class="text-[10px] text-zinc-600 font-mono">{p.trackCount}</span>
						{#if p.visibility === 'public'}
							<span class="text-[9px] uppercase tracking-wider font-bold text-purple-300 bg-purple-500/15 px-1 rounded-sm" title="Visible sur la page publique">pub</span>
						{/if}
					</button>
					<!-- Boutons d'action en hover. Le bouton OBS est mis en avant
					     visuellement parce que c'est la feature la plus utile pour
					     un streamer : un clic = URL prête-à-coller. -->
					<div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/95 backdrop-blur-sm pl-1.5">
						<button type="button" onclick={() => copyOverlayUrl(p)}
							class="p-1 rounded text-purple-300 hover:text-purple-100 hover:bg-purple-500/20"
							title="Copier le lien overlay OBS de cette playlist">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
								<rect x="2" y="6" width="20" height="12" rx="2"/>
								<polyline points="10 10 14 12 10 14 10 10" fill="currentColor"/>
							</svg>
						</button>
						<button type="button" onclick={() => openPlaceInScene(p)}
							class="p-1 rounded text-sky-300 hover:text-sky-100 hover:bg-sky-500/20"
							title="Placer cette playlist dans une scène">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
								<rect x="3" y="3" width="18" height="18" rx="2"/>
								<path d="M9 9h6v6H9z"/>
							</svg>
						</button>
						<button type="button" onclick={() => openDeckModalStartPlaylist(p)}
							class="p-1 rounded text-emerald-300 hover:text-emerald-100 hover:bg-emerald-500/20"
							title="Créer un bouton Stream Deck qui démarre cette playlist">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
								<rect x="3" y="4" width="18" height="14" rx="2"/>
								<polygon points="10 9 16 12 10 15 10 9" fill="currentColor"/>
							</svg>
						</button>
						<button type="button" onclick={() => startEdit(p)}
							class="p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/60" title="Éditer">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
						</button>
						<button type="button" onclick={() => deleteOne(p)}
							class="p-1 rounded text-zinc-500 hover:text-rose-300 hover:bg-rose-900/40" title="Supprimer">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
						</button>
					</div>
				{/if}
			</li>
		{/each}

		{#if playlists.length === 0 && !creating}
			<li class="px-3 py-4 text-[11px] text-zinc-500 text-center leading-snug">
				Aucune playlist. Crée-en pour organiser tes sons par contexte (Intro, Dev, Chill...).
			</li>
		{/if}
	</ul>

	{#if playlists.length > 0}
		<footer class="border-t border-zinc-800 px-2 py-2 space-y-1.5">
			<!-- Hint découvrabilité des actions hover. -->
			<div class="text-[10px] text-zinc-600 leading-snug flex items-start gap-1.5 px-1">
				<svg class="w-3 h-3 mt-0.5 shrink-0 text-purple-400/70" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
					<rect x="2" y="6" width="20" height="12" rx="2"/>
					<polyline points="10 10 14 12 10 14 10 10" fill="currentColor"/>
				</svg>
				<span>Survole une playlist : <span class="text-purple-300">📺</span> URL OBS, <span class="text-sky-300">🎬</span> Placer en scène, <span class="text-emerald-300">▶</span> Bouton Deck.</span>
			</div>

			<!-- Boutons "globaux" : pilotent l'overlay courant peu importe la
			     playlist active. À ajouter au Deck une fois pour toutes. -->
			<div class="px-1 pt-1 border-t border-zinc-800/50">
				<div class="text-[9px] uppercase tracking-wider font-medium text-zinc-500 mb-1">Contrôles Deck généraux</div>
				<div class="grid grid-cols-2 gap-1">
					<button type="button" onclick={() => openDeckModalGlobal('toggle', 'Play / Pause', '⏯')}
						class="text-[11px] inline-flex items-center justify-center gap-1 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/40 text-zinc-300 hover:text-zinc-100 px-1.5 py-1 rounded-sm transition-colors"
						title="Ajouter un bouton Play/Pause au Stream Deck">
						<span>⏯</span> Play/Pause
					</button>
					<button type="button" onclick={() => openDeckModalGlobal('skip', 'Suivant', '⏭')}
						class="text-[11px] inline-flex items-center justify-center gap-1 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/40 text-zinc-300 hover:text-zinc-100 px-1.5 py-1 rounded-sm transition-colors"
						title="Ajouter un bouton Suivant au Stream Deck">
						<span>⏭</span> Skip
					</button>
					<button type="button" onclick={() => openDeckModalGlobal('prev', 'Précédent', '⏮')}
						class="text-[11px] inline-flex items-center justify-center gap-1 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/40 text-zinc-300 hover:text-zinc-100 px-1.5 py-1 rounded-sm transition-colors"
						title="Ajouter un bouton Précédent au Stream Deck">
						<span>⏮</span> Prev
					</button>
					<button type="button" onclick={() => openDeckModalGlobal('stop', 'Stop', '⏹')}
						class="text-[11px] inline-flex items-center justify-center gap-1 bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-800 hover:border-purple-500/40 text-zinc-300 hover:text-zinc-100 px-1.5 py-1 rounded-sm transition-colors"
						title="Ajouter un bouton Stop au Stream Deck">
						<span>⏹</span> Stop
					</button>
				</div>
			</div>
		</footer>
	{/if}
</aside>

{#if deckModalTemplate}
	<SendToDeckModal
		{token}
		title={deckModalTitle}
		subtitle={deckModalSubtitle}
		buttonTemplate={deckModalTemplate}
		onClose={() => deckModalTemplate = null}
		onPlaced={() => flash('Bouton ajouté au Stream Deck.', true)}
	/>
{/if}

{#if placePlaylist && placeOverlayToken}
	<PlaceInSceneModal
		{token}
		sourceType="playlist"
		sourceLabel={placePlaylist.name}
		sourceConfig={{ overlayToken: placeOverlayToken, playlistId: placePlaylist.id }}
		onPlaced={(sceneId, _sceneName, _isNew) => {
			// Redirection systématique : qu'on ait créé la scène ou utilisé
			// une existante, le streamer veut voir le résultat.
			placePlaylist = null
			focusSceneAfterNav(sceneId)
		}}
		onClose={() => placePlaylist = null}
	/>
{/if}
