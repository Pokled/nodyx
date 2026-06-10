<script lang="ts">
	import { browser } from '$app/environment'
	import {
		CANVAS_WIDTH, CANVAS_HEIGHT, SOURCE_TYPE_META, FULL_SCENE_VIEWPORT_TYPES,
		resolveSourceUrl,
		type ObsSceneLayout, type ObsSceneSource,
	} from '$lib/types/obsScenes'

	// ─── Canvas scène OBS-like ──────────────────────────────────────────────
	// Reproduit la zone preview d'OBS : fond noir 16:9, grille subtile, sources
	// positionnées en pixels absolus (1920x1080) puis scaled visuellement. La
	// sélection affiche les 8 poignées de resize style OBS (rouge ardent).
	//
	// Interactions :
	//   • clic sur une source : sélection (par-dessus les autres)
	//   • drag corps source : déplacement (snap aux bords + centre canvas)
	//   • drag poignée : resize avec ratio libre, clampé au canvas
	//   • clic hors source : désélection
	//
	// Le composant émet `onChange(layout)` à chaque modif persistante (fin de
	// drag) pour que le parent puisse sauvegarder. Pendant un drag actif, on
	// mute en local pour rester fluide à 60fps sans roundtrip réseau.

	interface Props {
		layout:        ObsSceneLayout
		selectedId:    string | null
		onSelect:      (id: string | null) => void
		onChange:      (layout: ObsSceneLayout) => void
		// Optionnel : résout le label affiché pour une source en fonction de
		// l'overlay/playlist parent. Permet d'afficher "super alerte" plutôt
		// que "Alert Box" quand le streamer a renommé l'overlay. Fallback
		// sur le label stocké si non fourni.
		labelFor?:     (s: ObsSceneSource) => string
		// Mode rendu : 'live' affiche les iframes des overlays (preview
		// fidèle), 'wireframe' garde les placeholders rapides (utile pour
		// composer sans surcharger le CPU). Défaut 'live'.
		previewMode?:  'live' | 'wireframe'
	}

	let { layout, selectedId, onSelect, onChange, labelFor, previewMode = 'live' }: Props = $props()

	// Origin du navigateur pour construire les URLs des iframes. SSR-safe :
	// vide tant qu'on n'est pas dans un browser, on cache les iframes.
	const origin = $derived(browser ? window.location.origin : '')

	// Réf au conteneur pour calculer le ratio pixel canvas → pixel écran.
	// Recalculé sur ResizeObserver pour gérer redimensionnement de la fenêtre.
	let stageEl: HTMLDivElement | null = null
	let scale = $state(1)

	function updateScale(): void {
		if (!stageEl) return
		const w = stageEl.clientWidth
		scale = w > 0 ? w / CANVAS_WIDTH : 1
	}

	$effect(() => {
		if (!stageEl) return
		updateScale()
		const obs = new ResizeObserver(updateScale)
		obs.observe(stageEl)
		return () => obs.disconnect()
	})

	// Le layout est immuable depuis l'extérieur, mais on a besoin de l'écrire
	// pendant un drag. On garde une copie locale "dragLayout" qu'on flush au
	// parent en fin d'interaction. Tant qu'aucun drag : on lit le prop.
	let dragLayout = $state<ObsSceneLayout | null>(null)
	const effectiveLayout = $derived<ObsSceneLayout>(dragLayout ?? layout)

	// Sources triées par z pour l'ordre de stack (z bas = fond, z haut = devant).
	const sortedSources = $derived<ObsSceneSource[]>(
		[...effectiveLayout.sources].sort((a, b) => a.z - b.z),
	)

	// ── Drag/resize state ────────────────────────────────────────────────
	type DragMode = null | 'move' | `resize-${'nw'|'n'|'ne'|'e'|'se'|'s'|'sw'|'w'}`
	let dragMode  = $state<DragMode>(null)
	let dragId    = $state<string | null>(null)
	let dragStart = { mouseX: 0, mouseY: 0, x: 0, y: 0, w: 0, h: 0 }

	function findSource(id: string): ObsSceneSource | null {
		return effectiveLayout.sources.find(s => s.id === id) ?? null
	}

	// Le snap aux guides 0/centre/max donne ce feeling OBS où les bords se
	// magnétisent. Tolérance en pixels CANVAS (8px = ~1% sur 1920).
	const SNAP_TOLERANCE = 16
	function snap(value: number, targets: number[]): number {
		for (const t of targets) {
			if (Math.abs(value - t) <= SNAP_TOLERANCE) return t
		}
		return value
	}

	function startMove(e: PointerEvent, src: ObsSceneSource): void {
		if (src.locked) return
		;(e.target as HTMLElement).setPointerCapture(e.pointerId)
		dragMode  = 'move'
		dragId    = src.id
		dragStart = { mouseX: e.clientX, mouseY: e.clientY, x: src.x, y: src.y, w: src.w, h: src.h }
		dragLayout = JSON.parse(JSON.stringify(layout))
		onSelect(src.id)
		e.stopPropagation()
		e.preventDefault()
	}

	function startResize(e: PointerEvent, src: ObsSceneSource, handle: Exclude<DragMode, null | 'move'>): void {
		if (src.locked) return
		;(e.target as HTMLElement).setPointerCapture(e.pointerId)
		dragMode  = handle
		dragId    = src.id
		dragStart = { mouseX: e.clientX, mouseY: e.clientY, x: src.x, y: src.y, w: src.w, h: src.h }
		dragLayout = JSON.parse(JSON.stringify(layout))
		onSelect(src.id)
		e.stopPropagation()
		e.preventDefault()
	}

	function onPointerMove(e: PointerEvent): void {
		if (!dragMode || !dragId || !dragLayout) return
		const dx = (e.clientX - dragStart.mouseX) / scale
		const dy = (e.clientY - dragStart.mouseY) / scale

		const idx = dragLayout.sources.findIndex(s => s.id === dragId)
		if (idx < 0) return
		const src = dragLayout.sources[idx]

		if (dragMode === 'move') {
			let nx = dragStart.x + dx
			let ny = dragStart.y + dy
			// Snap aux bords du canvas + centres (X et Y).
			nx = snap(nx,                              [0, (CANVAS_WIDTH  - src.w) / 2, CANVAS_WIDTH  - src.w])
			ny = snap(ny,                              [0, (CANVAS_HEIGHT - src.h) / 2, CANVAS_HEIGHT - src.h])
			src.x = Math.max(0, Math.min(CANVAS_WIDTH  - src.w, Math.round(nx)))
			src.y = Math.max(0, Math.min(CANVAS_HEIGHT - src.h, Math.round(ny)))
		} else {
			// Resize : ajuste x/y/w/h selon la poignée pressée.
			let nx = dragStart.x
			let ny = dragStart.y
			let nw = dragStart.w
			let nh = dragStart.h
			const MIN = 24    // évite de réduire la source à 0 (perdue à l'œil)

			if (dragMode.includes('e')) nw = Math.max(MIN, dragStart.w + dx)
			if (dragMode.includes('s')) nh = Math.max(MIN, dragStart.h + dy)
			if (dragMode.includes('w')) {
				const nxRaw = dragStart.x + dx
				const maxX  = dragStart.x + dragStart.w - MIN
				nx = Math.min(maxX, Math.max(0, nxRaw))
				nw = dragStart.w + (dragStart.x - nx)
			}
			if (dragMode.includes('n')) {
				const nyRaw = dragStart.y + dy
				const maxY  = dragStart.y + dragStart.h - MIN
				ny = Math.min(maxY, Math.max(0, nyRaw))
				nh = dragStart.h + (dragStart.y - ny)
			}
			// Clamp au canvas
			if (nx + nw > CANVAS_WIDTH)  nw = CANVAS_WIDTH  - nx
			if (ny + nh > CANVAS_HEIGHT) nh = CANVAS_HEIGHT - ny

			src.x = Math.round(nx)
			src.y = Math.round(ny)
			src.w = Math.max(MIN, Math.round(nw))
			src.h = Math.max(MIN, Math.round(nh))
		}
		// Trigger reactivity en cassant la référence
		dragLayout = { sources: [...dragLayout.sources] }
	}

	function endDrag(e: PointerEvent): void {
		if (!dragMode || !dragLayout) return
		try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* déjà release */ }
		onChange(dragLayout)
		dragLayout = null
		dragMode = null
		dragId = null
	}

	// Clic sur le stage sans toucher une source = désélection. Utilise le
	// event target pour distinguer le stage vs un enfant.
	function onStageClick(e: MouseEvent): void {
		if (e.target === e.currentTarget) onSelect(null)
	}

	function metaFor(src: ObsSceneSource): typeof SOURCE_TYPE_META[keyof typeof SOURCE_TYPE_META] {
		return SOURCE_TYPE_META[src.type]
	}
