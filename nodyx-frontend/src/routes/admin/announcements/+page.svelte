<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const COLORS = [
		{ key: 'indigo', label: 'Indigo',  bg: 'bg-indigo-900/60 border-indigo-700 text-indigo-200' },
		{ key: 'amber',  label: 'Ambre',   bg: 'bg-amber-900/60  border-amber-700  text-amber-200'  },
		{ key: 'green',  label: 'Vert',    bg: 'bg-green-900/60  border-green-700  text-green-200'  },
		{ key: 'red',    label: 'Rouge',   bg: 'bg-red-900/60    border-red-700    text-red-200'    },
		{ key: 'sky',    label: 'Bleu',    bg: 'bg-sky-900/60    border-sky-700    text-sky-200'    },
		{ key: 'rose',   label: 'Rose',    bg: 'bg-rose-900/60   border-rose-700   text-rose-200'   },
	]

	const COLOR_BANNER: Record<string, string> = {
		indigo: 'bg-indigo-900/70 border-indigo-700/60 text-indigo-100',
		amber:  'bg-amber-900/70  border-amber-700/60  text-amber-100',
		green:  'bg-green-900/70  border-green-700/60  text-green-100',
		red:    'bg-red-900/70    border-red-700/60    text-red-100',
		sky:    'bg-sky-900/70    border-sky-700/60    text-sky-100',
		rose:   'bg-rose-900/70   border-rose-700/60   text-rose-100',
	}

	let selectedColor = $state('indigo')
	let previewMsg    = $state('')

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

<svelte:head><title>Annonces — Admin Nodyx</title></svelte:head>

