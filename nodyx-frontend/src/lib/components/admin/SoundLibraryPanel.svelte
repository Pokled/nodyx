<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { onMount, onDestroy } from 'svelte'
	import { PUBLIC_API_URL } from '$env/static/public'
	import Tooltip from '$lib/components/ui/Tooltip.svelte'
	import SendToDeckModal from './SendToDeckModal.svelte'
	import PlaylistSidebar, { type Playlist } from './PlaylistSidebar.svelte'

	// Soundboard / bibliothèque audio : upload mp3/ogg/wav, extraction ID3 (titre,
	// artiste, durée, cover art), preview, édition (volume défaut, fade in/out,
	// loop, royalty-free, tags). Le lien vers le Stream Deck arrive en Session B.

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	type Visibility = 'private' | 'public'

	interface AudioTrack {
		id:              string
		ownerUserId:     string
		assetId:         string
		visibility:      Visibility
		title:           string
		artist:          string | null
		album:           string | null
		durationMs:      number | null
		thumbnailUrl:    string | null
		fileUrl:         string
		mimeType:        string
		volumeDefault:   number
		fadeInMs:        number
		fadeOutMs:       number
		loop:            boolean
		royaltyFree:     boolean | null
		tags:            string[]
		createdAt:       string
		updatedAt:       string
	}

	let tracks    = $state<AudioTrack[]>([])
	let loading   = $state(true)
	let uploading = $state(false)

	// Playlists : sidebar gauche. selectedPlaylistId = null => "Toutes les pistes"
	// (comportement par défaut, on affiche `tracks`). Sinon on charge les tracks
	// de la playlist via /streamer/audio-library/playlists/:id et on les filtre.
	let playlists          = $state<Playlist[]>([])
	let selectedPlaylistId = $state<string | null>(null)
	let playlistTracks     = $state<AudioTrack[]>([])
	let playlistTracksLoading = $state(false)

	// Popover "ajouter à une playlist" pour un track donné. trackId qu'on a
	// ouvert + Set des playlist ids dans lesquelles ce track est déjà.
	let playlistMenuTrackId = $state<string | null>(null)
	let playlistMenuMembership = $state<Set<string>>(new Set())
	let playlistMenuBusy = $state(false)
	let uploadProgress = $state<{ done: number; total: number; current: string; failed: number }>({ done: 0, total: 0, current: '', failed: 0 })
	let toast     = $state<{ text: string; ok: boolean } | null>(null)

	// Queue viewers : état + chargement + actions (skip/clear/toggle).
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
	let queue          = $state<QueueEntry[]>([])
	let queueEnabled   = $state(true)
	let queueBusy      = $state(false)
	let queuePollTimer: ReturnType<typeof setInterval> | null = null

	async function loadQueue(): Promise<void> {
		const res = await apiFetch(fetch, '/streamer/soundboard/queue', {
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			const d = await res.json() as { queue: QueueEntry[]; queueEnabled: boolean }
			queue = d.queue ?? []
			queueEnabled = d.queueEnabled !== false
		}
	}

	async function toggleQueueEnabled(): Promise<void> {
		if (queueBusy) return
		queueBusy = true
		const next = !queueEnabled
		try {
			const res = await apiFetch(fetch, '/streamer/soundboard/queue/enabled', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ enabled: next }),
			})
			if (res.ok) {
				queueEnabled = next
				flash(next ? 'Ajouts viewers activés.' : 'Ajouts viewers désactivés.', true)
			} else flash('Échec toggle.', false)
		} finally {
			queueBusy = false
		}
	}

	async function skipQueueItem(trackId: string): Promise<void> {
		const res = await apiFetch(fetch, `/streamer/soundboard/queue/${trackId}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			queue = queue.filter(q => q.trackId !== trackId)
			flash('Son retiré de la queue.', true)
		}
	}

	async function clearQueueAll(): Promise<void> {
		if (queue.length === 0) return
		if (!confirm(`Vider la queue (${queue.length} son${queue.length > 1 ? 's' : ''}) ?`)) return
		const res = await apiFetch(fetch, '/streamer/soundboard/queue', {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			queue = []
			flash('Queue vidée.', true)
		}
	}
	let query     = $state('')
	let visibilityFilter = $state<'all' | Visibility>('all')

	// Édition inline : le clic sur "Éditer" déplie une ligne sous le track.
	let editingId        = $state<string | null>(null)
	let editTitle        = $state('')
	let editArtist       = $state('')
	let editVisibility   = $state<Visibility>('private')
	let editVolume       = $state(1)
	let editFadeIn       = $state(0)
	let editFadeOut      = $state(0)
	let editLoop         = $state(false)
	let editRoyaltyFree  = $state<'unknown' | 'yes' | 'no'>('unknown')
	let editTags         = $state('')
	let editBusy         = $state(false)

	// Preview audio : un seul lecteur partagé pour éviter d'empiler les streams.
	let previewEl: HTMLAudioElement | null = null
	let previewingId = $state<string | null>(null)

	// Modal "Envoyer au deck" : ouvert quand on clique sur le bouton + Deck d'une row.
	let sendToDeckTrack = $state<AudioTrack | null>(null)

	// Palette de gradients qu'on attribue de façon déterministe par track id
	// pour que le même son ait toujours la même couleur (mémoire visuelle).
	const SOUND_GRADIENTS = ['neon', 'cyber', 'sunset', 'ocean', 'forest', 'amber', 'inferno', 'minimal']
	function gradientForTrack(id: string): string {
		let h = 0
		for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
		return SOUND_GRADIENTS[h % SOUND_GRADIENTS.length]
	}

	// Source des pistes selon la sélection sidebar :
	//   - null  => toutes les pistes de l'owner (full library)
	//   - <id>  => uniquement les pistes de cette playlist (chargées séparément)
	const baseTracks = $derived(selectedPlaylistId === null ? tracks : playlistTracks)

	const filtered = $derived(baseTracks.filter(t => {
		if (visibilityFilter !== 'all' && t.visibility !== visibilityFilter) return false
		if (query.trim()) {
			const q = query.trim().toLowerCase()
			return t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q)
		}
		return true
	}))

	function absoluteUrl(rel: string): string {
		if (rel.startsWith('http')) return rel
		// PUBLIC_API_URL pointe vers /api/v1, on remonte d'un cran pour viser /uploads.
		const base = PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '')
		return `${base}${rel}`
	}

	function fmtDuration(ms: number | null): string {
		if (!ms || ms <= 0) return '—:—'
		const total = Math.round(ms / 1000)
		const m = Math.floor(total / 60)
		const s = total % 60
		return `${m}:${s.toString().padStart(2, '0')}`
	}

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	async function loadTracks(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/audio-library', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { tracks: AudioTrack[] }
				tracks = data.tracks ?? []
			}
		} finally {
			loading = false
		}
	}

	async function loadPlaylists(): Promise<void> {
		const res = await apiFetch(fetch, '/streamer/audio-library/playlists', {
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			const d = await res.json() as { playlists: Playlist[] }
			playlists = d.playlists ?? []
		}
	}

	// Recharge les tracks de la playlist sélectionnée (si une l'est).
	async function loadPlaylistTracks(playlistId: string): Promise<void> {
		playlistTracksLoading = true
		try {
			const res = await apiFetch(fetch, `/streamer/audio-library/playlists/${playlistId}`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const d = await res.json() as { tracks: AudioTrack[] }
				playlistTracks = d.tracks ?? []
			} else {
				playlistTracks = []
			}
		} finally {
			playlistTracksLoading = false
		}
	}

	function onSelectPlaylist(id: string | null): void {
		selectedPlaylistId = id
		stopPreview()
		closePlaylistMenu()
		if (id) loadPlaylistTracks(id)
		else playlistTracks = []
	}

	async function onPlaylistsChanged(): Promise<void> {
		await loadPlaylists()
		// Si la playlist active a disparu (delete), on revient sur "Toutes".
		if (selectedPlaylistId && !playlists.some(p => p.id === selectedPlaylistId)) {
			selectedPlaylistId = null
			playlistTracks = []
		}
	}

	// Popover "ajouter à playlists" pour un track : charge ses playlists ids et
	// ouvre le menu. Re-cliquer sur le même track ferme le menu.
	async function openPlaylistMenu(trackId: string): Promise<void> {
		if (playlistMenuTrackId === trackId) {
			closePlaylistMenu()
			return
		}
		playlistMenuTrackId = trackId
		playlistMenuMembership = new Set()
		const res = await apiFetch(fetch, `/streamer/audio-library/${trackId}/playlists`, {
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			const d = await res.json() as { playlistIds: string[] }
			playlistMenuMembership = new Set(d.playlistIds ?? [])
		}
	}

	function closePlaylistMenu(): void {
		playlistMenuTrackId = null
		playlistMenuMembership = new Set()
	}

	async function toggleTrackInPlaylist(trackId: string, playlistId: string): Promise<void> {
		if (playlistMenuBusy) return
		playlistMenuBusy = true
		const isIn = playlistMenuMembership.has(playlistId)
		try {
			const url = `/streamer/audio-library/playlists/${playlistId}/tracks${isIn ? `/${trackId}` : ''}`
			const res = await apiFetch(fetch, url, {
				method:  isIn ? 'DELETE' : 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    isIn ? undefined : JSON.stringify({ trackId }),
			})
			if (res.ok) {
				// Update optimiste du membership
				const next = new Set(playlistMenuMembership)
				if (isIn) next.delete(playlistId)
				else      next.add(playlistId)
				playlistMenuMembership = next
				// Refresh des compteurs sidebar + tracks playlist active si concernée
				loadPlaylists()
				if (selectedPlaylistId === playlistId) loadPlaylistTracks(playlistId)
			} else {
				flash('Échec mise à jour playlist.', false)
			}
		} finally {
			playlistMenuBusy = false
		}
	}

	async function handleFiles(files: FileList | null): Promise<void> {
		if (!files || files.length === 0 || uploading) return
		uploading = true
		const arr = Array.from(files)
		uploadProgress = { done: 0, total: arr.length, current: arr[0].name, failed: 0 }
		let added = 0
		try {
			for (let i = 0; i < arr.length; i++) {
				const file = arr[i]
				uploadProgress = { ...uploadProgress, current: file.name }
				const ok = await uploadOne(file)
				if (ok) added++
				else uploadProgress = { ...uploadProgress, failed: uploadProgress.failed + 1 }
				uploadProgress = { ...uploadProgress, done: i + 1 }
				// Refresh la liste tous les 3 fichiers pour que le streamer voie sa
				// biblio se peupler en live (gros batch = plus motivant que d'attendre).
				if (ok && (added % 3 === 0)) await loadTracks()
			}
			await loadTracks()
			const failed = uploadProgress.failed
			if (failed === 0)      flash(`${added} piste${added > 1 ? 's' : ''} ajoutée${added > 1 ? 's' : ''}.`, true)
			else if (added === 0)  flash(`Échec upload des ${failed} fichier${failed > 1 ? 's' : ''}.`, false)
			else                   flash(`${added} ajoutée${added > 1 ? 's' : ''}, ${failed} échec${failed > 1 ? 's' : ''}.`, true)
		} finally {
			uploading = false
			uploadProgress = { done: 0, total: 0, current: '', failed: 0 }
		}
	}

	async function uploadOne(file: File): Promise<boolean> {
		// 1) POST multipart vers /api/v1/assets avec asset_type=sound
		// @fastify/multipart en mode req.file() ne lit les champs texte que s'ils
		// arrivent AVANT le fichier dans le stream. Ordre crucial : name + type d'abord.
		const form = new FormData()
		form.append('name',       file.name)
		form.append('asset_type', 'sound')
		form.append('file',       file, file.name)
		const upRes = await apiFetch(fetch, '/assets', {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    form,
		})
		if (!upRes.ok) {
			const err = await upRes.json().catch(() => ({})) as { error?: string }
			console.warn('[soundboard] asset upload failed', err)
			return false
		}
		const upData = await upRes.json() as { asset?: { id?: string } }
		const assetId = upData.asset?.id
		if (!assetId) return false

		// 2) POST /streamer/audio-library avec l'asset_id (extraction ID3 backend)
		const libRes = await apiFetch(fetch, '/streamer/audio-library', {
			method:  'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ assetId, visibility: 'private' }),
		})
		return libRes.ok
	}

	function onDrop(e: DragEvent): void {
		e.preventDefault()
		dragHover = false
		if (e.dataTransfer?.files) handleFiles(e.dataTransfer.files)
	}

	let dragHover = $state(false)
	function onDragOver(e: DragEvent): void { e.preventDefault(); dragHover = true }
	function onDragLeave(): void { dragHover = false }

	function startEdit(t: AudioTrack): void {
		stopPreview()
		editingId       = t.id
		editTitle       = t.title
		editArtist      = t.artist ?? ''
		editVisibility  = t.visibility
		editVolume      = t.volumeDefault
		editFadeIn      = t.fadeInMs
		editFadeOut     = t.fadeOutMs
		editLoop        = t.loop
		editRoyaltyFree = t.royaltyFree === true ? 'yes' : t.royaltyFree === false ? 'no' : 'unknown'
		editTags        = t.tags.join(', ')
	}

	function cancelEdit(): void { editingId = null }

	async function saveEdit(t: AudioTrack): Promise<void> {
		editBusy = true
		try {
			const royaltyFree = editRoyaltyFree === 'yes' ? true : editRoyaltyFree === 'no' ? false : null
			const tags = editTags.split(',').map(s => s.trim()).filter(s => s.length > 0).slice(0, 32)
			const res = await apiFetch(fetch, `/streamer/audio-library/${t.id}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({
					title:         editTitle.trim() || t.title,
					artist:        editArtist.trim() || null,
					visibility:    editVisibility,
					volumeDefault: editVolume,
					fadeInMs:      editFadeIn,
					fadeOutMs:     editFadeOut,
					loop:          editLoop,
					royaltyFree,
					tags,
				}),
			})
			if (res.ok) {
				const data = await res.json() as { track: AudioTrack }
				tracks = tracks.map(x => x.id === t.id ? data.track : x)
				editingId = null
				flash('Piste mise à jour.', true)
			} else {
				flash('Échec mise à jour.', false)
			}
		} finally {
			editBusy = false
		}
	}

	async function deleteTrack(t: AudioTrack): Promise<void> {
		if (!confirm(`Supprimer "${t.title}" de la bibliothèque ?\n(le fichier audio reste dans tes assets)`)) return
		const res = await apiFetch(fetch, `/streamer/audio-library/${t.id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			tracks = tracks.filter(x => x.id !== t.id)
			if (editingId === t.id) editingId = null
			if (previewingId === t.id) stopPreview()
			flash(`"${t.title}" supprimée.`, true)
		} else {
			flash('Échec suppression.', false)
		}
	}

	function togglePreview(t: AudioTrack): void {
		if (previewingId === t.id) {
			stopPreview()
			return
		}
		stopPreview()
		if (!browser) return
		previewEl = new Audio(absoluteUrl(t.fileUrl))
		previewEl.volume = Math.min(1, Math.max(0, t.volumeDefault))
		previewEl.onended = () => { previewingId = null }
		previewEl.onerror = () => { previewingId = null; flash('Lecture impossible.', false) }
		previewEl.play().catch(() => { previewingId = null })
		previewingId = t.id
	}

	function stopPreview(): void {
		if (previewEl) {
			previewEl.pause()
			previewEl.src = ''
			previewEl = null
		}
		previewingId = null
	}

	onMount(() => {
		loadTracks()
		loadPlaylists()
		loadQueue()
		// Poll la queue toutes les 4s pour voir les ajouts viewers arriver en
		// quasi temps réel sans surcharger (l'admin reste connecté à ce panel
		// que pendant qu'il configure, pas en background).
		queuePollTimer = setInterval(loadQueue, 4_000)
	})
	onDestroy(() => {
		stopPreview()
		if (queuePollTimer) clearInterval(queuePollTimer)
	})
</script>

<section class="space-y-6">

	<!-- Header : titre + tooltip + lien page publique + meta filtres. -->
	<header class="flex items-start justify-between gap-4 flex-wrap">
		<div>
			<div class="flex items-center gap-2">
				<h2 class="text-lg font-semibold text-zinc-100">Soundboard</h2>
				<Tooltip text="Ta bibliothèque audio personnelle. Upload tes mp3/ogg/wav, on extrait les tags ID3, et tu pourras les déclencher depuis le Stream Deck." position="bottom"/>
			</div>
			<p class="text-sm text-zinc-500 mt-0.5">Audio à déclencher en live. Extraction auto des tags ID3 et de la cover.</p>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<!-- Lien direct vers la page publique viewers. Visible seulement quand on
			     a au moins une piste publique (sinon la page serait vide pour le viewer). -->
			<a href="/soundboard" target="_blank" rel="noopener noreferrer"
				class="text-xs inline-flex items-center gap-1.5 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 hover:border-purple-500/70 text-purple-100 px-2.5 py-1.5 rounded-sm transition-colors font-medium"
				title="Ouvrir la page publique du Soundboard (visible par tes viewers)">
				<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
					<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
					<polyline points="15 3 21 3 21 9"/>
					<line x1="10" y1="14" x2="21" y2="3"/>
				</svg>
				Page publique
			</a>
			<div class="text-xs text-zinc-500 flex items-center gap-1.5 flex-wrap">
				<span class="text-zinc-600">Formats</span>
				<code class="text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">mp3</code>
				<code class="text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">ogg</code>
				<code class="text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">wav</code>
				<code class="text-zinc-300 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded-sm font-mono">flac</code>
			</div>
		</div>
	</header>

	{#if toast}
		<div class="border-l-2 px-3 py-2 text-sm flex items-center gap-2 {toast.ok ? 'border-emerald-500 bg-emerald-500/5 text-emerald-200' : 'border-rose-500 bg-rose-500/5 text-rose-200'}">
			{toast.text}
		</div>
	{/if}

	<!-- Queue viewers : toggle d'activation + liste FIFO + skip/clear -->
	<div class="border border-zinc-800 bg-zinc-900">
		<header class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between gap-3 flex-wrap">
			<div class="flex items-center gap-2">
				<h3 class="text-sm font-semibold text-zinc-100">Queue viewers</h3>
				<Tooltip text="Les viewers peuvent ajouter des sons à une queue depuis la page publique /soundboard ou via la commande chat (à venir). Auto-play du suivant quand un son finit. Toggle off = blocage temporaire."/>
				{#if queue.length > 0}
					<span class="text-xs text-zinc-500">{queue.length} en attente</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if queue.length > 0}
					<button type="button" onclick={clearQueueAll}
						class="text-xs inline-flex items-center border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/60 px-2.5 py-1 rounded-sm transition-colors">
						Tout vider
					</button>
				{/if}
				<!-- Toggle visuel -->
				<button type="button" onclick={toggleQueueEnabled} disabled={queueBusy}
					class="inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-sm border transition-colors
						{queueEnabled
							? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200 hover:bg-emerald-500/25'
							: 'bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700'}">
					<span class="w-1.5 h-1.5 rounded-full {queueEnabled ? 'bg-emerald-400' : 'bg-zinc-500'}"></span>
					{queueEnabled ? 'Viewers autorisés' : 'Viewers bloqués'}
				</button>
			</div>
		</header>
		{#if queue.length === 0}
			<div class="px-4 py-4 text-xs text-zinc-500 text-center">
				{queueEnabled
					? 'Aucun son en queue. Les viewers peuvent ajouter via /soundboard.'
					: 'Les ajouts viewers sont désactivés. Active-les pour rouvrir la queue.'}
			</div>
		{:else}
			<ol class="divide-y divide-zinc-800">
				{#each queue as e, i (e.trackId + '_' + e.addedAt)}
					<li class="grid grid-cols-[28px_40px_1fr_140px_auto] gap-3 items-center px-4 py-2">
						<span class="text-xs font-mono text-zinc-600 text-center">{i + 1}</span>
						<div class="w-10 h-10 rounded bg-zinc-950 border border-zinc-800 overflow-hidden grid place-items-center">
							{#if e.thumbnailUrl}
								<img src={absoluteUrl(e.thumbnailUrl)} alt="" class="w-full h-full object-cover" loading="lazy"/>
							{:else}
								<svg class="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
									<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
								</svg>
							{/if}
						</div>
						<div class="min-w-0">
							<div class="text-sm text-zinc-100 truncate" title={e.title}>{e.title}</div>
							<div class="text-[11px] text-zinc-500 truncate">{e.artist ?? '—'}</div>
						</div>
						<div class="text-[11px] text-zinc-500 inline-flex items-center gap-1.5">
							{#if e.source === 'chat'}
								<span class="text-purple-300">💬</span>
							{:else}
								<span class="text-zinc-500">🌐</span>
							{/if}
							<span class="truncate">{e.addedBy}</span>
						</div>
						<button type="button" onclick={() => skipQueueItem(e.trackId)}
							class="text-xs inline-flex items-center border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/60 px-2 py-1 rounded-sm transition-colors"
							title="Retirer ce son de la queue">
							Skip
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</div>

	<!-- Zone d'upload : drag & drop + click. -->
	<label
		class="block border-2 border-dashed transition-colors cursor-pointer {dragHover ? 'border-purple-500/80 bg-purple-500/[0.06]' : 'border-zinc-800 hover:border-zinc-700 bg-zinc-900/50'}"
		ondragover={onDragOver}
		ondragleave={onDragLeave}
		ondrop={onDrop}>
		<div class="px-4 py-6 flex flex-col items-center gap-2 text-center">
			<svg class="w-8 h-8 {dragHover ? 'text-purple-300' : uploading ? 'text-purple-400 animate-pulse' : 'text-zinc-500'}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
				<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
				<polyline points="17 8 12 3 7 8"/>
				<line x1="12" y1="3" x2="12" y2="15"/>
			</svg>

			{#if uploading && uploadProgress.total > 0}
				<!-- Mode upload : compteur + barre + nom du fichier en cours -->
				<div class="w-full max-w-md space-y-2">
					<div class="flex items-center justify-between text-xs text-zinc-300">
						<span class="font-medium">Upload <span class="text-purple-300">{uploadProgress.done} / {uploadProgress.total}</span></span>
						{#if uploadProgress.failed > 0}
							<span class="text-rose-300">{uploadProgress.failed} échec{uploadProgress.failed > 1 ? 's' : ''}</span>
						{/if}
					</div>
					<div class="w-full h-1.5 bg-zinc-950 rounded-sm overflow-hidden border border-zinc-800">
						<div class="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-[width] duration-300"
							style="width: {(uploadProgress.done / uploadProgress.total) * 100}%"></div>
					</div>
					<div class="text-xs text-zinc-500 truncate" title={uploadProgress.current}>{uploadProgress.current}</div>
				</div>
			{:else}
				<div class="text-sm text-zinc-300">
					{#if dragHover}
						Lâche ici, on s'occupe du reste.
					{:else}
						<span class="text-zinc-100 font-medium">Dépose tes fichiers audio</span> ou clique pour parcourir
					{/if}
				</div>
				<div class="text-xs text-zinc-500">Upload multiple supporté. Tags ID3 (titre, artiste, cover) extraits automatiquement. <span class="text-zinc-600">Max 50 MB par fichier — pour les WAV longs, préférer mp3/ogg.</span></div>
			{/if}
		</div>
		<input type="file" multiple accept="audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/flac" class="sr-only"
			onchange={(e) => handleFiles((e.currentTarget as HTMLInputElement).files)} disabled={uploading}/>
	</label>

	<!-- Layout 2 colonnes : sidebar playlists | bibliothèque filtrée -->
	<div class="grid grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)] gap-4 items-start">
		<!-- Sidebar : navigation par playlist -->
		<PlaylistSidebar
			{token}
			{playlists}
			{selectedPlaylistId}
			{onSelectPlaylist}
			{onPlaylistsChanged}
		/>

		<!-- Colonne droite : filtres + biblio -->
		<div class="space-y-3">

	<!-- Filtres + recherche -->
	<div class="flex items-center gap-2 flex-wrap">
		<div class="flex items-center gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-sm">
			{#each (['all', 'private', 'public'] as const) as v (v)}
				<button type="button" onclick={() => visibilityFilter = v}
					class="text-xs px-2.5 py-1 rounded-sm transition-colors {visibilityFilter === v ? 'bg-purple-500/15 text-purple-200' : 'text-zinc-400 hover:text-zinc-200'}">
					{v === 'all' ? 'Toutes' : v === 'private' ? 'Privé' : 'Public'}
				</button>
			{/each}
		</div>
		<div class="flex-1 min-w-[200px] relative">
			<svg class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
				<circle cx="11" cy="11" r="8"/>
				<line x1="21" y1="21" x2="16.65" y2="16.65"/>
			</svg>
			<input type="search" bind:value={query} placeholder="Rechercher par titre ou artiste"
				class="w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 pl-8 pr-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors rounded-sm"/>
		</div>
	</div>

	<!-- Liste : grille tabulaire. -->
	<div>
		<div class="flex items-baseline justify-between mb-2 gap-2">
			<h3 class="text-xs uppercase tracking-wide font-medium text-zinc-500 truncate">
				{#if selectedPlaylistId}
					{@const p = playlists.find(x => x.id === selectedPlaylistId)}
					{p?.name ?? 'Playlist'}
				{:else}
					Toutes les pistes
				{/if}
			</h3>
			{#if filtered.length > 0}<span class="text-xs text-zinc-600 shrink-0">{filtered.length} / {baseTracks.length}</span>{/if}
		</div>

		{#if loading || playlistTracksLoading}
			<div class="border border-zinc-800 bg-zinc-900 px-4 py-6 text-sm text-zinc-500">Chargement…</div>
		{:else if tracks.length === 0}
			<div class="border border-dashed border-zinc-800 bg-zinc-900/50 px-4 py-8 text-center text-sm text-zinc-500">
				Aucune piste. Dépose tes premiers fichiers audio ci-dessus pour démarrer.
			</div>
		{:else if selectedPlaylistId && baseTracks.length === 0}
			<div class="border border-dashed border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500 leading-relaxed">
				Playlist vide. Reviens sur <button type="button" onclick={() => onSelectPlaylist(null)} class="text-purple-300 hover:underline">Toutes les pistes</button>
				et utilise l'icône <span class="text-zinc-300">≡</span> à côté de chaque son pour le ranger ici.
			</div>
		{:else if filtered.length === 0}
			<div class="border border-dashed border-zinc-800 bg-zinc-900/50 px-4 py-6 text-center text-sm text-zinc-500">
				Aucun résultat pour ces filtres.
			</div>
		{:else}
			<div class="border border-zinc-800 bg-zinc-900">
				<!-- Header colonnes : vignette | titre/artiste | durée | visibilité | actions -->
				<div class="grid grid-cols-[56px_1fr_80px_140px_auto] gap-4 px-4 py-2 border-b border-zinc-800 bg-zinc-950 text-[11px] uppercase tracking-wide font-medium text-zinc-500">
					<span></span>
					<span>Titre</span>
					<span>Durée</span>
					<span>Visibilité</span>
					<span class="text-right pr-1">Actions</span>
				</div>
				<ul class="divide-y divide-zinc-800">
					{#each filtered as t (t.id)}
						<li class="grid grid-cols-[56px_1fr_80px_140px_auto] gap-4 px-4 py-3 items-center {editingId === t.id ? 'bg-purple-500/[0.04] border-l-2 border-l-purple-500' : ''}">
							<!-- Col 1 : vignette / fallback -->
							<div class="w-12 h-12 bg-zinc-950 border border-zinc-800 flex items-center justify-center overflow-hidden">
								{#if t.thumbnailUrl}
									<img src={absoluteUrl(t.thumbnailUrl)} alt="" class="w-full h-full object-cover" loading="lazy"/>
								{:else}
									<svg class="w-5 h-5 text-zinc-600" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<path d="M9 18V5l12-2v13"/>
										<circle cx="6" cy="18" r="3"/>
										<circle cx="18" cy="16" r="3"/>
									</svg>
								{/if}
							</div>

							<!-- Col 2 : titre + artiste -->
							<div class="min-w-0">
								<div class="text-sm font-medium text-zinc-100 truncate" title={t.title}>{t.title}</div>
								<div class="text-xs text-zinc-500 truncate" title={t.artist ?? ''}>
									{t.artist ?? 'Artiste inconnu'}
									{#if t.loop} · <span class="text-zinc-400">loop</span>{/if}
									{#if t.royaltyFree === true} · <span class="text-emerald-400">libre de droits</span>{:else if t.royaltyFree === false} · <span class="text-rose-400">à risque DMCA</span>{/if}
								</div>
							</div>

							<!-- Col 3 : durée -->
							<div class="text-xs font-mono text-zinc-400">{fmtDuration(t.durationMs)}</div>

							<!-- Col 4 : visibilité -->
							<div class="text-xs">
								<span class="inline-flex items-center gap-1.5">
									<span class="w-1.5 h-1.5 rounded-full {t.visibility === 'public' ? 'bg-purple-400' : 'bg-zinc-600'}"></span>
									<span class="{t.visibility === 'public' ? 'text-purple-300' : 'text-zinc-400'} font-medium">
										{t.visibility === 'public' ? 'Public' : 'Privé'}
									</span>
								</span>
							</div>

							<!-- Col 5 : actions -->
							<div class="flex items-center gap-1.5 justify-end relative">
								<button type="button" onclick={() => togglePreview(t)}
									class="text-xs inline-flex items-center gap-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 hover:text-purple-200 text-zinc-100 px-2.5 py-1 rounded-sm transition-colors"
									title={previewingId === t.id ? 'Arrêter' : 'Écouter'}>
									{#if previewingId === t.id}
										<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><rect x="5" y="4" width="3" height="12"/><rect x="12" y="4" width="3" height="12"/></svg>
										Stop
									{:else}
										<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84a1 1 0 011.04.06l9 6a1 1 0 010 1.66l-9 6A1 1 0 016 16V4a1 1 0 01.3-.84z"/></svg>
										Écouter
									{/if}
								</button>
								<button type="button" onclick={() => sendToDeckTrack = t}
									class="text-xs inline-flex items-center gap-1 bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 hover:border-purple-500/70 text-purple-100 px-2.5 py-1 rounded-sm transition-colors font-medium"
									title="Ajouter ce son à un bouton du Stream Deck">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
									Deck
								</button>
								<!-- Bouton ouverture popover playlists pour ce track. -->
								<button type="button" onclick={() => openPlaylistMenu(t.id)}
									class="text-xs inline-flex items-center bg-zinc-800 hover:bg-zinc-700 border {playlistMenuTrackId === t.id ? 'border-purple-500/60 text-purple-200' : 'border-zinc-700 hover:border-purple-500/60 hover:text-purple-200'} text-zinc-100 px-2 py-1 rounded-sm transition-colors"
									title="Ranger dans une playlist">
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="13" y2="18"/>
										<polyline points="3 6 4 7 5 6"/><polyline points="3 12 4 13 5 12"/><polyline points="3 18 4 19 5 18"/>
									</svg>
								</button>
								<button type="button" onclick={() => editingId === t.id ? cancelEdit() : startEdit(t)}
									class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-purple-500/60 hover:text-purple-200 text-zinc-100 px-2.5 py-1 rounded-sm transition-colors">
									{editingId === t.id ? 'Fermer' : 'Éditer'}
								</button>
								<button type="button" onclick={() => deleteTrack(t)}
									class="text-xs inline-flex items-center border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/60 px-2 py-1 rounded-sm transition-colors"
									title="Supprimer">
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<polyline points="3 6 5 6 21 6"/>
										<path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>
										<path d="M10 11v6M14 11v6"/>
										<path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
									</svg>
								</button>

								<!-- Popover playlists : ancré sous les actions, fermé par clic sur le même bouton. -->
								{#if playlistMenuTrackId === t.id}
									<div class="absolute top-full right-0 mt-1.5 z-20 w-64 bg-zinc-950 border border-zinc-800 shadow-xl rounded-sm overflow-hidden">
										<div class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
											<span class="text-[11px] uppercase tracking-wide font-medium text-zinc-400">Playlists</span>
											<button type="button" onclick={closePlaylistMenu} class="text-xs text-zinc-500 hover:text-zinc-300" title="Fermer">✕</button>
										</div>
										{#if playlists.length === 0}
											<div class="px-3 py-3 text-[11px] text-zinc-500 text-center">
												Aucune playlist. Crée-en une dans la sidebar à gauche.
											</div>
										{:else}
											<ul class="max-h-56 overflow-y-auto py-1">
												{#each playlists as p (p.id)}
													{@const inIt = playlistMenuMembership.has(p.id)}
													<li>
														<button type="button" onclick={() => toggleTrackInPlaylist(t.id, p.id)} disabled={playlistMenuBusy}
															class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors {inIt ? 'text-zinc-100 bg-purple-500/10' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60'}">
															<span class="w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0 {inIt ? 'bg-purple-500 border-purple-400' : 'border-zinc-600'}">
																{#if inIt}
																	<svg class="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
																{/if}
															</span>
															<span class="w-2 h-2 rounded-full shrink-0" style="background: {p.color ?? 'var(--nx-accent-2-soft)'};"></span>
															<span class="flex-1 truncate" title={p.name}>{p.name}</span>
															<span class="text-[10px] text-zinc-600 font-mono">{p.trackCount}</span>
														</button>
													</li>
												{/each}
											</ul>
										{/if}
									</div>
								{/if}
							</div>
						</li>

						{#if editingId === t.id}
							<li class="border-t border-zinc-800 bg-zinc-950 px-4 py-4">
								<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
									<div>
										<div class="flex items-center gap-1.5">
											<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Titre</label>
											<Tooltip text="Le titre affiché dans le Stream Deck et l'overlay. Remplace celui des tags ID3."/>
										</div>
										<input type="text" bind:value={editTitle} maxlength="200"
											class="mt-1.5 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors rounded-sm"/>
									</div>
									<div>
										<div class="flex items-center gap-1.5">
											<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Artiste</label>
											<Tooltip text="Optionnel. Affiché dans l'overlay sous le titre."/>
										</div>
										<input type="text" bind:value={editArtist} maxlength="200"
											class="mt-1.5 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors rounded-sm"/>
									</div>
								</div>

								<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
									<div>
										<div class="flex items-center gap-1.5">
											<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Volume défaut</label>
											<Tooltip text="Multiplicateur appliqué au déclenchement. 1.0 = volume original, 2.0 = +6 dB."/>
										</div>
										<div class="mt-1.5 flex items-center gap-2">
											<input type="range" min="0" max="2" step="0.05" bind:value={editVolume} class="flex-1 accent-purple-500"/>
											<span class="text-xs font-mono text-zinc-300 w-10 text-right">{editVolume.toFixed(2)}</span>
										</div>
									</div>
									<div>
										<div class="flex items-center gap-1.5">
											<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Fade in (ms)</label>
											<Tooltip text="Montée en volume au déclenchement. 0 = pas de fade."/>
										</div>
										<input type="number" min="0" max="10000" step="50" bind:value={editFadeIn}
											class="mt-1.5 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors rounded-sm"/>
									</div>
									<div>
										<div class="flex items-center gap-1.5">
											<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Fade out (ms)</label>
											<Tooltip text="Descente en volume à la fin ou au stop. 0 = coupe sec."/>
										</div>
										<input type="number" min="0" max="10000" step="50" bind:value={editFadeOut}
											class="mt-1.5 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 outline-none transition-colors rounded-sm"/>
									</div>
								</div>

								<div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
									<div>
										<div class="flex items-center gap-1.5 mb-1.5">
											<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Visibilité</label>
											<Tooltip text="Privé : visible que par toi. Public (V2) : partagé avec tes modérateurs et utilisable via channel points."/>
										</div>
										<div class="grid grid-cols-2 gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-sm">
											{#each (['private', 'public'] as Visibility[]) as v (v)}
												<button type="button" onclick={() => editVisibility = v}
													class="text-xs px-2.5 py-1.5 rounded-sm transition-colors {editVisibility === v ? 'bg-purple-500/15 text-purple-200' : 'text-zinc-400 hover:text-zinc-200'}">
													{v === 'private' ? 'Privé' : 'Public'}
												</button>
											{/each}
										</div>
									</div>
									<div>
										<div class="flex items-center gap-1.5 mb-1.5">
											<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Droits</label>
											<Tooltip text="Indication anti-DMCA. Libre = OK pour Twitch. À risque = strike possible. Inconnu = pas vérifié."/>
										</div>
										<div class="grid grid-cols-3 gap-1 bg-zinc-900 border border-zinc-800 p-0.5 rounded-sm">
											{#each [{ v: 'unknown', l: 'Inconnu' }, { v: 'yes', l: 'Libre' }, { v: 'no', l: 'Risqué' }] as opt (opt.v)}
												<button type="button" onclick={() => editRoyaltyFree = opt.v as 'unknown' | 'yes' | 'no'}
													class="text-xs px-2 py-1.5 rounded-sm transition-colors {editRoyaltyFree === opt.v ? (opt.v === 'yes' ? 'bg-emerald-500/15 text-emerald-200' : opt.v === 'no' ? 'bg-rose-500/15 text-rose-200' : 'bg-zinc-700/40 text-zinc-200') : 'text-zinc-400 hover:text-zinc-200'}">
													{opt.l}
												</button>
											{/each}
										</div>
									</div>
									<label class="flex items-center gap-2 cursor-pointer self-end pb-2">
										<input type="checkbox" bind:checked={editLoop} class="w-4 h-4 accent-purple-500"/>
										<span class="text-sm text-zinc-300">Loop</span>
										<Tooltip text="Lecture en boucle jusqu'au stop. Utile pour les ambiances de fond."/>
									</label>
								</div>

								<div class="mt-4">
									<div class="flex items-center gap-1.5">
										<label class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Tags</label>
										<Tooltip text="Séparés par des virgules. Sert à filtrer la bibliothèque. Ex: chill, electro, ambiance."/>
									</div>
									<input type="text" bind:value={editTags} maxlength="500" placeholder="chill, electro, ambiance"
										class="mt-1.5 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 outline-none transition-colors rounded-sm"/>
								</div>

								<div class="mt-5 flex items-center gap-2">
									<button type="button" onclick={() => saveEdit(t)} disabled={editBusy}
										class="text-sm font-medium bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 shadow-sm shadow-purple-500/30 disabled:shadow-none text-white px-4 py-1.5 rounded-sm transition-colors">
										Enregistrer
									</button>
									<button type="button" onclick={cancelEdit}
										class="text-sm bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-sm transition-colors">
										Annuler
									</button>
								</div>
							</li>
						{/if}
					{/each}
				</ul>
			</div>
		{/if}
	</div>

		</div><!-- /colonne droite -->
	</div><!-- /grid 2 colonnes -->
</section>

{#if sendToDeckTrack}
	{@const t = sendToDeckTrack}
	<SendToDeckModal
		{token}
		title="Ajouter au Stream Deck"
		subtitle={t.title}
		buttonTemplate={{
			label:     t.title.slice(0, 40),
			icon:      '🎵',
			iconScale: 1,
			gradient:  gradientForTrack(t.id),
			action:    { type: 'play_audio', trackId: t.id, trackTitle: t.title },
		}}
		onClose={() => sendToDeckTrack = null}
		onPlaced={() => flash(`"${t.title}" ajouté au deck.`, true)}
	/>
{/if}
