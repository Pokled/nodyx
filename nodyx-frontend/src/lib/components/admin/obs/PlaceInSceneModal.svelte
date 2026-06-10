<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { onMount } from 'svelte'
	import { SOURCE_TYPE_META, CANVAS_WIDTH, CANVAS_HEIGHT,
		type ObsScene, type ObsSceneLayout, type ObsSceneSource, type ObsSceneSourceType } from '$lib/types/obsScenes'

	// ─── Modal "Placer dans une scène" ──────────────────────────────────────
	// Appelée depuis Overlays OBS et Soundboard pour rattacher un overlay ou
	// une playlist à une scène existante (ou à une nouvelle). Le streamer reste
	// sur son tab d'origine : pas de redirection vers Scènes, juste un toast
	// de confirmation. C'est ce qui répare la sensation "tu es projeté ailleurs
	// et tu te perds".
	//
	// Côté flow :
	//   1. Liste des scènes existantes (créées par le streamer).
	//   2. Option en bas : "+ Créer une nouvelle scène" inline.
	//   3. Clic sur une scène → PATCH layout (ajoute la source au centre du
	//      canvas avec la taille par défaut du type) → toast et fermeture.

	interface Props {
		token:      string
		// Type de source à placer (ex : 'alert_box', 'playlist').
		sourceType: ObsSceneSourceType
		// Label par défaut (nom de l'overlay / playlist) pour identifier dans
		// la liste Sources de la scène cible.
		sourceLabel: string
		// Config qui sera collée à la source (overlayToken, playlistId, etc.).
		sourceConfig: Record<string, unknown>
		// Le 3e arg signale si la scène vient d'être créée (true) ou si on
		// a placé dans une scène existante (false). Les parents l'utilisent
		// pour décider de naviguer vers Scènes (cas "nouvelle scène à
		// travailler") ou de rester sur place (cas "rangement rapide").
		onPlaced:   (sceneId: string, sceneName: string, isNew: boolean) => void
		onClose:    () => void
	}
	let { token, sourceType, sourceLabel, sourceConfig, onPlaced, onClose }: Props = $props()

	let scenes  = $state<ObsScene[]>([])
	let loading = $state(true)
	let busy    = $state(false)
	let error   = $state<string | null>(null)

	let creating  = $state(false)
	let newName   = $state('')

	async function loadScenes(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/obs/scenes', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const d = await res.json() as { scenes: ObsScene[] }
				scenes = d.scenes ?? []
			}
		} finally {
			loading = false
		}
	}

	function buildNewSource(): ObsSceneSource {
		const m = SOURCE_TYPE_META[sourceType]
		return {
			id:      `src_${Math.random().toString(36).slice(2, 10)}`,
			type:    sourceType,
			label:   (sourceLabel || m.label).slice(0, 60),
			x:       Math.round((CANVAS_WIDTH  - m.defaultW) / 2),
			y:       Math.round((CANVAS_HEIGHT - m.defaultH) / 2),
			w:       m.defaultW,
			h:       m.defaultH,
			z:       0,    // placeholder ; on recalcule juste avant le PATCH
			visible: true,
			locked:  false,
			config:  sourceConfig,
		}
	}

	async function placeIn(scene: ObsScene): Promise<void> {
		if (busy) return
		busy = true
		error = null
		try {
			// On récupère la version la plus à jour de la scène pour éviter
			// d'écraser une modif faite ailleurs entre le load et le PATCH.
			const fresh = await apiFetch(fetch, `/streamer/obs/scenes/${scene.id}`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			let liveLayout: ObsSceneLayout = scene.layout
			if (fresh.ok) {
				const d = await fresh.json() as { scene: ObsScene }
				liveLayout = d.scene.layout
			}
			const maxZ = liveLayout.sources.reduce((acc, s) => Math.max(acc, s.z), -1)
			const newSrc = { ...buildNewSource(), z: maxZ + 1 }
			const layout: ObsSceneLayout = { sources: [...liveLayout.sources, newSrc] }

			const res = await apiFetch(fetch, `/streamer/obs/scenes/${scene.id}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ layout }),
			})
			if (res.ok) {
				onPlaced(scene.id, scene.name, false)
			} else {
				error = `Placement impossible (HTTP ${res.status}).`
			}
		} catch {
			error = 'Erreur réseau.'
		} finally {
			busy = false
		}
	}

	async function createAndPlace(): Promise<void> {
		const name = newName.trim()
		if (!name || busy) return
		busy = true
		error = null
		try {
			// On crée la scène avec la source déjà dedans pour éviter un
			// 2e roundtrip réseau. Z = 0 (première source = au-dessus du fond).
			const layout: ObsSceneLayout = { sources: [buildNewSource()] }
			const res = await apiFetch(fetch, '/streamer/obs/scenes', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ name, layout }),
			})
			if (res.ok) {
				const d = await res.json() as { scene: ObsScene }
				onPlaced(d.scene.id, d.scene.name, true)
			} else if (res.status === 409) {
				error = 'Une scène a déjà ce nom.'
			} else {
				error = `Création impossible (HTTP ${res.status}).`
			}
		} catch {
			error = 'Erreur réseau.'
		} finally {
			busy = false
		}
	}

	onMount(() => { void loadScenes() })
</script>

<div class="fixed inset-0 z-50 grid place-items-center p-4 bg-black/70 backdrop-blur-sm"
	onclick={onClose}
	onkeydown={(e) => { if (e.key === 'Escape') onClose() }}
	role="dialog" aria-modal="true" tabindex="-1">
	<div class="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-lg shadow-2xl"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="document">
		<header class="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
			<div class="min-w-0">
				<div class="text-xs uppercase tracking-widest font-semibold text-purple-300/80">Placer dans une scène</div>
				<h3 class="text-sm font-semibold text-zinc-100 mt-0.5 truncate">
					{SOURCE_TYPE_META[sourceType].icon} {sourceLabel || SOURCE_TYPE_META[sourceType].label}
				</h3>
			</div>
			<button type="button" onclick={onClose} class="text-zinc-500 hover:text-zinc-200 w-7 h-7 grid place-items-center shrink-0" title="Fermer">✕</button>
		</header>

		<div class="p-4 space-y-3">
			{#if loading}
				<div class="text-center text-xs text-zinc-500 py-6">Chargement…</div>
			{:else if scenes.length === 0 && !creating}
				<div class="rounded-md border border-dashed border-zinc-800 bg-zinc-900/40 px-4 py-5 text-center text-xs text-zinc-500 leading-snug">
					Aucune scène. Crée-en une ci-dessous pour y placer cet élément.
				</div>
			{:else}
				<div class="text-[10px] uppercase tracking-widest font-semibold text-zinc-500">Choisis une scène</div>
				<ul class="space-y-1.5 max-h-64 overflow-y-auto">
					{#each scenes as s (s.id)}
						<li>
							<button type="button" onclick={() => placeIn(s)} disabled={busy}
								class="w-full text-left flex items-center gap-3 p-2.5 rounded-md bg-zinc-900/60 border border-zinc-800 hover:border-purple-500/60 hover:bg-purple-500/5 transition-colors disabled:opacity-50">
								<span class="w-2 h-2 rounded-full shrink-0" style="background: {s.color ?? '#a78bfa'};"></span>
								<div class="min-w-0 flex-1">
									<div class="text-sm text-zinc-100 truncate">{s.name}</div>
									<div class="text-[10px] text-zinc-600">{s.layout.sources.length} source{s.layout.sources.length > 1 ? 's' : ''}</div>
								</div>
								<svg class="w-3.5 h-3.5 text-zinc-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
							</button>
						</li>
					{/each}
				</ul>
			{/if}

			<!-- Création inline d'une nouvelle scène avec la source déjà dedans -->
			<div class="border-t border-zinc-800 pt-3">
				{#if !creating}
					<button type="button" onclick={() => { creating = true; newName = '' }}
						class="w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/40 hover:border-purple-500/70 text-purple-100 rounded-md transition-colors">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
						Créer une nouvelle scène
					</button>
				{:else}
					<div class="space-y-2">
						<label class="block">
							<span class="text-[10px] uppercase tracking-wider font-semibold text-zinc-500">Nom de la scène</span>
							<input type="text" bind:value={newName} maxlength="80"
								placeholder="ex : Dev, Discussion, Pause"
								onkeydown={(e) => { if (e.key === 'Enter') createAndPlace() }}
								class="mt-1 w-full bg-zinc-900 border border-zinc-800 focus:border-purple-500/60 px-3 py-1.5 text-xs text-zinc-100 outline-none rounded-sm"
								autofocus/>
						</label>
						<div class="flex items-center gap-2">
							<button type="button" onclick={createAndPlace} disabled={busy || !newName.trim()}
								class="flex-1 text-xs font-medium bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-white px-3 py-1.5 rounded-sm transition-colors">
								{busy ? 'Création…' : 'Créer et placer'}
							</button>
							<button type="button" onclick={() => { creating = false; error = null }}
								class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-sm">
								Annuler
							</button>
						</div>
					</div>
				{/if}
			</div>

			{#if error}
				<div class="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-sm px-2 py-1.5">{error}</div>
			{/if}
		</div>
	</div>
</div>
