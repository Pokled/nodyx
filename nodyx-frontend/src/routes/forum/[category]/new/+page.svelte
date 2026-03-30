<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/stores';
	import type { ActionData, PageData } from './$types';
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte';
	import PollCreator from '$lib/components/PollCreator.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);
	let selectedTagIds = $state<string[]>([]);
	let submitting = $state(false);

	// ── Sélecteur catégorie / sous-catégorie ──────────────────────────────
	type CatNode = { id: string; name: string; children: CatNode[] };

	function findInitial(cats: CatNode[], targetId: string): { parentId: string; subId: string | null } {
		for (const cat of cats) {
			if (cat.id === targetId) return { parentId: cat.id, subId: null };
			for (const child of cat.children ?? []) {
				if (child.id === targetId) return { parentId: cat.id, subId: child.id };
			}
		}
		return { parentId: cats[0]?.id ?? targetId, subId: null };
	}

	const rootCategories = $derived((data.categories ?? []) as CatNode[]);
	const initial        = $derived(findInitial(rootCategories, data.currentCategoryId ?? ''));

	let selectedParentId = $state(initial.parentId);
	let selectedSubId    = $state<string | null>(initial.subId);

	const selectedParent  = $derived(rootCategories.find(c => c.id === selectedParentId));
	const subcategories   = $derived(selectedParent?.children ?? []);
	const finalCategoryId = $derived(selectedSubId || selectedParentId);

	function onParentChange(e: Event) {
		selectedParentId = (e.currentTarget as HTMLSelectElement).value;
		selectedSubId    = null;
	}

	// ── Sondage optionnel ──────────────────────────────────────────────────
	let showPollSection = $state(false);
	let pollConfig      = $state<any>(null);
	let pollJson        = $derived(pollConfig ? JSON.stringify(pollConfig) : '');

	function toggleTag(id: string) {
		if (selectedTagIds.includes(id)) {
			selectedTagIds = selectedTagIds.filter(t => t !== id);
		} else if (selectedTagIds.length < 5) {
			selectedTagIds = [...selectedTagIds, id];
		}
	}
</script>

<svelte:head>
	<title>Nouveau sujet — Nodyx</title>
</svelte:head>

<div class="max-w-3xl">
	<a href="/forum/{finalCategoryId}" class="text-sm text-gray-500 hover:text-gray-300">← Retour</a>
	<h1 class="mt-2 text-2xl font-bold text-white mb-6">Nouveau sujet</h1>

	{#if form?.error}
		<p class="mb-4bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
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
		<!-- Sélecteur catégorie + sous-catégorie -->
		<div>
			<label class="block text-sm text-gray-400 mb-2">Catégorie</label>
			<div class="flex flex-wrap gap-2">
				<select
					onchange={onParentChange}
					class="flex-1 min-w-[180px]bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
				>
					{#each rootCategories as cat}
						<option value={cat.id} selected={cat.id === selectedParentId}>{cat.name}</option>
					{/each}
				</select>
				{#if subcategories.length > 0}
					<select
						onchange={(e) => selectedSubId = (e.currentTarget as HTMLSelectElement).value || null}
						class="flex-1 min-w-[180px]bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
					>
						<option value="">— Sans sous-catégorie —</option>
						{#each subcategories as sub}
							<option value={sub.id} selected={sub.id === selectedSubId}>{sub.name}</option>
						{/each}
					</select>
				{/if}
			</div>
			<input type="hidden" name="category_id" value={finalCategoryId} />
		</div>

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
				class="w-fullbg-gray-800 border border-gray-700 px-3 py-2 text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<div>
			<label class="block text-sm text-gray-400 mb-2">Message</label>
			<NodyxEditor
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
							class="inline-flex items-center px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer"
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

		<!-- Sondage optionnel -->
		<div>
			{#if !showPollSection}
				<button
					type="button"
					onclick={() => showPollSection = true}
					class="flex items-center gap-2 px-3 py-2border border-dashed border-gray-700 text-sm text-gray-500 hover:text-indigo-400 hover:border-indigo-700 transition-colors"
				>
					<span>📊</span>
					<span>Joindre un sondage à ce sujet <span class="text-gray-600 text-xs">(optionnel)</span></span>
				</button>
			{:else}
				<div class="border border-indigo-900/50 bg-gray-900/50 p-4">
					<div class="flex items-center justify-between mb-3">
						<span class="text-sm font-medium text-indigo-300">📊 Sondage joint</span>
						{#if pollConfig}
							<div class="flex items-center gap-2">
								<span class="text-xs text-green-400">✓ Configuré</span>
								<button type="button" onclick={() => { pollConfig = null; showPollSection = false; }}
									class="text-xs text-gray-500 hover:text-red-400 transition-colors">Retirer</button>
							</div>
						{:else}
							<button type="button" onclick={() => showPollSection = false}
								class="text-xs text-gray-500 hover:text-gray-300 transition-colors">Annuler</button>
						{/if}
					</div>
					{#if !pollConfig}
						<PollCreator
							token={data.token}
							channelId={null}
							onCollect={(cfg) => { pollConfig = cfg; }}
							onClose={() => showPollSection = false}
						/>
					{:else}
						<div class="text-sm text-gray-400">
							<span class="font-medium text-white">{pollConfig.title}</span>
							<span class="ml-2 text-gray-600">·</span>
							<span class="ml-2">{pollConfig.options.length} options</span>
							<button type="button" onclick={() => pollConfig = null}
								class="ml-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">Modifier</button>
						</div>
					{/if}
				</div>
				{#if pollConfig}
					<input type="hidden" name="poll_json" value={pollJson} />
				{/if}
			{/if}
		</div>

		<div class="flex items-center gap-3">
			<button
				type="submit"
				disabled={submitting}
				class="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2 text-sm font-semibold text-white transition-colors"
			>
				{submitting ? 'Publication...' : 'Publier le sujet'}
			</button>
			<a href="/forum/{finalCategoryId}" class="bg-red-900/50 hover:bg-red-800/60 border border-red-700/50 hover:border-red-600 px-5 py-2 text-sm font-semibold text-red-300 hover:text-red-200 transition-colors">Annuler</a>
		</div>
	</form>
</div>
