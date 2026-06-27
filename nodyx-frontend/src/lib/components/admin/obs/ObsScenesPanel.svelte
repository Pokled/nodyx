<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { onMount, onDestroy } from 'svelte'
	import SceneCanvas from './SceneCanvas.svelte'
	import AddSourceModal from './AddSourceModal.svelte'
	import { consumeFocusedSceneId, focusOverlayAfterNav } from './sceneNav'
	import {
		SOURCE_TYPE_META, FULL_SCENE_VIEWPORT_TYPES,
		type ObsScene, type ObsSceneLayout, type ObsSceneSource,
		type ObsSceneSourceType,
	} from '$lib/types/obsScenes'

	// ─── Streamer Hub → Scènes OBS (compositeur visuel) ─────────────────────
	// Orchestrateur principal du tab "Scènes". Reproduit le layout d'OBS :
	//   ┌────────────────────────┬──────────┐
	//   │  Canvas preview 16:9   │ Contrôles│
	//   ├─────┬─────┬────────────┤          │
	//   │ Scn │ Src │ Audio Mix  │          │
	//   └─────┴─────┴────────────┴──────────┘
	// Avantage : le streamer qui connaît OBS retrouve immédiatement ses
	// repères (Scenes en bas-gauche, Sources au centre, Mixer à droite,
	// Controls à l'extrême droite). Adapté au style admin Nodyx (zinc/purple).
	//
	// Phase A : tout est stocké côté Nodyx, pas de sync OBS. Audio Mixer et
	// Contrôles sont visibles mais marqués "via OBS bridge (à venir)" pour
	// que l'utilisateur sache qu'ils seront activés en Phase B+.

	interface Props {
		token: string
	}
	let { token }: Props = $props()

	let scenes      = $state<ObsScene[]>([])
	let loading     = $state(true)
	let activeId    = $state<string | null>(null)
	let selectedSrc = $state<string | null>(null)
	// Mode de rendu du canvas. 'live' affiche les iframes des overlays, 'wireframe'
	// les placeholders rapides. Persisté en localStorage pour rester cohérent
	// entre sessions (un user qui préfère wireframe ne veut pas re-toggle à
	// chaque visite). Défaut 'live'.
	let previewMode = $state<'live' | 'wireframe'>('live')

	// Index des overlays et playlists pour résoudre dynamiquement le label
	// affiché des sources d'une scène. Sans ça, le label de la source était
	// figé à sa valeur au moment de l'ajout (ex "Alert Box"), et un renommage
	// de l'overlay parent ne se reflétait pas dans le canvas.
	interface OverlayLite  { id: string; token: string; label: string | null }
	interface PlaylistLite { id: string; name: string }
	let overlaysIndex  = $state<Map<string, OverlayLite>>(new Map())
	let playlistsIndex = $state<Map<string, PlaylistLite>>(new Map())

	async function loadOverlaysIndex(): Promise<void> {
		try {
			const res = await apiFetch(fetch, '/streamer/overlays', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const d = await res.json() as { overlays: OverlayLite[] }
				const map = new Map<string, OverlayLite>()
				for (const o of d.overlays ?? []) map.set(o.token, o)
				overlaysIndex = map
			}
		} catch { /* index restera vide : on retombera sur le label local de la source */ }
	}
	async function loadPlaylistsIndex(): Promise<void> {
		try {
			const res = await apiFetch(fetch, '/streamer/audio-library/playlists', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const d = await res.json() as { playlists: PlaylistLite[] }
				const map = new Map<string, PlaylistLite>()
				for (const p of d.playlists ?? []) map.set(p.id, p)
				playlistsIndex = map
			}
		} catch { /* idem */ }
	}

	// Label à afficher pour une source : priorité au nom vivant de l'overlay
	// ou de la playlist parente, fallback sur le label stocké dans la source
	// (utile si le parent est offline / supprimé), fallback final sur le type.
	function displayLabelFor(s: ObsSceneSource): string {
		const m = SOURCE_TYPE_META[s.type]
		const tok = typeof s.config.overlayToken === 'string' ? s.config.overlayToken : null
		if (s.type === 'playlist' && typeof s.config.playlistId === 'string') {
			const p = playlistsIndex.get(s.config.playlistId)
			if (p?.name) return p.name
		}
		if (tok) {
			const o = overlaysIndex.get(tok)
			if (o?.label?.trim()) return o.label.trim()
		}
		return (s.label?.trim() || m.label).slice(0, 60)
	}
	let creating    = $state(false)
	let newName     = $state('')
	let saving      = $state(false)
	let lastSaveAt  = $state<number | null>(null)

	// Pour éviter de spammer le PATCH layout pendant qu'on drag plusieurs
	// fois d'affilée : on debounce 600ms après le dernier change. On garde
	// aussi une trace du dernier layout poussé pour ne pas re-PATCH une
	// scène qui n'a pas réellement bougé (sanitize backend peut renvoyer une
	// version légèrement différente qui ressetterait scenes et redéclencherait
	// les inputs réactifs).
	let saveTimer: ReturnType<typeof setTimeout> | null = null
	let saveInFlight = false
	let pendingLayout: ObsSceneLayout | null = null
	let lastPushedLayoutJson = ''

	let toast = $state<{ text: string; ok: boolean } | null>(null)
	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		setTimeout(() => { toast = null }, 3000)
	}

	// Modal "+ Source" : null = fermé.
	let addSourceOpen = $state(false)
	// Modal "Changer X" : si une source est en train d'être swap, on garde
	// son id pour patcher la bonne au pick. null = modal swap fermé. Le
	// $derived swappingSource est déclaré plus bas, après activeLayout.
	let swapSourceId = $state<string | null>(null)

	const activeScene = $derived<ObsScene | null>(scenes.find(s => s.id === activeId) ?? null)
	const activeLayout = $derived<ObsSceneLayout>(activeScene?.layout ?? { sources: [] })
	const swappingSource = $derived<ObsSceneSource | null>(
		swapSourceId ? activeLayout.sources.find(s => s.id === swapSourceId) ?? null : null,
	)
	const selectedSource = $derived<ObsSceneSource | null>(
		activeLayout.sources.find(s => s.id === selectedSrc) ?? null,
	)
	// Ordre d'affichage Sources list : z décroissant (devant → arrière), comme OBS.
	const sourcesByZ = $derived<ObsSceneSource[]>(
		[...activeLayout.sources].sort((a, b) => b.z - a.z),
	)

	// ── Chargement / sauvegarde scènes ─────────────────────────────────────

	async function loadScenes(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/obs/scenes', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const d = await res.json() as { scenes: ObsScene[] }
				scenes = d.scenes ?? []
				// Priorité au focus posé par PlaceInSceneModal (création de scène
				// depuis Overlays/Soundboard) : si un ID est en attente, on
				// l'active. Sinon on garde la sélection courante, et à défaut
				// on prend la première scène pour ne pas afficher un canvas
				// vide au premier load.
				const focused = consumeFocusedSceneId()
				if (focused && scenes.some(s => s.id === focused)) {
					activeId = focused
					selectedSrc = null
				} else if (!activeId && scenes.length > 0) {
					activeId = scenes[0].id
				}
			}
		} finally {
			loading = false
		}
	}

	// Quand le tab Scènes reste monté (l'utilisateur y était déjà), onMount
	// ne re-tire pas. Le helper sceneNav broadcast un CustomEvent pour qu'on
	// puisse capter le focus en live.
	function onFocusEvent(e: Event): void {
		const detail = (e as CustomEvent<{ sceneId: string }>).detail
		if (!detail?.sceneId) return
		// Si la scène est déjà chargée, on switche tout de suite. Sinon on
		// reload puis on consomme l'id depuis le sessionStorage.
		if (scenes.some(s => s.id === detail.sceneId)) {
			activeId = detail.sceneId
			selectedSrc = null
		} else {
			void loadScenes()
		}
	}

	async function createScene(): Promise<void> {
		const name = newName.trim()
		if (!name || saving) return
		saving = true
		try {
			const res = await apiFetch(fetch, '/streamer/obs/scenes', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ name }),
			})
			if (res.ok) {
				const d = await res.json() as { scene: ObsScene }
				scenes = [...scenes, d.scene]
				activeId = d.scene.id
				newName = ''
				creating = false
			} else if (res.status === 409) {
				flash('Ce nom est déjà pris par une autre scène.', false)
			} else {
				flash('Création impossible.', false)
			}
		} finally {
			saving = false
		}
	}

	async function deleteScene(id: string): Promise<void> {
		const s = scenes.find(x => x.id === id)
		if (!s) return
		if (!confirm(`Supprimer la scène "${s.name}" ?`)) return
		const res = await apiFetch(fetch, `/streamer/obs/scenes/${id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			scenes = scenes.filter(x => x.id !== id)
			if (activeId === id) activeId = scenes[0]?.id ?? null
		} else {
			flash('Suppression échouée.', false)
		}
	}

	async function duplicateScene(id: string): Promise<void> {
		const res = await apiFetch(fetch, `/streamer/obs/scenes/${id}/duplicate`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			const d = await res.json() as { scene: ObsScene }
			scenes = [...scenes, d.scene]
			activeId = d.scene.id
			flash(`Scène dupliquée : "${d.scene.name}".`, true)
		} else {
			flash('Duplication échouée.', false)
		}
	}

	async function persistLayout(layout: ObsSceneLayout): Promise<void> {
		if (!activeId) return
		const json = JSON.stringify(layout)
		if (json === lastPushedLayoutJson) return       // rien de neuf à sauver
		if (saveInFlight) {
			// Un PATCH est déjà en vol : on garde le dernier layout désiré
			// et on relancera dès qu'il revient. Ça évite N PATCH concurrents
			// qui se télescopent dans le pool DB et l'event loop.
			pendingLayout = layout
			return
		}
		saveInFlight = true
		lastPushedLayoutJson = json
		try {
			const res = await apiFetch(fetch, `/streamer/obs/scenes/${activeId}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ layout }),
			})
			if (res.ok) {
				const d = await res.json() as { scene: ObsScene }
				// On garde notre layout local (déjà à jour) plutôt que d'écraser
				// avec la version backend, pour ne pas perturber les inputs en
				// cours de saisie. On synchronise quand même les métadonnées
				// (updatedAt, etc.).
				scenes = scenes.map(s => s.id === d.scene.id ? { ...d.scene, layout: s.layout } : s)
				lastSaveAt = Date.now()
			} else {
				flash('Sauvegarde échouée. Réessaye.', false)
				lastPushedLayoutJson = ''       // pour réessayer la prochaine fois
			}
		} catch {
			lastPushedLayoutJson = ''
		} finally {
			saveInFlight = false
			// S'il y a eu d'autres changements pendant qu'on attendait, on flush
			// maintenant (un seul PATCH supplémentaire avec la version la plus
			// récente, pas la queue entière).
			if (pendingLayout) {
				const p = pendingLayout
				pendingLayout = null
				void persistLayout(p)
			}
		}
	}

	function applyLayoutChange(layout: ObsSceneLayout): void {
		if (!activeScene) return
		// Update local immédiat (UI fluide), persist debounced à 600ms.
		scenes = scenes.map(s => s.id === activeScene.id ? { ...s, layout } : s)
		if (saveTimer) clearTimeout(saveTimer)
		saveTimer = setTimeout(() => { void persistLayout(layout) }, 600)
	}

	// ── Manipulation des sources ───────────────────────────────────────────

	// Swap : on garde la position/taille/visibilité/lock/z de la source
	// existante, on remplace juste le contenu (overlay token, playlist id,
	// URL). Le label est mis à jour pour refléter le nouveau choix.
	function swapSource(type: ObsSceneSourceType, config: Record<string, unknown>, label?: string): void {
		if (!activeScene || !swappingSource) return
		const m = SOURCE_TYPE_META[type]
		const updated: ObsSceneSource = {
			...swappingSource,
			type,
			label:  (label?.trim() || m.label).slice(0, 60),
			config: config ?? {},
		}
		const layout: ObsSceneLayout = {
			sources: activeLayout.sources.map(s => s.id === updated.id ? updated : s),
		}
		applyLayoutChange(layout)
		swapSourceId = null
	}

	function addSource(type: ObsSceneSourceType, config: Record<string, unknown>, label?: string): void {
		if (!activeScene) return
		const m = SOURCE_TYPE_META[type]
		const maxZ = activeLayout.sources.reduce((acc, s) => Math.max(acc, s.z), -1)
		const newSrc: ObsSceneSource = {
			id:      `src_${Math.random().toString(36).slice(2, 10)}`,
			type,
			label:   (label?.trim() || m.label).slice(0, 60),
			x:       Math.round(((1920 - m.defaultW) / 2)),
			y:       Math.round(((1080 - m.defaultH) / 2)),
			w:       m.defaultW,
			h:       m.defaultH,
			z:       maxZ + 1,
			visible: true,
			locked:  false,
			config:  config ?? {},
		}
		const layout: ObsSceneLayout = { sources: [...activeLayout.sources, newSrc] }
		applyLayoutChange(layout)
		selectedSrc = newSrc.id
		addSourceOpen = false
	}

	function removeSource(id: string): void {
		if (!activeScene) return
		const layout: ObsSceneLayout = { sources: activeLayout.sources.filter(s => s.id !== id) }
		applyLayoutChange(layout)
		if (selectedSrc === id) selectedSrc = null
	}

	function toggleSourceVisible(id: string): void {
		if (!activeScene) return
		const layout: ObsSceneLayout = {
			sources: activeLayout.sources.map(s => s.id === id ? { ...s, visible: !s.visible } : s),
		}
		applyLayoutChange(layout)
	}

	function toggleSourceLocked(id: string): void {
		if (!activeScene) return
		const layout: ObsSceneLayout = {
			sources: activeLayout.sources.map(s => s.id === id ? { ...s, locked: !s.locked } : s),
		}
		applyLayoutChange(layout)
	}

	function moveSourceZ(id: string, dir: 'up' | 'down' | 'top' | 'bottom'): void {
		if (!activeScene) return
		const src = activeLayout.sources.find(s => s.id === id)
		if (!src) return
		const all = [...activeLayout.sources]
		const maxZ = all.reduce((acc, s) => Math.max(acc, s.z), 0)
		const minZ = all.reduce((acc, s) => Math.min(acc, s.z), 0)
		const sorted = [...all].sort((a, b) => a.z - b.z)
		const idx = sorted.findIndex(s => s.id === id)
		let newZ = src.z
		if (dir === 'top')    newZ = maxZ + 1
		if (dir === 'bottom') newZ = minZ - 1
		if (dir === 'up' && idx < sorted.length - 1) {
			const next = sorted[idx + 1]
			newZ = next.z
			next.z = src.z
		}
		if (dir === 'down' && idx > 0) {
			const prev = sorted[idx - 1]
			newZ = prev.z
			prev.z = src.z
		}
		const layout: ObsSceneLayout = {
			sources: all.map(s => s.id === id ? { ...s, z: newZ } : sorted.find(x => x.id === s.id) ?? s),
		}
		applyLayoutChange(layout)
	}

	// Editeur de propriétés du source sélectionné : on patch un seul champ
	// à la fois et on persist debounced via applyLayoutChange.
	function patchSelected(patch: Partial<ObsSceneSource>): void {
		if (!selectedSource || !activeScene) return
		const layout: ObsSceneLayout = {
			sources: activeLayout.sources.map(s => s.id === selectedSource.id ? { ...s, ...patch } : s),
		}
		applyLayoutChange(layout)
	}

	function fmtSavedAgo(ts: number | null): string {
		if (!ts) return ''
		const sec = Math.floor((Date.now() - ts) / 1000)
		if (sec < 5)  return 'sauvegardé à l\'instant'
		if (sec < 60) return `sauvegardé il y a ${sec}s`
		return `sauvegardé il y a ${Math.floor(sec / 60)}min`
	}

	onMount(() => {
		void loadScenes()
		void loadOverlaysIndex()
		void loadPlaylistsIndex()
		window.addEventListener('nodyx:focus-scene', onFocusEvent)
		try {
			const v = localStorage.getItem('nodyx:scenes:preview-mode')
			if (v === 'live' || v === 'wireframe') previewMode = v
		} catch { /* localStorage indispo : on garde le défaut */ }
	})

	$effect(() => {
		try { localStorage.setItem('nodyx:scenes:preview-mode', previewMode) } catch { /* noop */ }
	})

	// Patch du fond de scène : on regénère le layout en gardant les sources
	// inchangées et on passe par le même flow debounced que les sources.
	function setBackground(bg: { kind: 'none' | 'color' | 'image'; color?: string; url?: string } | undefined): void {
		if (!activeScene) return
		const layout: ObsSceneLayout = { sources: activeLayout.sources, ...(bg ? { background: bg } : {}) }
		applyLayoutChange(layout)
	}
	onDestroy(() => {
		window.removeEventListener('nodyx:focus-scene', onFocusEvent)
	})
