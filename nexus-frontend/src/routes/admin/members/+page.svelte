<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	let search = $state('')

	const filtered = $derived(
		data.members.filter((m: any) =>
			!search || m.username.toLowerCase().includes(search.toLowerCase())
		)
	)

	const ROLE_COLORS: Record<string, string> = {
		owner:     'bg-yellow-900/50 text-yellow-400 border-yellow-800/50',
		admin:     'bg-red-900/50 text-red-400 border-red-800/50',
		moderator: 'bg-blue-900/50 text-blue-400 border-blue-800/50',
		member:    'bg-gray-800 text-gray-400 border-gray-700',
	}

	function luminance(hex: string): number {
		const r = parseInt(hex.slice(1,3), 16)
		const g = parseInt(hex.slice(3,5), 16)
		const b = parseInt(hex.slice(5,7), 16)
		return (0.299*r + 0.587*g + 0.114*b) / 255
	}
</script>

<svelte:head><title>Membres — Admin Nexus</title></svelte:head>

<div>
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">Membres</h1>
			<p class="text-sm text-gray-500 mt-0.5">{data.members.length} membre{data.members.length > 1 ? 's' : ''} au total</p>
		</div>
		<input
			type="text"
			placeholder="Rechercher..."
			bind:value={search}
			class="px-3 py-2 rounded-lg bg-gray-900 border border-gray-800 text-sm text-gray-200
			       placeholder-gray-600 focus:outline-none focus:border-indigo-700 w-48"
		/>
	</div>

	<div class="rounded-xl border border-gray-800 overflow-hidden">
		<table class="w-full text-sm">
			<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
				<tr>
					<th class="px-4 py-3 text-left">Membre</th>
					<th class="px-4 py-3 text-left">Rôle</th>
					<th class="px-4 py-3 text-left">Grade</th>
					<th class="px-4 py-3 text-center">Fils</th>
					<th class="px-4 py-3 text-center">Messages</th>
					<th class="px-4 py-3 text-left">Inscrit le</th>
					<th class="px-4 py-3 text-right">Actions</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-gray-800/60">
				{#each filtered as member}
					<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
						<!-- Member -->
						<td class="px-4 py-3">
							<div class="flex items-center gap-2.5">
								<div class="w-8 h-8 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold text-indigo-200 shrink-0">
									{member.username.charAt(0).toUpperCase()}
								</div>
								<div>
									<a href="/users/{member.username}" class="font-medium text-white hover:text-indigo-300 transition-colors">
										{member.username}
									</a>
									<div class="text-xs text-gray-600">{member.email}</div>
								</div>
							</div>
						</td>

						<!-- Role (editable) -->
						<td class="px-4 py-3">
							{#if member.role === 'owner'}
								<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border {ROLE_COLORS.owner}">
									owner
								</span>
							{:else}
								<form method="POST" action="?/changeRole" use:enhance class="inline">
									<input type="hidden" name="user_id" value={member.user_id} />
									<select
										name="role"
										onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.submit()}
										class="rounded border px-2 py-0.5 text-xs font-medium cursor-pointer bg-transparent
										       focus:outline-none {ROLE_COLORS[member.role]}"
									>
										{#each ['admin','moderator','member'] as r}
											<option value={r} selected={r === member.role} class="bg-gray-900 text-white">
												{r}
											</option>
										{/each}
									</select>
								</form>
							{/if}
						</td>

						<!-- Grade -->
						<td class="px-4 py-3">
							{#if member.grade_name && member.grade_color}
								<span
									class="inline-block rounded px-2 py-0.5 text-xs font-medium"
									style="background-color:{member.grade_color}; color:{luminance(member.grade_color)>0.5?'#111':'#fff'}"
								>
									{member.grade_name}
								</span>
							{:else}
								<span class="text-gray-700 text-xs">—</span>
							{/if}
						</td>

						<!-- Counts -->
						<td class="px-4 py-3 text-center text-gray-400 tabular-nums">{member.thread_count}</td>
						<td class="px-4 py-3 text-center text-gray-400 tabular-nums">{member.post_count}</td>

						<!-- Date -->
						<td class="px-4 py-3 text-xs text-gray-500">
							{new Date(member.joined_at).toLocaleDateString('fr-FR')}
						</td>

						<!-- Actions -->
						<td class="px-4 py-3 text-right">
							{#if member.role !== 'owner'}
								<div class="flex items-center justify-end gap-2">
									<a href="/admin/grades" class="text-xs text-indigo-400 hover:text-indigo-300">
										Grade
									</a>
									<form method="POST" action="?/kick" use:enhance class="inline">
										<input type="hidden" name="user_id" value={member.user_id} />
										<button
											type="submit"
											onclick={(e) => { if (!confirm(`Exclure ${member.username} ?`)) e.preventDefault() }}
											class="text-xs text-red-500 hover:text-red-400"
										>
											Exclure
										</button>
									</form>
								</div>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="px-4 py-8 text-center text-gray-600">
							Aucun membre trouvé.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
