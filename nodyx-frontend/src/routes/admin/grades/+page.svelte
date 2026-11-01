<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'
	import { t } from '$lib/i18n'
	import { inkOn } from '$lib/adminTheme'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const grades  = $derived(data.grades ?? [])
	const members = $derived(data.members ?? [])

	const PERM_LABELS: Record<string, string> = {
		can_post:            'agrade.perm_post',
		can_create_thread:   'agrade.perm_create_thread',
		can_create_category: 'agrade.perm_create_category',
		can_moderate:        'agrade.perm_moderate',
		can_manage_members:  'agrade.perm_manage_members',
		can_manage_grades:   'agrade.perm_manage_grades',
	}

	const errorText = $derived(
		(form as any)?.error ?? ((form as any)?.errorKey ? tFn((form as any).errorKey) : null)
	)

	// ── Création / édition ────────────────────────────────────────────────
	let newName  = $state('')
	let newColor = $state('#99aab5')

	let editingId = $state<string | null>(null)
	let editName  = $state('')
	let editColor = $state('#99aab5')
	function startEdit(g: any) {
		editingId = g.id
		editName  = g.name
		editColor = g.color
	}

	// Combien de membres portent chaque grade (lu dans la liste déjà chargée)
	const holders = $derived.by(() => {
		const c: Record<string, number> = {}
		for (const m of members) if (m.grade_id) c[m.grade_id] = (c[m.grade_id] ?? 0) + 1
		return c
	})
	const ungraded = $derived(members.filter((m: any) => !m.grade_id).length)

	// ── Attribution ───────────────────────────────────────────────────────
	let search      = $state('')
	let gradeFilter = $state<'all' | 'none' | string>('all')
	const filteredMembers = $derived.by(() => {
		const q = search.trim().toLowerCase()
		return members
			.filter((m: any) => gradeFilter === 'all' || (gradeFilter === 'none' ? !m.grade_id : m.grade_id === gradeFilter))
			.filter((m: any) => !q || m.username.toLowerCase().includes(q))
			.sort((a: any, b: any) => a.username.localeCompare(b.username))
	})

	let savedFor  = $state<string | null>(null)
	let savingFor = $state<string | null>(null)
	let failedFor = $state<string | null>(null)
</script>

<svelte:head><title>{tFn('agrade.page_title')}</title></svelte:head>