<div class="space-y-6">
	<div>
		<h1 class="text-2xl font-bold text-white">Annonces système</h1>
		<p class="text-sm text-gray-500 mt-0.5">
			Bannières visibles par tous les utilisateurs connectés en haut de l'application.
		</p>
	</div>

	<!-- ── Create form ─────────────────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Nouvelle annonce</h2>

		{#if form?.error}
			<p class="mb-4 text-sm text-red-400 bg-red-900/30 border border-red-800/50 rounded-lg px-4 py-2">{form.error}</p>
		{/if}
		{#if form?.ok}
			<p class="mb-4 text-sm text-green-400 bg-green-900/30 border border-green-800/50 rounded-lg px-4 py-2">Annonce créée.</p>
		{/if}

		<form method="POST" action="?/create" use:enhance class="space-y-4">
			<!-- Message -->
			<div>
				<label for="ann-create-message" class="block text-sm font-medium text-gray-300 mb-1.5">Message</label>
				<textarea
					id="ann-create-message"
					name="message"
					rows="2"
					bind:value={previewMsg}
					placeholder="Ex: Maintenance prévue ce soir à 22h. Le forum sera indisponible 30 minutes."
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-white
					       focus:outline-none focus:border-indigo-500 resize-none placeholder-gray-600"
					required
				></textarea>
			</div>

			<!-- Color + Expiry -->
			<div class="flex flex-wrap gap-4">
				<!-- Color picker -->
				<div>
					<span class="block text-xs font-medium text-gray-400 mb-2">Couleur</span>
					<div class="flex gap-2">
						{#each COLORS as c}
							<button
								type="button"
								onclick={() => selectedColor = c.key}
								title={c.label}
								class="w-7 h-7 rounded-full border-2 transition-all {c.bg.split(' ')[0]}
								       {selectedColor === c.key ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-90'}"
							></button>
						{/each}
					</div>
					<input type="hidden" name="color" value={selectedColor} />
				</div>

				<!-- Expiry -->
				<div class="flex-1 min-w-[180px]">
					<label for="ann-create-expires" class="block text-xs font-medium text-gray-400 mb-2">Expire le (optionnel)</label>
					<input
						id="ann-create-expires"
						type="datetime-local"
						name="expires_at"
						class="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-white
						       focus:outline-none focus:border-indigo-500"
					/>
				</div>
			</div>

			<!-- Preview -->
			{#if previewMsg.trim()}
				<div>
					<p class="text-xs text-gray-500 mb-1.5">Aperçu :</p>
					<div class="rounded-lg border px-4 py-3 text-sm font-medium flex items-center gap-2
					            {COLOR_BANNER[selectedColor] ?? COLOR_BANNER.indigo}">
						<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
						</svg>
						{previewMsg}
					</div>
				</div>
			{/if}

			<button type="submit"
				class="px-5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">
				Publier l'annonce
			</button>
		</form>
	</div>

	<!-- ── Existing announcements ───────────────────────────────────────────── -->
	<div class="rounded-xl border border-gray-800 overflow-hidden">
		{#if data.announcements.length === 0}
			<div class="px-6 py-10 text-center text-sm text-gray-600">
				Aucune annonce pour le moment.
			</div>
		{:else}
			<table class="w-full text-sm">
				<thead class="bg-gray-900 border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wider">
					<tr>
						<th class="px-4 py-3 text-left">Message</th>
						<th class="px-4 py-3 text-center w-24">Couleur</th>
						<th class="px-4 py-3 text-center w-24">Statut</th>
						<th class="px-4 py-3 text-center w-28">Créée</th>
						<th class="px-4 py-3 text-center w-28">Expire</th>
						<th class="px-4 py-3 text-right w-32">Actions</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-800/60">
					{#each data.announcements as ann}
						<tr class="bg-gray-900/30 hover:bg-gray-900/60 transition-colors">
							<!-- Message -->
							<td class="px-4 py-3 max-w-xs">
								<div class="flex items-start gap-2">
									<span class="inline-block w-2.5 h-2.5 rounded-full mt-1 shrink-0
									             {ann.color === 'indigo' ? 'bg-indigo-500' :
									              ann.color === 'amber'  ? 'bg-amber-500'  :
									              ann.color === 'green'  ? 'bg-green-500'  :
									              ann.color === 'red'    ? 'bg-red-500'    :
									              ann.color === 'sky'    ? 'bg-sky-500'    :
									              ann.color === 'rose'   ? 'bg-rose-500'   : 'bg-indigo-500'}">
									</span>
									<span class="text-gray-200 line-clamp-2">{ann.message}</span>
								</div>
							</td>

							<!-- Color label -->
							<td class="px-4 py-3 text-center">
								<span class="text-xs text-gray-500 capitalize">{ann.color}</span>
							</td>

							<!-- Status toggle -->
							<td class="px-4 py-3 text-center">
								<form method="POST" action="?/toggle" use:enhance>
									<input type="hidden" name="id" value={ann.id} />
									<input type="hidden" name="is_active" value={String(!ann.is_active)} />
									<button type="submit"
										class="px-2 py-0.5 rounded text-xs font-medium transition-colors
										       {ann.is_active
										         ? 'bg-green-900/50 text-green-400 border border-green-800/50 hover:bg-green-900/70'
										         : 'bg-gray-800 text-gray-500 border border-gray-700 hover:bg-gray-700'}">
										{ann.is_active ? 'Active' : 'Inactive'}
									</button>
								</form>
							</td>

							<!-- Created -->
							<td class="px-4 py-3 text-center text-xs text-gray-500 tabular-nums">
								{timeAgo(ann.created_at)}
							</td>

							<!-- Expires -->
							<td class="px-4 py-3 text-center text-xs tabular-nums
							           {ann.expires_at && new Date(ann.expires_at) < new Date() ? 'text-red-500' : 'text-gray-500'}">
								{#if ann.expires_at}
									{new Date(ann.expires_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
								{:else}
									<span class="text-gray-700">—</span>
								{/if}
							</td>

							<!-- Delete -->
							<td class="px-4 py-3 text-right">
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={ann.id} />
									<button type="submit"
										onclick={(e) => { if (!confirm('Supprimer cette annonce ?')) e.preventDefault() }}
										class="text-xs px-2 py-1 rounded bg-gray-800 text-gray-500
										       hover:text-red-400 hover:bg-gray-700 transition-colors"
										title="Supprimer">
										🗑️
									</button>
								</form>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{/if}
	</div>
</div>
