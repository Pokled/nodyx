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

	// Des idées pour démarrer, créées en un clic dans la langue de l'admin.
	// Une idée disparaît dès qu'un tag du même nom existe.
	const IDEAS = [
		{ key: 'question', color: '#3b82f6' },
		{ key: 'solved',   color: '#22c55e' },
		{ key: 'tutorial', color: '#8b5cf6' },
		{ key: 'news',     color: '#f59e0b' },
		{ key: 'idea',     color: '#ec4899' },
		{ key: 'bug',      color: '#ef4444' },
		{ key: 'beginner', color: '#14b8a6' },
		{ key: 'spoiler',  color: '#64748b' },
	] as const;
	const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
	const ideas = $derived(IDEAS.filter((i) => !tags.some((tag: any) => norm(tag.name) === norm(tFn(`atags.idea_${i.key}`)))));
	let ideaBusy = $state<string | null>(null);

	// L'aperçu « dans le forum » : les vrais tags les plus portés, sinon deux idées
	const sample = $derived.by(() => {
		const real = [...tags].sort((a: any, b: any) => (b.thread_count ?? 0) - (a.thread_count ?? 0)).slice(0, 2);
		if (real.length) return real.map((tag: any) => ({ name: tag.name, color: tag.color }));
		return IDEAS.slice(0, 2).map((i) => ({ name: tFn(`atags.idea_${i.key}`), color: i.color }));
	});
	const used = $derived(tags.reduce((n: number, tag: any) => n + ((tag.thread_count ?? 0) > 0 ? 1 : 0), 0));

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

	<!-- À quoi ça sert : trois temps, et ce que voient les membres -->
	<section class="adm-card tg-how" aria-labelledby="tg-how-title">
		<div class="tg-how-text">
			<h2 id="tg-how-title" class="tg-h2">{tFn('atags.how_title')}</h2>
			<ol class="tg-steps">
				{#each [1, 2, 3] as i (i)}
					<li><span class="tg-n">{i}</span><span><b>{tFn(`atags.how_${i}`)}</b> {tFn(`atags.how_${i}_sub`)}</span></li>
				{/each}
			</ol>
			<p class="tg-note">{tFn('atags.how_note')}</p>
		</div>
		<figure class="tg-demo" aria-label={tFn('atags.demo_label')}>
			<figcaption>{tFn('atags.demo_label')}</figcaption>
			<div class="tg-demo-bar">
				<span class="tg-demo-lbl">{tFn('forum.tags_filter')}</span>
				<span class="tg-chip tg-chip--on">{tFn('forum.tags_all')}</span>
				{#each sample as s (s.name)}<span class="tg-chip" style="--tc:{s.color}">{s.name}</span>{/each}
			</div>
			<div class="tg-demo-row">
				<span class="tg-demo-av" aria-hidden="true">L</span>
				<span class="tg-demo-body">
					<span class="tg-demo-tags">{#each sample as s (s.name)}<span class="tg-mini" style="--tc:{s.color}">{s.name}</span>{/each}</span>
					<b>{tFn('atags.demo_thread')}</b>
					<span class="tg-demo-meta">{tFn('atags.demo_meta')}</span>
				</span>
			</div>
		</figure>
	</section>

	<!-- Idées : un clic crée le tag -->
	{#if ideas.length > 0}
		<section class="adm-card tg-ideas" aria-labelledby="tg-ideas-title">
			<div>
				<h2 id="tg-ideas-title" class="tg-h2">{tFn('atags.ideas_title')}</h2>
				<p class="tg-note">{tFn('atags.ideas_sub')}</p>
			</div>
			<div class="tg-idea-list">
				{#each ideas as idea (idea.key)}
					<form method="POST" action="?/create" use:enhance={() => { ideaBusy = idea.key; return async ({ update }) => { await update({ reset: false }); ideaBusy = null } }}>
						<input type="hidden" name="name" value={tFn(`atags.idea_${idea.key}`)} />
						<input type="hidden" name="color" value={idea.color} />
						<button type="submit" class="tg-idea" style="--tc:{idea.color}" disabled={ideaBusy !== null}>
							<span class="tg-idea-top"><span class="tg-plus" aria-hidden="true">+</span><b>{tFn(`atags.idea_${idea.key}`)}</b></span>
							<span class="tg-idea-why">{tFn(`atags.idea_${idea.key}_why`)}</span>
						</button>
					</form>
				{/each}
			</div>
		</section>
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
		{:else}
			<p class="adm-desc">{tFn(tags.length > 1 ? 'atags.summary_many' : 'atags.summary_one', { n: tags.length, used })}</p>
		{/if}
		<div class="adm-table-wrap">
			<table class="adm-table">
				<thead>
					<tr>
						<th>{tFn('atags.col_tag')}</th>
						<th>{tFn('atags.col_slug')}</th>
						<th class="adm-num">{tFn('atags.col_threads')}</th>
						<th class="adm-num"><span class="sr-only">{tFn('atags.col_action')}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as tag (tag.id)}
						{#if editId === tag.id}
							<tr class="tag-editing">
								<td colspan="4">
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
							<td class="adm-num" data-label={tFn('atags.col_threads')}>{#if tag.thread_count}{tag.thread_count}{:else}<span class="adm-muted" title={tFn('atags.unused_tip')}>{tFn('atags.unused')}</span>{/if}</td>
							<td class="adm-num">
								<div class="tag-row-actions">
									<button type="button" class="adm-btn adm-btn--sm" onclick={() => startEdit(tag)}>{tFn('common.edit')}</button>
									<form method="POST" action="?/delete" use:enhance class="inline">
										<input type="hidden" name="tag_id" value={tag.id} />
										<button type="submit" class="adm-btn adm-btn--sm adm-btn--danger"
											onclick={(e) => { if (!confirm(tag.thread_count ? tFn(tag.thread_count > 1 ? 'atags.confirm_delete_many' : 'atags.confirm_delete_one', { name: tag.name, n: tag.thread_count }) : tFn('atags.confirm_delete', { name: tag.name }))) e.preventDefault() }}>
											{tFn('atags.delete')}
										</button>
									</form>
								</div>
							</td>
						</tr>
						{/if}
					{:else}
						<tr><td colspan="4" class="adm-empty">{tFn('atags.none_found')}</td></tr>
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
	/* À quoi ça sert + aperçu dans le forum */
	.tg-how { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 1.25rem; align-items: start; }
	.tg-h2 { margin: 0 0 0.625rem; font-size: 0.95rem; font-weight: 650; }
	.tg-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.625rem; font-size: 0.82rem; line-height: 1.5; color: var(--nx-text-muted); }
	.tg-steps li { display: flex; gap: 0.625rem; align-items: flex-start; }
	.tg-steps b { color: var(--nx-text); font-weight: 600; }
	.tg-n { flex: none; width: 1.375rem; height: 1.375rem; border-radius: 99px; display: grid; place-items: center; font-size: 0.7rem; font-weight: 700; background: var(--nx-header-accent); color: #16120c; margin-top: 0.05rem; }
	.tg-note { margin: 0.75rem 0 0; font-size: 0.75rem; color: var(--nx-text-muted); }
	.tg-demo { margin: 0; padding: 0.875rem; border-radius: 12px; border: 1px dashed var(--nx-border); background: color-mix(in srgb, var(--nx-text) 2%, var(--nx-surface)); display: flex; flex-direction: column; gap: 0.625rem; }
	.tg-demo figcaption { font-size: 0.68rem; font-weight: 650; letter-spacing: 0.06em; text-transform: uppercase; color: var(--nx-text-muted); }
	.tg-demo-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; }
	.tg-demo-lbl { font-size: 0.7rem; font-weight: 600; color: var(--nx-text-muted); margin-right: 0.125rem; }
	.tg-chip { --tc: var(--nx-text-muted); display: inline-flex; padding: 0.125rem 0.5rem; font-size: 0.7rem; font-weight: 600; color: var(--tc); border: 1px solid color-mix(in srgb, var(--tc) 35%, transparent); background: color-mix(in srgb, var(--tc) 8%, transparent); }
	.tg-chip--on { --tc: var(--nx-header-accent); background: var(--nx-header-accent); color: #16120c; }
	.tg-demo-row { display: flex; gap: 0.625rem; align-items: flex-start; padding: 0.625rem; border: 1px solid var(--nx-border); background: var(--nx-surface); }
	.tg-demo-av { flex: none; width: 2rem; height: 2rem; border-radius: 99px; display: grid; place-items: center; font-weight: 700; font-size: 0.8rem; background: linear-gradient(135deg, #4f46e5, #7c3aed); color: #fff; }
	.tg-demo-body { display: flex; flex-direction: column; gap: 0.25rem; min-width: 0; font-size: 0.82rem; }
	.tg-demo-tags { display: flex; flex-wrap: wrap; gap: 0.25rem; }
	.tg-mini { --tc: var(--nx-text-muted); padding: 0 0.4rem; font-size: 0.68rem; font-weight: 600; color: var(--tc); border: 1px solid color-mix(in srgb, var(--tc) 30%, transparent); background: color-mix(in srgb, var(--tc) 13%, transparent); }
	.tg-demo-meta { font-size: 0.72rem; color: var(--nx-text-muted); }
	/* Idées en un clic */
	.tg-ideas { display: flex; flex-direction: column; gap: 0.75rem; }
	.tg-ideas .tg-note { margin-top: 0; }
	.tg-idea-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 12rem), 1fr)); gap: 0.5rem; }
	.tg-idea-list form { display: contents; }
	.tg-idea { --tc: var(--nx-header-accent); display: flex; flex-direction: column; gap: 0.2rem; text-align: left; padding: 0.625rem 0.75rem; border-radius: 10px; border: 1px solid var(--nx-border); border-left: 3px solid var(--tc); background: var(--nx-surface); font: inherit; color: inherit; cursor: pointer; transition: background 0.15s, border-color 0.15s; }
	.tg-idea:hover:not(:disabled) { background: color-mix(in srgb, var(--tc) 7%, var(--nx-surface)); border-color: color-mix(in srgb, var(--tc) 45%, var(--nx-border)); }
	.tg-idea:disabled { opacity: 0.55; cursor: wait; }
	.tg-idea-top { display: flex; align-items: center; gap: 0.375rem; font-size: 0.85rem; }
	.tg-idea-top b { color: var(--tc); font-weight: 650; }
	.tg-plus { width: 1.125rem; height: 1.125rem; border-radius: 6px; display: grid; place-items: center; font-weight: 700; font-size: 0.8rem; color: var(--tc); background: color-mix(in srgb, var(--tc) 14%, transparent); }
	.tg-idea-why { font-size: 0.72rem; line-height: 1.45; color: var(--nx-text-muted); }
	@media (max-width: 860px) { .tg-how { grid-template-columns: 1fr; } }
</style>