</script>

<!-- Wrapper extérieur : noir + grid pattern pour évoquer le canvas OBS.
     Le ratio 16:9 est maintenu via aspect-ratio CSS, scale calcule combien
     1 pixel canvas vaut côté écran. -->
<div bind:this={stageEl}
	role="application"
	tabindex="-1"
	class="relative w-full aspect-video bg-black border border-zinc-800 overflow-hidden select-none cursor-default"
	style="background-image:
		linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),
		linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px);
		background-size: {64 * scale}px {64 * scale}px;"
	onclick={onStageClick}
	onpointermove={onPointerMove}
	onpointerup={endDrag}
	onpointercancel={endDrag}>

	<!-- Fond de scène (couleur unie ou image). On le dessine sous toutes
	     les sources, au-dessus de la grille subtile : si l'utilisateur a
	     posé un fond opaque, il masque la grille (comportement attendu). -->
	{#if effectiveLayout.background && effectiveLayout.background.kind === 'color' && effectiveLayout.background.color}
		<div class="absolute inset-0 pointer-events-none" style="background-color: {effectiveLayout.background.color}; z-index: 0;"></div>
	{:else if effectiveLayout.background && effectiveLayout.background.kind === 'image' && effectiveLayout.background.url}
		<img src={effectiveLayout.background.url} alt=""
			class="absolute inset-0 w-full h-full object-cover pointer-events-none"
			style="z-index: 0;"
			loading="lazy"/>
	{/if}

	<!-- Repère "SAFE AREA" 5% sur les bords, hint subtil OBS-style. -->
	<div class="absolute pointer-events-none border border-dashed border-white/5"
		style="left: 5%; top: 5%; right: 5%; bottom: 5%; z-index: 1;"></div>

	{#each sortedSources as src (src.id)}
		{@const m = metaFor(src)}
		{@const isSel = selectedId === src.id}
		{@const liveUrl = previewMode === 'live' ? resolveSourceUrl(src, origin) : null}
		<!-- Toutes les sources sont placables et resizables comme une Browser
		     Source OBS classique. L'iframe rend dans le wrapper et le
		     overflow:hidden coupe ce qui dépasse — au streamer de choisir le
		     cadrage. Le drag/select reste sur le wrapper. -->
		<div
			role="button"
			tabindex="0"
			class="absolute group transition-shadow overflow-hidden {src.visible ? '' : 'opacity-30'}"
			style="
				left:   {(src.x / CANVAS_WIDTH)  * 100}%;
				top:    {(src.y / CANVAS_HEIGHT) * 100}%;
				width:  {(src.w / CANVAS_WIDTH)  * 100}%;
				height: {(src.h / CANVAS_HEIGHT) * 100}%;
				z-index: {src.z};
			"
			onpointerdown={(e) => startMove(e, src)}
			onkeydown={(e) => { if (e.key === 'Enter') onSelect(src.id) }}>

			{#if liveUrl}
				<!-- Aperçu Phase A : l'iframe a une viewport CSS = la taille
				     pixel de la source (src.w × src.h dans le repère
				     1920×1080). On scale uniformément par canvas_scale pour
				     adapter à la taille affichée du canvas. C'est l'approche
				     la plus simple et la plus prévisible : ce que tu vois
				     dans le canvas correspond à ce que rendrait une Browser
				     Source OBS de cette taille. Le rendu n'est pas pixel-
				     perfect pour les overlays Nodyx à CSS fixe (ils
				     apparaissent à leur taille naturelle), mais le streamer
				     compose visuellement et OBS gère le rendu final.
				     L'aperçu réel et fidèle viendra en Phase B (OBS WebSocket
				     + screenshots de la scène réelle). -->
				<iframe
					src={liveUrl}
					title={labelFor ? labelFor(src) : (src.label || m.label)}
					loading="lazy"
					sandbox="allow-scripts allow-same-origin allow-popups"
					class="absolute top-0 left-0 border-0 pointer-events-none bg-transparent"
					style="
						width:  {src.w}px;
						height: {src.h}px;
						transform: scale({scale});
						transform-origin: top left;
					"
				></iframe>
				<!-- Badge label en haut-gauche. Pour les overlays full-scene
				     (pointer-events: none sur le wrapper), c'est l'unique zone
				     cliquable pour sélectionner cette source depuis le canvas
				     sans passer par la liste Sources. -->
				<button type="button"
					onclick={(e) => { e.stopPropagation(); onSelect(src.id) }}
					class="absolute top-0 left-0 text-[9px] uppercase tracking-wider font-semibold px-1.5 py-0.5 hover:brightness-125 transition"
					style="
						color: #{m.accent};
						background: rgba(0,0,0,0.55);
						pointer-events: auto;
						border: {isSel ? '1px solid rgba(239,68,68,0.95)' : '1px solid transparent'};
					">
					{labelFor ? labelFor(src) : (src.label || m.label)}
				</button>
			{:else}
				<!-- Placeholder visuel par type : utilisé quand pas d'URL (overlay
				     non lié, placeholder_video, mode wireframe). -->
				<div class="absolute inset-0 flex flex-col items-center justify-center text-center px-2 py-2 backdrop-blur-[2px]"
					style="background: rgba(0,0,0,0.35);
						border: 1px solid #{m.accent}80;
						box-shadow: inset 0 0 0 1px rgba(255,255,255,0.04);">
					<div class="text-2xl mb-0.5 leading-none">{m.icon}</div>
					<div class="text-[10px] uppercase tracking-wider font-semibold" style="color: #{m.accent};">
						{labelFor ? labelFor(src) : (src.label || m.label)}
					</div>
				</div>
			{/if}
			{#if src.locked}
				<div class="absolute top-1 right-1 text-[10px] text-amber-400 pointer-events-none" title="Verrouillée">🔒</div>
			{/if}
			{#if !src.visible}
				<div class="absolute top-1 left-1 text-[10px] text-zinc-500 pointer-events-none" title="Cachée">⊘</div>
			{/if}

			<!-- Sélection OBS-style : bordure rouge ardent + poignées aux coins
			     et milieux de bords. Les poignées sont des carrés de 8px (côté
			     écran, donc fixes peu importe le zoom). -->
			{#if isSel}
				<div class="absolute inset-0 pointer-events-none ring-2 ring-red-500/95 ring-inset"></div>
				{#if !src.locked}
					{#each ['nw','n','ne','e','se','s','sw','w'] as h (h)}
						<button type="button"
							class="absolute w-2.5 h-2.5 bg-red-500 border border-white/80 shadow-md
								{h === 'nw' || h === 'sw' ? 'left-0 -translate-x-1/2' : ''}
								{h === 'ne' || h === 'se' ? 'right-0 translate-x-1/2' : ''}
								{h === 'n'  ? 'left-1/2 -translate-x-1/2' : ''}
								{h === 's'  ? 'left-1/2 -translate-x-1/2' : ''}
								{h === 'w'  ? 'left-0 -translate-x-1/2 top-1/2 -translate-y-1/2' : ''}
								{h === 'e'  ? 'right-0 translate-x-1/2 top-1/2 -translate-y-1/2' : ''}
								{h === 'nw' || h === 'n' || h === 'ne' ? 'top-0 -translate-y-1/2' : ''}
								{h === 'sw' || h === 's' || h === 'se' ? 'bottom-0 translate-y-1/2' : ''}
								{h === 'nw' || h === 'se' ? 'cursor-nwse-resize' : ''}
								{h === 'ne' || h === 'sw' ? 'cursor-nesw-resize' : ''}
								{h === 'n'  || h === 's'  ? 'cursor-ns-resize' : ''}
								{h === 'e'  || h === 'w'  ? 'cursor-ew-resize' : ''}
							"
							aria-label="Redimensionner ({h})"
							onpointerdown={(e) => startResize(e, src, `resize-${h}` as Exclude<DragMode, null | 'move'>)}>
						</button>
					{/each}
				{/if}
			{:else}
				<!-- Halo de hover discret pour suggérer qu'on peut cliquer -->
				<div class="absolute inset-0 pointer-events-none ring-1 ring-white/0 group-hover:ring-white/30 transition"></div>
			{/if}
		</div>
	{/each}

	{#if effectiveLayout.sources.length === 0}
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-2 text-zinc-600 text-sm pointer-events-none">
			<svg class="w-10 h-10 opacity-60" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
				<rect x="3" y="3" width="18" height="18" rx="2"/>
				<path d="M9 9h6v6H9z"/>
				<path d="M3 9h6M3 15h6M15 3v6M15 15v6"/>
			</svg>
			<div class="text-xs uppercase tracking-widest text-zinc-500">Canvas vide</div>
			<div class="text-[11px] text-zinc-600 max-w-[24ch] text-center">Ajoute une source depuis la colonne de droite pour démarrer.</div>
		</div>
	{/if}

	<!-- Resolution badge bas-droite : on est sur du 1920x1080 référence. Hint
	     pour l'utilisateur qu'on raisonne en pixels OBS, pas en CSS responsive. -->
	<div class="absolute bottom-1 right-1 text-[9px] font-mono text-white/30 bg-black/30 px-1 py-0.5 rounded-sm pointer-events-none">
		{CANVAS_WIDTH}×{CANVAS_HEIGHT}
	</div>
</div>
