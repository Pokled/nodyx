<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import { t } from '$lib/i18n';
	import { inkOn } from '$lib/adminTheme';

	const tFn = $derived($t);

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const tags = $derived(data.tags ?? []);

	// Panneau « créer » : ouvert d'office tant que la liste est vide, puis libre.
	// Jamais open={expression} : Svelte 5 la réévalue à chaque frappe dans le
	// formulaire et refermait le panneau pendant qu'on tapait le nom.
	let createOpen = $state(untrack(() => tags.length === 0))

	// Aperçu en direct de l'étiquette en cours de création
	let newName  = $state('');
	let newColor = $state('#6366f1');

	// Modifier une étiquette en place : la ligne devient un petit formulaire.
	// Les sujets gardent leur étiquette, seuls le nom et la couleur changent.
	let editId    = $state<string | null>(null);
	let editName  = $state('');
	let editColor = $state('#6366f1');
	let editBusy  = $state(false);
	function startEdit(tag: { id: string; name: string; color: string }) {
		editId = tag.id; editName = tag.name; editColor = tag.color;
		queueMicrotask(() => (document.getElementById(`tag-edit-name-${tag.id}`) as HTMLInputElement | null)?.select());
	}
	function stopEdit() { editId = null; }

	const errorText = $derived(form && 'errorKey' in form && form.errorKey ? tFn(form.errorKey as string) : null);
	const editError = $derived(form && 'editId' in form && form.editId === editId ? errorText : null);

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

	{#if errorText && !editError}
		<div class="adm-notice adm-notice--bad" role="alert">{errorText}</div>
	{/if}

	<details class="adm-card adm-disclosure" bind:open={createOpen}>
		<summary>
			<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			{tFn('atags.create_tag')}
		</summary>
		<form method="POST" action="?/create" class="adm-form"
			use:enhance={() => async ({ result, update }) => {
				// Sans remise à zéro du formulaire : elle effaçait la couleur (noir, aperçu vide)
				await update({ reset: false });
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
						{#if editId === tag.id}
							<tr class="tag-editing">
								<td colspan="3">
									<form method="POST" action="?/update" class="tag-edit"
										use:enhance={() => { editBusy = true; return async ({ result, update }) => {
											editBusy = false;
											await update({ reset: false });
											if (result.type === 'success') stopEdit();
										} }}>
										<input type="hidden" name="tag_id" value={tag.id} />
										<label class="adm-field tag-edit-name">
											<span class="adm-label">{tFn('atags.name')}</span>
											<input id="tag-edit-name-{tag.id}" onkeydown={(e) => { if (e.key === 'Escape') stopEdit() }} name="name" type="text" required maxlength="50" class="adm-input" bind:value={editName} />
										</label>
										<div class="adm-field">
											<label class="adm-label" for="tag-edit-color-{tag.id}">{tFn('atags.color')}</label>
											<div class="adm-color">
												<input id="tag-edit-color-{tag.id}" name="color" type="color" bind:value={editColor} />
												<code>{editColor}</code>
											</div>
										</div>
										<div class="adm-field">
											<span class="adm-label">{tFn('atags.preview')}</span>
											<div class="flex items-center min-h-9">
												<span class="adm-swatch" style="background:{editColor}; color:{inkOn(editColor)}">{editName.trim() || tag.name}</span>
											</div>
										</div>
										<div class="tag-edit-actions">
											<button type="button" class="adm-btn adm-btn--sm" onclick={stopEdit}>{tFn('common.cancel')}</button>
											<button type="submit" class="adm-btn adm-btn--sm adm-btn--primary" disabled={editBusy || !editName.trim()}>{tFn('common.save')}</button>
										</div>
										<p class="tag-edit-help">{tFn('atags.edit_help')}</p>
										{#if editError}<p class="adm-notice adm-notice--bad tag-edit-err" role="alert">{editError}</p>{/if}
									</form>
								</td>
							</tr>
						{:else}
						<tr>
							<td class="adm-cell-main">
								<span class="adm-swatch" style="background:{tag.color}; color:{inkOn(tag.color)}">{tag.name}</span>
							</td>
							<td class="adm-muted" data-label={tFn('atags.col_slug')}><code>{tag.slug}</code></td>
							<td class="adm-num">
								<div class="tag-row-actions">
									<button type="button" class="adm-btn adm-btn--sm" onclick={() => startEdit(tag)}>{tFn('common.edit')}</button>
									<form method="POST" action="?/delete" use:enhance class="inline">
										<input type="hidden" name="tag_id" value={tag.id} />
										<button type="submit" class="adm-btn adm-btn--sm adm-btn--danger"
											onclick={(e) => { if (!confirm(tFn('atags.confirm_delete', { name: tag.name }))) e.preventDefault() }}>
											{tFn('atags.delete')}
										</button>
									</form>
								</div>
							</td>
						</tr>
						{/if}
					{:else}
						<tr><td colspan="3" class="adm-empty">{tFn('atags.none_found')}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<style>
	.tag-row-actions { display: inline-flex; gap: 0.375rem; justify-content: flex-end; flex-wrap: wrap; }
	.tag-editing td { background: color-mix(in srgb, var(--nx-header-accent) 5%, var(--nx-surface)) !important; }
	.tag-edit { display: grid; grid-template-columns: minmax(10rem, 1.4fr) auto minmax(8rem, 1fr) auto; gap: 0.75rem 1rem; align-items: end; text-align: left; }
	.tag-edit-actions { display: flex; gap: 0.375rem; justify-content: flex-end; }
	.tag-edit-help { grid-column: 1 / -1; margin: 0; font-size: 0.75rem; color: var(--nx-text-muted); }
	.tag-edit-err { grid-column: 1 / -1; margin: 0; }
	@media (max-width: 720px) {
		.tag-edit { grid-template-columns: 1fr; }
		.tag-edit-actions .adm-btn { flex: 1; }
		.tag-editing td { display: block; text-align: left; }
	}
</style>
