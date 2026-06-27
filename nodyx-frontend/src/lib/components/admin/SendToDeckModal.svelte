<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { onMount } from 'svelte'
	import type { Deck, DeckButton, DeckLayout } from '$lib/types/deck'

	// Modal de placement rapide : depuis une biblio (soundboard, clips, etc.),
	// on choisit un deck + une page + une case libre pour créer un bouton
	// pré-rempli. Évite à l'admin de naviguer dans l'éditeur de deck.

	interface Props {
		token:     string
		// Le bouton qu'on veut créer (l'appelant décide du label, icon, action,
		// gradient en fonction de ce qu'il "envoie").
		buttonTemplate: Omit<DeckButton, 'id' | 'x' | 'y' | 'w' | 'h'>
		// Texte affiché en haut du modal pour contextualiser ("Ajouter ce son", etc.)
		title:     string
		subtitle?: string
		onClose:   () => void
		onPlaced?: (deckId: string, pageId: string) => void
	}

	let { token, buttonTemplate, title, subtitle, onClose, onPlaced }: Props = $props()

	let decks   = $state<Deck[]>([])
	let loading = $state(true)
	let saving  = $state(false)
	let error   = $state<string | null>(null)

	let selectedDeckId = $state<string | null>(null)
	let selectedPageId = $state<string | null>(null)

	const selectedDeck = $derived(decks.find(d => d.id === selectedDeckId) ?? null)
	const selectedPage = $derived(selectedDeck?.layout.pages.find(p => p.id === selectedPageId) ?? selectedDeck?.layout.pages[0] ?? null)

	function newButtonId(): string {
		return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
	}

	function isOccupied(page: { buttons: DeckButton[] }, x: number, y: number): boolean {
		return page.buttons.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
	}

	// Détecte la première case libre (lecture top-left → bottom-right). null
	// si la page est pleine.
	function firstFreeCell(layout: DeckLayout, pageId: string): { x: number; y: number } | null {
		const page = layout.pages.find(p => p.id === pageId)
		if (!page) return null
		for (let y = 0; y < layout.rows; y++) {
			for (let x = 0; x < layout.cols; x++) {
				if (!isOccupied(page, x, y)) return { x, y }
			}
		}
		return null
	}

	async function loadDecks(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/decks', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const d = await res.json() as { decks: Deck[] }
				decks = d.decks ?? []
				if (decks.length > 0) {
					selectedDeckId = decks[0].id
					selectedPageId = decks[0].layout.pages[0]?.id ?? null
				}
			}
		} finally {
			loading = false
		}
	}

	async function placeAt(x: number, y: number): Promise<void> {
		if (!selectedDeck || !selectedPage || saving) return
		saving = true
		error = null
		try {
			// Clone profond, ajoute le nouveau bouton dans la page cible, PATCH.
			const layout: DeckLayout = JSON.parse(JSON.stringify(selectedDeck.layout))
			const page = layout.pages.find(p => p.id === selectedPage.id)
			if (!page) { error = 'Page introuvable'; return }
			page.buttons.push({
				...buttonTemplate,
				id: newButtonId(),
				x, y, w: 1, h: 1,
			})
			const res = await apiFetch(fetch, `/streamer/decks/${selectedDeck.id}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ layout }),
			})
			if (!res.ok) {
				error = 'Échec sauvegarde'
				return
			}
			// Met à jour le deck local pour visualiser immédiatement le bouton placé.
			const d = await res.json() as { deck: Deck }
			decks = decks.map(x => x.id === d.deck.id ? d.deck : x)
			onPlaced?.(selectedDeck.id, selectedPage.id)
			// On laisse le modal ouvert : Preston peut enchaîner les placements
			// (utile pour bâtir une page complète sans rouvrir 10 fois).
		} catch {
			error = 'Erreur réseau'
		} finally {
			saving = false
		}
	}

	async function placeAuto(): Promise<void> {
		if (!selectedDeck || !selectedPage) return
		const free = firstFreeCell(selectedDeck.layout, selectedPage.id)
		if (!free) { error = 'Page pleine, choisis une autre page ou une case libre.'; return }
		await placeAt(free.x, free.y)
	}

	function backdropClick(e: MouseEvent): void {
		if (e.target === e.currentTarget) onClose()
	}

	onMount(loadDecks)
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onclick={backdropClick}>
	<div class="w-full max-w-2xl border border-purple-500/40 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 shadow-2xl rounded-md overflow-hidden">

		<!-- Header -->
		<header class="px-5 py-4 border-b border-zinc-800 flex items-start justify-between gap-3">
			<div class="min-w-0">
				<h3 class="text-sm font-semibold text-zinc-100 truncate">{title}</h3>
				{#if subtitle}<p class="text-xs text-zinc-500 mt-0.5 truncate">{subtitle}</p>{/if}
			</div>
			<button type="button" onclick={onClose}
				class="p-1 rounded text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 transition-colors" aria-label="Fermer">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
			</button>
		</header>

		<div class="p-5 space-y-4">
			{#if loading}
				<div class="text-sm text-zinc-500 text-center py-6">Chargement des decks…</div>
			{:else if decks.length === 0}
				<div class="text-center py-6 space-y-2">
					<div class="text-3xl">🎛️</div>
					<div class="text-sm text-zinc-300">Aucun Stream Deck créé pour l'instant.</div>
					<div class="text-xs text-zinc-500">Crée-en un depuis l'onglet <span class="text-purple-300 font-medium">Stream Deck</span>, puis reviens ici.</div>
				</div>
			{:else}
				<!-- Sélection deck -->
				<div>
					<div class="text-[11px] uppercase tracking-wide font-medium text-zinc-500 mb-1.5">Deck</div>
					<div class="flex items-center gap-1.5 flex-wrap">
						{#each decks as d (d.id)}
							{@const active = d.id === selectedDeckId}
							<button type="button" onclick={() => { selectedDeckId = d.id; selectedPageId = d.layout.pages[0]?.id ?? null }}
								class="text-xs font-medium px-2.5 py-1 rounded-sm border transition-colors
									{active ? 'bg-purple-500/20 border-purple-500/60 text-purple-100' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'}">
								{d.label}
								<span class="text-[10px] text-zinc-500 ml-1 font-mono">{d.layout.pages.reduce((n, p) => n + p.buttons.length, 0)}b</span>
							</button>
						{/each}
					</div>
				</div>

				<!-- Sélection page -->
				{#if selectedDeck && selectedDeck.layout.pages.length > 0}
					<div>
						<div class="text-[11px] uppercase tracking-wide font-medium text-zinc-500 mb-1.5">Page</div>
						<div class="flex items-center gap-1.5 flex-wrap">
							{#each selectedDeck.layout.pages as p (p.id)}
								{@const active = p.id === selectedPageId}
								{@const accent = p.color ?? 'var(--nx-accent-2-soft)'}
								<button type="button" onclick={() => selectedPageId = p.id}
									class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-sm border transition-colors
										{active ? 'bg-purple-500/15 border-purple-500/60 text-purple-100' : 'bg-zinc-900 border-zinc-800 text-zinc-300 hover:border-zinc-700'}">
									<span class="w-1.5 h-1.5 rounded-full" style="background: {accent};"></span>
									{p.name}
									<span class="text-[10px] text-zinc-500 font-mono">{p.buttons.length}</span>
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<!-- Mini grille interactive : cellules libres cliquables -->
				{#if selectedDeck && selectedPage}
					{@const cols = selectedDeck.layout.cols}
					{@const rows = selectedDeck.layout.rows}
					<div>
						<div class="flex items-center justify-between mb-1.5">
							<div class="text-[11px] uppercase tracking-wide font-medium text-zinc-500">Placement</div>
							<span class="text-[10px] text-zinc-500">{cols} × {rows} — clique sur une case libre</span>
						</div>
						<div class="mx-auto bg-zinc-950 border border-zinc-800 p-2 rounded-sm" style="max-width: 360px;">
							<div class="aspect-[4/3] grid gap-1"
								style="grid-template-columns: repeat({cols}, minmax(0, 1fr)); grid-template-rows: repeat({rows}, minmax(0, 1fr));">
								{#each Array(rows * cols) as _, idx (idx)}
									{@const cx = idx % cols}
									{@const cy = Math.floor(idx / cols)}
									{@const occupant = selectedPage.buttons.find(b => cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h)}
									{#if occupant}
										<div class="rounded-sm bg-gradient-to-br from-zinc-700/70 to-zinc-800/70 border border-zinc-700/60 grid place-items-center"
											style="grid-column: {occupant.x + 1} / span {occupant.w}; grid-row: {occupant.y + 1} / span {occupant.h};"
											title={occupant.label}>
											<span class="text-[10px] opacity-70">{occupant.icon}</span>
										</div>
									{:else}
										<button type="button" onclick={() => placeAt(cx, cy)} disabled={saving}
											class="rounded-sm border border-dashed border-zinc-700 hover:border-purple-500/80 hover:bg-purple-500/15 disabled:opacity-30 grid place-items-center text-zinc-600 hover:text-purple-200 transition-colors"
											style="grid-column: {cx + 1}; grid-row: {cy + 1};"
											title="Placer ici">
											<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
										</button>
									{/if}
								{/each}
							</div>
						</div>
					</div>
				{/if}

				{#if error}
					<div class="text-xs px-3 py-2 border-l-2 border-rose-500 bg-rose-500/10 text-rose-200">{error}</div>
				{/if}
			{/if}
		</div>

		<!-- Footer : auto-place + close -->
		<footer class="px-5 py-3 border-t border-zinc-800 bg-zinc-900/60 flex items-center justify-between gap-2">
			<span class="text-[11px] text-zinc-500">Le modal reste ouvert : tu peux enchaîner plusieurs placements.</span>
			<div class="flex items-center gap-2">
				{#if decks.length > 0}
					<button type="button" onclick={placeAuto} disabled={saving || !selectedDeck || !selectedPage}
						class="text-xs font-medium bg-purple-500 hover:bg-purple-400 disabled:bg-zinc-800 disabled:text-zinc-500 shadow-sm shadow-purple-500/30 disabled:shadow-none text-white px-3 py-1.5 rounded-sm transition-colors">
						{saving ? 'Placement…' : '⚡ Auto-placement'}
					</button>
				{/if}
				<button type="button" onclick={onClose}
					class="text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-sm transition-colors">
					Fermer
				</button>
			</div>
		</footer>
	</div>
</div>
