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
		pending_requests?: number
	}
	type AccessRequest = { user_id: string; username: string; avatar: string | null; created_at: string }

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

	// ── Demandes d'accès en édition (vue propriétaire) ──────────────────────
	let requestsFor = $state<string | null>(null)   // boardId du popover ouvert
	let requests    = $state<AccessRequest[]>([])
	let reqLoading  = $state(false)

	async function openRequests(b: Board) {
		requestsFor = b.id
		reqLoading = true
		try {
			const res = await fetch(`/api/v1/canvas/${b.id}/requests`, { headers: { Authorization: `Bearer ${data.token}` } })
			requests = res.ok ? (await res.json()).requests ?? [] : []
		} finally {
			reqLoading = false
		}
	}

	async function approve(boardId: string, userId: string) {
		await fetch(`/api/v1/canvas/${boardId}/requests/${userId}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${data.token}` } }).catch(() => {})
		requests = requests.filter(r => r.user_id !== userId)
		await invalidateAll()
		if (requests.length === 0) requestsFor = null
	}

	async function deny(boardId: string, userId: string) {
		await fetch(`/api/v1/canvas/${boardId}/requests/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${data.token}` } }).catch(() => {})
		requests = requests.filter(r => r.user_id !== userId)
		await invalidateAll()
		if (requests.length === 0) requestsFor = null
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
					{#if (b.pending_requests ?? 0) > 0}
						<button onclick={() => openRequests(b)} title="Demandes d'accès en édition"
							class="absolute top-2 left-2 z-10 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold text-amber-950 bg-amber-400 hover:bg-amber-300 shadow-lg animate-pulse">
							<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0012 22zm6.36-6V11c0-3.07-1.64-5.64-4.5-6.32V4a1.5 1.5 0 00-3 0v.68C7.99 5.36 6.36 7.92 6.36 11v5l-1.86 1.86V19h15v-1.14L18.36 16z"/></svg>
							{b.pending_requests}
						</button>
					{/if}
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

{#if requestsFor}
	<div class="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
	     onclick={(e) => { if (e.target === e.currentTarget) requestsFor = null }}
	     role="presentation">
		<div class="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a] p-6">
			<h2 class="text-lg font-bold text-white mb-1">Demandes d'accès en édition</h2>
			<p class="text-sm text-gray-500 mb-4">Accorde l'édition aux membres en qui tu as confiance.</p>
			{#if reqLoading}
				<p class="text-sm text-gray-500 py-6 text-center">Chargement…</p>
			{:else if requests.length === 0}
				<p class="text-sm text-gray-500 py-6 text-center">Aucune demande en attente.</p>
			{:else}
				<div class="space-y-2">
					{#each requests as r (r.user_id)}
						<div class="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] p-2.5">
							<div class="w-8 h-8 rounded-full bg-indigo-500/20 flex items-center justify-center text-sm shrink-0 overflow-hidden">
								{#if r.avatar}<img src={r.avatar} alt={r.username} class="w-full h-full object-cover" />{:else}{r.username?.[0]?.toUpperCase() ?? '?'}{/if}
							</div>
							<span class="flex-1 text-sm text-white truncate">{r.username}</span>
							<button onclick={() => requestsFor && approve(requestsFor, r.user_id)}
								class="px-2.5 py-1 rounded-md text-xs font-semibold text-emerald-950 bg-emerald-400 hover:bg-emerald-300">Accepter</button>
							<button onclick={() => requestsFor && deny(requestsFor, r.user_id)}
								class="px-2.5 py-1 rounded-md text-xs font-semibold text-gray-300 bg-white/5 hover:bg-white/10">Refuser</button>
						</div>
					{/each}
				</div>
			{/if}
			<div class="flex justify-end mt-5">
				<button onclick={() => requestsFor = null} class="px-4 py-2 rounded-lg text-sm text-gray-400 hover:text-white">Fermer</button>
			</div>
		</div>
	</div>
{/if}
