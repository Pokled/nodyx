<script lang="ts">
	import type { PageData } from './$types'
	import { enhance } from '$app/forms'

	let { data }: { data: PageData } = $props()

	const CATEGORY_ICONS: Record<string, string> = {
		feature: '✨', design: '🎨', plugin: '🔌', event: '📅',
	}

	const STAGE_ICONS: Record<string, string> = {
		germe: '🌱', pousse: '🌿', fleur: '🌸', fruit: '🍎',
	}

	function growthStage(waterCount: number): string {
		if (waterCount >= 200) return 'fruit'
		if (waterCount >= 50)  return 'fleur'
		if (waterCount >= 10)  return 'pousse'
		return 'germe'
	}

	function formatDate(d: string) {
		return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
	}
</script>

<svelte:head><title>Admin — Jardin</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-xl font-bold text-white">Jardin des idées</h1>
		<p class="text-sm text-gray-400 mt-0.5">{data.seeds.length} graine{data.seeds.length > 1 ? 's' : ''} au total</p>
	</div>

	{#if data.seeds.length === 0}
		<p class="text-gray-500 text-sm">Aucune graine plantée.</p>
	{:else}
		<div class="rounded-xl border border-gray-800 overflow-hidden">
			<table class="w-full text-sm">
				<thead class="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left">Idée</th>
						<th class="px-4 py-3 text-left">Catégorie</th>
						<th class="px-4 py-3 text-left">Stade</th>
						<th class="px-4 py-3 text-left">Votes</th>
						<th class="px-4 py-3 text-left">Planté par</th>
						<th class="px-4 py-3 text-left">Date</th>
						<th class="px-4 py-3 text-right">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800">
					{#each data.seeds as seed}
						{@const stage = growthStage(seed.water_count)}
						<tr class="bg-gray-900/40 hover:bg-gray-800/40 transition-colors {seed.harvest_date ? 'opacity-60' : ''}">
							<td class="px-4 py-3 max-w-xs">
								<p class="text-white font-medium truncate">{seed.title}</p>
								{#if seed.description}
									<p class="text-gray-500 text-xs truncate mt-0.5">{seed.description}</p>
								{/if}
							</td>
							<td class="px-4 py-3 text-gray-400">
								{CATEGORY_ICONS[seed.category] ?? ''} {seed.category}
							</td>
							<td class="px-4 py-3">
								<span class="text-base">{STAGE_ICONS[stage]}</span>
								<span class="text-xs text-gray-400 ml-1">{stage}</span>
							</td>
							<td class="px-4 py-3 text-white font-medium">{seed.water_count}</td>
							<td class="px-4 py-3 text-gray-400">{seed.planter_username ?? '—'}</td>
							<td class="px-4 py-3 text-gray-500 text-xs">{formatDate(seed.planted_at)}</td>
							<td class="px-4 py-3">
								<div class="flex items-center justify-end gap-2">
									{#if !seed.harvest_date}
										<!-- Mark as harvested -->
										<form method="POST" action="?/harvest" use:enhance>
											<input type="hidden" name="id" value={seed.id} />
											<button type="submit"
												class="px-2.5 py-1 rounded text-xs font-medium bg-green-900/40 text-green-400 hover:bg-green-800/60 transition-colors"
												title="Marquer comme implémentée">
												🍎 Implémenter
											</button>
										</form>
									{:else}
										<span class="text-xs text-gray-500">Implémenté le {formatDate(seed.harvest_date)}</span>
									{/if}
									<!-- Delete -->
									<form method="POST" action="?/delete" use:enhance={({ cancel }) => {
										if (!confirm(`Supprimer "${seed.title}" ?`)) cancel()
									}}>
										<input type="hidden" name="id" value={seed.id} />
										<button type="submit"
											class="px-2.5 py-1 rounded text-xs font-medium bg-red-900/40 text-red-400 hover:bg-red-800/60 transition-colors">
											Supprimer
										</button>
									</form>
								</div>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
