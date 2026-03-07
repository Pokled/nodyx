<script lang="ts">
	import { onMount } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { page } from '$app/stores'
	import { dmUnreadStore } from '$lib/socket'

	let { data } = $props()

	interface Conversation {
		id: string
		other_id: string
		other_username: string
		other_avatar: string | null
		other_name_color: string | null
		last_message_content: string | null
		last_message_sender_id: string | null
		last_message_at: string | null
		unread_count: number
	}

	let conversations: Conversation[] = $state(data.conversations ?? [])
	let searchQuery = $state('')
	let searching = $state(false)
	let searchResults: { id: string; username: string; avatar: string | null }[] = $state([])
	let searchTimeout: ReturnType<typeof setTimeout> | null = null
	let currentUserId = $state('')

	onMount(async () => {
		// Récupérer l'id de l'utilisateur connecté
		const res = await apiFetch(fetch, '/users/me', {
			headers: { Authorization: `Bearer ${data.token}` }
		})
		if (res.ok) {
			const u = await res.json()
			currentUserId = u.user?.id ?? ''
		}
		// Reset DM badge
		dmUnreadStore.set(0)
	})

	async function searchUsers(q: string) {
		if (q.trim().length < 2) { searchResults = []; return }
		searching = true
		try {
			const res = await apiFetch(fetch, `/users/search?q=${encodeURIComponent(q)}`, {
				headers: { Authorization: `Bearer ${data.token}` }
			})
			if (res.ok) {
				const j = await res.json()
				searchResults = j.users ?? []
			}
		} finally {
			searching = false
		}
	}

	function onSearchInput() {
		if (searchTimeout) clearTimeout(searchTimeout)
		searchTimeout = setTimeout(() => searchUsers(searchQuery), 300)
	}

	async function openDM(userId: string) {
		const res = await apiFetch(fetch, '/dm/conversations', {
			method: 'POST',
			headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ userId })
		})
		if (res.ok) {
			const { conversationId } = await res.json()
			window.location.href = `/dm/${conversationId}`
		}
	}

	function formatTime(iso: string | null): string {
		if (!iso) return ''
		const d = new Date(iso)
		const now = new Date()
		const diff = now.getTime() - d.getTime()
		if (diff < 60_000) return 'maintenant'
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`
		if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
		return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
	}

	function truncate(s: string | null, n = 50): string {
		if (!s) return ''
		return s.length > n ? s.slice(0, n) + '…' : s
	}
</script>

<svelte:head>
	<title>Messages privés</title>
</svelte:head>

<div class="max-w-2xl mx-auto px-4 py-6">
	<!-- Header -->
	<div class="flex items-center gap-3 mb-6">
		<div class="w-9 h-9 rounded-xl bg-indigo-600/20 flex items-center justify-center shrink-0">
			<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
			</svg>
		</div>
		<div>
			<h1 class="text-lg font-bold text-white">Messages privés</h1>
			<p class="text-xs text-gray-500">{conversations.length} conversation{conversations.length !== 1 ? 's' : ''}</p>
		</div>
	</div>

	<!-- Recherche / Nouveau DM -->
	<div class="relative mb-6">
		<div class="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-xl px-3 py-2.5">
			<svg class="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
			</svg>
			<input
				type="text"
				bind:value={searchQuery}
				oninput={onSearchInput}
				placeholder="Nouveau message — chercher un utilisateur…"
				class="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none"
			/>
			{#if searching}
				<div class="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
			{/if}
		</div>

		<!-- Résultats de recherche -->
		{#if searchResults.length > 0}
			<div class="absolute top-full mt-1 left-0 right-0 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-10 overflow-hidden">
				{#each searchResults as u}
					<button
						onclick={() => openDM(u.id)}
						class="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-700/60 transition-colors text-left"
					>
						{#if u.avatar}
							<img src={u.avatar} alt={u.username} class="w-8 h-8 rounded-full object-cover shrink-0"/>
						{:else}
							<div class="w-8 h-8 rounded-full bg-indigo-600/30 flex items-center justify-center shrink-0 text-sm font-bold text-indigo-300">
								{u.username[0].toUpperCase()}
							</div>
						{/if}
						<span class="text-sm text-white font-medium">{u.username}</span>
						<span class="ml-auto text-xs text-indigo-400">Envoyer un message →</span>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Liste des conversations -->
	{#if conversations.length === 0}
		<div class="text-center py-16 text-gray-600">
			<svg class="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
			</svg>
			<p class="text-sm">Aucune conversation</p>
			<p class="text-xs mt-1">Cherche un utilisateur ci-dessus pour commencer</p>
		</div>
	{:else}
		<div class="space-y-1">
			{#each conversations as conv}
				<a
					href="/dm/{conv.id}"
					class="flex items-center gap-3 p-3 rounded-xl hover:bg-gray-800/60 transition-colors group relative"
				>
					<!-- Avatar -->
					{#if conv.other_avatar}
						<img src={conv.other_avatar} alt={conv.other_username} class="w-11 h-11 rounded-full object-cover shrink-0"/>
					{:else}
						<div class="w-11 h-11 rounded-full bg-indigo-600/25 flex items-center justify-center shrink-0 text-base font-bold"
							style={conv.other_name_color ? `color: ${conv.other_name_color}` : 'color: #818cf8'}>
							{conv.other_username[0].toUpperCase()}
						</div>
					{/if}

					<!-- Contenu -->
					<div class="flex-1 min-w-0">
						<div class="flex items-center justify-between gap-2">
							<span class="text-sm font-semibold truncate"
								style={conv.other_name_color ? `color: ${conv.other_name_color}` : 'color: white'}>
								{conv.other_username}
							</span>
							{#if conv.last_message_at}
								<span class="text-[11px] text-gray-600 shrink-0">{formatTime(conv.last_message_at)}</span>
							{/if}
						</div>
						<p class="text-xs text-gray-500 truncate mt-0.5">
							{#if conv.last_message_content}
								{conv.last_message_sender_id === currentUserId ? 'Vous : ' : ''}{truncate(conv.last_message_content)}
							{:else}
								<span class="italic">Aucun message</span>
							{/if}
						</p>
					</div>

					<!-- Badge non-lu -->
					{#if conv.unread_count > 0}
						<span class="shrink-0 min-w-[20px] h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center px-1">
							{conv.unread_count > 9 ? '9+' : conv.unread_count}
						</span>
					{/if}
				</a>
			{/each}
		</div>
	{/if}
</div>
