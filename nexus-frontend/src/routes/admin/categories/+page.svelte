<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let editingId = $state<string | null>(null)

	// Flatten tree for the parent selector
	function flatten(nodes: any[], depth = 0): Array<{ id: string; name: string; depth: number }> {
		return nodes.flatMap(n => [
			{ id: n.id, name: n.name, depth },
			...flatten(n.children ?? [], depth + 1),
		])
	}
	const flatCats = $derived(flatten(data.categories))

	function renderTree(nodes: any[], depth = 0): any[] {
		return nodes.flatMap(n => [{ ...n, depth }, ...renderTree(n.children ?? [], depth + 1)])
	}
	const flatRows = $derived(renderTree(data.categories))
</script>

<svelte:head><title>Catégories — Admin Nexus</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-6">Catégories</h1>

	{#if form?.error}
		<p class="mb-4 rounded-lg bg-red-900/40 border border-red-800 px-4 py-2 text-sm text-red-300">{form.error}</p>
	{/if}

	<!-- Create -->
	<details class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50">
		<summary class="cursor-pointer px-5 py-3.5 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none flex items-center gap-2">
			<span>+</span> Nouvelle catégorie
		</summary>
		<form method="POST" action="?/create" use:enhance class="px-5 pb-5 pt-3 space-y-4 border-t border-gray-800">
			<div class="grid sm:grid-cols-2 gap-4">
				<div>
					<label class="block text-xs text-gray-400 mb-1">Nom *</label>
					<input name="name" type="text" required maxlength="100"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
				</div>
				<div>
					<label class="block text-xs text-gray-400 mb-1">Catégorie parente (optionnel)</label>
					<select name="parent_id" class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">
						<option value="">— Racine —</option>
						{#each flatCats as c}
							<option value={c.id}>{'·'.repeat(c.depth * 2)} {c.name}</option>
						{/each}
					</select>
				</div>
			</div>
			<div>
				<label class="block text-xs text-gray-400 mb-1">Description</label>
				<input name="description" type="text" maxlength="500" placeholder="Optionnel"
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
			</div>
			<button type="submit" class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white">
				Créer
			</button>
		</form>
	</details>

	<!-- Tree table -->
	<div class="rounded-xl border border-gray-800 overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
				<tr>
					<th class="px-4 py-3 text-left">Catégorie</th>
					<th class="px-4 py-3 text-center">Fils</th>
					<th class="px-4 py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800/60">
				{#each flatRows as cat}
					<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
						{#if editingId === cat.id}
							<td colspan="3" class="px-4 py-4">
								<form method="POST" action="?/edit" use:enhance={() => {
									return async ({ update }) => { await update(); editingId = null }
								}} class="space-y-3">
									<input type="hidden" name="id" value={cat.id} />
									<div class="grid sm:grid-cols-2 gap-3">
										<div>
											<label class="block text-xs text-gray-400 mb-1">Nom</label>
											<input name="name" type="text" required value={cat.name}
												class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
										</div>
										<div>
											<label class="block text-xs text-gray-400 mb-1">Catégorie parente</label>
											<select name="parent_id" class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500">
												<option value="__unchanged__">— Inchangée —</option>
												<option value="">— Racine —</option>
												{#each flatCats.filter(c => c.id !== cat.id) as c}
													<option value={c.id} selected={c.id === cat.parent_id}>
														{'·'.repeat(c.depth * 2)} {c.name}
													</option>
												{/each}
											</select>
										</div>
									</div>
									<div>
										<label class="block text-xs text-gray-400 mb-1">Description</label>
										<input name="description" type="text" value={cat.description ?? ''}
											class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
									</div>
									<div class="flex gap-2">
										<button type="submit" class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white">Enregistrer</button>
										<button type="button" onclick={() => editingId = null} class="rounded-lg bg-gray-700 hover:bg-gray-600 px-3 py-1.5 text-xs text-gray-300">Annuler</button>
									</div>
								</form>
							</td>
						{:else}
							<td class="px-4 py-3">
								<div style="padding-left: {cat.depth * 1.5}rem" class="flex items-center gap-2">
									{#if cat.depth > 0}<span class="text-gray-700 text-xs">└</span>{/if}
									<div>
										<span class="font-medium text-white">{cat.name}</span>
										{#if cat.description}
											<span class="text-xs text-gray-500 ml-2">{cat.description}</span>
										{/if}
									</div>
								</div>
							</td>
							<td class="px-4 py-3 text-center text-gray-500 tabular-nums">{cat.thread_count}</td>
							<td class="px-4 py-3 text-right">
								<div class="flex items-center justify-end gap-3">
									<button onclick={() => editingId = cat.id} class="text-xs text-indigo-400 hover:text-indigo-300">Modifier</button>
									<form method="POST" action="?/delete" use:enhance class="inline">
										<input type="hidden" name="id" value={cat.id} />
										<button type="submit"
											onclick={(e) => { if (!confirm(`Supprimer "${cat.name}" ? Cette action est irréversible.`)) e.preventDefault() }}
											class="text-xs text-red-500 hover:text-red-400">
											Supprimer
										</button>
									</form>
								</div>
							</td>
						{/if}
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
