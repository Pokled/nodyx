<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	type Board = {
		id: string
		name: string
		visibility: 'private' | 'public'
		element_count: number
		updated_at: string
	}

	let boards = $derived((data.boards ?? []) as Board[])
	let publicBoards = $derived((data.publicBoards ?? []) as (Board & { creator_username: string | null })[])

	let showCreate = $state(false)
	let newName    = $state('')
	let newVis     = $state<'private' | 'public'>('private')
	let creating   = $state(false)
	let busyId     = $state<string | null>(null)

	const auth = { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' }

	function fmtDate(s: string): string {
		try { return new Date(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) }
		catch { return '' }
	}

	async function createProject() {
		if (creating) return
		creating = true
		try {
			const res = await fetch('/api/v1/canvas', {
				method: 'POST',
				headers: auth,
				body: JSON.stringify({ name: newName.trim() || 'Sans titre', visibility: newVis })
			})
			if (res.ok) {
				const { board } = await res.json()
				goto(`/canvas/${board.id}`)
			}
		} finally {
			creating = false
		}
	}

	async function renameProject(b: Board) {
		const name = prompt('Renommer le projet :', b.name)
		if (name === null || name.trim() === b.name) return
		busyId = b.id
		try {
			const res = await fetch(`/api/v1/canvas/${b.id}`, {
				method: 'PATCH',
				headers: auth,
				body: JSON.stringify({ name: name.trim() || 'Sans titre' })
			})
			if (res.ok) await invalidateAll()
		} finally {
			busyId = null
		}
	}

	async function deleteProject(b: Board) {
		if (!confirm(`Supprimer définitivement "${b.name}" ?`)) return
		busyId = b.id
		try {
			// Pas de Content-Type sur un DELETE sans body (sinon Fastify renvoie 400 EMPTY_JSON_BODY)
			const res = await fetch(`/api/v1/canvas/${b.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${data.token}` } })
			if (res.ok) await invalidateAll()
		} finally {
			busyId = null
		}
	}
</script>

<svelte:head><title>Canvas : mes projets</title></svelte:head>

<div class="max-w-5xl mx-auto px-4 py-8">
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white flex items-center gap-2">
				<span class="text-cyan-400">🎨</span> Mes projets Canvas
			</h1>
			<p class="text-sm text-gray-500 mt-1">Tableaux blancs collaboratifs. Enregistrés automatiquement.</p>
		</div>
		<button
			onclick={() => { newName = ''; newVis = 'private'; showCreate = true }}
			class="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white
			       bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 transition-all">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
			Nouveau projet
		</button>
	</div>

	{#if boards.length === 0}
		<div class="rounded-2xl border border-white/10 bg-white/[0.02] py-16 text-center">
			<div class="text-5xl mb-3">🎨</div>
			<p class="text-gray-300 font-medium">Aucun projet pour l'instant.</p>
			<p class="text-gray-500 text-sm mt-1">Crée ton premier tableau blanc, il sera sauvegardé automatiquement.</p>
		</div>
	{:else}
		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each boards as b (b.id)}
				<div class="group relative rounded-xl border border-white/10 bg-white/[0.02] hover:border-cyan-500/40 transition-all overflow-hidden">
					<button
						onclick={() => goto(`/canvas/${b.id}`)}
						class="block w-full text-left">
						<div class="h-28 bg-gradient-to-br from-indigo-500/10 via-cyan-500/10 to-transparent flex items-center justify-center">
							<span class="text-3xl opacity-40">🎨</span>
						</div>
						<div class="p-4">
							<div class="flex items-center gap-2">
								<h3 class="flex-1 font-semibold text-white truncate">{b.name}</h3>
								<span class="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded
								             {b.visibility === 'public' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-gray-500/15 text-gray-400'}">
									{b.visibility === 'public' ? 'Public' : 'Privé'}
								</span>
							</div>
							<p class="text-xs text-gray-500 mt-1">{b.element_count} élément{b.element_count > 1 ? 's' : ''} · {fmtDate(b.updated_at)}</p>
						</div>
					</button>
					<div class="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
						<button onclick={() => renameProject(b)} disabled={busyId === b.id} title="Renommer"
							class="p-1.5 rounded-md bg-black/40 text-gray-300 hover:text-white hover:bg-black/60">
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
						</button>
						<button onclick={() => deleteProject(b)} disabled={busyId === b.id} title="Supprimer"
							class="p-1.5 rounded-md bg-black/40 text-gray-300 hover:text-red-400 hover:bg-black/60">
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if publicBoards.length > 0}
		<div class="mt-10">
			<h2 class="text-lg font-bold text-white mb-1">Projets publics de la communauté</h2>
			<p class="text-sm text-gray-500 mb-4">Ouvre-les en lecture seule. La demande d'accès en édition arrive bientôt.</p>
			<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each publicBoards as b (b.id)}
					<button onclick={() => goto(`/canvas/${b.id}`)}
						class="group text-left rounded-xl border border-white/10 bg-white/[0.02] hover:border-cyan-500/40 transition-all overflow-hidden">
						<div class="h-28 bg-gradient-to-br from-emerald-500/10 via-cyan-500/10 to-transparent flex items-center justify-center">
							<span class="text-3xl opacity-40">🎨</span>
						</div>
						<div class="p-4">
							<div class="flex items-center gap-2">
								<h3 class="flex-1 font-semibold text-white truncate">{b.name}</h3>
								<span class="shrink-0 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">Public</span>
							</div>
							<p class="text-xs text-gray-500 mt-1">par {b.creator_username ?? '?'} · {b.element_count} élément{b.element_count > 1 ? 's' : ''} · lecture seule</p>
						</div>
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>

{#if showCreate}
	<div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
	     onclick={(e) => { if (e.target === e.currentTarget) showCreate = false }}
	     role="presentation">
		<div class="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a] p-6">
			<h2 class="text-lg font-bold text-white mb-4">Nouveau projet Canvas</h2>
			<label class="block text-xs font-semibold text-gray-400 mb-1" for="cv-name">Nom du projet</label>
			<input id="cv-name" bind:value={newName} placeholder="Sans titre" maxlength="100"
				class="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-white text-sm mb-4 focus:border-cyan-500/50 outline-none" />

			<p class="text-xs font-semibold text-gray-400 mb-2">Visibilité</p>
			<div class="grid grid-cols-2 gap-2 mb-6">
				<button type="button" onclick={() => newVis = 'private'}
					class="rounded-lg border px-3 py-2.5 text-left transition-all {newVis === 'private' ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-white/10 bg-white/[0.02]'}">
					<div class="text-sm font-semibold text-white">🔒 Privé</div>
					<div class="text-[11px] text-gray-500 mt-0.5">Toi seul, pour l'instant</div>
				</button>
				<button type="button" onclick={() => newVis = 'public'}
					class="rounded-lg border px-3 py-2.5 text-left transition-all {newVis === 'public' ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-white/10 bg-white/[0.02]'}">
					<div class="text-sm font-semibold text-white">🌐 Public</div>
					<div class="text-[11px] text-gray-500 mt-0.5">Visible par la communauté</div>
				</button>
			</div>

			<div class="flex justify-end gap-2">
				<button onclick={() => showCreate = false} class="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Annuler</button>
				<button onclick={createProject} disabled={creating}
					class="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 disabled:opacity-50">
					{creating ? 'Création…' : 'Créer et ouvrir'}
				</button>
			</div>
		</div>
	</div>
{/if}