</script>

<section class="space-y-3">

	<!-- Header : titre + état sauvegarde + lien doc -->
	<header class="flex items-start justify-between gap-3 flex-wrap">
		<div>
			<h2 class="text-lg font-semibold text-zinc-100">Scènes OBS</h2>
			<p class="text-sm text-zinc-500 mt-0.5">Compose la disposition de tes scènes. <span class="text-zinc-400">Phase A</span> : aperçu indicatif, le rendu final est celui d'OBS. <span class="text-zinc-600">Phase B (à venir)</span> : aperçu réel de la scène OBS via OBS WebSocket.</p>
		</div>
		{#if lastSaveAt}
			<div class="text-[11px] text-zinc-500 flex items-center gap-1.5">
				<span class="w-1.5 h-1.5 rounded-full bg-emerald-400/80"></span>
				{fmtSavedAgo(lastSaveAt)}
			</div>
		{/if}
	</header>

	{#if toast}
		<div class="border-l-2 px-3 py-2 text-sm flex items-center gap-2 {toast.ok ? 'border-emerald-500 bg-emerald-500/5 text-emerald-200' : 'border-rose-500 bg-rose-500/5 text-rose-200'}">
			{toast.text}
		</div>
	{/if}

	{#if loading}
		<div class="border border-zinc-800 bg-zinc-900 px-4 py-10 text-sm text-zinc-500 text-center">Chargement…</div>
	{:else}
		<!-- Grille principale OBS-like : canvas en haut large + contrôles à
		     droite ; 3 colonnes en bas (Scenes / Sources / Mixer). -->
		<div class="grid grid-cols-[minmax(0,1fr)_240px] gap-3">
			<!-- ── Colonne gauche : Canvas + 3 sous-colonnes ─────────────── -->
			<div class="space-y-3 min-w-0">
				<!-- Canvas preview -->
				{#if activeScene}
					<SceneCanvas
						layout={activeLayout}
						selectedId={selectedSrc}
						onSelect={(id) => selectedSrc = id}
						onChange={applyLayoutChange}
						labelFor={displayLabelFor}
						{previewMode}
					/>
					<!-- Toggle compact mode rendu sous le canvas : permet de basculer
					     aperçu live (iframes) ↔ wireframe (placeholders rapides) sans
					     quitter la scène. -->
					<div class="flex items-center justify-end gap-2 text-[11px]">
						<span class="text-zinc-500">Aperçu :</span>
						<div class="inline-flex items-center bg-zinc-900 border border-zinc-800 rounded-sm p-0.5">
							{#each (['live', 'wireframe'] as const) as m (m)}
								<button type="button" onclick={() => previewMode = m}
									class="px-2 py-0.5 rounded-sm transition-colors {previewMode === m ? 'bg-purple-500/15 text-purple-200' : 'text-zinc-400 hover:text-zinc-200'}">
									{m === 'live' ? 'Live' : 'Wireframe'}
								</button>
							{/each}
						</div>
					</div>
				{:else}
					<div class="w-full aspect-video bg-zinc-950 border border-dashed border-zinc-800 flex flex-col items-center justify-center gap-2 text-zinc-500">
						<svg class="w-12 h-12 opacity-50" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
							<rect x="3" y="3" width="18" height="18" rx="2"/>
							<path d="M3 9h18M9 3v18"/>
						</svg>
						<div class="text-sm">Aucune scène. Crée-en une pour démarrer.</div>
					</div>
				{/if}

				<!-- Trois sous-colonnes : Scenes / Sources / Audio Mixer -->
				<div class="grid grid-cols-3 gap-3">
					<!-- Scenes -->
					<div class="border border-zinc-800 bg-zinc-900 flex flex-col">
						<header class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
							<h3 class="text-[10px] uppercase tracking-widest font-semibold text-zinc-400">Scènes</h3>
							<span class="text-[10px] text-zinc-600 font-mono">{scenes.length}</span>
						</header>
						<ul class="flex-1 min-h-[180px] max-h-[260px] overflow-y-auto">
							{#each scenes as s (s.id)}
								{@const isAct = activeId === s.id}
								<li class="border-b border-zinc-800/60 last:border-0">
									<button type="button" onclick={() => { activeId = s.id; selectedSrc = null }}
										class="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors
											{isAct ? 'bg-purple-500/15 text-zinc-100 border-l-2 border-l-purple-500'
											       : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40 border-l-2 border-transparent'}">
										<span class="w-2 h-2 rounded-full shrink-0" style="background: {s.color ?? 'var(--nx-accent-2-soft)'};"></span>
										<span class="flex-1 truncate" title={s.name}>{s.name}</span>
										<span class="text-[10px] text-zinc-600 font-mono">{s.layout.sources.length}</span>
									</button>
								</li>
							{/each}
							{#if scenes.length === 0 && !creating}
								<li class="px-3 py-4 text-[11px] text-zinc-500 text-center leading-snug">
									Crée ta première scène (ex : Dev, Discussion, Pause).
								</li>
							{/if}
						</ul>
						<!-- Boutons + - dupliquer style OBS -->
						<footer class="border-t border-zinc-800 p-1 flex items-center gap-0.5">
							{#if !creating}
								<button type="button" onclick={() => { creating = true; newName = '' }}
									class="w-6 h-6 grid place-items-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 rounded-sm" title="Nouvelle scène">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
								</button>
								<button type="button" onclick={() => activeId && deleteScene(activeId)} disabled={!activeId}
									class="w-6 h-6 grid place-items-center text-zinc-400 hover:text-rose-300 hover:bg-rose-900/30 rounded-sm disabled:opacity-30" title="Supprimer la scène active">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4"/></svg>
								</button>
								<button type="button" onclick={() => activeId && duplicateScene(activeId)} disabled={!activeId}
									class="w-6 h-6 grid place-items-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 rounded-sm disabled:opacity-30" title="Dupliquer la scène active">
									<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
										<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
									</svg>
								</button>
							{:else}
								<input type="text" bind:value={newName} maxlength="80" placeholder="Nom (ex : Dev)"
									onkeydown={(e) => { if (e.key === 'Enter') createScene(); if (e.key === 'Escape') creating = false }}
									class="flex-1 bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-1.5 py-0.5 text-[11px] text-zinc-100 placeholder-zinc-600 outline-none rounded-sm" autofocus/>
								<button type="button" onclick={createScene} disabled={saving || !newName.trim()}
									class="text-[11px] bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-1.5 py-0.5 rounded-sm">OK</button>
								<button type="button" onclick={() => creating = false}
									class="text-[11px] text-zinc-500 hover:text-zinc-300 px-1">✕</button>
							{/if}
						</footer>
					</div>

					<!-- Sources de la scène active -->
					<div class="border border-zinc-800 bg-zinc-900 flex flex-col">
						<header class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
							<h3 class="text-[10px] uppercase tracking-widest font-semibold text-zinc-400">Sources</h3>
							<span class="text-[10px] text-zinc-600 font-mono">{activeLayout.sources.length}</span>
						</header>
						<ul class="flex-1 min-h-[180px] max-h-[260px] overflow-y-auto">
							{#each sourcesByZ as s (s.id)}
								{@const m = SOURCE_TYPE_META[s.type]}
								{@const isSel = selectedSrc === s.id}
								<li class="border-b border-zinc-800/60 last:border-0 group">
									<div class="flex items-center gap-1 px-2 py-1 text-xs transition-colors
										{isSel ? 'bg-purple-500/15' : 'hover:bg-zinc-800/40'}">
										<button type="button" onclick={() => toggleSourceVisible(s.id)}
											class="w-5 h-5 grid place-items-center text-zinc-500 hover:text-zinc-200 shrink-0" title={s.visible ? 'Cacher' : 'Afficher'}>
											{#if s.visible}
												<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
											{:else}
												<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
											{/if}
										</button>
										<button type="button" onclick={() => toggleSourceLocked(s.id)}
											class="w-5 h-5 grid place-items-center text-zinc-500 hover:text-amber-300 shrink-0" title={s.locked ? 'Déverrouiller' : 'Verrouiller'}>
											{#if s.locked}
												<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zM9 6a3 3 0 0 1 6 0v2H9V6z"/></svg>
											{:else}
												<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></svg>
											{/if}
										</button>
										<button type="button" onclick={() => selectedSrc = s.id}
											class="flex-1 flex items-center gap-1.5 min-w-0 text-left text-zinc-300 hover:text-zinc-100">
											<span class="text-[14px] leading-none">{m.icon}</span>
											<span class="truncate" title={displayLabelFor(s)}>{displayLabelFor(s)}</span>
										</button>
										<div class="hidden group-hover:flex items-center gap-0.5">
											<button type="button" onclick={() => moveSourceZ(s.id, 'up')} class="w-5 h-5 grid place-items-center text-zinc-500 hover:text-zinc-200" title="Devant">
												<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg>
											</button>
											<button type="button" onclick={() => moveSourceZ(s.id, 'down')} class="w-5 h-5 grid place-items-center text-zinc-500 hover:text-zinc-200" title="Derrière">
												<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>
											</button>
											<button type="button" onclick={() => removeSource(s.id)} class="w-5 h-5 grid place-items-center text-zinc-500 hover:text-rose-300" title="Supprimer">
												<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
											</button>
										</div>
									</div>
								</li>
							{/each}
							{#if activeLayout.sources.length === 0 && activeScene}
								<li class="px-3 py-4 text-[11px] text-zinc-500 text-center leading-snug">
									Aucune source. Clique sur <span class="text-zinc-300">＋</span> ci-dessous pour ajouter une caméra, un overlay ou une URL.
								</li>
							{/if}
						</ul>
						<footer class="border-t border-zinc-800 p-1 flex items-center gap-0.5">
							<button type="button" onclick={() => addSourceOpen = true} disabled={!activeScene}
								class="w-6 h-6 grid place-items-center text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 rounded-sm disabled:opacity-30" title="Ajouter une source">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
							</button>
							<button type="button" onclick={() => selectedSrc && removeSource(selectedSrc)} disabled={!selectedSrc}
								class="w-6 h-6 grid place-items-center text-zinc-400 hover:text-rose-300 hover:bg-rose-900/30 rounded-sm disabled:opacity-30" title="Supprimer la source sélectionnée">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4"/></svg>
							</button>
						</footer>
					</div>

					<!-- Audio Mixer placeholder Phase A -->
					<div class="border border-zinc-800 bg-zinc-900 flex flex-col">
						<header class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
							<h3 class="text-[10px] uppercase tracking-widest font-semibold text-zinc-400">Audio Mixer</h3>
							<span class="text-[9px] uppercase tracking-wider font-bold text-amber-300/80 bg-amber-500/10 px-1 rounded-sm">Phase B</span>
						</header>
						<div class="flex-1 min-h-[180px] flex flex-col items-center justify-center gap-2 px-3 py-4 text-center">
							<svg class="w-8 h-8 text-zinc-700" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
								<rect x="4" y="2" width="6" height="20" rx="1"/><rect x="14" y="2" width="6" height="20" rx="1"/>
								<line x1="7" y1="14" x2="7" y2="14"/><line x1="17" y1="8" x2="17" y2="8"/>
							</svg>
							<div class="text-[11px] text-zinc-500 leading-snug max-w-[20ch]">
								Les sliders de volume des sources audio apparaîtront ici une fois Nodyx connecté à OBS.
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- ── Colonne droite : Contrôles + Properties ───────────────── -->
			<aside class="space-y-3 min-w-0">
				<!-- Contrôles OBS (placeholders Phase A) -->
				<div class="border border-zinc-800 bg-zinc-900">
					<header class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
						<h3 class="text-[10px] uppercase tracking-widest font-semibold text-zinc-400">Contrôles</h3>
						<span class="text-[9px] uppercase tracking-wider font-bold text-amber-300/80 bg-amber-500/10 px-1 rounded-sm">Phase C</span>
					</header>
					<div class="p-2 space-y-1.5">
						<button type="button" disabled class="w-full inline-flex items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 text-zinc-500 px-2.5 py-1.5 text-[11px] rounded-sm cursor-not-allowed">
							<span class="inline-flex items-center gap-1.5"><span class="text-rose-400/60">●</span> Start Streaming</span>
							<span class="text-[9px] uppercase font-mono">via OBS</span>
						</button>
						<button type="button" disabled class="w-full inline-flex items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 text-zinc-500 px-2.5 py-1.5 text-[11px] rounded-sm cursor-not-allowed">
							<span class="inline-flex items-center gap-1.5"><span class="text-zinc-500">⏺</span> Start Recording</span>
							<span class="text-[9px] uppercase font-mono">via OBS</span>
						</button>
						<button type="button" disabled class="w-full inline-flex items-center justify-between gap-2 bg-zinc-800/40 border border-zinc-800 text-zinc-500 px-2.5 py-1.5 text-[11px] rounded-sm cursor-not-allowed">
							<span class="inline-flex items-center gap-1.5"><span class="text-zinc-500">🎬</span> Studio Mode</span>
							<span class="text-[9px] uppercase font-mono">via OBS</span>
						</button>
					</div>
				</div>

				<!-- Properties du source sélectionné OU panneau Scène si rien
				     n'est sélectionné. Quand aucune source n'est ciblée, on
				     propose le picker de fond de scène : couleur unie, image
				     ou aucun (transparent, comme OBS Color/Image Source). -->
				<div class="border border-zinc-800 bg-zinc-900">
					<header class="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
						<h3 class="text-[10px] uppercase tracking-widest font-semibold text-zinc-400">
							{selectedSource ? 'Propriétés' : 'Scène'}
						</h3>
					</header>
					<div class="p-2.5 space-y-2.5">
						{#if !selectedSource}
							{@const bg = activeLayout.background ?? { kind: 'none' as const }}
							<div class="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">Fond de scène</div>
							<div class="grid grid-cols-3 gap-1 bg-zinc-950 border border-zinc-800 p-0.5 rounded-sm">
								{#each [{ k: 'none', l: 'Aucun' }, { k: 'color', l: 'Couleur' }, { k: 'image', l: 'Image' }] as opt (opt.k)}
									{@const isSel = bg.kind === opt.k}
									<button type="button"
										onclick={() => setBackground({
											kind:  opt.k as 'none' | 'color' | 'image',
											color: opt.k === 'color' ? (bg.color ?? '#0b0b0c') : undefined,
											url:   opt.k === 'image' ? (bg.url   ?? '')        : undefined,
										})}
										class="text-[11px] px-2 py-1 rounded-sm transition-colors {isSel ? 'bg-purple-500/15 text-purple-200' : 'text-zinc-400 hover:text-zinc-200'}">
										{opt.l}
									</button>
								{/each}
							</div>

							{#if bg.kind === 'color'}
								<label class="flex items-center gap-2">
									<input type="color" value={bg.color ?? '#0b0b0c'}
										oninput={(e) => setBackground({ kind: 'color', color: e.currentTarget.value })}
										class="w-8 h-8 bg-transparent border border-zinc-800 rounded cursor-pointer p-0"/>
									<input type="text" value={bg.color ?? '#0b0b0c'} maxlength="7"
										oninput={(e) => {
											const v = e.currentTarget.value
											if (/^#[0-9a-fA-F]{6}$/.test(v)) setBackground({ kind: 'color', color: v })
										}}
										class="flex-1 bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-2 py-1 text-xs text-zinc-100 outline-none rounded-sm font-mono"/>
								</label>
							{:else if bg.kind === 'image'}
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-zinc-500">URL de l'image (HTTPS)</span>
									<input type="url" value={bg.url ?? ''} placeholder="https://…"
										oninput={(e) => setBackground({ kind: 'image', url: e.currentTarget.value })}
										class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-2 py-1 text-[11px] text-zinc-100 outline-none rounded-sm font-mono"/>
								</label>
								<div class="text-[10px] text-zinc-600 leading-snug">
									L'image est affichée plein cadre derrière les sources (object-cover).
								</div>
							{:else}
								<div class="text-[10px] text-zinc-500 leading-snug">
									Aucun fond : la scène reste transparente. Choisis <span class="text-zinc-300">Couleur</span> pour un fond uni ou <span class="text-zinc-300">Image</span> pour un visuel.
								</div>
							{/if}

							<div class="pt-2 border-t border-zinc-800 text-[11px] text-zinc-500 leading-snug">
								Sélectionne une source dans le canvas ou la liste pour éditer sa position, sa taille ou son contenu.
							</div>
						{:else}
							{@const m = SOURCE_TYPE_META[selectedSource.type]}
							<!-- Header : on met en avant le nom vivant (super alerte,
							     Pause, etc.) et on rappelle le type en sous-titre
							     discret pour ne pas répéter Alert Box quand le
							     streamer a donné un nom custom à son overlay. -->
							<div class="flex items-center gap-2.5 min-w-0">
								<span class="text-lg leading-none">{m.icon}</span>
								<div class="min-w-0 flex-1">
									<div class="text-sm font-semibold text-zinc-100 truncate" title={displayLabelFor(selectedSource)}>
										{displayLabelFor(selectedSource)}
									</div>
									<div class="text-[10px] uppercase tracking-wider font-semibold" style="color: #{m.accent};">{m.label}</div>
								</div>
							</div>
							<label class="block">
								<span class="text-[9px] uppercase font-semibold text-zinc-500">Nom affiché</span>
								<input type="text" value={selectedSource.label} maxlength="60"
									oninput={(e) => patchSelected({ label: e.currentTarget.value })}
									class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-2 py-1 text-xs text-zinc-100 outline-none rounded-sm"/>
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-zinc-500">X</span>
									<input type="number" value={selectedSource.x} min="0" max="1920"
										oninput={(e) => patchSelected({ x: Math.max(0, Math.min(1920, parseInt(e.currentTarget.value) || 0)) })}
										class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-1.5 py-1 text-xs text-zinc-100 outline-none rounded-sm font-mono"/>
								</label>
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-zinc-500">Y</span>
									<input type="number" value={selectedSource.y} min="0" max="1080"
										oninput={(e) => patchSelected({ y: Math.max(0, Math.min(1080, parseInt(e.currentTarget.value) || 0)) })}
										class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-1.5 py-1 text-xs text-zinc-100 outline-none rounded-sm font-mono"/>
								</label>
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-zinc-500">Largeur</span>
									<input type="number" value={selectedSource.w} min="1" max="1920"
										oninput={(e) => patchSelected({ w: Math.max(1, Math.min(1920, parseInt(e.currentTarget.value) || 1)) })}
										class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-1.5 py-1 text-xs text-zinc-100 outline-none rounded-sm font-mono"/>
								</label>
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-zinc-500">Hauteur</span>
									<input type="number" value={selectedSource.h} min="1" max="1080"
										oninput={(e) => patchSelected({ h: Math.max(1, Math.min(1080, parseInt(e.currentTarget.value) || 1)) })}
										class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-1.5 py-1 text-xs text-zinc-100 outline-none rounded-sm font-mono"/>
								</label>
							</div>
							{#if selectedSource.type === 'browser_source'}
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-zinc-500">URL Browser Source</span>
									<input type="url" value={typeof selectedSource.config.url === 'string' ? selectedSource.config.url : ''}
										placeholder="https://…"
										oninput={(e) => patchSelected({ config: { ...selectedSource.config, url: e.currentTarget.value } })}
										class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-2 py-1 text-[11px] text-zinc-100 outline-none rounded-sm font-mono"/>
								</label>
							{:else if typeof selectedSource.config.overlayToken === 'string' && selectedSource.config.overlayToken.length > 0}
								<!-- Source liée à un overlay Nodyx : on offre des
								     actions IN-PLACE plutôt que d'envoyer le streamer
								     dans un autre tab. Le bouton "Changer..." rouvre
								     le picker à l'étape adaptée (overlay du même type
								     ou playlist) et permet de remplacer la cible en
								     gardant la position/taille de la source. -->
								<div class="rounded-sm border border-zinc-800 bg-zinc-950 px-2.5 py-2 space-y-1.5">
									<div class="flex items-center justify-between gap-2">
										<span class="text-[9px] uppercase tracking-wider font-semibold text-zinc-500">
											{selectedSource.type === 'playlist' ? 'Playlist ciblée' : 'Overlay lié'}
										</span>
										<button type="button" onclick={() => { swapSourceId = selectedSource.id }}
											class="text-[10px] font-medium text-purple-200 hover:text-purple-100 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40">
											<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
											Changer
										</button>
									</div>
									<div class="text-[11px] text-zinc-300 font-medium truncate" title={displayLabelFor(selectedSource)}>
										{displayLabelFor(selectedSource)}
									</div>
								</div>
								<!-- Lien secondaire vers la config viewer-facing de
								     l'overlay (couleurs, sons, etc.). Navigation via
								     le helper : pushState + hashchange dispatché manuel,
								     + sessionStorage pour qu'OverlayManager ouvre pile
								     la ligne de cet overlay au mount. -->
								{#if selectedSource.type !== 'playlist'}
									<button type="button"
										onclick={() => focusOverlayAfterNav(selectedSource.config.overlayToken as string)}
										class="text-[10px] text-zinc-500 hover:text-zinc-300 inline-flex items-center gap-1">
										<svg class="w-2.5 h-2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
											<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
										</svg>
										Modifier les couleurs / sons de cet overlay
									</button>
								{/if}
							{:else if selectedSource.type === 'placeholder_video'}
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-zinc-500">Type visé</span>
									<select value={typeof selectedSource.config.kind === 'string' ? selectedSource.config.kind : 'webcam'}
										onchange={(e) => patchSelected({ config: { ...selectedSource.config, kind: e.currentTarget.value } })}
										class="mt-0.5 w-full bg-zinc-950 border border-zinc-800 focus:border-purple-500/60 px-2 py-1 text-[11px] text-zinc-100 outline-none rounded-sm">
										<option value="webcam">📷 Webcam</option>
										<option value="capture">🎮 Capture jeu</option>
										<option value="image">🖼 Image / logo</option>
									</select>
								</label>
								<div class="text-[10px] text-zinc-600 leading-snug">
									La vraie source OBS sera liée ici quand le bridge OBS WebSocket sera activé (Phase B).
								</div>
							{/if}
						{/if}
					</div>
				</div>
			</aside>
		</div>
	{/if}
</section>

{#if addSourceOpen}
	<AddSourceModal
		{token}
		onPick={(type, config, label) => addSource(type, config, label)}
		onClose={() => addSourceOpen = false}
	/>
{/if}

{#if swappingSource}
	<!-- Mode swap : on rouvre le modal à l'étape adaptée au type courant.
	     Le picker se charge de proposer la liste + "Créer un nouveau". Au
	     pick, swapSource() met à jour la source SANS toucher la position. -->
	<AddSourceModal
		{token}
		initialType={swappingSource.type}
		title={swappingSource.type === 'playlist'
			? 'Changer la playlist'
			: `Changer l'overlay ${SOURCE_TYPE_META[swappingSource.type].label}`}
		onPick={(type, config, label) => swapSource(type, config, label)}
		onClose={() => swapSourceId = null}
	/>
{/if}
