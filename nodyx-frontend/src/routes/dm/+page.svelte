<script lang="ts">
	import { onMount, untrack } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { dmUnreadStore } from '$lib/socket'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data } = $props()

	interface Participant {
		id: string
		username: string
		avatar: string | null
		name_color: string | null
	}

	interface Conversation {
		id: string
		is_group: boolean
		group_name: string | null
		participants: Participant[]
		other_id: string
		other_username: string
		other_avatar: string | null
		other_name_color: string | null
		last_message_content: string | null
		last_message_encrypted: boolean
		last_message_sender_id: string | null
		last_message_at: string | null
		unread_count: number
	}

	function convLabel(conv: Conversation): string {
		if (conv.is_group) {
			return conv.group_name ?? conv.participants.map(p => p.username).join(', ')
		}
		return conv.other_username
	}

	let conversations: Conversation[] = $state(untrack(() => data.conversations ?? []))
	let searchQuery = $state('')
	let searching = $state(false)
	let searchResults: { id: string; username: string; avatar: string | null }[] = $state([])
	let searchTimeout: ReturnType<typeof setTimeout> | null = null
	let currentUserId = $state('')

	onMount(async () => {
		const res = await apiFetch(fetch, '/users/me', {
			headers: { Authorization: `Bearer ${data.token}` }
		})
		if (res.ok) {
			const u = await res.json()
			currentUserId = u.user?.id ?? ''
		}
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
		} finally { searching = false }
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
		if (diff < 60_000) return tFn('dm.now')
		if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}min`
		if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
		return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
	}

	function truncate(s: string | null, n = 55): string {
		if (!s) return ''
		return s.length > n ? s.slice(0, n) + '…' : s
	}
</script>

<svelte:head>
	<title>{tFn('dm.title')}</title>
</svelte:head>

<div class="h-full flex">

	<!-- ── Sidebar gauche ─────────────────────────────────────────────────── -->
	<div class="w-72 shrink-0 flex flex-col border-r border-white/[0.06] bg-gray-950/60">

		<!-- Header -->
		<div class="px-4 pt-5 pb-3">
			<div class="flex items-center gap-2.5 mb-4">
				<div class="w-8 h-8 rounded-xl bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center shrink-0">
					<svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
					</svg>
				</div>
				<div class="flex-1 min-w-0">
					<h1 class="text-sm font-bold text-white">{tFn('dm.title')}</h1>
					<p class="text-[11px] text-gray-600">
						{conversations.length !== 1
							? tFn('dm.n_conversations_plural', { n: String(conversations.length) })
							: tFn('dm.n_conversations', { n: String(conversations.length) })}
					</p>
				</div>
			</div>

			<!-- Barre de recherche -->
			<div class="relative">
				<div class="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded-xl px-3 py-2 focus-within:border-indigo-500/40 focus-within:bg-indigo-500/5 transition-all">
					<svg class="w-3.5 h-3.5 text-gray-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
					</svg>
					<input
						type="text"
						bind:value={searchQuery}
						oninput={onSearchInput}
						placeholder={tFn('dm.search_placeholder')}
						class="flex-1 bg-transparent text-xs text-white placeholder-gray-600 outline-none"
					/>
					{#if searching}
						<div class="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
					{/if}
				</div>

				<!-- Résultats de recherche -->
				{#if searchResults.length > 0}
					<div class="absolute top-full mt-1.5 left-0 right-0 bg-gray-900 border border-white/[0.08] rounded-xl shadow-2xl z-20 overflow-hidden">
						{#each searchResults as u}
							<button
								onclick={() => openDM(u.id)}
								class="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.05] transition-colors text-left"
							>
								{#if u.avatar}
									<img src={u.avatar} alt={u.username} class="w-7 h-7 rounded-full object-cover shrink-0"/>
								{:else}
									<div class="w-7 h-7 rounded-full bg-indigo-600/25 flex items-center justify-center shrink-0 text-xs font-bold text-indigo-300">
										{u.username[0].toUpperCase()}
									</div>
								{/if}
								<span class="text-sm text-white font-medium flex-1 truncate">{u.username}</span>
								<svg class="w-3 h-3 text-indigo-400 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
								</svg>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- Liste des conversations -->
		<div class="flex-1 overflow-y-auto px-2 pb-4" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.04) transparent">
			{#if conversations.length === 0}
				<div class="flex flex-col items-center justify-center py-12 px-4 text-center">
					<div class="w-12 h-12 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
						<svg class="w-5 h-5 text-gray-700" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
						</svg>
					</div>
					<p class="text-xs text-gray-600 font-medium">{tFn('dm.no_conversations')}</p>
					<p class="text-[11px] text-gray-700 mt-1">{tFn('dm.no_conversations_hint')}</p>
				</div>
			{:else}
				<div class="space-y-0.5">
					{#each conversations as conv}
						<a
							href="/dm/{conv.id}"
							class="dm-row flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl transition-all relative group"
						>
							<!-- Avatar(s) avec badge non-lu -->
							<div class="relative shrink-0">
								{#if conv.is_group}
									<!-- Stack de 2 avatars pour les groupes -->
									<div class="w-9 h-9 relative">
										{#each conv.participants.slice(0, 2) as p, i}
											{#if p.avatar}
												<img src={p.avatar} alt={p.username}
													class="w-6 h-6 rounded-full object-cover absolute border-2 border-gray-950"
													style={i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}/>
											{:else}
												<div class="w-6 h-6 rounded-full bg-indigo-600/30 border-2 border-gray-950 flex items-center justify-center text-[10px] font-bold absolute"
													style={`${i === 0 ? 'top:0;left:0' : 'bottom:0;right:0'}; color: ${p.name_color ?? '#818cf8'}`}>
													{p.username[0].toUpperCase()}
												</div>
											{/if}
										{/each}
									</div>
								{:else if conv.other_avatar}
									<img src={conv.other_avatar} alt={conv.other_username} class="w-9 h-9 rounded-full object-cover"/>
								{:else}
									<div class="w-9 h-9 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center text-sm font-bold"
										style={conv.other_name_color ? `color: ${conv.other_name_color}` : 'color: #818cf8'}>
										{(conv.other_username ?? '?')[0].toUpperCase()}
									</div>
								{/if}
								{#if conv.unread_count > 0}
									<span class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold flex items-center justify-center px-1 shadow-lg shadow-indigo-500/30">
										{conv.unread_count > 9 ? '9+' : conv.unread_count}
									</span>
								{/if}
							</div>

							<!-- Texte -->
							<div class="flex-1 min-w-0">
								<div class="flex items-baseline justify-between gap-1">
									<span class="text-sm font-semibold truncate {conv.unread_count > 0 ? 'text-white' : 'text-gray-300'}"
										style={!conv.is_group && conv.other_name_color ? `color: ${conv.other_name_color}` : ''}>
										{convLabel(conv)}
									</span>
									{#if conv.last_message_at}
										<span class="text-[10px] text-gray-700 shrink-0">{formatTime(conv.last_message_at)}</span>
									{/if}
								</div>
								<p class="text-[11px] truncate mt-0.5 {conv.unread_count > 0 ? 'text-gray-400 font-medium' : 'text-gray-600'}">
									{#if conv.last_message_content}
										{#if conv.last_message_encrypted}
											<span class="opacity-60">🔒 Message chiffré</span>
										{:else}
											{conv.last_message_sender_id === currentUserId ? tFn('dm.you_prefix') : ''}{truncate(conv.last_message_content)}
										{/if}
									{:else}
										<span class="italic">{tFn('dm.no_message')}</span>
									{/if}
								</p>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<!-- ── Zone vide / Sélection ───────────────────────────────────────────── -->
	<div class="flex-1 flex flex-col items-center justify-center bg-gray-950/20">
		<div class="flex flex-col items-center gap-4 text-center px-8 max-w-sm">
			<!-- Illustration -->
			<div class="relative">
				<div class="w-20 h-20 rounded-3xl bg-indigo-600/10 border border-indigo-500/15 flex items-center justify-center">
					<svg class="w-9 h-9 text-indigo-500/60" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
					</svg>
				</div>
				<!-- Orbite déco -->
				<div class="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center">
					<div class="w-2 h-2 rounded-full bg-indigo-400/60"></div>
				</div>
			</div>

			<div>
				<h2 class="text-base font-bold text-white mb-1">{tFn('dm.select_conversation')}</h2>
				<p class="text-sm text-gray-600 leading-relaxed">{tFn('dm.select_conversation_hint')}</p>
			</div>

			<!-- Raccourci : taper dans la recherche -->
			<div class="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/[0.03] border border-white/[0.06] text-xs text-gray-600">
				<svg class="w-3.5 h-3.5 shrink-0 text-gray-700" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
				</svg>
				{tFn('dm.search_new_hint')}
			</div>
		</div>
	</div>
</div>

<style>
.dm-row {
	background: transparent;
}
.dm-row:hover {
	background: rgba(255,255,255,0.04);
}
</style>
