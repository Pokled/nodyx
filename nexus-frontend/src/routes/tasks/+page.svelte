<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let showCreate = $state(false)
	let creating   = $state(false)
	let deleting   = $state<string | null>(null)

	function fDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
	}
</script>

<svelte:head><title>Tableaux — Nexus</title></svelte:head>

<div class="space-y-6">

	<!-- Header -->
	<div class="flex items-center justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-2xl font-bold text-white">Tableaux de tâches</h1>
			<p class="text-sm text-gray-500 mt-0.5">{data.boards.length} tableau{data.boards.length > 1 ? 'x' : ''}</p>
		</div>
		<button
			onclick={() => showCreate = !showCreate}
			class="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
		>
			<span class="text-base leading-none">+</span>
			Nouveau tableau
		</button>
	</div>

	<!-- Formulaire de création -->
	{#if showCreate}
		<div class="rounded-xl border border-indigo-800/50 bg-indigo-950/30 p-5">
			<h2 class="text-sm font-semibold text-indigo-300 mb-4">Nouveau tableau</h2>
			<form
				method="POST"
				action="?/create"
				use:enhance={() => {
					creating = true
					return async ({ update }) => { creating = false; await update() }
				}}
				class="space-y-3"
			>
				{#if form?.error}
					<p class="text-sm text-red-400">{form.error}</p>
				{/if}
				<div class="flex gap-3 flex-wrap">
					<input
						name="name"
						type="text"
						placeholder="Nom du tableau"
						required
						maxlength="100"
						class="flex-1 min-w-48 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200
						       placeholder-gray-600 focus:outline-none focus:border-indigo-600"
					/>
					<input
						name="description"
						type="text"
						placeholder="Description (optionnel)"
						maxlength="1000"
						class="flex-1 min-w-64 rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200
						       placeholder-gray-600 focus:outline-none focus:border-indigo-600"
					/>
				</div>
				<div class="flex gap-2">
					<button
						type="submit"
						disabled={creating}
						class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
					>
						{creating ? 'Création...' : 'Créer'}
					</button>
					<button
						type="button"
						onclick={() => showCreate = false}
						class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors"
					>
						Annuler
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Grille des tableaux -->
	{#if data.boards.length === 0}
		<div class="rounded-xl border border-gray-800 bg-gray-900/30 px-6 py-16 text-center">
			<div class="text-4xl mb-3">📋</div>
			<p class="text-gray-400 font-medium">Aucun tableau pour l'instant</p>
			<p class="text-sm text-gray-600 mt-1">Créez votre premier tableau pour organiser les tâches de votre communauté.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each data.boards as board}
				<div class="rounded-xl border border-gray-800 bg-gray-900/40 hover:bg-gray-900/60 transition-colors flex flex-col">
					<a href="/tasks/{board.id}" class="flex-1 p-5 block">
						<div class="flex items-start gap-3">
							<span class="text-2xl leading-none mt-0.5">📋</span>
							<div class="min-w-0">
								<h3 class="font-semibold text-white truncate">{board.name}</h3>
								{#if board.description}
									<p class="text-sm text-gray-500 mt-0.5 line-clamp-2">{board.description}</p>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-4 mt-4 text-xs text-gray-600">
							<span>{board.column_count} colonne{board.column_count > 1 ? 's' : ''}</span>
							<span>·</span>
							<span>{board.card_count} carte{board.card_count > 1 ? 's' : ''}</span>
							<span>·</span>
							<span>{board.created_by_username}</span>
						</div>
					</a>
					<div class="border-t border-gray-800 px-5 py-2.5 flex items-center justify-between">
						<span class="text-xs text-gray-600">{fDate(board.created_at)}</span>
						<form
							method="POST"
							action="?/delete"
							use:enhance={() => {
								deleting = board.id
								return async ({ update }) => { deleting = null; await update() }
							}}
						>
							<input type="hidden" name="id" value={board.id} />
							<button
								type="submit"
								disabled={deleting === board.id}
								onclick={(e) => { if (!confirm('Supprimer ce tableau ?')) e.preventDefault() }}
								class="text-xs text-gray-600 hover:text-red-400 transition-colors disabled:opacity-50"
							>
								Supprimer
							</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
