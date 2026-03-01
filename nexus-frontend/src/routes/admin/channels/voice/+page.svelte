<script lang="ts">
	import type { PageData, ActionData } from './$types'
	import { enhance } from '$app/forms'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let orderedChannels = $state<any[]>([])
	$effect(() => { orderedChannels = data.channels?.slice() ?? [] })

	let reorderForm = $state<HTMLFormElement | null>(null)
	let idsJson = $derived(JSON.stringify(orderedChannels.map((c: any) => c.id)))

	function moveChannel(index: number, dir: -1 | 1) {
		const target = index + dir
		if (target < 0 || target >= orderedChannels.length) return
		const copy = orderedChannels.slice()
		;[copy[index], copy[target]] = [copy[target], copy[index]]
		orderedChannels = copy
		setTimeout(() => reorderForm?.requestSubmit(), 0)
	}
</script>

<svelte:head><title>Canaux vocaux — Admin Nexus</title></svelte:head>

<div>
	<div class="flex items-center gap-3 mb-2">
		<h1 class="text-2xl font-bold text-white">Canaux vocaux</h1>
		<span class="px-2.5 py-1 rounded-full text-xs font-semibold bg-green-900/40 text-green-300 border border-green-800/40">
			WebRTC P2P — Phase 2
		</span>
	</div>
	<p class="text-sm text-gray-500 mb-8">
		Salons audio temps réel. Connexions directes entre navigateurs via WebRTC (STUN Google + Cloudflare).
		Chaque salon supporte jusqu'à 8 participants simultanés en mode mesh P2P.
	</p>

	{#if form?.error}
		<p class="mb-4 text-sm text-red-400 bg-red-900/30 border border-red-800/50 rounded-lg px-4 py-2">{form.error}</p>
	{/if}
	{#if form?.ok}
		<p class="mb-4 text-sm text-green-400 bg-green-900/30 border border-green-800/50 rounded-lg px-4 py-2">Action effectuée ✓</p>
	{/if}

	<!-- Hidden reorder form -->
	<form bind:this={reorderForm} method="POST" action="?/reorder" use:enhance class="hidden">
		<input name="ids" value={idsJson} />
	</form>

	<!-- Liste des salons vocaux -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Salons actifs</h2>

		{#if orderedChannels.length === 0}
			<p class="text-sm text-gray-600 italic py-4 text-center">
				Aucun salon vocal créé. Utilisez le formulaire ci-dessous pour en créer un.
			</p>
		{:else}
			<div class="space-y-2">
				{#each orderedChannels as ch, i (ch.id)}
					<div class="flex items-center justify-between px-4 py-3 rounded-lg bg-gray-800/60 border border-gray-700/60">
						<div class="flex items-center gap-2">
							<!-- Position controls -->
							<div class="flex flex-col gap-0.5 shrink-0">
								<button
									type="button"
									onclick={() => moveChannel(i, -1)}
									disabled={i === 0}
									class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1"
									title="Monter"
								>▲</button>
								<button
									type="button"
									onclick={() => moveChannel(i, 1)}
									disabled={i === orderedChannels.length - 1}
									class="text-gray-600 hover:text-gray-300 disabled:opacity-20 text-xs leading-none px-1"
									title="Descendre"
								>▼</button>
							</div>
							<span class="text-xl">🔊</span>
							<div>
								<p class="text-sm font-medium text-white">{ch.name}</p>
								<p class="text-xs text-gray-500 font-mono">#{ch.slug}</p>
							</div>
						</div>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="id" value={ch.id} />
							<button
								type="submit"
								class="text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 px-3 py-1.5 rounded transition-colors"
								onclick={(e) => { if (!confirm(`Supprimer "${ch.name}" ?`)) e.preventDefault() }}
							>
								Supprimer
							</button>
						</form>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Créer un salon vocal -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5 mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Créer un salon vocal</h2>
		<form method="POST" action="?/create" use:enhance class="flex gap-3">
			<input
				type="text"
				name="name"
				required
				placeholder="ex: Général, Gaming, Lounge…"
				class="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
			/>
			<button type="submit" class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors whitespace-nowrap">
				Créer
			</button>
		</form>
	</div>

	<!-- Informations techniques -->
	<div class="rounded-xl border border-indigo-900/40 bg-indigo-950/20 p-5">
		<h3 class="text-sm font-semibold text-indigo-300 mb-3">Architecture WebRTC — Phase 2 → Phase 3</h3>
		<div class="space-y-3 text-xs text-gray-400">
			<div class="flex items-start gap-3">
				<span class="text-green-400 font-bold shrink-0">✓</span>
				<div><strong class="text-gray-200">Signaling</strong> — Socket.IO (serveur Nexus). En Phase 3 : remplacé par DHT/libp2p sans serveur central.</div>
			</div>
			<div class="flex items-start gap-3">
				<span class="text-green-400 font-bold shrink-0">✓</span>
				<div><strong class="text-gray-200">Transport</strong> — WebRTC P2P direct (mesh). ICE via STUN Google + Cloudflare. En Phase 3 : WireGuard inter-instances.</div>
			</div>
			<div class="flex items-start gap-3">
				<span class="text-green-400 font-bold shrink-0">✓</span>
				<div><strong class="text-gray-200">Codec</strong> — Opus 48kHz (standard WebRTC, qualité voix optimale).</div>
			</div>
			<div class="flex items-start gap-3">
				<span class="text-yellow-500 font-bold shrink-0">~</span>
				<div><strong class="text-gray-200">Capacité</strong> — Max ~8 participants (mesh = N×(N-1)/2 connexions). SFU pour ≥9 → Phase 3.</div>
			</div>
			<div class="flex items-start gap-3">
				<span class="text-gray-600 font-bold shrink-0">○</span>
				<div><strong class="text-gray-200">TURN fallback</strong> — Non implémenté (Phase 3). Requis pour NAT symétrique strict.</div>
			</div>
		</div>
	</div>
</div>