{#snippet permChecks(current: Record<string, boolean> | null)}
	<fieldset class="adm-field">
		<legend class="adm-label mb-2">{tFn('agrade.permissions')}</legend>
		<div class="adm-checks">
			{#each Object.entries(PERM_LABELS) as [key, label]}
				<label class="adm-check">
					<input type="checkbox" name={key} checked={current?.[key] ?? false} />
					{tFn(label)}
				</label>
			{/each}
		</div>
		<p class="adm-hint mt-2">{tFn('agrade.perm_not_enforced')}</p>
	</fieldset>
{/snippet}

<div class="adm-page">
	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('agrade.title')}</h1>
			<p class="adm-desc">{tFn('agrade.desc')}</p>
		</div>
	</header>

	{#if errorText}
		<div class="adm-notice adm-notice--bad" role="alert">{errorText}</div>
	{/if}

	<!-- Créer -->
	<details class="adm-card adm-disclosure" open={grades.length === 0}>
		<summary>
			<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
			{tFn('agrade.create_grade')}
		</summary>
		<form method="POST" action="?/create" class="adm-form"
			use:enhance={() => async ({ result, update }) => {
				await update()
				if (result.type === 'success') newName = ''
			}}>
			<input type="hidden" name="position" value={grades.length} />
			<div class="adm-form-grid">
				<label class="adm-field">
					<span class="adm-label">{tFn('agrade.name')}</span>
					<input name="name" type="text" required maxlength="100" class="adm-input" bind:value={newName} />
				</label>
				<div class="adm-field">
					<label class="adm-label" for="grade-create-color">{tFn('agrade.color')}</label>
					<div class="adm-color">
						<input id="grade-create-color" name="color" type="color" bind:value={newColor} />
						<code>{newColor}</code>
					</div>
				</div>
				<div class="adm-field">
					<span class="adm-label">{tFn('atags.preview')}</span>
					<div class="flex items-center min-h-9">
						<span class="adm-swatch" style="background:{newColor}; color:{inkOn(newColor)}">{newName.trim() || tFn('agrade.name')}</span>
					</div>
				</div>
			</div>
			{@render permChecks(null)}
			<div>
				<button type="submit" class="adm-btn adm-btn--primary">{tFn('agrade.create')}</button>
			</div>
		</form>
	</details>

	<!-- Liste des grades -->
	{#if grades.length === 0}
		<p class="adm-empty adm-card">{tFn('agrade.empty')}</p>
	{:else}
		<div class="adm-table-wrap">
			<table class="adm-table">
				<thead>
					<tr>
						<th>{tFn('agrade.col_grade')}</th>
						<th>{tFn('agrade.permissions')}</th>
						<th class="adm-num">{tFn('agrade.col_holders')}</th>
						<th class="adm-num"><span class="sr-only">{tFn('agrade.col_actions')}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each grades as grade, i (grade.id)}
						<tr>
							{#if editingId === grade.id}
								<td colspan="4">
									<form method="POST" action="?/update" class="adm-form py-2"
										use:enhance={() => async ({ result, update }) => {
											await update()
											if (result.type === 'success') editingId = null
										}}>
										<input type="hidden" name="grade_id" value={grade.id} />
										<div class="adm-form-grid">
											<label class="adm-field">
												<span class="adm-label">{tFn('agrade.name')}</span>
												<input name="name" type="text" required maxlength="100" class="adm-input" bind:value={editName} />
											</label>
											<div class="adm-field">
												<label class="adm-label" for="grade-edit-color-{grade.id}">{tFn('agrade.color')}</label>
												<div class="adm-color">
													<input id="grade-edit-color-{grade.id}" name="color" type="color" bind:value={editColor} />
													<code>{editColor}</code>
												</div>
											</div>
											<div class="adm-field">
												<span class="adm-label">{tFn('atags.preview')}</span>
												<div class="flex items-center min-h-9">
													<span class="adm-swatch" style="background:{editColor}; color:{inkOn(editColor)}">{editName.trim() || grade.name}</span>
												</div>
											</div>
										</div>
										{@render permChecks(grade.permissions ?? {})}
										<div class="adm-actions">
											<button type="submit" class="adm-btn adm-btn--primary adm-btn--sm">{tFn('agrade.save')}</button>
											<button type="button" class="adm-btn adm-btn--sm" onclick={() => editingId = null}>{tFn('agrade.cancel')}</button>
										</div>
									</form>
								</td>
							{:else}
								<td class="adm-cell-main">
									<span class="adm-swatch" style="background:{grade.color}; color:{inkOn(grade.color)}">{grade.name}</span>
								</td>
								<td data-label={tFn('agrade.permissions')}>
									{#if Object.values(grade.permissions ?? {}).some(Boolean)}
										<div class="flex flex-wrap gap-1 justify-end md:justify-start">
											{#each Object.entries(PERM_LABELS).filter(([k]) => grade.permissions?.[k]) as [, label]}
												<span class="adm-pill">{tFn(label)}</span>
											{/each}
										</div>
									{:else}
										<span class="adm-muted">·</span>
									{/if}
								</td>
								<td class="adm-num" data-label={tFn('agrade.col_holders')}>{holders[grade.id] ?? 0}</td>
								<td class="adm-num">
									<div class="adm-actions adm-actions--row">
										<form method="POST" action="?/move" use:enhance class="adm-move">
											<input type="hidden" name="grade_id" value={grade.id} />
											<button type="submit" name="dir" value="up" class="adm-btn adm-btn--icon" disabled={i === 0}
												aria-label={tFn('agrade.move_up', { name: grade.name })} title={tFn('agrade.move_up', { name: grade.name })}>
												<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 15l-6-6-6 6"/></svg>
											</button>
											<button type="submit" name="dir" value="down" class="adm-btn adm-btn--icon" disabled={i === grades.length - 1}
												aria-label={tFn('agrade.move_down', { name: grade.name })} title={tFn('agrade.move_down', { name: grade.name })}>
												<svg fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
											</button>
										</form>
										<button type="button" class="adm-btn adm-btn--sm" onclick={() => startEdit(grade)}>{tFn('agrade.edit')}</button>
										<form method="POST" action="?/delete" use:enhance class="inline">
											<input type="hidden" name="grade_id" value={grade.id} />
											<button type="submit" class="adm-btn adm-btn--sm adm-btn--danger"
												onclick={(e) => { if (!confirm(tFn('agrade.confirm_delete', { name: grade.name }))) e.preventDefault() }}>
												{tFn('agrade.delete')}
											</button>
										</form>
									</div>
								</td>
							{/if}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<!-- Attribution aux membres -->
	<section class="flex flex-col gap-3 mt-2">
		<div class="adm-head">
			<div>
				<h2 class="adm-title" style="font-size:1.0625rem">{tFn('agrade.assign_title')}</h2>
				<p class="adm-desc">{tFn('agrade.assign_desc')}</p>
			</div>
			<label class="adm-search">
				<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
				<input type="search" class="adm-input" placeholder={tFn('agrade.search_ph')} aria-label={tFn('agrade.search_ph')} bind:value={search} />
			</label>
		</div>

		{#if grades.length > 0}
			<div class="adm-chips" role="group" aria-label={tFn('agrade.col_current_grade')}>
				<button type="button" class="adm-chip" aria-pressed={gradeFilter === 'all'} onclick={() => gradeFilter = 'all'}>
					{tFn('amem.filter_all')} <span class="adm-chip-count">{members.length}</span>
				</button>
				<button type="button" class="adm-chip" aria-pressed={gradeFilter === 'none'} onclick={() => gradeFilter = 'none'}>
					{tFn('agrade.filter_none')} <span class="adm-chip-count">{ungraded}</span>
				</button>
				{#each grades as g (g.id)}
					<button type="button" class="adm-chip" aria-pressed={gradeFilter === g.id} onclick={() => gradeFilter = g.id}>
						<span class="inline-block w-2 h-2 rounded-full" style="background:{g.color}" aria-hidden="true"></span>
						{g.name} <span class="adm-chip-count">{holders[g.id] ?? 0}</span>
					</button>
				{/each}
			</div>
		{/if}

		<div class="adm-table-wrap">
			<table class="adm-table">
				<thead>
					<tr>
						<th>{tFn('agrade.col_member')}</th>
						<th>{tFn('agrade.col_role')}</th>
						<th>{tFn('agrade.col_assign')}</th>
					</tr>
				</thead>
				<tbody>
					{#each filteredMembers as member (member.user_id)}
						<tr>
							<td class="adm-cell-main font-medium">{member.username}</td>
							<td data-label={tFn('agrade.col_role')}>
								<span class="adm-pill adm-pill--{member.role}">{tFn(`amem.role_${member.role}`)}</span>
							</td>
							<td data-label={tFn('agrade.col_assign')}>
								<form method="POST" action="?/assign" class="flex items-center gap-2 justify-end md:justify-start"
									use:enhance={({ formElement }) => {
										savingFor = member.user_id
										failedFor = null
										return async ({ result, update }) => {
											savingFor = null
											if (result.type === 'success') {
												await update({ reset: false })
												savedFor = member.user_id
												setTimeout(() => { if (savedFor === member.user_id) savedFor = null }, 2000)
											} else {
												// Échec : le menu revient sur le grade réellement en base,
												// et la ligne le dit (jamais de « Enregistré » mensonger).
												const sel = formElement.querySelector('select')
												if (sel) sel.value = member.grade_id ?? ''
												failedFor = member.user_id
											}
										}
									}}>
									<input type="hidden" name="user_id" value={member.user_id} />
									<select name="grade_id" class="adm-input" aria-label={tFn('agrade.assign_to', { name: member.username })}
										disabled={grades.length === 0 || savingFor === member.user_id}
										onchange={(e) => (e.currentTarget as HTMLSelectElement).form?.requestSubmit()}>
										<option value="" selected={!member.grade_id}>{tFn('agrade.none')}</option>
										{#each grades as g (g.id)}
											<option value={g.id} selected={g.id === member.grade_id}>{g.name}</option>
										{/each}
									</select>
									<span class="text-xs adm-muted min-w-[4.5rem]" role="status">
										{#if savedFor === member.user_id}{tFn('agrade.saved')}{:else if failedFor === member.user_id}<span style="color:var(--nx-bad)">{tFn('agrade.assign_failed')}</span>{/if}
									</span>
								</form>
							</td>
						</tr>
					{:else}
						<tr><td colspan="3" class="adm-empty">{tFn('amem.none_found')}</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	</section>
</div>
