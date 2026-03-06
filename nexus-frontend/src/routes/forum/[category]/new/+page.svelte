<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import type { ActionData, PageData } from './$types';
	import NexusEditor from '$lib/components/editor/NexusEditor.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);
	let selectedTagIds = $state<string[]>([]);
	let submitting = $state(false);

	function toggleTag(id: string) {
		if (selectedTagIds.includes(id)) {
			selectedTagIds = selectedTagIds.filter(t => t !== id);
		} else if (selectedTagIds.length < 5) {
			selectedTagIds = [...selectedTagIds, id];
		}
	}
</script>

<svelte:head>
	<title>Nouveau sujet — Nexus</title>
</svelte:head>

<div class="max-w-3xl">
	<a href="/forum/{$page.params.category}" class="text-sm text-gray-500 hover:text-gray-300">← Retour</a>
	<h1 class="mt-2 text-2xl font-bold text-white mb-6">Nouveau sujet</h1>

	{#if form?.error}
		<p class="mb-4 rounded bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
			{form.error}
		</p>
	{/if}

	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="space-y-5"
	>
		<div>
			<label for="title" class="block text-sm text-gray-400 mb-1">
				Titre <span class="text-gray-600 text-xs">(3–300 caractères)</span>
			</label>
			<input
				id="title"
				name="title"
				type="text"
				required
				minlength="3"
				maxlength="300"
				placeholder="Titre de votre sujet..."
				class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<div>
			<label class="block text-sm text-gray-400 mb-2">Message</label>
			<NexusEditor
				name="content"
				placeholder="Rédigez votre message..."
			/>
		</div>

		<!-- Tags multi-select -->
		{#if tags.length > 0}
			<div>
				<label class="block text-sm text-gray-400 mb-2">
					Tags <span class="text-gray-600 text-xs">(optionnel, max 5)</span>
				</label>
				<div class="flex flex-wrap gap-2">
					{#each tags as tag}
						<button
							type="button"
							onclick={() => toggleTag(tag.id)}
							class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer"
							style="
								background-color: {selectedTagIds.includes(tag.id) ? tag.color + '33' : 'transparent'};
								color: {tag.color};
								border-color: {selectedTagIds.includes(tag.id) ? tag.color : tag.color + '55'};
							"
						>
							{#if selectedTagIds.includes(tag.id)}✓ {/if}{tag.name}
						</button>
					{/each}
				</div>
				<!-- Hidden inputs for selected tags -->
				{#each selectedTagIds as tagId}
					<input type="hidden" name="tag_ids" value={tagId} />
				{/each}
			</div>
		{/if}

		<div class="flex items-center gap-3">
			<button
				type="submit"
				disabled={submitting}
				class="rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-semibold text-white transition-colors"
			>
				{submitting ? 'Publication...' : 'Publier le sujet'}
			</button>
			<a href="/forum/{$page.params.category}" class="rounded bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 hover:border-red-600 px-5 py-2 text-sm font-semibold text-red-300 hover:text-red-200 transition-colors">Annuler</a>
		</div>
	</form>
</div>
