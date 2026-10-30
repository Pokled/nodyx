<script lang="ts">
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import type { PageData } from './$types'
	import { untrack } from 'svelte'
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte'
	import { t, locale } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	// ── État local ────────────────────────────────────────────────────────────
	let board   = $state(untrack(() => structuredClone(data.board)))
	let members = $state(untrack(() => data.members))

	const token     = $derived(page.data.token as string)
	const API       = '/api/v1/tasks'

	// ── Drag & drop ───────────────────────────────────────────────────────────
	let dragCardId    = $state<string | null>(null)
	let dragOverColId = $state<string | null>(null)

	// ── Modales / formulaires ─────────────────────────────────────────────────
	let addingCardColId   = $state<string | null>(null)  // colonne dont on ajoute une carte
	let addingColumn      = $state(false)
	let editingCard       = $state<any | null>(null)      // carte en cours d'édition
	let editingBoardName  = $state(false)

	// inputs
	let newCardTitle  = $state('')
	let newColName    = $state('')
	let newColColor   = $state('gray')
	let boardNameDraft = $state(board.name)

	// ── Helpers ───────────────────────────────────────────────────────────────
	// labelKey résolu via tFn dans le template (réactif à la locale).
	const PRIORITY_META: Record<string, { labelKey: string; cls: string }> = {
		low:    { labelKey: 'tasks.priority.low',    cls: 'text-gray-500 bg-gray-800 border-gray-700' },
		normal: { labelKey: 'tasks.priority.normal', cls: 'text-gray-400 bg-gray-800 border-gray-700' },
		high:   { labelKey: 'tasks.priority.high',   cls: 'text-[var(--nx-warn)] bg-[color-mix(in_srgb,var(--nx-warn)_12%,transparent)] border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)]' },
		urgent: { labelKey: 'tasks.priority.urgent', cls: 'text-[var(--nx-bad)] bg-[color-mix(in_srgb,var(--nx-bad)_12%,transparent)] border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)]' },
	}

	const COL_COLORS: Record<string, string> = {
		gray:   'bg-gray-500',
		red:    'bg-red-500',
		orange: 'bg-orange-500',
		yellow: 'bg-yellow-500',
		green:  'bg-green-500',
		blue:   'bg-blue-500',
		indigo: 'bg-indigo-500',
		purple: 'bg-purple-500',
		pink:   'bg-pink-500',
	}

	const COLOR_OPTS = Object.keys(COL_COLORS)

	function fDue(iso: string | null, dateLocale: string) {
		if (!iso) return null
		const d = new Date(iso)
		const today = new Date(); today.setHours(0,0,0,0)
		const diff  = Math.ceil((d.getTime() - today.getTime()) / 86400000)
		if (diff < 0)   return { labelKey: 'tasks.due.overdue', cls: 'text-[var(--nx-bad)] bg-[color-mix(in_srgb,var(--nx-bad)_12%,transparent)] border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)]' }
		if (diff === 0) return { labelKey: 'tasks.due.today', cls: 'text-[var(--nx-warn)] bg-[color-mix(in_srgb,var(--nx-warn)_12%,transparent)] border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)]' }
		if (diff === 1) return { labelKey: 'tasks.due.tomorrow', cls: 'text-[var(--nx-warn)] bg-[color-mix(in_srgb,var(--nx-warn)_12%,transparent)] border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)]' }
		return {
			label: d.toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' }),
			cls:   'text-gray-400 bg-gray-800 border-gray-700',
		}
	}

	// ── API helpers ───────────────────────────────────────────────────────────

	async function api(path: string, method = 'GET', body?: unknown) {
		const res = await fetch(`${API}${path}`, {
			method,
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: body ? JSON.stringify(body) : undefined,
		})
		return res.ok ? res.json() : null
	}

	// ── Cartes ────────────────────────────────────────────────────────────────

	async function addCard(colId: string) {
		const title = newCardTitle.trim()
		if (!title) return
		const json = await api(`/columns/${colId}/cards`, 'POST', { title })
		if (!json) return
		const col = board.columns.find((c: any) => c.id === colId)
		if (col) col.cards = [...col.cards, json.card]
		newCardTitle  = ''
		addingCardColId = null
	}

	async function deleteCard(cardId: string, colId: string) {
		if (!confirm(tFn('tasks.confirm_delete_card'))) return
		await api(`/cards/${cardId}`, 'DELETE')
		const col = board.columns.find((c: any) => c.id === colId)
		if (col) col.cards = col.cards.filter((k: any) => k.id !== cardId)
		if (editingCard?.id === cardId) editingCard = null
	}

	async function saveCard() {
		if (!editingCard) return
		const json = await api(`/cards/${editingCard.id}`, 'PATCH', {
			title:       editingCard.title,
			description: editingCard.description,
			assignee_id: editingCard.assignee_id ?? null,
			due_date:    editingCard.due_date    ?? null,
			priority:    editingCard.priority,
		})
		if (!json) return
		// Mettre à jour la carte dans son colonne
		for (const col of board.columns) {
			const idx = col.cards.findIndex((k: any) => k.id === editingCard.id)
			if (idx >= 0) { col.cards[idx] = json.card; break }
		}
		editingCard = null
	}

	// ── Déplacement (drag & drop) ─────────────────────────────────────────────

	function onDragStart(e: DragEvent, cardId: string) {
		dragCardId = cardId
		e.dataTransfer!.effectAllowed = 'move'
	}

	function onDragOver(e: DragEvent, colId: string) {
		e.preventDefault()
		dragOverColId = colId
	}

	function onDragLeave() {
		dragOverColId = null
	}

	async function onDrop(e: DragEvent, targetColId: string) {
		e.preventDefault()
		dragOverColId = null
		if (!dragCardId) return

		// Trouver la carte + sa colonne source
		let sourceCol: any = null
		let card: any      = null
		for (const col of board.columns) {
			const found = col.cards.find((k: any) => k.id === dragCardId)
			if (found) { sourceCol = col; card = found; break }
		}
		if (!card || sourceCol?.id === targetColId) { dragCardId = null; return }

		// Optimistic update
		sourceCol.cards = sourceCol.cards.filter((k: any) => k.id !== dragCardId)
		const targetCol = board.columns.find((c: any) => c.id === targetColId)
		if (targetCol) targetCol.cards = [...targetCol.cards, { ...card, column_id: targetColId }]

		dragCardId = null
		await api(`/cards/${card.id}`, 'PATCH', { column_id: targetColId })
	}

	// ── Colonnes ──────────────────────────────────────────────────────────────

	async function addColumn() {
		const name = newColName.trim()
		if (!name) return
		const json = await api(`/boards/${board.id}/columns`, 'POST', { name, color: newColColor })
		if (!json) return
		board.columns = [...board.columns, json.column]
		newColName    = ''
		newColColor   = 'gray'
		addingColumn  = false
	}

	async function deleteColumn(colId: string) {
		const col = board.columns.find((c: any) => c.id === colId)
		if (!confirm(tFn('tasks.confirm_delete_col', { name: col?.name }))) return
		await api(`/columns/${colId}`, 'DELETE')
		board.columns = board.columns.filter((c: any) => c.id !== colId)
	}

	// ── Renommage board ───────────────────────────────────────────────────────

	async function saveBoardName() {
		const name = boardNameDraft.trim()
		if (!name || name === board.name) { editingBoardName = false; return }
		await api(`/boards/${board.id}`, 'PATCH', { name })
		board.name   = name
		editingBoardName = false
	}

	async function deleteBoard() {
		if (!confirm(tFn('tasks.confirm_delete_board', { name: board.name }))) return
		await api(`/boards/${board.id}`, 'DELETE')
		goto('/tasks')
	}
