<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte'
	import { page } from '$app/stores'
	import { getSocket, dmUnreadStore } from '$lib/socket'
	import { apiFetch } from '$lib/api'

	let { data } = $props()

	interface DmMessage {
		id: string
		conversation_id: string
		sender_id: string
		sender_username: string
		sender_avatar: string | null
		sender_name_color: string | null
		content: string
		created_at: string
		deleted_at: string | null
	}

	interface Conversation {
		id: string
		other_id: string
		other_username: string
		other_avatar: string | null
		other_name_color: string | null
	}

	let messages: DmMessage[] = $state(data.messages ?? [])
	let conversations: Conversation[] = $state(data.conversations ?? [])
	let conversation: Conversation | null = $state(data.conversation ?? null)
	let conversationId = $state(data.conversationId)

	// Quand on switch d'interlocuteur, SvelteKit réutilise le composant sans le détruire.
	// On réinitialise l'état local dès que data change (nouveau [id] dans l'URL).
	$effect(() => {
		if (data.conversationId === conversationId) return
		conversationId = data.conversationId
		conversation = data.conversation ?? null
		messages = data.messages ?? []
		hasMore = (data.messages ?? []).length >= 50
		messageInput = ''
		typingLabel = ''
		typingUsers.clear()
		markRead()
		dmUnreadStore.set(0)
		tick().then(() => scrollToBottom())
	})

	let messageInput = $state('')
	let messagesEl: HTMLDivElement | null = $state(null)
	let typingUsers: Map<string, { timeout: ReturnType<typeof setTimeout>; username: string }> = new Map()
	let typingLabel = $state('')
	let typingTimeout: ReturnType<typeof setTimeout> | null = null
	let loadingMore = $state(false)
	let hasMore = $state(messages.length >= 50)
	let currentUserId = $state('')
	let sendingMsg = $state(false)

	// Obtenir l'id de l'user courant
	onMount(async () => {
		const res = await apiFetch(fetch, '/users/me', {
			headers: { Authorization: `Bearer ${data.token}` }
		})
		if (res.ok) {
			const u = await res.json()
			currentUserId = u.user?.id ?? ''
		}

		// Marquer comme lu
		markRead()
		dmUnreadStore.set(0)

		// Scroll en bas
		await tick()
		scrollToBottom()

		// Écoute socket DM
		const sock = getSocket()
		if (sock) {
			sock.on('dm:message', onDmMessage)
			sock.on('dm:typing', onDmTyping)
			sock.on('dm:read_ack', () => {})
		}
	})

	onDestroy(() => {
		const sock = getSocket()
		if (sock) {
			sock.off('dm:message', onDmMessage)
			sock.off('dm:typing', onDmTyping)
		}
	})

	function onDmMessage(msg: DmMessage) {
		if (msg.conversation_id !== conversationId) return
		messages = [...messages, msg]
		tick().then(scrollToBottom)
		// Marquer comme lu si la fenêtre est active
		if (document.hasFocus()) markRead()
	}

	function onDmTyping({ conversationId: cid, userId, username }: { conversationId: string; userId: string; username: string }) {
		if (cid !== conversationId) return
		if (typingUsers.has(userId)) clearTimeout(typingUsers.get(userId)!.timeout)
		typingUsers.set(userId, {
			username,
			timeout: setTimeout(() => {
				typingUsers.delete(userId)
				updateTypingLabel()
			}, 3000)
		})
		updateTypingLabel()
	}

	function updateTypingLabel() {
		const names = [...typingUsers.values()].map(v => v.username)
		if (names.length === 0) typingLabel = ''
		else if (names.length === 1) typingLabel = `${names[0]} écrit…`
		else typingLabel = `${names.join(', ')} écrivent…`
	}

	function markRead() {
		const sock = getSocket()
		if (sock) sock.emit('dm:read', conversationId)
		apiFetch(fetch, `/dm/conversations/${conversationId}/read`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${data.token}` }
		}).catch(() => {})
	}

	function scrollToBottom() {
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight
	}

	async function loadMore() {
		if (loadingMore || !hasMore || messages.length === 0) return
		loadingMore = true
		const oldest = messages[0].created_at
		try {
			const res = await apiFetch(fetch, `/dm/conversations/${conversationId}/messages?limit=50&before=${encodeURIComponent(oldest)}`, {
				headers: { Authorization: `Bearer ${data.token}` }
			})
			if (res.ok) {
				const { messages: older } = await res.json()
				if (older.length === 0) { hasMore = false; return }
				const prevScrollHeight = messagesEl?.scrollHeight ?? 0
				messages = [...older, ...messages]
				hasMore = older.length >= 50
				await tick()
				// Maintenir la position de scroll
				if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight - prevScrollHeight
			}
		} finally {
			loadingMore = false
		}
	}

	function onScroll() {
		if (!messagesEl) return
		if (messagesEl.scrollTop < 80) loadMore()
	}

	function emitTyping() {
		const sock = getSocket()
		if (!sock || typingTimeout) return
		sock.emit('dm:typing', conversationId)
		typingTimeout = setTimeout(() => { typingTimeout = null }, 2000)
	}

	async function sendMessage() {
		const content = messageInput.trim()
		if (!content || sendingMsg) return
		sendingMsg = true
		messageInput = ''
		try {
			const sock = getSocket()
			if (sock) {
				sock.emit('dm:send', { conversationId, content })
			} else {
				// Fallback REST si socket pas dispo
				await apiFetch(fetch, `/dm/conversations/${conversationId}/messages`, {
					method: 'POST',
					headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'application/json' },
					body: JSON.stringify({ content })
				})
			}
		} finally {
			sendingMsg = false
			await tick()
			scrollToBottom()
		}
	}

	async function deleteMessage(msgId: string) {
		await apiFetch(fetch, `/dm/messages/${msgId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${data.token}` }
		})
		messages = messages.map(m => m.id === msgId ? { ...m, deleted_at: new Date().toISOString(), content: '' } : m)
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			sendMessage()
		}
	}

	function formatTime(iso: string): string {
		const d = new Date(iso)
		return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
	}

	function formatDate(iso: string): string {
		const d = new Date(iso)
		const now = new Date()
		if (d.toDateString() === now.toDateString()) return 'Aujourd\'hui'
		const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
		if (d.toDateString() === yesterday.toDateString()) return 'Hier'
		return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
	}

	// Regrouper les messages avec séparateurs de date
	let groupedMessages = $derived.by(() => {
		const groups: { date: string; msgs: DmMessage[] }[] = []
		let currentDate = ''
		for (const m of messages) {
			const d = formatDate(m.created_at)
			if (d !== currentDate) {
				currentDate = d
				groups.push({ date: d, msgs: [] })
			}
			groups[groups.length - 1].msgs.push(m)
		}
		return groups
	})

	// Regrouper les messages consécutifs du même sender (bulles condensées)
	function isFirstInGroup(msgs: DmMessage[], i: number): boolean {
		if (i === 0) return true
		return msgs[i].sender_id !== msgs[i - 1].sender_id
	}
	function isLastInGroup(msgs: DmMessage[], i: number): boolean {
		if (i === msgs.length - 1) return true
		return msgs[i].sender_id !== msgs[i + 1].sender_id
	}
</script>

<svelte:head>
	<title>DM — {conversation?.other_username ?? 'Messages privés'}</title>
</svelte:head>

<!-- Layout deux colonnes : sidebar conversations + vue active -->
<div class="flex h-full">

	<!-- Sidebar conversations (masquée sur mobile) -->
	<aside class="hidden sm:flex flex-col w-64 border-r border-gray-800 shrink-0 bg-gray-950/40">
		<div class="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
			<span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Messages privés</span>
			<a href="/dm" class="text-gray-500 hover:text-white transition-colors" title="Nouvelle conversation">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
				</svg>
			</a>
		</div>
		<div class="flex-1 overflow-y-auto py-1">
			{#each conversations as conv}
				<a href="/dm/{conv.id}"
					class="flex items-center gap-2.5 px-3 py-2 mx-1 rounded-lg transition-colors {conv.id === conversationId ? 'bg-indigo-600/20 text-white' : 'text-gray-400 hover:bg-gray-800/60 hover:text-white'}">
					{#if conv.other_avatar}
						<img src={conv.other_avatar} alt={conv.other_username} class="w-7 h-7 rounded-full object-cover shrink-0"/>
					{:else}
						<div class="w-7 h-7 rounded-full bg-indigo-600/25 flex items-center justify-center shrink-0 text-xs font-bold"
							style={conv.other_name_color ? `color: ${conv.other_name_color}` : 'color: #818cf8'}>
							{conv.other_username[0].toUpperCase()}
						</div>
					{/if}
					<span class="text-sm truncate font-medium">{conv.other_username}</span>
				</a>
			{/each}
		</div>
	</aside>

	<!-- Zone principale -->
	<div class="flex-1 flex flex-col min-w-0">

		<!-- Header -->
		<header class="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-950/40">
			<a href="/dm" class="sm:hidden p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
				</svg>
			</a>
			{#if conversation?.other_avatar}
				<img src={conversation.other_avatar} alt={conversation.other_username} class="w-8 h-8 rounded-full object-cover shrink-0"/>
			{:else if conversation}
				<div class="w-8 h-8 rounded-full bg-indigo-600/25 flex items-center justify-center shrink-0 text-sm font-bold"
					style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : 'color: #818cf8'}>
					{conversation.other_username[0].toUpperCase()}
				</div>
			{/if}
			{#if conversation}
				<a href="/users/{conversation.other_username}"
					class="text-sm font-semibold hover:underline"
					style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : 'color: white'}>
					{conversation.other_username}
				</a>
			{/if}
		</header>

		<!-- Messages -->
		<div
			bind:this={messagesEl}
			onscroll={onScroll}
			class="flex-1 overflow-y-auto px-4 py-4 space-y-0.5"
		>
			<!-- Loader "plus de messages" -->
			{#if loadingMore}
				<div class="flex justify-center py-3">
					<div class="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"></div>
				</div>
			{/if}

			{#each groupedMessages as group}
				<!-- Séparateur de date -->
				<div class="flex items-center gap-3 py-3">
					<div class="flex-1 h-px bg-gray-800"></div>
					<span class="text-[11px] text-gray-600 font-medium shrink-0">{group.date}</span>
					<div class="flex-1 h-px bg-gray-800"></div>
				</div>

				{#each group.msgs as msg, i}
					{@const isMine = msg.sender_id === currentUserId}
					{@const first = isFirstInGroup(group.msgs, i)}
					{@const last = isLastInGroup(group.msgs, i)}

					<div class="flex {isMine ? 'justify-end' : 'justify-start'} {first ? 'mt-3' : 'mt-0.5'} group/msg">
						<!-- Avatar (autres seulement, premier du groupe) -->
						{#if !isMine}
							<div class="w-8 shrink-0 mr-2 self-end">
								{#if last}
									{#if msg.sender_avatar}
										<img src={msg.sender_avatar} alt={msg.sender_username} class="w-7 h-7 rounded-full object-cover"/>
									{:else}
										<div class="w-7 h-7 rounded-full bg-indigo-600/25 flex items-center justify-center text-xs font-bold"
											style={msg.sender_name_color ? `color: ${msg.sender_name_color}` : 'color: #818cf8'}>
											{msg.sender_username[0].toUpperCase()}
										</div>
									{/if}
								{/if}
							</div>
						{/if}

						<div class="max-w-[75%] flex flex-col {isMine ? 'items-end' : 'items-start'}">
							<!-- Bulle -->
							{#if msg.deleted_at}
								<div class="px-3 py-2 rounded-2xl text-xs italic text-gray-600 bg-gray-800/40 border border-gray-800">
									Message supprimé
								</div>
							{:else}
								<div class="relative px-3 py-2 rounded-2xl text-sm break-words
									{isMine
										? 'bg-indigo-600 text-white ' + (first ? 'rounded-tr-sm' : '') + (last ? '' : 'rounded-br-sm')
										: 'bg-gray-800 text-gray-100 ' + (first ? 'rounded-tl-sm' : '') + (last ? '' : 'rounded-bl-sm')}">
									{msg.content}

									<!-- Actions (hover) -->
									{#if isMine}
										<button
											onclick={() => deleteMessage(msg.id)}
											class="absolute -left-7 top-1 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 rounded hover:bg-gray-800 text-gray-600 hover:text-red-400"
											title="Supprimer"
										>
											<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
												<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
											</svg>
										</button>
									{/if}
								</div>
							{/if}

							<!-- Heure (dernier du groupe) -->
							{#if last}
								<span class="text-[10px] text-gray-600 mt-0.5 px-1">{formatTime(msg.created_at)}</span>
							{/if}
						</div>
					</div>
				{/each}
			{/each}

			<!-- Indicateur de frappe -->
			{#if typingLabel}
				<div class="flex items-center gap-2 px-2 py-1 mt-2">
					<div class="flex gap-0.5">
						<span class="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style="animation-delay: 0ms"></span>
						<span class="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style="animation-delay: 150ms"></span>
						<span class="w-1.5 h-1.5 rounded-full bg-gray-500 animate-bounce" style="animation-delay: 300ms"></span>
					</div>
					<span class="text-[11px] text-gray-500 italic">{typingLabel}</span>
				</div>
			{/if}
		</div>

		<!-- Zone de saisie -->
		<div class="shrink-0 px-4 py-3 border-t border-gray-800">
			<div class="flex items-end gap-2 bg-gray-800/60 border border-gray-700 rounded-2xl px-4 py-2.5 focus-within:border-indigo-500/60 transition-colors">
				<textarea
					bind:value={messageInput}
					onkeydown={onKeydown}
					oninput={emitTyping}
					placeholder="Message privé…"
					rows="1"
					class="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none resize-none max-h-32 leading-relaxed"
					style="field-sizing: content;"
				></textarea>
				<button
					onclick={sendMessage}
					disabled={!messageInput.trim() || sendingMsg}
					class="shrink-0 p-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
					title="Envoyer"
				>
					<svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<line x1="22" y1="2" x2="11" y2="13"/>
						<polygon points="22 2 15 22 11 13 2 9 22 2"/>
					</svg>
				</button>
			</div>
			<p class="text-[10px] text-gray-700 mt-1.5 text-right">Entrée pour envoyer · Maj+Entrée pour retour à la ligne</p>
		</div>

	</div>
</div>
