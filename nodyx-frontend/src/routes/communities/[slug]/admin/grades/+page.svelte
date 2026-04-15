<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// Track which grade is being edited (null = none)
	let editingId = $state<string | null>(null)

	const PERMISSION_LABELS: Record<string, string> = {
		can_post:            'Poster',
		can_create_thread:   'Créer un thread',
		can_create_category: 'Créer une catégorie',
		can_moderate:        'Modérer',
		can_manage_members:  'Gérer les membres',
		can_manage_grades:   'Gérer les grades',
	}

	function permSummary(permissions: Record<string, boolean>): string {
		return Object.entries(permissions)
			.filter(([, v]) => v)
			.map(([k]) => PERMISSION_LABELS[k] ?? k)
			.join(', ') || '—'
	}

	function luminance(hex: string): number {
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		return (0.299 * r + 0.587 * g + 0.114 * b) / 255
	}
</script>

<svelte:head>
	<title>Grades — {data.community.name} — Nodyx</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-6">
	<nav class="text-sm text-gray-500 mb-4">
		<a href="/communities/{data.community.slug}" class="hover:text-gray-300">{data.community.name}</a>
		<span class="mx-2">/</span>
		<span class="text-gray-300">Grades</span>
	</nav>

	<h1 class="text-2xl font-bold text-white mb-6">Grades de la communauté</h1>

	{#if form?.error}
		<p class="mb-4 rounded bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
			{form.error}
		</p>
	{/if}

	<!-- Create form -->
	<details class="mb-6 rounded-lg border border-gray-700 bg-gray-900">
		<summary class="cursor-pointer px-4 py-3 text-sm font-semibold text-indigo-300 hover:text-indigo-200 select-none">
			+ Créer un grade
		</summary>

		<form method="POST" action="?/create" use:enhance class="px-4 pb-4 pt-2 space-y-4">
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
				<div>
					<label for="new-name" class="block text-xs text-gray-400 mb-1">Nom</label>
					<input
						id="new-name"
						name="name"
						type="text"
						required
						maxlength="100"
						class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
					/>
				</div>
				<div>
					<label for="new-color" class="block text-xs text-gray-400 mb-1">Couleur</label>
					<input
						id="new-color"
						name="color"
						type="color"
						value="#99AAB5"
						class="h-9 w-full rounded bg-gray-800 border border-gray-700 px-1 cursor-pointer"
					/>
				</div>
				<div>
					<label for="new-position" class="block text-xs text-gray-400 mb-1">Position</label>
					<input
						id="new-position"
						name="position"
						type="number"
						value="0"
						min="0"
						class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
					/>
				</div>
			</div>

			<fieldset>
				<legend class="text-xs text-gray-400 mb-2">Permissions</legend>
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
					{#each Object.entries(PERMISSION_LABELS) as [key, label]}
						<label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
							<input type="checkbox" name={key} class="accent-indigo-500" />
							{label}
						</label>
					{/each}
				</div>
			</fieldset>

			<button
				type="submit"
				class="rounded bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white transition-colors"
			>
				Créer
			</button>
		</form>
	</details>

	<!-- Grades table -->
	{#if data.grades.length === 0}
		<p class="text-sm text-gray-500">Aucun grade pour l'instant.</p>
	{:else}
		<div class="overflow-x-auto rounded-lg border border-gray-700">
			<table class="w-full text-sm text-left">
				<thead class="bg-gray-800 text-gray-400 text-xs uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3">Nom</th>
						<th class="px-4 py-3">Couleur</th>
						<th class="px-4 py-3">Permissions</th>
						<th class="px-4 py-3 text-right">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800">
					{#each data.grades as grade}
						<tr class="bg-gray-900 hover:bg-gray-800/50 transition-colors">
							{#if editingId === grade.id}
								<!-- Inline edit row -->
								<td colspan="4" class="px-4 py-3">
									<form method="POST" action="?/update" use:enhance={() => { return async ({ update }) => { await update(); editingId = null } }} class="space-y-3">
										<input type="hidden" name="grade_id" value={grade.id} />
										<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
											<div>
												<label for="comm-grade-edit-name-{grade.id}" class="block text-xs text-gray-400 mb-1">Nom</label>
												<input
													id="comm-grade-edit-name-{grade.id}"
													name="name"
													type="text"
													required
													value={grade.name}
													class="w-full rounded bg-gray-800 border border-gray-600 px-3 py-1.5 text-white text-sm focus:outline-none focus:border-indigo-500"
												/>
											</div>
											<div>
												<label for="comm-grade-edit-color-{grade.id}" class="block text-xs text-gray-400 mb-1">Couleur</label>
												<input
													id="comm-grade-edit-color-{grade.id}"
													name="color"
													type="color"
													value={grade.color}
													class="h-9 w-full rounded bg-gray-800 border border-gray-600 px-1 cursor-pointer"
												/>
											</div>
										</div>
										<fieldset>
											<legend class="text-xs text-gray-400 mb-2">Permissions</legend>
											<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
												{#each Object.entries(PERMISSION_LABELS) as [key, label]}
													<label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
														<input
															type="checkbox"
															name={key}
															checked={grade.permissions?.[key as keyof typeof grade.permissions] ?? false}
															class="accent-indigo-500"
														/>
														{label}
													</label>
												{/each}
											</div>
										</fieldset>
										<div class="flex gap-2">
											<button
												type="submit"
												class="rounded bg-indigo-600 hover:bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
											>
												Enregistrer
											</button>
											<button
												type="button"
												onclick={() => { editingId = null }}
												class="rounded bg-gray-700 hover:bg-gray-600 px-3 py-1.5 text-xs text-gray-300 transition-colors"
											>
												Annuler
											</button>
										</div>
									</form>
								</td>
							{:else}
								<!-- Read-only row -->
								<td class="px-4 py-3 font-medium text-white">
									<span
										class="inline-block rounded px-2 py-0.5 text-xs font-medium"
										style="background-color: {grade.color}; color: {luminance(grade.color) > 0.5 ? '#111827' : '#ffffff'}"
									>
										{grade.name}
									</span>
								</td>
								<td class="px-4 py-3">
									<span class="inline-flex items-center gap-1.5 text-gray-400">
										<span class="w-4 h-4 rounded-sm border border-gray-600 inline-block" style="background-color: {grade.color}"></span>
										{grade.color}
									</span>
								</td>
								<td class="px-4 py-3 text-gray-400 text-xs">{permSummary(grade.permissions ?? {})}</td>
								<td class="px-4 py-3 text-right">
									<button
										type="button"
										onclick={() => { editingId = grade.id }}
										class="text-indigo-400 hover:text-indigo-300 mr-3 text-xs"
										aria-label="Modifier {grade.name}"
									>
										Modifier
									</button>
									<form method="POST" action="?/delete" use:enhance class="inline">
										<input type="hidden" name="grade_id" value={grade.id} />
										<button
											type="submit"
											class="text-red-400 hover:text-red-300 text-xs"
											aria-label="Supprimer {grade.name}"
											onclick={(e) => { if (!confirm(`Supprimer le grade "${grade.name}" ?`)) e.preventDefault() }}
										>
											Supprimer
										</button>
									</form>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Member grade assignment -->
	<div class="mt-10">
		<h2 class="text-lg font-bold text-white mb-4">Attribution des grades aux membres</h2>

		{#if data.members.length === 0}
			<p class="text-sm text-gray-500">Aucun membre dans cette communauté.</p>
		{:else}
			<div class="overflow-x-auto rounded-lg border border-gray-700">
				<table class="w-full text-sm text-left">
					<thead class="bg-gray-800 text-gray-400 text-xs uppercase tracking-wider">
						<tr>
							<th class="px-4 py-3">Membre</th>
							<th class="px-4 py-3">Rôle</th>
							<th class="px-4 py-3">Grade actuel</th>
							<th class="px-4 py-3">Attribuer</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-gray-800">
						{#each data.members as member}
							<tr class="bg-gray-900 hover:bg-gray-800/50 transition-colors">
								<td class="px-4 py-3 font-medium text-white">{member.username}</td>
								<td class="px-4 py-3 text-gray-400 text-xs capitalize">{member.role}</td>
								<td class="px-4 py-3">
									{#if member.grade_name && member.grade_color}
										<span
											class="inline-block rounded px-2 py-0.5 text-xs font-medium"
											style="background-color: {member.grade_color}; color: {luminance(member.grade_color) > 0.5 ? '#111827' : '#ffffff'}"
										>
											{member.grade_name}
										</span>
									{:else}
										<span class="text-gray-600 text-xs">—</span>
									{/if}
								</td>
								<td class="px-4 py-3">
									<form method="POST" action="?/assign" use:enhance class="flex items-center gap-2">
										<input type="hidden" name="user_id" value={member.user_id} />
										<select
											name="grade_id"
											class="rounded bg-gray-800 border border-gray-700 px-2 py-1 text-white text-xs focus:outline-none focus:border-indigo-500"
										>
											<option value="">— Aucun grade —</option>
											{#each data.grades as grade}
												<option
													value={grade.id}
													selected={grade.id === member.grade_id}
												>
													{grade.name}
												</option>
											{/each}
										</select>
										<button
											type="submit"
											class="rounded bg-indigo-600 hover:bg-indigo-500 px-3 py-1 text-xs font-semibold text-white transition-colors"
										>
											Attribuer
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
</div>
