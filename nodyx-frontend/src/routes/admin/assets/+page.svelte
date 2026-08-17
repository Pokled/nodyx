<script lang="ts">
	import type { PageData } from './$types'
	import { enhance } from '$app/forms'
	import { PUBLIC_API_URL } from '$env/static/public'

	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	const TYPE_ICONS: Record<string, string> = {
		frame: '🖼️', banner: '🎨', badge: '🏅', sticker: '⭐',
		font: '🔤', theme: '🎭', emoji: '😀', sound: '🔊',
	}

	function thumbUrl(asset: { thumbnail_path?: string; file_path: string }) {
		const base = PUBLIC_API_URL.replace('/api/v1', '')
		return `${base}/uploads/${asset.thumbnail_path ?? asset.file_path}`
	}

	function confirmDelete(name: string) {
		return confirm(tFn('aast.confirm_delete', { name }))
	}
</script>

<svelte:head><title>{tFn('aast.page_title')}</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-xl font-bold text-white">{tFn('aast.title')}</h1>
		<p class="text-sm text-gray-400 mt-0.5">{data.assets.length > 1 ? tFn('aast.total_many', { n: data.assets.length }) : tFn('aast.total_one', { n: data.assets.length })}</p>
	</div>

	{#if data.assets.length === 0}
		<p class="text-gray-500 text-sm">{tFn('aast.empty')}</p>
	{:else}
		<div class="rounded-xl border border-gray-800 overflow-x-auto">
			<table class="tableau-cartes w-full text-sm md:min-w-[720px]">
				<thead class="bg-gray-900 text-gray-400 text-xs uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left w-12"></th>
						<th class="px-4 py-3 text-left">{tFn('aast.col_name')}</th>
						<th class="px-4 py-3 text-left">{tFn('aast.col_type')}</th>
						<th class="px-4 py-3 text-left">{tFn('aast.col_creator')}</th>
						<th class="px-4 py-3 text-left">{tFn('aast.col_size')}</th>
						<th class="px-4 py-3 text-left">{tFn('aast.col_status')}</th>
						<th class="px-4 py-3 text-right">{tFn('aast.col_actions')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800">
					{#each data.assets as asset}
						<tr class="bg-gray-900/40 hover:bg-gray-800/40 transition-colors {asset.is_banned ? 'opacity-50' : ''}">
							<td class="px-4 py-3">
								{#if asset.thumbnail_path || asset.mime_type?.startsWith('image/')}
									<img src={thumbUrl(asset)} alt={asset.name}
										class="w-10 h-10 rounded-lg object-cover border border-gray-700" />
								{:else}
									<div class="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center text-xl">
										{TYPE_ICONS[asset.asset_type] ?? '📦'}
									</div>
								{/if}
							</td>
							<td class="px-4 py-3" data-label={tFn('aast.col_name')}>
								<a href="/library/{asset.id}" target="_blank"
									class="text-white hover:text-indigo-300 font-medium truncate max-w-xs block">
									{asset.name}
								</a>
							</td>
							<td class="px-4 py-3 text-gray-400" data-label={tFn('aast.col_type')}>{TYPE_ICONS[asset.asset_type] ?? ''} {asset.asset_type}</td>
							<td class="px-4 py-3 text-gray-400" data-label={tFn('aast.col_creator')}>{asset.creator_username ?? '·'}</td>
							<td class="px-4 py-3 text-gray-500 text-xs" data-label={tFn('aast.col_size')}>{tFn('aast.kb', { n: Math.round(asset.file_size / 1024) })}</td>
							<td class="px-4 py-3" data-label={tFn('aast.col_status')}>
								{#if asset.is_banned}
									<span class="px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 text-xs font-medium">{tFn('aast.banned')}</span>
								{:else if !asset.is_public}
									<span class="px-2 py-0.5 rounded-full bg-gray-800 text-gray-500 text-xs font-medium">{tFn('aast.private')}</span>
								{:else}
									<span class="px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 text-xs font-medium">{tFn('aast.public')}</span>
								{/if}
							</td>
							<td class="px-4 py-3">
								<div class="flex items-center justify-end gap-2">
									<!-- Ban / Unban -->
									<form method="POST" action="?/ban" use:enhance>
										<input type="hidden" name="id" value={asset.id} />
										<button type="submit"
											class="px-2.5 py-1 rounded text-xs font-medium transition-colors
											       {asset.is_banned
											         ? 'bg-green-900/40 text-green-400 hover:bg-green-800/60'
											         : 'bg-yellow-900/40 text-yellow-400 hover:bg-yellow-800/60'}">
											{asset.is_banned ? tFn('aast.unban') : tFn('aast.ban')}
										</button>
									</form>
									<!-- Delete -->
									<form method="POST" action="?/delete" use:enhance={({ cancel }) => {
										if (!confirmDelete(asset.name)) cancel()
									}}>
										<input type="hidden" name="id" value={asset.id} />
										<button type="submit"
											class="px-2.5 py-1 rounded text-xs font-medium bg-red-900/40 text-red-400 hover:bg-red-800/60 transition-colors">
											{tFn('aast.delete')}
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
