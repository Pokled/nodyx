<script lang="ts">
	import { enhance } from '$app/forms'
	import { tick } from 'svelte'
	import type { PageData, ActionData } from './$types'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const errorText = $derived(
		(form as any)?.error ?? ((form as any)?.errorKey ? tFn((form as any).errorKey) : null)
	)

	type Row = {
		id: string; name: string; description?: string | null; parent_id: string | null
		post_min_role?: string | null; thread_count: number; depth: number
		index: number; siblings: number; subtreeThreads: number; descendants: Set<string>
	}

	// Arbre aplati pour le tableau : profondeur, rang parmi les sœurs (pour les
	// flèches), fils de toute la branche (la suppression est refusée tant qu'il en
	// reste) et descendants (une catégorie ne peut pas devenir l'enfant de sa
	// propre sous-catégorie : ce serait une boucle).
	function flatten(nodes: any[], depth = 0): Row[] {
		return nodes.flatMap((n, index) => {
			const children = flatten(n.children ?? [], depth + 1)
			const direct = children.filter(c => c.depth === depth + 1)
			const row: Row = {
				...n, depth, index, siblings: nodes.length,
				subtreeThreads: (n.thread_count ?? 0) + direct.reduce((s, c) => s + c.subtreeThreads, 0),
				descendants: new Set(children.map(c => c.id)),
			}
			return [row, ...children]
		})
	}
	const rows = $derived(flatten(data.categories ?? []))

	const ROLES = ['member', 'moderator', 'admin', 'owner'] as const

	// ── Création (avec parent pré-rempli depuis « Ajouter une sous-catégorie ») ──
	let createOpen   = $state(false)
	let createParent = $state('')
	let createName: HTMLInputElement | undefined = $state()
	async function addChild(parentId: string) {
		createParent = parentId
		createOpen = true
		await tick()
		createName?.scrollIntoView({ block: 'center', behavior: 'smooth' })
		createName?.focus()
	}

	let editingId = $state<string | null>(null)
</script>

<svelte:head><title>{tFn('acat.page_title')}</title></svelte:head>

