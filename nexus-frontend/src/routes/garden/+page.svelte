<script lang="ts">
	import type { PageData, ActionData } from './$types'
	import { goto, invalidateAll } from '$app/navigation'
	import { page } from '$app/stores'
	import { enhance } from '$app/forms'
	import { PUBLIC_API_URL } from '$env/static/public'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// Local mutable copy of seeds for optimistic updates
	let seeds = $state(data.seeds.map((s: any) => ({ ...s })))

	const CATEGORIES = [
		{ value: '', label: 'Toutes' },
		{ value: 'feature', label: '✨ Fonctionnalité' },
		{ value: 'design',  label: '🎨 Design' },
		{ value: 'plugin',  label: '🔌 Plugin' },
		{ value: 'event',   label: '🎉 Événement' },
	]

	const STAGE_META: Record<string, { icon: string; label: string; color: string }> = {
		germe:  { icon: '🌱', label: 'Germe',  color: 'text-green-400' },
		pousse: { icon: '🌿', label: 'Pousse', color: 'text-emerald-400' },
		fleur:  { icon: '🌸', label: 'Fleur',  color: 'text-pink-400' },
		fruit:  { icon: '🍎', label: 'Fruit',  color: 'text-red-400' },
	}

	let showForm   = $state(false)
	$effect(() => { if (form?.error) showForm = true; })
	let wateringId = $state<string | null>(null)
	let toast      = $state<{ msg: string; emoji: string } | null>(null)
	let toastTimer = $state<ReturnType<typeof setTimeout> | null>(null)

	const PATIENCE_QUOTES = [
		{ msg: 'Tu as déjà arrosé cette graine 💧\n« La patience est une vertu »', emoji: '🌿' },
		{ msg: 'Doucement ! Cette plante a déjà eu sa dose d\'eau 😄\n« Trop d\'eau noie le poisson »', emoji: '🐟' },
		{ msg: 'Tu as voté ici ! Reviens quand une nouvelle graine sera plantée 🌱\n« Chaque chose en son temps »', emoji: '⏳' },
		{ msg: 'Ton arrosoir est vide pour cette graine 🪣\n« La patience est mère de toutes les vertus »', emoji: '❤️' },
	]

	function showToast(msg: string, emoji: string) {
		if (toastTimer) clearTimeout(toastTimer)
		toast = { msg, emoji }
		toastTimer = setTimeout(() => { toast = null }, 4000)
	}

	function applyCategory(cat: string) {
		const u = new URL($page.url)
		if (cat) u.searchParams.set('category', cat)
		else u.searchParams.delete('category')
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	async function waterSeed(seedId: string) {
		if (!data.token) { goto('/auth/login?redirectTo=/garden'); return }
		wateringId = seedId
		const res = await fetch(`${PUBLIC_API_URL}/api/v1/garden/seeds/${seedId}/water`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${data.token}` },
		})
		wateringId = null
		if (res.status === 409) {
			const q = PATIENCE_QUOTES[Math.floor(Math.random() * PATIENCE_QUOTES.length)]
			showToast(q.msg, q.emoji)
			return
		}
		// Optimistic local update — no full page re-fetch
		const seed = seeds.find((s: any) => s.id === seedId)
		if (seed) {
			seed.watered_by_me = true
			seed.water_count += 1
		}
	}

	function growthPercent(stage: string, count: number): number {
		if (stage === 'germe')  return Math.min((count / 10)  * 100, 100)
		if (stage === 'pousse') return Math.min(((count - 10)  / 40)  * 100, 100)
		if (stage === 'fleur')  return Math.min(((count - 50)  / 150) * 100, 100)
		return 100
	}
</script>

<svelte:head>
	<title>Le Jardin Nexus</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">

	<!-- Toast "déjà arrosé" -->
	{#if toast}
		<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-start gap-3 px-5 py-3.5 rounded-2xl bg-gray-900 border border-emerald-700/60 shadow-2xl shadow-black/50 max-w-xs w-full animate-in fade-in slide-in-from-bottom-4 duration-300">
			<span class="text-2xl shrink-0 mt-0.5">{toast.emoji}</span>
			<p class="text-sm text-gray-200 leading-snug whitespace-pre-line">{toast.msg}</p>
			<button onclick={() => toast = null} class="shrink-0 text-gray-600 hover:text-gray-400 mt-0.5 ml-1 transition-colors">✕</button>
		</div>
	{/if}

	<!-- Header -->
	<div class="flex items-center justify-between mb-2">
		<div>
			<h1 class="text-2xl font-bold text-white">🌱 Le Jardin Nexus</h1>
			<p class="text-sm text-gray-400 mt-0.5">Plante des idées, la communauté les arrose. Les plus populaires entrent en développement.</p>
		</div>
		<button
			onclick={() => showForm = !showForm}
			class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors"
		>
			🌱 Planter une graine
		</button>
	</div>

	<!-- Plant form -->
	{#if showForm}
		<div class="my-5 p-5 rounded-xl border border-emerald-800/40 bg-emerald-950/20">
			<h2 class="text-base font-semibold text-white mb-4">Proposer une idée</h2>
			{#if form?.error}
				<p class="mb-3 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{form.error}</p>
			{/if}
			<form method="POST" action="?/plant" use:enhance={() => {
				return async ({ result, update }) => {
					if (result.type === 'success' && (result.data as { planted?: boolean })?.planted) {
						showForm = false
						await update({ reset: true })
						seeds = data.seeds.map((s: any) => ({ ...s }))
					}
				}
			}} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="sm:col-span-2">
					<label class="block text-xs font-medium text-gray-400 mb-1">Titre *</label>
					<input name="title" required maxlength="200" placeholder="Ex: Mode sombre personnalisable"
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500" />
				</div>
				<div class="sm:col-span-2">
					<label class="block text-xs font-medium text-gray-400 mb-1">Description</label>
					<textarea name="description" rows="3" placeholder="Décris ton idée en détail…"
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-emerald-500 resize-none"></textarea>
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Catégorie</label>
					<select name="category"
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white focus:outline-none focus:border-emerald-500">
						{#each CATEGORIES.slice(1) as cat}
							<option value={cat.value}>{cat.label}</option>
						{/each}
					</select>
				</div>
				<div class="flex items-end gap-3">
					<button type="submit" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-semibold text-white transition-colors">
						Planter 🌱
					</button>
					<button type="button" onclick={() => showForm = false}
						class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors">
						Annuler
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Category tabs -->
	<div class="flex gap-1.5 flex-wrap mb-6">
		{#each CATEGORIES as cat}
			<button
				onclick={() => applyCategory(cat.value)}
				class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {data.category === cat.value ? 'bg-emerald-700 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}"
			>
				{cat.label}
			</button>
		{/each}
	</div>

	<!-- Seeds list -->
	{#if seeds.length === 0}
		<div class="text-center py-16 text-gray-500">
			<p class="text-5xl mb-3">🏜️</p>
			<p class="font-medium">Le jardin est vide</p>
			<p class="text-sm mt-1">Plante la première graine !</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each seeds as seed}
				{@const stage = STAGE_META[seed.growth_stage] ?? STAGE_META.germe}
				{@const pct   = growthPercent(seed.growth_stage, seed.water_count)}
				<div class="p-4 rounded-xl border border-gray-800 bg-gray-900 hover:border-gray-700 transition-colors">
					<div class="flex items-start gap-3">
						<span class="text-2xl shrink-0 mt-0.5">{stage.icon}</span>
						<div class="flex-1 min-w-0">
							<div class="flex items-center justify-between gap-3">
								<h3 class="text-sm font-semibold text-white truncate">{seed.title}</h3>
								<span class="text-xs {stage.color} font-medium shrink-0">{stage.label}</span>
							</div>
							{#if seed.description}
								<p class="text-xs text-gray-400 mt-1 line-clamp-2">{seed.description}</p>
							{/if}

							<!-- Growth bar -->
							<div class="mt-2 h-1 rounded-full bg-gray-800 overflow-hidden">
								<div
									class="h-full rounded-full bg-emerald-500 transition-all duration-500"
									style="width: {pct}%"
								></div>
							</div>

							<div class="flex items-center justify-between mt-2">
								<span class="text-[10px] text-gray-600">
									{seed.water_count} arrosage{seed.water_count !== 1 ? 's' : ''}
									{#if seed.harvest_date}
										&nbsp;· 🍎 Implémenté
									{/if}
								</span>
								<button
									onclick={() => waterSeed(seed.id)}
									disabled={wateringId === seed.id || seed.watered_by_me}
									class="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors disabled:opacity-50
										{seed.watered_by_me
											? 'bg-emerald-900/40 text-emerald-400 cursor-default'
											: 'bg-gray-800 hover:bg-emerald-900/40 text-gray-400 hover:text-emerald-400'}"
								>
									💧 {seed.watered_by_me ? 'Arrosé' : 'Arroser'}
								</button>
							</div>
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Pagination -->
		{#if seeds.length === 30}
			<div class="flex justify-center mt-8">
				<a
					href="?{new URLSearchParams({ category: data.category, offset: String(data.offset + 30) })}"
					class="px-5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors"
				>
					Voir plus →
				</a>
			</div>
		{/if}
	{/if}
</div>
