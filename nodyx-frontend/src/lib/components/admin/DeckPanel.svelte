<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import Tooltip from '$lib/components/ui/Tooltip.svelte'
	import DeckEditor from './DeckEditor.svelte'
	import type { Deck } from '$lib/types/deck'

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	let decks    = $state<Deck[]>([])
	let loading  = $state(true)
	let creating = $state(false)
	let editingDeckId = $state<string | null>(null)
	let toast    = $state<{ text: string; ok: boolean } | null>(null)

	const publicBaseUrl = $derived(browser ? window.location.origin : '')

	const editingDeck = $derived(editingDeckId ? decks.find(d => d.id === editingDeckId) ?? null : null)

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3000)
	}

	async function loadDecks(): Promise<void> {
		loading = true
		try {
			const res = await apiFetch(fetch, '/streamer/decks', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { decks: Deck[] }
				decks = data.decks ?? []
			}
		} finally {
			loading = false
		}
	}

	async function createDeck(): Promise<void> {
		if (creating) return
		creating = true
		try {
			const res = await apiFetch(fetch, '/streamer/decks', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ label: 'Mon Deck' }),
			})
			if (res.ok) {
				const data = await res.json() as { deck: Deck }
				decks = [...decks, data.deck]
				editingDeckId = data.deck.id
				flash('Deck créé. Configure tes boutons.', true)
			} else {
				flash('Échec création.', false)
			}
		} finally {
			creating = false
		}
	}

	async function revokeDeck(d: Deck): Promise<void> {
		if (!confirm(`Révoquer le deck "${d.label}" ? L'URL mobile sera invalidée.`)) return
		const res = await apiFetch(fetch, `/streamer/decks/${d.id}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (res.ok) {
			decks = decks.filter(x => x.id !== d.id)
			if (editingDeckId === d.id) editingDeckId = null
			flash(`Deck "${d.label}" révoqué.`, true)
		} else {
			flash('Échec révocation.', false)
		}
	}

	function onDeckSaved(d: Deck): void {
		const idx = decks.findIndex(x => x.id === d.id)
		if (idx >= 0) {
			decks[idx] = d
			decks = decks
		}
	}

	function fmtRelative(iso: string | null | undefined): string {
		if (!iso) return 'jamais'
		const diff = Date.now() - new Date(iso).getTime()
		const m = Math.floor(diff / 60_000)
		if (m < 1)   return "à l'instant"
		if (m < 60)  return `il y a ${m}min`
		const h = Math.floor(m / 60)
		if (h < 24)  return `il y a ${h}h`
		const d = Math.floor(h / 24)
		return `il y a ${d}j`
	}

	onMount(loadDecks)
</script>

<section class="rounded-xl border border-cyan-500/25 bg-gradient-to-br from-cyan-950/30 via-slate-900/60 to-indigo-950/20 p-5 space-y-4">
	{#if editingDeck}
		<DeckEditor
			deck={editingDeck}
			{token}
			{publicBaseUrl}
			onClose={() => { editingDeckId = null; loadDecks() }}
			onSaved={onDeckSaved}
		/>
	{:else}
		<header class="flex items-center justify-between gap-3 flex-wrap">
			<div class="flex items-center gap-2.5">
				<svg class="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
				<h2 class="text-sm font-semibold text-white">Nodyx Deck — Stream Deck mobile</h2>
				<Tooltip text="Configure une grille de boutons accessible depuis ton téléphone ou tablette. Tu peux y lancer des clips, placer des markers, envoyer des messages chat ou déclencher tes commandes custom en un seul tap." variant="tip" position="bottom"/>
			</div>
			<button type="button" onclick={createDeck} disabled={creating}
				class="text-xs bg-cyan-500/20 hover:bg-cyan-500/30 disabled:opacity-30 border border-cyan-500/50 text-cyan-100 px-4 py-1.5 rounded font-semibold transition-colors inline-flex items-center gap-1.5">
				{creating ? 'Création…' : '+ Nouveau deck'}
			</button>
		</header>

		{#if toast}
			<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
				<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
				{toast.text}
			</div>
		{/if}

		<!-- Aide rapide -->
		<div class="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3 text-[11px] text-cyan-100 leading-relaxed space-y-1">
			<div class="font-semibold text-cyan-300">Comment ça marche ?</div>
			<div>1. Crée un deck et configure ses boutons (Top Clips, Marker, Message, Commande…).</div>
			<div>2. Copie l'URL mobile, ouvre-la sur ton tel/tablette (idéal : ajoute-la à l'écran d'accueil pour un effet app).</div>
			<div>3. En live, tu touches un bouton sur ton tel → l'action se déclenche instantanément côté Nodyx.</div>
		</div>

		<!-- Liste des decks -->
		{#if loading}
			<div class="text-xs text-slate-500 text-center py-8">Chargement…</div>
		{:else if decks.length === 0}
			<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-8 text-center space-y-2">
				<div class="text-4xl">🎛️</div>
				<div class="text-sm text-slate-300">Aucun deck pour l'instant</div>
				<div class="text-[11px] text-slate-500">Crée ton premier deck en un clic. Tu pourras le configurer ensuite avec des presets prêts à l'emploi.</div>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
				{#each decks as d (d.id)}
					<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2">
						<div class="flex items-start justify-between gap-2">
							<div class="flex-1 min-w-0">
								<div class="text-sm font-semibold text-white truncate">{d.label}</div>
									<div class="text-[10px] text-slate-500 mt-0.5">
									{d.layout.cols} × {d.layout.rows} · {d.layout.pages.reduce((n, p) => n + p.buttons.length, 0)} boutons{d.layout.pages.length > 1 ? ` · ${d.layout.pages.length} pages` : ''}
								</div>
								<div class="text-[10px] text-slate-500">
									Dernier ping : {fmtRelative(d.lastSeenAt)}
								</div>
							</div>
						</div>

						<!-- Mini preview -->
						<div class="aspect-[4/3] rounded bg-slate-950/60 border border-slate-800 p-1.5">
							<div class="h-full grid gap-0.5"
								style="grid-template-columns: repeat({d.layout.cols}, minmax(0, 1fr)); grid-template-rows: repeat({d.layout.rows}, minmax(0, 1fr));">
								{#each Array(d.layout.rows * d.layout.cols) as _, idx (idx)}
									<div class="rounded bg-slate-800/40"></div>
								{/each}
								{#each d.layout.pages[0]?.buttons ?? [] as b (b.id)}
									<div class="rounded bg-gradient-to-br from-cyan-500/60 to-indigo-700/60 border border-white/10"
										style="grid-column: {b.x + 1} / span {b.w}; grid-row: {b.y + 1} / span {b.h};"></div>
								{/each}
							</div>
						</div>

						<div class="flex items-center gap-1.5 pt-1">
							<button type="button" onclick={() => editingDeckId = d.id}
								class="flex-1 text-[11px] bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-100 px-2 py-1.5 rounded font-medium transition-colors">
								Éditer
							</button>
							<button type="button" onclick={() => revokeDeck(d)}
								class="text-[10px] bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 px-2 py-1.5 rounded transition-colors">
								Révoquer
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</section>
