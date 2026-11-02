<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { t } from '$lib/i18n';
	import { inkOn } from '$lib/adminTheme';

	const tFn = $derived($t);

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);

	// Aperçu en direct de l'étiquette en cours de création
	let newName  = $state('');
	let newColor = $state('#6366f1');

	let search = $state('');
	const filtered = $derived.by(() => {
		const q = search.trim().toLowerCase();
		const list = q ? tags.filter((tag: any) => tag.name.toLowerCase().includes(q) || tag.slug.includes(q)) : tags;
		return [...list].sort((a: any, b: any) => a.name.localeCompare(b.name));
	});
</script>

<svelte:head><title>{tFn('atags.page_title')}</title></svelte:head>

<div class="adm-page">
	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('atags.title')}</h1>
			<p class="adm-desc">{tFn('atags.desc')}</p>
		</div>
		{#if tags.length > 0}
			<label class="adm-search">
				<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
				<input type="search" class="adm-input" placeholder={tFn('atags.search_ph')} aria-label={tFn('atags.search_ph')} bind:value={search} />
			</label>
		{/if}
	</header>

	{#if form?.error}
		<div class="adm-notice adm-notice--bad" role="alert">{form.error}</div>
	{/if}

	<details class="adm-card adm-disclosure" open={tags.length === 0}>
		<summary>
			<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			{tFn('atags.create_tag')}
		</summary>
		<form method="POST" action="?/create" class="adm-form"
			use:enhance={() => async ({ result, update }) => {
				await update();
				if (result.type === 'success') newName = '';
			}}>
			<div class="adm-form-grid">
				<label class="adm-field">
					<span class="adm-label">{tFn('atags.name')}</span>
					<input name="name" type="text" required maxlength="50" class="adm-input"
						placeholder={tFn('atags.name_ph')} bind:value={newName} />
				</label>
				<div class="adm-field">
					<label class="adm-label" for="tag-create-color">{tFn('atags.color')}</label>
					<div class="adm-color">
						<input id="tag-create-color" name="color" type="color" bind:value={newColor} />
						<code>{newColor}</code>
					</div>
				</div>
				<div class="adm-field">
					<span class="adm-label">{tFn('atags.preview')}</span>
					<div class="flex items-center min-h-9">
						<span class="adm-swatch" style="background:{newColor}; color:{inkOn(newColor)}">{newName.trim() || tFn('atags.name_ph')}</span>
					</div>
				</div>
			</div>
			<div>
				<button type="submit" class="adm-btn adm-btn--primary">{tFn('atags.create')}</button>
			</div>
		</form>
	</details>

	{#if tags.length === 0}
		<p class="adm-empty adm-card">{tFn('atags.empty')}</p>
	{:else}
		{#if search.trim()}
			<p class="adm-desc">{tFn('atags.shown', { n: filtered.length, total: tags.length })}</p>
		{/if}
		<div class="adm-table-wrap">
			<table class="adm-table">
				<thead>
					<tr>
						<th>{tFn('atags.col_tag')}</th>
						<th>{tFn('atags.col_slug')}</th>
						<th class="adm-num"><span class="sr-only">{tFn('atags.col_action')}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as tag (tag.id)}
						<tr>
							<td class="adm-cell-main">
								<span class="adm-swatch" style="background:{tag.color}; color:{inkOn(tag.color)}">{tag.name}</span>
							</td>
							<td class="adm-muted" data-label={tFn('atags.col_slug')}><code>{tag.slug}</code></td>
							<td class="adm-num">
								<form method="POST" action="?/delete" use:enhance class="inline">
									<input type="hidden" name="tag_id" value={tag.id} />
									<button type="submit" class="adm-btn adm-btn--sm adm-btn--danger"
										onclick={(e) => { if (!confirm(tFn('atags.confirm_delete', { name: tag.name }))) e.preventDefault() }}>
										{tFn('atags.delete')}
									</button>
								</form>
							</td>
						</tr>
					{:else}
						<tr><td colspan="3" class="adm-empty">{tFn('atags.none_found')}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
