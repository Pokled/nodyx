<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { t } from '$lib/i18n';

	const tFn = $derived($t);

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);

	function luminance(hex: string) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	}
</script>

<svelte:head><title>{tFn('atags.page_title')}</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-6">{tFn('atags.title')}</h1>

	{#if form?.error}
		<p class="mb-4 rounded-lg bg-red-900/40 border border-red-800 px-4 py-2 text-sm text-red-300">{form.error}</p>
	{/if}

	<!-- Create form -->
	<details class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50">
		<summary class="cursor-pointer px-5 py-3.5 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none flex items-center gap-2">
			<span class="text-base">+</span> {tFn('atags.create_tag')}
		</summary>
		<form method="POST" action="?/create" use:enhance class="px-5 pb-5 pt-3 space-y-4 border-t border-gray-800">
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label for="tag-create-name" class="block text-xs text-gray-400 mb-1">{tFn('atags.name')}</label>
					<input id="tag-create-name" name="name" type="text" required maxlength="50"
						placeholder={tFn('atags.name_ph')}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
				</div>
				<div>
					<label for="tag-create-color" class="block text-xs text-gray-400 mb-1">{tFn('atags.color')}</label>
					<input id="tag-create-color" name="color" type="color" value="var(--nx-accent)"
						class="h-10 w-full rounded-lg bg-gray-800 border border-gray-700 px-1 cursor-pointer" />
				</div>
			</div>
			<button type="submit"
				class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors">
				{tFn('atags.create')}
			</button>
		</form>
	</details>

	<!-- Tags list -->
	{#if tags.length === 0}
		<p class="text-sm text-gray-500">{tFn('atags.empty')}</p>
	{:else}
		<div class="rounded-xl border border-gray-800 overflow-x-auto">
			<table class="w-full text-sm min-w-[480px]">
				<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left">{tFn('atags.col_tag')}</th>
						<th class="px-4 py-3 text-left">{tFn('atags.col_slug')}</th>
						<th class="px-4 py-3 text-right">{tFn('atags.col_action')}</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800/60">
					{#each tags as tag}
						<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
							<td class="px-4 py-3">
								<span class="inline-block rounded-full px-3 py-1 text-xs font-semibold"
									style="background:{tag.color}; color:{luminance(tag.color) > 0.5 ? '#111' : '#fff'}">
									{tag.name}
								</span>
							</td>
							<td class="px-4 py-3 text-gray-400 font-mono text-xs">{tag.slug}</td>
							<td class="px-4 py-3 text-right">
								<form method="POST" action="?/delete" use:enhance class="inline">
									<input type="hidden" name="tag_id" value={tag.id} />
									<button type="submit"
										onclick={(e) => { if (!confirm(tFn('atags.confirm_delete', { name: tag.name }))) e.preventDefault() }}
										class="text-xs text-red-500 hover:text-red-400">
										{tFn('atags.delete')}
									</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
