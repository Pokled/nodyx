<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import type { ActionData, PageData } from './$types';
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte';
	import PollCreator from '$lib/components/PollCreator.svelte';
	import { t } from '$lib/i18n';
	import { untrack } from 'svelte';

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);
	let selectedTagIds = $state<string[]>([]);
	let submitting = $state(false);

	// ── Sélecteur catégorie / sous-catégorie ──────────────────────────────
	type CatNode = { id: string; name: string; post_min_role?: string; children: CatNode[] };

	// Rôle de l'utilisateur courant vs post_min_role de la catégorie. Un
	// non-membre vaut -1, donc en dessous de 'member' : le back tranche pour de
	// bon (routes/forums.ts), ceci ne fait qu'éviter d'afficher un choix voué au 403.
	const RANK: Record<string, number> = { member: 0, moderator: 1, admin: 2, owner: 3 };
	const userRank = $derived(RANK[(data.user as { role?: string } | null)?.role ?? ''] ?? -1);
	function canPostIn(cat: CatNode): boolean {
		return userRank >= (RANK[cat.post_min_role ?? 'member'] ?? 0);
	}

	function findInitial(cats: CatNode[], targetId: string): { parentId: string; subId: string | null } {
		for (const cat of cats) {
			if (cat.id === targetId && canPostIn(cat)) return { parentId: cat.id, subId: null };
			for (const child of cat.children ?? []) {
				if (child.id === targetId && canPostIn(child)) return { parentId: cat.id, subId: child.id };
			}
		}
		return { parentId: cats[0]?.id ?? targetId, subId: null };
	}

	// N'expose que les catégories où l'utilisateur peut réellement ouvrir un fil.
	const rootCategories = $derived(
		((data.categories ?? []) as CatNode[])
			.filter(canPostIn)
			.map(c => ({ ...c, children: (c.children ?? []).filter(canPostIn) }))
	);
	const noCategory = $derived(rootCategories.length === 0);
	const initial        = $derived(findInitial(rootCategories, data.currentCategoryId ?? ''));

	let selectedParentId = $state(untrack(() => initial.parentId));
	let selectedSubId    = $state<string | null>(untrack(() => initial.subId));

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
	<title>{tFn('forum.create_topic')} · Nodyx</title>
</svelte:head>

<div class="max-w-3xl">
	<a href="/forum/{finalCategoryId}" class="text-sm text-[var(--nx-text-muted)] hover:text-[var(--nx-text)]">{tFn('common.back')}</a>
	<h1 class="mt-2 text-2xl font-bold text-[var(--nx-text)] mb-6">{tFn('forum.create_topic')}</h1>

	{#if form?.error}
		<p class="mb-4 bg-[color-mix(in_srgb,var(--nx-bad)_15%,transparent)] border border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] px-4 py-2 text-sm text-[var(--nx-bad)]">
			{form.code === 'CATEGORY_RESTRICTED' ? tFn('forum.category_restricted') : form.error}
		</p>
	{/if}

	{#if noCategory}
		<p class="mb-4 bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-4 py-3 text-sm text-[var(--nx-text-muted)]">
			{tFn('forum.new_topic_no_category')}
		</p>
	{:else}
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
			<span class="block text-sm text-[var(--nx-text-muted)] mb-2">{tFn('forum.category')}</span>
			<div class="flex flex-wrap gap-2">
				<select
					onchange={onParentChange}
					class="flex-1 min-w-[180px] bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-[var(--nx-text)] focus:outline-none focus:border-indigo-500"
				>
					{#each rootCategories as cat}
						<option value={cat.id} selected={cat.id === selectedParentId}>{cat.name}</option>
					{/each}
				</select>
				{#if subcategories.length > 0}
					<select
						onchange={(e) => selectedSubId = (e.currentTarget as HTMLSelectElement).value || null}
						class="flex-1 min-w-[180px] bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-[var(--nx-text)] focus:outline-none focus:border-indigo-500"
					>
						<option value="">{tFn('forum.no_subcategory')}</option>
						{#each subcategories as sub}
							<option value={sub.id} selected={sub.id === selectedSubId}>{sub.name}</option>
						{/each}
					</select>
				{/if}
			</div>
			<input type="hidden" name="category_id" value={finalCategoryId} />
		</div>

		<div>
			<label for="title" class="block text-sm text-[var(--nx-text-muted)] mb-1">
				{tFn('forum.title_label')} <span class="text-[var(--nx-text-muted)] text-xs">{tFn('forum.title_hint')}</span>
			</label>
			<input
				id="title"
				name="title"
				type="text"
				required
				minlength="3"
				maxlength="300"
				placeholder={tFn('forum.title_placeholder')}
				class="w-full bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-[var(--nx-text)] placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<div>
			<span class="block text-sm text-[var(--nx-text-muted)] mb-2">{tFn('forum.message_label')}</span>
			<NodyxEditor
				name="content"
				placeholder={tFn('forum.message_placeholder')}
			/>
		</div>

		<!-- Tags multi-select -->
		{#if tags.length > 0}
			<div>
				<span class="block text-sm text-[var(--nx-text-muted)] mb-2">
					Tags <span class="text-[var(--nx-text-muted)] text-xs">(optionnel, max 5)</span>
				</span>
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
					class="flex items-center gap-2 px-3 py-2 border border-dashed border-[var(--nx-border)] text-sm text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] hover:border-indigo-700 transition-colors"
				>
					<span>📊</span>
					<span>{tFn('forum.attach_poll')} <span class="text-[var(--nx-text-muted)] text-xs">{tFn('common.optional')}</span></span>
				</button>
			{:else}
				<div class="border border-indigo-900/50 bg-[var(--nx-surface)]/50 p-4">
					<div class="flex items-center justify-between mb-3">
						<span class="text-sm font-medium text-[var(--nx-header-accent)]">{tFn('forum.poll_attached')}</span>
						{#if pollConfig}
							<div class="flex items-center gap-2">
								<span class="text-xs text-[var(--nx-ok)]">{tFn('forum.poll_configured')}</span>
								<button type="button" onclick={() => { pollConfig = null; showPollSection = false; }}
									class="text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-bad)] transition-colors">Retirer</button>
							</div>
						{:else}
							<button type="button" onclick={() => showPollSection = false}
								class="text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] transition-colors">{tFn('common.cancel')}</button>
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
						<div class="text-sm text-[var(--nx-text-muted)]">
							<span class="font-medium text-[var(--nx-text)]">{pollConfig.title}</span>
							<span class="ml-2 text-[var(--nx-text-muted)]">·</span>
							<span class="ml-2">{tFn('forum.poll_n_options', { n: String(pollConfig.options.length) })}</span>
							<button type="button" onclick={() => pollConfig = null}
								class="ml-3 text-xs text-[var(--nx-header-accent)] hover:text-[var(--nx-header-accent)] transition-colors">{tFn('common.edit')}</button>
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
				{submitting ? tFn('common.publishing') : tFn('forum.publish_topic')}
			</button>
			<a href="/forum/{finalCategoryId}" class="bg-[color-mix(in_srgb,var(--nx-bad)_15%,transparent)] hover:bg-[color-mix(in_srgb,var(--nx-bad)_18%,transparent)] border border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] hover:border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] px-5 py-2 text-sm font-semibold text-[var(--nx-bad)] hover:text-[var(--nx-bad)] transition-colors">{tFn('common.cancel')}</a>
		</div>
	</form>
	{/if}
</div>
