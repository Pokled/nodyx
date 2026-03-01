<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);

	function luminance(hex: string) {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
	}
</script>

<svelte:head><title>Tags — Admin Nexus</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-6">Tags</h1>

	{#if form?.error}
		<p class="mb-4 rounded-lg bg-red-900/40 border border-red-800 px-4 py-2 text-sm text-red-300">{form.error}</p>
	{/if}

	<!-- Create form -->
	<details class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50">
		<summary class="cursor-pointer px-5 py-3.5 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none flex items-center gap-2">
			<span class="text-base">+</span> Créer un tag
		</summary>
		<form method="POST" action="?/create" use:enhance class="px-5 pb-5 pt-3 space-y-4 border-t border-gray-800">
			<div class="grid grid-cols-2 gap-4">
				<div>
					<label class="block text-xs text-gray-400 mb-1">Nom</label>
					<input name="name" type="text" required maxlength="50"
						placeholder="ex: Tutoriel"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
				</div>
				<div>
					<label class="block text-xs text-gray-400 mb-1">Couleur</label>
					<input name="color" type="color" value="#6366f1"
						class="h-10 w-full rounded-lg bg-gray-800 border border-gray-700 px-1 cursor-pointer" />
				</div>
			</div>
			<button type="submit"
				class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors">
				Créer
			</button>
		</form>
	</details>

	<!-- Tags list -->
	{#if tags.length === 0}
		<p class="text-sm text-gray-500">Aucun tag. Créez-en un ci-dessus.</p>
	{:else}
		<div class="rounded-xl border border-gray-800 overflow-hidden">
			<table class="w-full text-sm">
				<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left">Tag</th>
						<th class="px-4 py-3 text-left">Slug</th>
						<th class="px-4 py-3 text-right">Action</th>
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
										onclick={(e) => { if (!confirm(`Supprimer "${tag.name}" ?`)) e.preventDefault() }}
										class="text-xs text-red-500 hover:text-red-400">
										Supprimer
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
