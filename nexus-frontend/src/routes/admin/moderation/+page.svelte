<script lang="ts">
	import { enhance } from '$app/forms'
	import { page } from '$app/stores'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	function flatCategories(nodes: any[], depth = 0): any[] {
		return nodes.flatMap(n => [{ ...n, depth }, ...flatCategories(n.children ?? [], depth + 1)])
	}
	const flatCats = $derived(flatCategories(data.categories))

	function timeAgo(d: string) {
		const diff = Date.now() - new Date(d).getTime()
		const m = Math.floor(diff / 60000)
		const h = Math.floor(m / 60)
		const day = Math.floor(h / 24)
		if (m < 1)  return 'à l\'instant'
		if (m < 60) return `${m}min`
		if (h < 24) return `${h}h`
		return `${day}j`
	}
</script>

<svelte:head><title>Modération — Admin Nexus</title></svelte:head>

<div>
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">Modération</h1>
			<p class="text-sm text-gray-500 mt-0.5">{data.total} fil{data.total > 1 ? 's' : ''} au total</p>
		</div>

		<!-- Category filter -->
		<form method="GET">
			<select name="category_id" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.submit()}
				class="rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-700">
				<option value="">Toutes les catégories</option>
				{#each flatCats as c}
					<option value={c.id} selected={c.id === data.catFilter}>
						{'·'.repeat(c.depth * 2)} {c.name}
					</option>
				{/each}
			</select>
		</form>
	</div>

	<div class="rounded-xl border border-gray-800 overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
				<tr>
					<th class="px-4 py-3 text-left">Fil</th>
					<th class="px-4 py-3 text-left">Catégorie</th>
					<th class="px-4 py-3 text-center">Msgs</th>
					<th class="px-4 py-3 text-center">Vues</th>
					<th class="px-4 py-3 text-center">Statut</th>
					<th class="px-4 py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800/60">
				{#each data.threads as thread}
					<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
						<!-- Title -->
						<td class="px-4 py-3 max-w-[280px]">
							<a href="/forum/{thread.category_id}/{thread.id}"
								class="font-medium text-white hover:text-indigo-300 transition-colors line-clamp-1 text-sm">
								{thread.title}
							</a>
							<div class="text-xs text-gray-600 mt-0.5">
								par {thread.author_username} · {timeAgo(thread.created_at)}
							</div>
						</td>

						<!-- Category -->
						<td class="px-4 py-3 text-xs text-gray-400">{thread.category_name}</td>

						<!-- Counts -->
						<td class="px-4 py-3 text-center text-gray-400 tabular-nums">{thread.post_count}</td>
						<td class="px-4 py-3 text-center text-gray-400 tabular-nums">{thread.views}</td>

						<!-- Status badges -->
						<td class="px-4 py-3">
							<div class="flex items-center justify-center gap-1.5">
								{#if thread.is_pinned}
									<span class="px-1.5 py-0.5 rounded text-xs bg-yellow-900/50 text-yellow-400 border border-yellow-800/50">📌</span>
								{/if}
								{#if thread.is_locked}
									<span class="px-1.5 py-0.5 rounded text-xs bg-red-900/50 text-red-400 border border-red-800/50">🔒</span>
								{/if}
								{#if !thread.is_pinned && !thread.is_locked}
									<span class="text-xs text-gray-700">—</span>
								{/if}
							</div>
						</td>

						<!-- Actions -->
						<td class="px-4 py-3">
							<div class="flex items-center justify-end gap-2">
								<!-- Pin toggle -->
								<form method="POST" action="?/pin" use:enhance>
									<input type="hidden" name="id" value={thread.id} />
									<input type="hidden" name="value" value={String(!thread.is_pinned)} />
									<button type="submit"
										class="text-xs px-2 py-1 rounded transition-colors
										       {thread.is_pinned
										         ? 'bg-yellow-900/40 text-yellow-400 hover:bg-yellow-900/60'
										         : 'bg-gray-800 text-gray-500 hover:text-yellow-400 hover:bg-gray-700'}"
										title="{thread.is_pinned ? 'Désépingler' : 'Épingler'}">
										📌
									</button>
								</form>

								<!-- Lock toggle -->
								<form method="POST" action="?/lock" use:enhance>
									<input type="hidden" name="id" value={thread.id} />
									<input type="hidden" name="value" value={String(!thread.is_locked)} />
									<button type="submit"
										class="text-xs px-2 py-1 rounded transition-colors
										       {thread.is_locked
										         ? 'bg-red-900/40 text-red-400 hover:bg-red-900/60'
										         : 'bg-gray-800 text-gray-500 hover:text-red-400 hover:bg-gray-700'}"
										title="{thread.is_locked ? 'Déverrouiller' : 'Verrouiller'}">
										🔒
									</button>
								</form>

								<!-- Delete -->
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={thread.id} />
									<button type="submit"
										onclick={(e) => { if (!confirm(`Supprimer "${thread.title}" et tous ses messages ?`)) e.preventDefault() }}
										class="text-xs px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
										title="Supprimer définitivement">
										🗑️
									</button>
								</form>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="px-4 py-8 text-center text-gray-600">Aucun fil trouvé.</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if data.total > data.limit}
		<div class="flex items-center justify-between mt-4">
			<span class="text-sm text-gray-500">
				{data.offset + 1}–{Math.min(data.offset + data.limit, data.total)} sur {data.total}
			</span>
			<div class="flex gap-2">
				{#if data.offset > 0}
					<a href="?offset={data.offset - data.limit}{data.catFilter ? `&category_id=${data.catFilter}` : ''}"
						class="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
						← Précédent
					</a>
				{/if}
				{#if data.offset + data.limit < data.total}
					<a href="?offset={data.offset + data.limit}{data.catFilter ? `&category_id=${data.catFilter}` : ''}"
						class="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
						Suivant →
					</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
