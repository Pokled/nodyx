<script lang="ts">
	import { enhance } from '$app/forms'
	import { page } from '$app/stores'
	import type { PageData } from './$types'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

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
		if (m < 1)  return tFn('amod.just_now')
		if (m < 60) return tFn('amod.ago_min', { n: m })
		if (h < 24) return tFn('amod.ago_h', { n: h })
		return tFn('amod.ago_j', { n: day })
	}
</script>

<svelte:head><title>{tFn('amod.page_title')}</title></svelte:head>

<div>
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">{tFn('amod.title')}</h1>
			<p class="text-sm text-gray-500 mt-0.5">{data.total > 1 ? tFn('amod.total_many', { n: data.total }) : tFn('amod.total_one', { n: data.total })}</p>
		</div>

		<!-- Category filter -->
		<form method="GET">
			<select name="category_id" onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.submit()}
				class="rounded-lg bg-gray-900 border border-gray-800 px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-indigo-700">
				<option value="">{tFn('amod.all_categories')}</option>
				{#each flatCats as c}
					<option value={c.id} selected={c.id === data.catFilter}>
						{'·'.repeat(c.depth * 2)} {c.name}
					</option>
				{/each}
			</select>
		</form>
	</div>

	<div class="rounded-xl border border-gray-800 overflow-x-auto">
		<table class="w-full text-sm min-w-[620px]">
			<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
				<tr>
					<th class="px-4 py-3 text-left">{tFn('amod.col_thread')}</th>
					<th class="px-4 py-3 text-left">{tFn('amod.col_category')}</th>
					<th class="px-4 py-3 text-center">{tFn('amod.col_msgs')}</th>
					<th class="px-4 py-3 text-center">{tFn('amod.col_views')}</th>
					<th class="px-4 py-3 text-center">{tFn('amod.col_status')}</th>
					<th class="px-4 py-3 text-right">{tFn('amod.col_actions')}</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800/60">
				{#each data.threads as thread}
					<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
						<!-- Title -->
						<td class="px-4 py-3 max-w-[280px]">
							<a href="/forum/{thread.category_slug ?? thread.category_id}/{thread.slug ?? thread.id}"
								class="font-medium text-white hover:text-indigo-300 transition-colors line-clamp-1 text-sm">
								{thread.title}
							</a>
							<div class="text-xs text-gray-600 mt-0.5">
								{tFn('amod.by', { name: thread.author_username })} · {timeAgo(thread.created_at)}
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
									<span class="text-xs text-gray-700">·</span>
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
										title={thread.is_pinned ? tFn('amod.unpin') : tFn('amod.pin')}>
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
										title={thread.is_locked ? tFn('amod.unlock') : tFn('amod.lock')}>
										🔒
									</button>
								</form>

								<!-- Delete -->
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={thread.id} />
									<button type="submit"
										onclick={(e) => { if (!confirm(tFn('amod.confirm_delete', { title: thread.title }))) e.preventDefault() }}
										class="text-xs px-2 py-1 rounded bg-gray-800 text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors"
										title={tFn('amod.delete_title')}>
										🗑️
									</button>
								</form>
							</div>
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="6" class="px-4 py-8 text-center text-gray-600">{tFn('amod.none_found')}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>

	<!-- Pagination -->
	{#if data.total > data.limit}
		<div class="flex items-center justify-between mt-4">
			<span class="text-sm text-gray-500">
				{tFn('amod.pagination', { from: data.offset + 1, to: Math.min(data.offset + data.limit, data.total), total: data.total })}
			</span>
			<div class="flex gap-2">
				{#if data.offset > 0}
					<a href="?offset={data.offset - data.limit}{data.catFilter ? `&category_id=${data.catFilter}` : ''}"
						class="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
						{tFn('amod.prev')}
					</a>
				{/if}
				{#if data.offset + data.limit < data.total}
					<a href="?offset={data.offset + data.limit}{data.catFilter ? `&category_id=${data.catFilter}` : ''}"
						class="px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-sm text-gray-300 transition-colors">
						{tFn('amod.next')}
					</a>
				{/if}
			</div>
		</div>
	{/if}
</div>