{#snippet parentOptions(exclude: Row | null, selected: string | null)}
	<option value="" selected={!selected}>{tFn('acat.root')}</option>
	{#each rows.filter(r => !exclude || (r.id !== exclude.id && !exclude.descendants.has(r.id))) as c (c.id)}
		<option value={c.id} selected={c.id === selected}>{'  '.repeat(c.depth * 2)}{c.depth > 0 ? '└ ' : ''}{c.name}</option>
	{/each}
{/snippet}

<div class="adm-page">
	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('acat.title')}</h1>
			<p class="adm-desc">{tFn('acat.desc')}</p>
		</div>
	</header>

	{#if errorText}
		<div class="adm-notice adm-notice--bad" role="alert">{errorText}</div>
	{/if}

	<!-- Créer -->
	<details class="adm-card adm-disclosure" bind:open={createOpen}>
		<summary>
			<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			{tFn('acat.new_category')}
		</summary>
		<form method="POST" action="?/create" class="adm-form"
			use:enhance={() => async ({ result, update }) => {
				await update()
				if (result.type === 'success') createParent = ''
			}}>
			<div class="adm-form-grid">
				<label class="adm-field">
					<span class="adm-label">{tFn('acat.name')}</span>
					<input name="name" type="text" required maxlength="100" class="adm-input" bind:this={createName} />
				</label>
				<label class="adm-field">
					<span class="adm-label">{tFn('acat.parent')}</span>
					<select name="parent_id" class="adm-input" bind:value={createParent}>
						{@render parentOptions(null, createParent || null)}
					</select>
				</label>
			</div>
			<label class="adm-field">
				<span class="adm-label">{tFn('acat.description')}</span>
				<input name="description" type="text" maxlength="500" class="adm-input" placeholder={tFn('acat.optional')} />
			</label>
			<div>
				<button type="submit" class="adm-btn adm-btn--primary">{tFn('acat.create')}</button>
			</div>
		</form>
	</details>

	<!-- Arbre -->
	<div class="adm-table-wrap">
		<table class="adm-table">
			<thead>
				<tr>
					<th>{tFn('acat.col_category')}</th>
					<th>{tFn('acat.post_min_role_label')}</th>
					<th class="adm-num">{tFn('acat.col_threads')}</th>
					<th class="adm-num"><span class="sr-only">{tFn('acat.col_actions')}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each rows as cat (cat.id)}
					<tr>
						{#if editingId === cat.id}
							<td colspan="4">
								<form method="POST" action="?/edit" class="adm-form py-2"
									use:enhance={() => async ({ result, update }) => {
										await update()
										if (result.type === 'success') editingId = null
									}}>
									<input type="hidden" name="id" value={cat.id} />
									<div class="adm-form-grid">
										<label class="adm-field">
											<span class="adm-label">{tFn('acat.name')}</span>
											<input name="name" type="text" required maxlength="100" value={cat.name} class="adm-input" />
										</label>
										<label class="adm-field">
											<span class="adm-label">{tFn('acat.parent')}</span>
											<select name="parent_id" class="adm-input">
												{@render parentOptions(cat, cat.parent_id)}
											</select>
										</label>
										<label class="adm-field">
											<span class="adm-label">{tFn('acat.post_min_role_label')}</span>
											<select name="post_min_role" class="adm-input">
												{#each ROLES as value}
													<option {value} selected={(cat.post_min_role ?? 'member') === value}>{tFn(`acat.role_${value}`)}</option>
												{/each}
											</select>
										</label>
									</div>
									<label class="adm-field">
										<span class="adm-label">{tFn('acat.description')}</span>
										<input name="description" type="text" maxlength="500" value={cat.description ?? ''} class="adm-input" placeholder={tFn('acat.optional')} />
									</label>
									<div class="adm-actions">
										<button type="submit" class="adm-btn adm-btn--primary adm-btn--sm">{tFn('acat.save')}</button>
										<button type="button" class="adm-btn adm-btn--sm" onclick={() => editingId = null}>{tFn('acat.cancel')}</button>
									</div>
								</form>
							</td>
						{:else}
							<td class="adm-cell-main">
								<div class="flex items-start gap-2 min-w-0">
									{#if cat.depth > 0}
										<span class="adm-tree-indent" style="width:{(cat.depth - 1) * 1.25}rem" aria-hidden="true"></span>
										<span class="adm-tree-branch" aria-hidden="true">└</span>
									{/if}
									<div class="min-w-0">
										<div class="font-medium">{cat.name}</div>
										{#if cat.description}
											<div class="text-xs adm-muted line-clamp-1">{cat.description}</div>
										{/if}
									</div>
								</div>
							</td>
							<td data-label={tFn('acat.post_min_role_label')}>
								{#if (cat.post_min_role ?? 'member') !== 'member'}
									<span class="adm-pill adm-pill--{cat.post_min_role === 'moderator' ? 'moderator' : 'admin'}">{tFn(`acat.role_${cat.post_min_role}`)}</span>
								{:else}
									<span class="adm-muted text-xs">{tFn('acat.role_member')}</span>
								{/if}
							</td>
							<td class="adm-num" data-label={tFn('acat.col_threads')}>{cat.thread_count}</td>
							<td class="adm-num">
								<div class="adm-actions adm-actions--row">
									<form method="POST" action="?/move" use:enhance class="adm-move">
										<input type="hidden" name="id" value={cat.id} />
										<button type="submit" name="dir" value="up" class="adm-btn adm-btn--icon" disabled={cat.index === 0}
											aria-label={tFn('acat.move_up', { name: cat.name })} title={tFn('acat.move_up', { name: cat.name })}>
											<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>
										</button>
										<button type="submit" name="dir" value="down" class="adm-btn adm-btn--icon" disabled={cat.index === cat.siblings - 1}
											aria-label={tFn('acat.move_down', { name: cat.name })} title={tFn('acat.move_down', { name: cat.name })}>
											<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
										</button>
									</form>
									<button type="button" class="adm-btn adm-btn--icon" onclick={() => addChild(cat.id)}
										aria-label={tFn('acat.add_child', { name: cat.name })} title={tFn('acat.add_child', { name: cat.name })}>
										<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
									</button>
									<button type="button" class="adm-btn adm-btn--sm" onclick={() => editingId = cat.id}>{tFn('acat.edit')}</button>
									<form method="POST" action="?/delete" use:enhance class="inline">
										<input type="hidden" name="id" value={cat.id} />
										<button type="submit" class="adm-btn adm-btn--sm adm-btn--danger"
											disabled={cat.subtreeThreads > 0}
											title={cat.subtreeThreads > 0 ? tFn('acat.delete_blocked', { n: cat.subtreeThreads }) : undefined}
											onclick={(e) => { if (!confirm(tFn('acat.confirm_delete', { name: cat.name }))) e.preventDefault() }}>
											{tFn('acat.delete')}
										</button>
									</form>
								</div>
							</td>
						{/if}
					</tr>
				{:else}
					<tr><td colspan="4" class="adm-empty">{tFn('acat.empty')}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>
	<p class="adm-hint">{tFn('acat.delete_hint')}</p>
</div>
