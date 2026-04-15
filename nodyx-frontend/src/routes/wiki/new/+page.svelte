<script lang="ts">
	import { enhance } from '$app/forms'
	import type { ActionData } from './$types'
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'

	let { form }: { form: ActionData } = $props()

	let saving = $state(false)
</script>

<svelte:head>
	<title>Nouvelle page — Wiki</title>
</svelte:head>

<div class="max-w-3xl mx-auto py-8 px-4">

	<!-- Breadcrumb -->
	<div class="flex items-center gap-2 text-sm text-gray-500 mb-6">
		<a href="/wiki" class="hover:text-gray-300 transition-colors">Wiki</a>
		<span>/</span>
		<span class="text-gray-300">Nouvelle page</span>
	</div>

	<h1 class="text-xl font-bold text-white mb-6">Créer une page wiki</h1>

	{#if form?.error}
		<div class="mb-4 px-4 py-3 rounded-xl bg-red-900/30 border border-red-500/30 text-red-400 text-sm">
			{form.error}
		</div>
	{/if}

	<form method="POST" use:enhance={() => {
		saving = true
		return async ({ update }) => { await update(); saving = false }
	}} class="space-y-5">

		<!-- Title -->
		<div>
			<label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5" for="title">
				Titre *
			</label>
			<input
				id="title" name="title" required
				placeholder="Titre de la page"
				class="w-full bg-gray-900/60 border border-gray-700/60 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-violet-500/60"
			/>
		</div>

		<!-- Category + Public -->
		<div class="flex gap-3 flex-wrap">
			<div class="flex-1 min-w-48">
				<label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5" for="category">
					Catégorie
				</label>
				<input
					id="category" name="category"
					placeholder="ex: Règles, Tutoriels, FAQ…"
					class="w-full bg-gray-900/60 border border-gray-700/60 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-violet-500/60"
				/>
			</div>
			<div class="flex items-end pb-0.5">
				<label class="flex items-center gap-2.5 cursor-pointer select-none">
					<input type="checkbox" name="is_public"
					       class="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-violet-500" />
					<span class="text-sm text-gray-400">Page publique</span>
				</label>
			</div>
		</div>

		<!-- Excerpt -->
		<div>
			<label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5" for="excerpt">
				Résumé <span class="text-gray-600 font-normal normal-case">(affiché dans la liste)</span>
			</label>
			<textarea
				id="excerpt" name="excerpt" rows="2"
				placeholder="Une phrase décrivant le contenu de la page…"
				class="w-full bg-gray-900/60 border border-gray-700/60 rounded-xl px-4 py-2.5 text-white text-sm placeholder-gray-600 focus:outline-none focus:border-violet-500/60 resize-none"
			></textarea>
		</div>

		<!-- Content (NodyxEditor) -->
		<div>
			<span class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
				Contenu
			</span>
			<NodyxEditor name="content" placeholder="Rédigez le contenu de la page…" />
		</div>

		<!-- Submit -->
		<div class="flex items-center justify-end gap-3 pt-2">
			<a href="/wiki" class="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
				Annuler
			</a>
			<button type="submit" disabled={saving}
			        class="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors disabled:opacity-50">
				{#if saving}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{/if}
				Publier la page
			</button>
		</div>
	</form>
</div>
