<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let editingId = $state<string | null>(null)

	const PERM_LABELS: Record<string, string> = {
		can_post:            'Poster',
		can_create_thread:   'Créer un fil',
		can_create_category: 'Créer une catégorie',
		can_moderate:        'Modérer',
		can_manage_members:  'Gérer les membres',
		can_manage_grades:   'Gérer les grades',
	}

	function permSummary(perms: Record<string, boolean>) {
		return Object.entries(perms).filter(([,v])=>v).map(([k])=>PERM_LABELS[k]??k).join(', ') || '—'
	}

	function luminance(hex: string) {
		return (0.299*parseInt(hex.slice(1,3),16) + 0.587*parseInt(hex.slice(3,5),16) + 0.114*parseInt(hex.slice(5,7),16)) / 255
	}
</script>

<svelte:head><title>Grades — Admin Nexus</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-6">Grades</h1>

	{#if form?.error}
		<p class="mb-4 rounded-lg bg-red-900/40 border border-red-800 px-4 py-2 text-sm text-red-300">{form.error}</p>
	{/if}

	<!-- Create -->
	<details class="mb-6 rounded-xl border border-gray-800 bg-gray-900/50">
		<summary class="cursor-pointer px-5 py-3.5 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none flex items-center gap-2">
			<span class="text-base">+</span> Créer un grade
		</summary>
		<form method="POST" action="?/create" use:enhance class="px-5 pb-5 pt-3 space-y-4 border-t border-gray-800">
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div>
					<label class="block text-xs text-gray-400 mb-1">Nom</label>
					<input name="name" type="text" required maxlength="100"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
				</div>
				<div>
					<label class="block text-xs text-gray-400 mb-1">Couleur</label>
					<input name="color" type="color" value="#99AAB5"
						class="h-10 w-full rounded-lg bg-gray-800 border border-gray-700 px-1 cursor-pointer" />
				</div>
				<div>
					<label class="block text-xs text-gray-400 mb-1">Position</label>
					<input name="position" type="number" value="0" min="0"
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
				</div>
			</div>
			<fieldset>
				<legend class="text-xs text-gray-400 mb-2">Permissions</legend>
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
					{#each Object.entries(PERM_LABELS) as [key, label]}
						<label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
							<input type="checkbox" name={key} class="accent-indigo-500" />
							{label}
						</label>
					{/each}
				</div>
			</fieldset>
			<button type="submit" class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-semibold text-white transition-colors">
				Créer
			</button>
		</form>
	</details>

	<!-- Table -->
	{#if data.grades.length === 0}
		<p class="text-sm text-gray-500">Aucun grade. Créez-en un ci-dessus.</p>
	{:else}
		<div class="rounded-xl border border-gray-800 overflow-hidden mb-10">
			<table class="w-full text-sm">
				<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left">Grade</th>
						<th class="px-4 py-3 text-left">Permissions</th>
						<th class="px-4 py-3 text-right">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800/60">
					{#each data.grades as grade}
						<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
							{#if editingId === grade.id}
								<td colspan="3" class="px-4 py-4">
									<form method="POST" action="?/update" use:enhance={() => {
										return async ({ update }) => { await update(); editingId = null }
									}} class="space-y-3">
										<input type="hidden" name="grade_id" value={grade.id} />
										<div class="grid sm:grid-cols-2 gap-3">
											<div>
												<label class="block text-xs text-gray-400 mb-1">Nom</label>
												<input name="name" type="text" required value={grade.name}
													class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-500" />
											</div>
											<div>
												<label class="block text-xs text-gray-400 mb-1">Couleur</label>
												<input name="color" type="color" value={grade.color}
													class="h-10 w-full rounded-lg bg-gray-800 border border-gray-700 px-1 cursor-pointer" />
											</div>
										</div>
										<fieldset>
											<legend class="text-xs text-gray-400 mb-2">Permissions</legend>
											<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
												{#each Object.entries(PERM_LABELS) as [key, label]}
													<label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
														<input type="checkbox" name={key} class="accent-indigo-500"
															checked={grade.permissions?.[key] ?? false} />
														{label}
													</label>
												{/each}
											</div>
										</fieldset>
										<div class="flex gap-2">
											<button type="submit" class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white">Enregistrer</button>
											<button type="button" onclick={() => editingId = null} class="rounded-lg bg-gray-700 hover:bg-gray-600 px-3 py-1.5 text-xs text-gray-300">Annuler</button>
										</div>
									</form>
								</td>
							{:else}
								<td class="px-4 py-3">
									<span class="inline-block rounded px-2.5 py-1 text-xs font-semibold"
										style="background:{grade.color}; color:{luminance(grade.color)>0.5?'#111':'#fff'}">
										{grade.name}
									</span>
								</td>
								<td class="px-4 py-3 text-xs text-gray-400">{permSummary(grade.permissions ?? {})}</td>
								<td class="px-4 py-3 text-right flex items-center justify-end gap-3">
									<button onclick={() => editingId = grade.id} class="text-xs text-indigo-400 hover:text-indigo-300">Modifier</button>
									<form method="POST" action="?/delete" use:enhance class="inline">
										<input type="hidden" name="grade_id" value={grade.id} />
										<button type="submit" onclick={(e) => { if (!confirm(`Supprimer "${grade.name}" ?`)) e.preventDefault() }}
											class="text-xs text-red-500 hover:text-red-400">Supprimer</button>
									</form>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Assign grades to members -->
	<h2 class="text-lg font-bold text-white mb-4">Attribution aux membres</h2>
	<div class="rounded-xl border border-gray-800 overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
				<tr>
					<th class="px-4 py-3 text-left">Membre</th>
					<th class="px-4 py-3 text-left">Rôle</th>
					<th class="px-4 py-3 text-left">Grade actuel</th>
					<th class="px-4 py-3 text-left">Attribuer</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800/60">
				{#each data.members as member}
					<tr class="bg-gray-900/30 hover:bg-gray-900/60">
						<td class="px-4 py-3 font-medium text-white">{member.username}</td>
						<td class="px-4 py-3 text-xs text-gray-500 capitalize">{member.role}</td>
						<td class="px-4 py-3">
							{#if member.grade_name && member.grade_color}
								<span class="inline-block rounded px-2 py-0.5 text-xs font-medium"
									style="background:{member.grade_color}; color:{luminance(member.grade_color)>0.5?'#111':'#fff'}">
									{member.grade_name}
								</span>
							{:else}
								<span class="text-gray-600 text-xs">—</span>
							{/if}
						</td>
						<td class="px-4 py-3">
							<form method="POST" action="?/assign" use:enhance class="flex items-center gap-2">
								<input type="hidden" name="user_id" value={member.user_id} />
								<select name="grade_id" class="rounded-lg bg-gray-800 border border-gray-700 px-2 py-1.5 text-white text-xs focus:outline-none focus:border-indigo-500">
									<option value="">— Aucun —</option>
									{#each data.grades as g}
										<option value={g.id} selected={g.id === member.grade_id}>{g.name}</option>
									{/each}
								</select>
								<button type="submit" class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white">
									Attribuer
								</button>
							</form>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
