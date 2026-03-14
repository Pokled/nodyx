<script lang="ts">
	import { page } from '$app/stores'
	import { goto } from '$app/navigation'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	// ── État local ────────────────────────────────────────────────────────────
	let board   = $state(structuredClone(data.board))
	let members = $state(data.members)

	const token     = $derived($page.data.token as string)
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
	const PRIORITY_META: Record<string, { label: string; cls: string }> = {
		low:    { label: 'Basse',   cls: 'text-gray-500 bg-gray-800 border-gray-700' },
		normal: { label: 'Normale', cls: 'text-gray-400 bg-gray-800 border-gray-700' },
		high:   { label: 'Haute',   cls: 'text-amber-400 bg-amber-900/30 border-amber-800/50' },
		urgent: { label: 'Urgente', cls: 'text-red-400 bg-red-900/30 border-red-800/50' },
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

	function fDue(iso: string | null) {
		if (!iso) return null
		const d = new Date(iso)
		const today = new Date(); today.setHours(0,0,0,0)
		const diff  = Math.ceil((d.getTime() - today.getTime()) / 86400000)
		if (diff < 0)   return { label: 'En retard', cls: 'text-red-400 bg-red-900/30 border-red-800/50' }
		if (diff === 0) return { label: "Aujourd'hui", cls: 'text-amber-400 bg-amber-900/30 border-amber-800/50' }
		if (diff === 1) return { label: 'Demain', cls: 'text-yellow-400 bg-yellow-900/30 border-yellow-800/50' }
		return {
			label: d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
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
		if (!confirm('Supprimer cette carte ?')) return
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
		if (!confirm(`Supprimer la colonne "${col?.name}" et toutes ses cartes ?`)) return
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
		if (!confirm(`Supprimer le tableau "${board.name}" et toutes ses colonnes ?`)) return
		await api(`/boards/${board.id}`, 'DELETE')
		goto('/tasks')
	}
</script>

<svelte:head><title>{board.name} — Tâches — Nexus</title></svelte:head>

<!-- ── Header ──────────────────────────────────────────────────────────────── -->
<div class="flex items-center gap-3 mb-6 flex-wrap">
	<a href="/tasks" class="text-gray-500 hover:text-gray-300 text-sm transition-colors">← Tableaux</a>
	<span class="text-gray-700">/</span>

	{#if editingBoardName}
		<form onsubmit={(e) => { e.preventDefault(); saveBoardName() }} class="flex items-center gap-2">
			<input
				bind:value={boardNameDraft}
				class="rounded-lg bg-gray-900 border border-indigo-700 px-3 py-1.5 text-sm text-white focus:outline-none"
				autofocus
				onblur={saveBoardName}
			/>
		</form>
	{:else}
		<h1
			class="text-lg font-bold text-white {data.canManage ? 'cursor-pointer hover:text-indigo-300 transition-colors' : ''}"
			ondblclick={() => data.canManage && (editingBoardName = true)}
			title={data.canManage ? 'Double-cliquer pour renommer' : ''}
		>
			{board.name}
		</h1>
	{/if}

	{#if board.description}
		<span class="text-sm text-gray-500 hidden sm:inline">— {board.description}</span>
	{/if}

	{#if data.canManage}
		<button
			onclick={deleteBoard}
			class="ml-auto text-xs text-gray-600 hover:text-red-400 transition-colors"
		>
			Supprimer le tableau
		</button>
	{/if}
</div>

<!-- ── Kanban ───────────────────────────────────────────────────────────────── -->
<div class="flex gap-4 overflow-x-auto pb-6 items-start">

	{#each board.columns as col (col.id)}
		<!-- Colonne -->
		<div
			class="flex-shrink-0 w-72 flex flex-col rounded-xl border transition-colors
			       {dragOverColId === col.id ? 'border-indigo-600 bg-indigo-950/20' : 'border-gray-800 bg-gray-900/40'}"
			ondragover={(e) => onDragOver(e, col.id)}
			ondragleave={onDragLeave}
			ondrop={(e) => onDrop(e, col.id)}
			role="list"
		>
			<!-- Header colonne -->
			<div class="flex items-center gap-2 px-3 py-3 border-b border-gray-800">
				<span class="w-2.5 h-2.5 rounded-full flex-shrink-0 {COL_COLORS[col.color] ?? 'bg-gray-500'}"></span>
				<span class="flex-1 text-sm font-semibold text-gray-200 truncate">{col.name}</span>
				<span class="text-xs text-gray-600 tabular-nums">{col.cards.length}</span>
				{#if data.canManage}
					<button
						onclick={() => deleteColumn(col.id)}
						class="text-gray-700 hover:text-red-400 text-sm leading-none transition-colors ml-1"
						title="Supprimer la colonne"
					>×</button>
				{/if}
			</div>

			<!-- Cartes -->
			<div class="flex flex-col gap-2 p-2 min-h-[4rem]">
				{#each col.cards as card (card.id)}
					{@const due     = fDue(card.due_date)}
					{@const priMeta = PRIORITY_META[card.priority] ?? PRIORITY_META.normal}
					<div
						draggable="true"
						ondragstart={(e) => onDragStart(e, card.id)}
						class="rounded-lg border bg-gray-900 hover:bg-gray-800 border-gray-700/60 hover:border-gray-600
						       p-3 cursor-grab active:cursor-grabbing transition-colors group"
						role="listitem"
					>
						<!-- Titre + actions -->
						<div class="flex items-start gap-2">
							<p class="flex-1 text-sm text-gray-200 leading-snug">{card.title}</p>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
								<button
									onclick={() => editingCard = structuredClone(card)}
									class="text-gray-600 hover:text-indigo-400 text-xs leading-none"
									title="Modifier"
								>✎</button>
								<button
									onclick={() => deleteCard(card.id, col.id)}
									class="text-gray-600 hover:text-red-400 text-xs leading-none ml-0.5"
									title="Supprimer"
								>×</button>
							</div>
						</div>

						<!-- Badges -->
						<div class="flex flex-wrap gap-1.5 mt-2">
							{#if card.priority !== 'normal'}
								<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border {priMeta.cls}">
									{priMeta.label}
								</span>
							{/if}
							{#if due}
								<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border {due.cls}">
									📅 {due.label}
								</span>
							{/if}
							{#if card.assignee_username}
								<span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-gray-400 bg-gray-800 border border-gray-700">
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
			<div class="p-2 border-t border-gray-800">
				{#if addingCardColId === col.id}
					<form onsubmit={(e) => { e.preventDefault(); addCard(col.id) }} class="space-y-2">
						<input
							bind:value={newCardTitle}
							placeholder="Titre de la carte..."
							maxlength="200"
							autofocus
							class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200
							       placeholder-gray-600 focus:outline-none focus:border-indigo-600"
						/>
						<div class="flex gap-2">
							<button
								type="submit"
								class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
							>Ajouter</button>
							<button
								type="button"
								onclick={() => { addingCardColId = null; newCardTitle = '' }}
								class="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 transition-colors"
							>Annuler</button>
						</div>
					</form>
				{:else}
					<button
						onclick={() => { addingCardColId = col.id; newCardTitle = '' }}
						class="w-full text-left px-2 py-1.5 text-xs text-gray-600 hover:text-gray-300 hover:bg-gray-800 rounded-lg transition-colors"
					>
						+ Ajouter une carte
					</button>
				{/if}
			</div>
		</div>
	{/each}

	<!-- Ajouter une colonne -->
	{#if data.canManage}
		<div class="flex-shrink-0 w-64">
			{#if addingColumn}
				<div class="rounded-xl border border-indigo-800/50 bg-indigo-950/20 p-3 space-y-3">
					<input
						bind:value={newColName}
						placeholder="Nom de la colonne"
						maxlength="100"
						autofocus
						class="w-full rounded-lg bg-gray-900 border border-gray-700 px-3 py-2 text-sm text-gray-200
						       placeholder-gray-600 focus:outline-none focus:border-indigo-600"
					/>
					<div class="flex flex-wrap gap-1.5">
						{#each COLOR_OPTS as c}
							<button
								onclick={() => newColColor = c}
								class="w-5 h-5 rounded-full {COL_COLORS[c]} {newColColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900' : 'opacity-70 hover:opacity-100'} transition-all"
								title={c}
							></button>
						{/each}
					</div>
					<div class="flex gap-2">
						<button
							onclick={addColumn}
							class="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
						>Ajouter</button>
						<button
							onclick={() => { addingColumn = false; newColName = '' }}
							class="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 transition-colors"
						>Annuler</button>
					</div>
				</div>
			{:else}
				<button
					onclick={() => addingColumn = true}
					class="w-full px-4 py-3 rounded-xl border border-dashed border-gray-700 hover:border-indigo-700 text-sm text-gray-600 hover:text-indigo-400 transition-colors"
				>
					+ Nouvelle colonne
				</button>
			{/if}
		</div>
	{/if}
</div>

<!-- ── Modal édition carte ──────────────────────────────────────────────────── -->
{#if editingCard}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
		onclick={(e) => { if (e.target === e.currentTarget) editingCard = null }}
		role="dialog"
	>
		<div class="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-4">
			<div class="flex items-center justify-between">
				<h2 class="text-base font-semibold text-white">Modifier la carte</h2>
				<button onclick={() => editingCard = null} class="text-gray-600 hover:text-gray-300 text-lg leading-none">×</button>
			</div>

			<!-- Titre -->
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1.5">Titre</label>
				<input
					bind:value={editingCard.title}
					maxlength="200"
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200
					       focus:outline-none focus:border-indigo-600"
				/>
			</div>

			<!-- Description -->
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1.5">Description</label>
				<textarea
					bind:value={editingCard.description}
					rows="3"
					maxlength="10000"
					placeholder="Détails, liens, notes..."
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200
					       placeholder-gray-600 focus:outline-none focus:border-indigo-600 resize-none"
				></textarea>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<!-- Priorité -->
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1.5">Priorité</label>
					<select
						bind:value={editingCard.priority}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200
						       focus:outline-none focus:border-indigo-600"
					>
						{#each Object.entries(PRIORITY_META) as [val, meta]}
							<option value={val}>{meta.label}</option>
						{/each}
					</select>
				</div>

				<!-- Échéance -->
				<div>
					<label class="block text-xs font-medium text-gray-500 mb-1.5">Échéance</label>
					<input
						type="date"
						bind:value={editingCard.due_date}
						class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200
						       focus:outline-none focus:border-indigo-600"
					/>
				</div>
			</div>

			<!-- Assigné à -->
			<div>
				<label class="block text-xs font-medium text-gray-500 mb-1.5">Assigné à</label>
				<select
					bind:value={editingCard.assignee_id}
					class="w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-2 text-sm text-gray-200
					       focus:outline-none focus:border-indigo-600"
				>
					<option value={null}>— Personne</option>
					{#each members as m}
						<option value={m.id}>{m.username}</option>
					{/each}
				</select>
			</div>

			<div class="flex gap-2 pt-1">
				<button
					onclick={saveCard}
					class="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
				>Enregistrer</button>
				<button
					onclick={() => editingCard = null}
					class="px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-sm text-gray-400 transition-colors"
				>Annuler</button>
			</div>
		</div>
	</div>
{/if}
