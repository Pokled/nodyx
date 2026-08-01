<script lang="ts">
	import type { PageData } from './$types'
	import { enhance } from '$app/forms'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

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

<svelte:head><title>{tFn('agard.page_title')}</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-xl font-bold text-white">{tFn('agard.title')}</h1>
		<p class="text-sm text-gray-400 mt-0.5">{data.seeds.length > 1 ? tFn('agard.total_many', { n: data.seeds.length }) : tFn('agard.total_one', { n: data.seeds.length })}</p>
	</div>

	{#if data.seeds.length === 0}
		<p class="text-gray-500 text-sm">{tFn('agard.empty')}</p>
	{:else}
		<div class="rounded-xl border border-gray-800 overflow-hidden">
			<table class="w-full text-sm">
				<thead class="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left">{tFn('agard.col_idea')}</th>
						<th class="px-4 py-3 text-left">{tFn('agard.col_category')}</th>
						<th class="px-4 py-3 text-left">{tFn('agard.col_stage')}</th>
						<th class="px-4 py-3 text-left">{tFn('agard.col_votes')}</th>
						<th class="px-4 py-3 text-left">{tFn('agard.col_planted_by')}</th>
						<th class="px-4 py-3 text-left">{tFn('agard.col_date')}</th>
						<th class="px-4 py-3 text-right">{tFn('agard.col_actions')}</th>
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
								<span class="text-xs text-gray-400 ml-1">{tFn(`agard.stage_${stage}`)}</span>
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
												title={tFn('agard.harvest_title')}>
												{tFn('agard.harvest_btn')}
											</button>
										</form>
									{:else}
										<span class="text-xs text-gray-500">{tFn('agard.harvested_on', { date: formatDate(seed.harvest_date) })}</span>
									{/if}
									<!-- Delete -->
									<form method="POST" action="?/delete" use:enhance={({ cancel }) => {
										if (!confirm(tFn('agard.confirm_delete', { title: seed.title }))) cancel()
									}}>
										<input type="hidden" name="id" value={seed.id} />
										<button type="submit"
											class="px-2.5 py-1 rounded text-xs font-medium bg-red-900/40 text-red-400 hover:bg-red-800/60 transition-colors">
											{tFn('agard.delete')}
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