</script>

<svelte:head><title>{tFn('tasks.meta_title', { board: board.name })}</title></svelte:head>

<!-- ── Header ──────────────────────────────────────────────────────────────── -->
<div class="flex items-center gap-3 mb-6 flex-wrap">
	<a href="/tasks" class="text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] text-sm transition-colors">← {tFn('tasks.boards_breadcrumb')}</a>
	<span class="text-[var(--nx-text-muted)]">/</span>

	{#if editingBoardName}
		<form onsubmit={(e) => { e.preventDefault(); saveBoardName() }} class="flex items-center gap-2">
			<!-- svelte-ignore a11y_autofocus -->
			<input
				bind:value={boardNameDraft}
				class="rounded-lg bg-[var(--nx-surface)] border border-indigo-700 px-3 py-1.5 text-sm text-[var(--nx-text)] focus:outline-none"
				autofocus
				onblur={saveBoardName}
			/>
		</form>
	{:else}
		<h1
			class="text-lg font-bold text-[var(--nx-text)] {data.canManage ? 'cursor-pointer hover:text-[var(--nx-header-accent)] transition-colors' : ''}"
			ondblclick={() => data.canManage && (editingBoardName = true)}
			title={data.canManage ? 'Double-cliquer pour renommer' : ''}
		>
			{board.name}
		</h1>
	{/if}

	{#if board.description}
		<span class="text-sm text-[var(--nx-text-muted)] hidden sm:inline">· {board.description}</span>
	{/if}

	{#if data.canManage}
		<button
			onclick={deleteBoard}
			class="ml-auto text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-bad)] transition-colors"
		>
			{tFn('tasks.delete_board')}
		</button>
	{/if}
</div>

<!-- ── Kanban ───────────────────────────────────────────────────────────────── -->
<div class="flex gap-4 overflow-x-auto pb-6 items-start">

	{#each board.columns as col (col.id)}
		<!-- Colonne -->
		<div
			class="flex-1 min-w-[15rem] flex flex-col rounded-xl border transition-colors
			       {dragOverColId === col.id ? 'border-indigo-600 bg-[rgb(var(--nx-accent-rgb)/0.08)]' : 'border-[var(--nx-border)] bg-[var(--nx-surface)]/40'}"
			ondragover={(e) => onDragOver(e, col.id)}
			ondragleave={onDragLeave}
			ondrop={(e) => onDrop(e, col.id)}
			role="list"
		>
			<!-- Header colonne -->
			<div class="flex items-center gap-2 px-3 py-3 border-b border-[var(--nx-border)]">
				<span class="w-2.5 h-2.5 rounded-full flex-shrink-0 {COL_COLORS[col.color] ?? 'bg-gray-500'}"></span>
				<span class="flex-1 text-sm font-semibold text-[var(--nx-text)] truncate">{col.name}</span>
				<span class="text-xs text-[var(--nx-text-muted)] tabular-nums">{col.cards.length}</span>
				{#if data.canManage}
					<button
						onclick={() => deleteColumn(col.id)}
						class="text-[var(--nx-text-muted)] hover:text-[var(--nx-bad)] text-sm leading-none transition-colors ml-1"
						title={tFn('tasks.delete_col_title')}
					>×</button>
				{/if}
			</div>

			<!-- Cartes -->
			<div class="flex flex-col gap-2 p-2 min-h-[4rem]">
				{#each col.cards as card (card.id)}
					{@const due     = fDue(card.due_date, $locale)}
					{@const priMeta = PRIORITY_META[card.priority] ?? PRIORITY_META.normal}
					<div
						draggable="true"
						ondragstart={(e) => onDragStart(e, card.id)}
						class="rounded-lg border bg-[var(--nx-surface)] hover:bg-[var(--nx-surface-raised)] border-[var(--nx-border)]/60 hover:border-[var(--nx-border)]
						       p-3 cursor-grab active:cursor-grabbing transition-colors group"
						role="listitem"
					>
						<!-- Titre + actions -->
						<div class="flex items-start gap-2">
							<p class="flex-1 text-sm text-[var(--nx-text)] leading-snug">{card.title}</p>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
								<button
									onclick={() => editingCard = $state.snapshot(card)}
									class="text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] text-xs leading-none"
									title={tFn('tasks.edit')}
								>✎</button>
								<button
									onclick={() => deleteCard(card.id, col.id)}
									class="text-[var(--nx-text-muted)] hover:text-[var(--nx-bad)] text-xs leading-none ml-0.5"
									title={tFn('tasks.delete')}
								>×</button>
							</div>
						</div>

						<!-- Description riche : HTML assaini côté serveur (écriture ET
						     lecture), donc sûr à rendre. Bornée en hauteur sur la tuile. -->
						{#if card.description}
							<div class="task-card-desc mt-1.5 max-h-28 overflow-hidden text-xs leading-snug text-[var(--nx-text-muted)]">
								{@html card.description}
							</div>
						{/if}

						<!-- Badges -->
						<div class="flex flex-wrap gap-1.5 mt-2">
							{#if card.priority !== 'normal'}
								<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border {priMeta.cls}">
									{tFn(priMeta.labelKey)}
								</span>
							{/if}
							{#if due}
								<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border {due.cls}">
									📅 {due.labelKey ? tFn(due.labelKey) : due.label}
								</span>
							{/if}
							{#if card.assignee_username}
								<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-[var(--nx-text-muted)] bg-[var(--nx-surface-raised)] border border-[var(--nx-border)]">
									{#if card.assignee_avatar}
										<img src={card.assignee_avatar} alt="" class="w-3.5 h-3.5 rounded-full" />
									{/if}
									{card.assignee_username}
								</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<!-- Ajouter une carte -->
			<div class="p-2 border-t border-[var(--nx-border)]">
				{#if addingCardColId === col.id}
					<form onsubmit={(e) => { e.preventDefault(); addCard(col.id) }} class="space-y-2">
						<!-- svelte-ignore a11y_autofocus -->
						<input
							bind:value={newCardTitle}
							placeholder={tFn('tasks.card_title_ph')}
							maxlength="200"
							autofocus
							class="w-full rounded-lg bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
							       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-600"
						/>
						<div class="flex gap-2">
							<button
								type="submit"
								class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
							>{tFn('tasks.add')}</button>
							<button
								type="button"
								onclick={() => { addingCardColId = null; newCardTitle = '' }}
								class="px-3 py-1.5 rounded-lg bg-[var(--nx-surface-raised)] hover:bg-[var(--nx-border)] text-xs text-[var(--nx-text-muted)] transition-colors"
							>{tFn('tasks.cancel')}</button>
						</div>
					</form>
				{:else}
					<button
						onclick={() => { addingCardColId = col.id; newCardTitle = '' }}
						class="w-full text-left px-2 py-1.5 text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] hover:bg-[var(--nx-surface-raised)] rounded-lg transition-colors"
					>
						{tFn('tasks.add_card')}
					</button>
				{/if}
			</div>
		</div>
	{/each}

	<!-- Ajouter une colonne -->
	{#if data.canManage}
		<div class="flex-shrink-0 w-64">
			{#if addingColumn}
				<div class="rounded-xl border border-indigo-800/50 bg-[rgb(var(--nx-accent-rgb)/0.08)] p-3 space-y-3">
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={newColName}
						placeholder={tFn('tasks.col_name_ph')}
						maxlength="100"
						autofocus
						class="w-full rounded-lg bg-[var(--nx-surface)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
						       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-600"
					/>
					<div class="flex flex-wrap gap-1.5">
						{#each COLOR_OPTS as c}
							<button
								onclick={() => newColColor = c}
								class="w-5 h-5 rounded-full {COL_COLORS[c]} {newColColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-[var(--nx-surface)]' : 'opacity-70 hover:opacity-100'} transition-all"
								title={c}
							></button>
						{/each}
					</div>
					<div class="flex gap-2">
						<button
							onclick={addColumn}
							class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
						>{tFn('tasks.add')}</button>
						<button
							onclick={() => { addingColumn = false; newColName = '' }}
							class="px-3 py-1.5 rounded-lg bg-[var(--nx-surface-raised)] hover:bg-[var(--nx-border)] text-xs text-[var(--nx-text-muted)] transition-colors"
						>{tFn('tasks.cancel')}</button>
					</div>
				</div>
			{:else}
				<button
					onclick={() => addingColumn = true}
					class="w-full px-4 py-3 rounded-xl border border-dashed border-[var(--nx-border)] hover:border-indigo-700 text-sm text-[var(--nx-text-muted)] hover:text-[var(--nx-header-accent)] transition-colors"
				>
					{tFn('tasks.new_col')}
				</button>
			{/if}
		</div>
	{/if}
</div>

<!-- ── Modal édition carte ──────────────────────────────────────────────────── -->
{#if editingCard}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
		onclick={(e) => { if (e.target === e.currentTarget) editingCard = null }}
		onkeydown={(e) => { if (e.key === 'Escape') editingCard = null }}
		role="dialog"
		tabindex="-1"
	>
		<div class="w-full max-w-lg bg-[var(--nx-surface)] border border-[var(--nx-border)] rounded-2xl shadow-2xl p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-base font-semibold text-[var(--nx-text)]">{tFn('tasks.edit_card')}</h2>
				<button onclick={() => editingCard = null} class="text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] text-lg leading-none">×</button>
			</div>

			<!-- Titre -->
			<div>
				<label for="task-edit-title" class="block text-xs font-medium text-[var(--nx-text-muted)] mb-1.5">Titre</label>
				<input
					id="task-edit-title"
					bind:value={editingCard.title}
					maxlength="200"
					class="w-full rounded-lg bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
					       focus:outline-none focus:border-indigo-600"
				/>
			</div>

			<!-- Description -->
			<div>
				<span class="block text-xs font-medium text-[var(--nx-text-muted)] mb-1.5">Description</span>
				<!-- Éditeur riche (liens, images, mise en forme). Le HTML est assaini
				     CÔTÉ SERVEUR, à l'écriture et à la lecture.
				     ⚠ Ne PAS l'envelopper dans un conteneur à overflow : l'éditeur borne
				     déjà sa hauteur lui-même (son contenu scrolle en interne) et sa racine
				     est en overflow-visible EXPRÈS pour que les popups (lien, image...)
				     puissent dépasser. Un wrapper overflow-y-auto les rognait. -->
				<NodyxEditor
					compact
					initialContent={editingCard.description}
					placeholder={tFn('tasks.details_ph')}
					onchange={(html) => { if (editingCard) editingCard.description = html }}
				/>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<!-- Priorité -->
				<div>
					<label for="task-edit-priority" class="block text-xs font-medium text-[var(--nx-text-muted)] mb-1.5">{tFn('tasks.priority_label')}</label>
					<select
						id="task-edit-priority"
						bind:value={editingCard.priority}
						class="w-full rounded-lg bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
						       focus:outline-none focus:border-indigo-600"
					>
						{#each Object.entries(PRIORITY_META) as [val, meta]}
							<option value={val}>{tFn(meta.labelKey)}</option>
						{/each}
					</select>
				</div>

				<!-- Échéance -->
				<div>
					<label for="task-edit-due" class="block text-xs font-medium text-[var(--nx-text-muted)] mb-1.5">{tFn('tasks.due_label')}</label>
					<input
						id="task-edit-due"
						type="date"
						bind:value={editingCard.due_date}
						class="w-full rounded-lg bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
						       focus:outline-none focus:border-indigo-600"
					/>
				</div>
			</div>

			<!-- Assigné à -->
			<div>
				<label for="task-edit-assignee" class="block text-xs font-medium text-[var(--nx-text-muted)] mb-1.5">{tFn('tasks.assignee_label')}</label>
				<select
					id="task-edit-assignee"
					bind:value={editingCard.assignee_id}
					class="w-full rounded-lg bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
					       focus:outline-none focus:border-indigo-600"
				>
					<option value={null}>{tFn('tasks.none')}</option>
					{#each members as m}
						<option value={m.id}>{m.username}</option>
					{/each}
				</select>
			</div>

			<div class="flex gap-2 pt-1">
				<button
					onclick={saveCard}
					class="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
				>{tFn('tasks.save')}</button>
				<button
					onclick={() => editingCard = null}
					class="px-4 py-2 rounded-lg bg-[var(--nx-surface-raised)] hover:bg-[var(--nx-border)] text-sm text-[var(--nx-text-muted)] transition-colors"
				>{tFn('tasks.cancel')}</button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Contenu riche des cartes : venu de l'éditeur, assaini côté serveur. On borne
	   ce qui pourrait casser une tuile étroite, sans imposer tout un thème. */
	.task-card-desc :global(p)          { margin: 0 0 0.25rem 0; }
	.task-card-desc :global(a)          { color: var(--nx-header-accent); text-decoration: underline; }
	.task-card-desc :global(a:hover)    { color: var(--nx-header-accent-strong); }
	.task-card-desc :global(img)        { max-width: 100%; max-height: 6rem; border-radius: 0.375rem; margin: 0.25rem 0; }
	.task-card-desc :global(pre)        { overflow-x: auto; background: color-mix(in srgb, var(--nx-text) 7%, transparent); border-radius: 0.375rem; padding: 0.375rem 0.5rem; margin: 0.25rem 0; }
	.task-card-desc :global(code)       { font-size: 0.7rem; }
	.task-card-desc :global(ul),
	.task-card-desc :global(ol)         { margin: 0.25rem 0; padding-left: 1.1rem; }
	.task-card-desc :global(h1),
	.task-card-desc :global(h2),
	.task-card-desc :global(h3),
	.task-card-desc :global(h4)         { font-size: 0.8rem; font-weight: 600; color: var(--nx-text); margin: 0.25rem 0; }
	.task-card-desc :global(blockquote) { border-left: 2px solid var(--nx-border); padding-left: 0.5rem; margin: 0.25rem 0; }
	.task-card-desc :global(iframe)     { max-width: 100%; max-height: 8rem; }
</style>
