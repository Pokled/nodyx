<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	let showCreate = $state(false)
	let creating   = $state(false)
	let deleting   = $state<string | null>(null)

	function fDate(iso: string) {
		return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
	}
</script>

<svelte:head><title>{tFn('tasks.page_title')}</title></svelte:head>

<div class="space-y-6">

	<!-- Header -->
	<div class="flex items-center justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-2xl font-bold text-[var(--nx-text)]">{tFn('tasks.title')}</h1>
			<p class="text-sm text-[var(--nx-text-muted)] mt-0.5">{data.boards.length} {tFn(data.boards.length > 1 ? 'tasks.boards_plural' : 'tasks.boards_one')}</p>
		</div>
		<button
			onclick={() => showCreate = !showCreate}
			class="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
		>
			<span class="text-base leading-none">+</span>
			{tFn('tasks.new_board')}
		</button>
	</div>

	<!-- Formulaire de création -->
	{#if showCreate}
		<div class="rounded-xl border border-indigo-800/50 bg-[rgb(var(--nx-accent-rgb)/0.1)] p-5">
			<h2 class="text-sm font-semibold text-[var(--nx-header-accent)] mb-4">{tFn('tasks.new_board')}</h2>
			<form
				method="POST"
				action="?/create"
				use:enhance={() => {
					creating = true
					return async ({ update }) => { creating = false; await update() }
				}}
				class="space-y-3"
			>
				{#if form?.error}
					<p class="text-sm text-[var(--nx-bad)]">{form.error}</p>
				{/if}
				<div class="flex gap-3 flex-wrap">
					<input
						name="name"
						type="text"
						placeholder={tFn('tasks.name_placeholder')}
						required
						maxlength="100"
						class="flex-1 min-w-48 rounded-lg bg-[var(--nx-surface)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
						       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-600"
					/>
					<input
						name="description"
						type="text"
						placeholder={tFn('tasks.desc_placeholder')}
						maxlength="1000"
						class="flex-1 min-w-64 rounded-lg bg-[var(--nx-surface)] border border-[var(--nx-border)] px-3 py-2 text-sm text-[var(--nx-text)]
						       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-600"
					/>
				</div>
				<div class="flex gap-2">
					<button
						type="submit"
						disabled={creating}
						class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-medium transition-colors"
					>
						{creating ? tFn('tasks.creating') : tFn('common.create')}
					</button>
					<button
						type="button"
						onclick={() => showCreate = false}
						class="px-4 py-2 rounded-lg bg-[var(--nx-surface-raised)] hover:bg-[var(--nx-border)] text-sm text-[var(--nx-text-muted)] transition-colors"
					>
						{tFn('common.cancel')}
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Grille des tableaux -->
	{#if data.boards.length === 0}
		<div class="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)]/30 px-6 py-16 text-center">
			<div class="text-4xl mb-3">📋</div>
			<p class="text-[var(--nx-text-muted)] font-medium">{tFn('tasks.empty')}</p>
			<p class="text-sm text-[var(--nx-text-muted)] mt-1">{tFn('tasks.empty_sub')}</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each data.boards as board}
				<div class="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)]/40 hover:bg-[var(--nx-surface)]/60 transition-colors flex flex-col">
					<a href="/tasks/{board.id}" class="flex-1 p-5 block">
						<div class="flex items-start gap-3">
							<span class="text-2xl leading-none mt-0.5">📋</span>
							<div class="min-w-0">
								<h3 class="font-semibold text-[var(--nx-text)] truncate">{board.name}</h3>
								{#if board.description}
									<p class="text-sm text-[var(--nx-text-muted)] mt-0.5 line-clamp-2">{board.description}</p>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-4 mt-4 text-xs text-[var(--nx-text-muted)]">
							<span>{board.column_count} {tFn(board.column_count > 1 ? 'tasks.columns_plural' : 'tasks.columns_one')}</span>
							<span>·</span>
							<span>{board.card_count} {tFn(board.card_count > 1 ? 'tasks.cards_plural' : 'tasks.cards_one')}</span>
							<span>·</span>
							<span>{board.created_by_username}</span>
						</div>
					</a>
					<div class="border-t border-[var(--nx-border)] px-5 py-2.5 flex items-center justify-between">
						<span class="text-xs text-[var(--nx-text-muted)]">{fDate(board.created_at)}</span>
						<form
							method="POST"
							action="?/delete"
							use:enhance={() => {
								deleting = board.id
								return async ({ update }) => { deleting = null; await update() }
							}}
						>
							<input type="hidden" name="id" value={board.id} />
							<button
								type="submit"
								disabled={deleting === board.id}
								onclick={(e) => { if (!confirm(tFn('tasks.confirm_delete'))) e.preventDefault() }}
								class="text-xs text-[var(--nx-text-muted)] hover:text-[var(--nx-bad)] transition-colors disabled:opacity-50"
							>
								{tFn('common.delete')}
							</button>
						</form>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
