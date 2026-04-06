<script lang="ts">
	import { t } from '$lib/i18n'
	import { onMount, onDestroy, tick } from 'svelte'
	import { getSocket, dmUnreadStore } from '$lib/socket'
	import { apiFetch } from '$lib/api'
	import {
		registerPublicKey, fetchPeerPublicKey,
		encryptDM, decryptDM, loadEsyKey, barbarizeVisual,
		type E2EStatus, type EsyKey
	} from '$lib/e2e'

	const tFn = $derived($t)

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
		is_encrypted?: boolean
		encryption_nonce?: string | null
		edited_at?: string | null
		// Texte déchiffré en local (jamais persisté)
		_decrypted?: string
		_decryptFailed?: boolean
		_barbarizing?: boolean   // animation en cours côté réceptionnaire
		_barbarText?: string     // texte barbarisé affiché pendant l'animation
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

	// ── E2E state ──────────────────────────────────────────────────────────────
	let e2eStatus = $state<E2EStatus>('unknown')
	let peerPublicKey: string | null = $state(null)
	let esyKey: EsyKey | null = $state(null)
	let esyFingerprint: string | null = $state(null)
	// Animation d'envoi — texte "barbarisé" affiché brièvement avant envoi
	let sendingVisual: string | null = $state(null)

	async function initE2E() {
		if (!conversation) return
		try {
			// 1. Init keypair local + enregistrer sur le serveur
			const registered = await registerPublicKey(data.token)
			if (!registered) {
				e2eStatus = 'inactive'
				return
			}

			// 2. Récupérer la clé publique du peer
			peerPublicKey = await fetchPeerPublicKey(conversation.other_username, data.token)

			// 3. Charger la clé ESY de l'instance
			try {
				esyKey = await loadEsyKey(data.token)
				esyFingerprint = esyKey.fingerprint
			} catch { esyKey = null }

			// 4. Déterminer le statut E2E
			if (peerPublicKey) {
				e2eStatus = 'active'
			} else {
				e2eStatus = 'partial' // moi oui, peer non encore
			}

			// 5. Déchiffrer les messages chiffrés déjà chargés
			await decryptPendingMessages()
		} catch {
			e2eStatus = 'inactive'
		}
	}

	async function decryptPendingMessages() {
		if (!peerPublicKey) return
		const updated = await Promise.all(messages.map(async (m) => {
			if (!m.is_encrypted || !m.encryption_nonce || m._decrypted !== undefined) return m
			const plain = await decryptDM(m.content, m.encryption_nonce, peerPublicKey!, data.token)
			return { ...m, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
		}))
		messages = updated
	}

	// Quand on switch de conversation
	$effect(() => {
		if (data.conversationId === conversationId) return
		conversationId = data.conversationId
		conversation = data.conversation ?? null
		messages = data.messages ?? []
		hasMore = (data.messages ?? []).length >= 50
		messageInput = ''
		typingLabel = ''
		typingUsers.clear()
		peerPublicKey = null
		e2eStatus = 'unknown'

		sendingVisual = null
		markRead()
		dmUnreadStore.set(0)
		tick().then(async () => {
			scrollToBottom()
			await initE2E()
		})
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
	// Édition inline
	let editingMsgId: string | null = $state(null)
	let editingContent = $state('')

	onMount(async () => {
		const res = await apiFetch(fetch, '/users/me', {
			headers: { Authorization: `Bearer ${data.token}` }
		})
		if (res.ok) {
			const u = await res.json()
			currentUserId = u.user?.id ?? ''
		}

		markRead()
		dmUnreadStore.set(0)
		await tick()
		scrollToBottom()

		// Écoute socket DM — attendre que le socket soit prêt si nécessaire
		const attachListeners = (sock: ReturnType<typeof getSocket>) => {
			if (!sock) return
			sock.off('dm:message', onDmMessage)
			sock.off('dm:typing', onDmTyping)
			sock.off('dm:edited', onDmEdited)
			sock.off('dm:deleted', onDmDeleted)
			sock.on('dm:message', onDmMessage)
			sock.on('dm:typing', onDmTyping)
			sock.on('dm:edited', onDmEdited)
			sock.on('dm:deleted', onDmDeleted)
			sock.on('dm:read_ack', () => {})
		}
		const sock = getSocket()
		if (sock) {
			attachListeners(sock)
		} else {
			// Socket pas encore initialisé — poll court jusqu'à disponibilité
			const interval = setInterval(() => {
				const s = getSocket()
				if (s) { clearInterval(interval); attachListeners(s) }
			}, 100)
			setTimeout(() => clearInterval(interval), 5000)
		}

		// Init E2E après le mount
		await initE2E()
	})

	onDestroy(() => {
		const sock = getSocket()
		if (sock) {
			sock.off('dm:message', onDmMessage)
			sock.off('dm:typing', onDmTyping)
		}
	})

	async function onDmMessage(msg: DmMessage) {
		if (msg.conversation_id !== conversationId) return

		if (msg.is_encrypted && msg.encryption_nonce && peerPublicKey) {
			// 1. Afficher d'abord le message barbarisé
			if (esyKey) {
				const barbarText = barbarizeVisual(msg.content.slice(0, 40), esyKey, 0.6)
				msg = { ...msg, _barbarizing: true, _barbarText: barbarText }
				messages = [...messages, msg]
				tick().then(scrollToBottom)

				// 2. Déchiffrer pendant l'animation (350ms)
				await new Promise(r => setTimeout(r, 350))
				const plain = await decryptDM(msg.content, msg.encryption_nonce!, peerPublicKey, data.token)

				// 3. Remplacer par le texte clair
				messages = messages.map(m =>
					m.id === msg.id
						? { ...m, _barbarizing: false, _barbarText: undefined, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
						: m
				)
			} else {
				const plain = await decryptDM(msg.content, msg.encryption_nonce, peerPublicKey, data.token)
				msg = { ...msg, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
				messages = [...messages, msg]
				tick().then(scrollToBottom)
			}
		} else {
			messages = [...messages, msg]
			tick().then(scrollToBottom)
		}

		if (document.hasFocus()) markRead()
	}

	function onDmEdited({ msgId, content, conversation_id }: { msgId: string; content: string; conversation_id: string }) {
		if (conversation_id !== conversationId) return
		messages = messages.map(m => m.id === msgId ? { ...m, content, edited_at: new Date().toISOString() } : m)
	}

	function onDmDeleted({ msgId, conversation_id }: { msgId: string; conversation_id: string }) {
		if (conversation_id !== conversationId) return
		messages = messages.map(m => m.id === msgId ? { ...m, deleted_at: new Date().toISOString(), content: '' } : m)
	}

	function startEdit(msg: DmMessage) {
		editingMsgId = msg.id
		editingContent = msg.content
	}

	function cancelEdit() {
		editingMsgId = null
		editingContent = ''
	}

	function saveEdit() {
		const content = editingContent.trim()
		if (!content || !editingMsgId) return
		const sock = getSocket()
		if (sock) sock.emit('dm:edit', { msgId: editingMsgId, content })
		editingMsgId = null
		editingContent = ''
	}

	function onEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit() }
		if (e.key === 'Escape') cancelEdit()
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
		else if (names.length === 1) typingLabel = tFn('dm.user_typing', { user: names[0] })
		else typingLabel = tFn('dm.users_typing', { users: names.join(', ') })
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
				// Déchiffrer les anciens messages
				const decrypted = await Promise.all((older as DmMessage[]).map(async (m) => {
					if (!m.is_encrypted || !m.encryption_nonce || !peerPublicKey) return m
					const plain = await decryptDM(m.content, m.encryption_nonce, peerPublicKey, data.token)
					return { ...m, _decrypted: plain ?? undefined, _decryptFailed: plain === null }
				}))
				messages = [...decrypted, ...messages]
				hasMore = older.length >= 50
				await tick()
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

			if (e2eStatus === 'active' && peerPublicKey) {
				// ── E2E : animation barbare → chiffrement → envoi ──────────────
				// 1. Afficher l'animation barbare pendant le chiffrement
				if (esyKey) {
					sendingVisual = barbarizeVisual(content, esyKey)
					await tick()
					await new Promise(r => setTimeout(r, 350))
				}

				const { ciphertext, nonce } = await encryptDM(content, peerPublicKey, data.token)
				sendingVisual = null

				if (sock) {
					sock.emit('dm:send', {
						conversationId,
						content: ciphertext,
						is_encrypted: true,
						encryption_nonce: nonce,
					})
				}
			} else {
				// ── Fallback texte clair ────────────────────────────────────────
				if (sock) {
					sock.emit('dm:send', { conversationId, content })
				}
			}
		} finally {
			sendingMsg = false
			sendingVisual = null
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
		return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
	}

	function formatDate(iso: string): string {
		const d = new Date(iso)
		const now = new Date()
		if (d.toDateString() === now.toDateString()) return tFn('common.today')
		const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
		if (d.toDateString() === yesterday.toDateString()) return tFn('common.yesterday')
		return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
	}

	// Message texte à afficher (déchiffré si E2E, brut sinon)
	function displayContent(msg: DmMessage): string {
		if (msg.is_encrypted) {
			if (msg._barbarizing && msg._barbarText) return msg._barbarText
			if (msg._decrypted !== undefined) return msg._decrypted
			if (msg._decryptFailed) return tFn('dm.decrypt_failed')
			return '…'
		}
		return msg.content
	}

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

	function isFirstInGroup(msgs: DmMessage[], i: number): boolean {
		if (i === 0) return true
		return msgs[i].sender_id !== msgs[i - 1].sender_id
	}
	function isLastInGroup(msgs: DmMessage[], i: number): boolean {
		if (i === msgs.length - 1) return true
		return msgs[i].sender_id !== msgs[i + 1].sender_id
	}

	// Couleurs du shield E2E
	const shieldColor = $derived(
		e2eStatus === 'active'   ? { dot: '#4ade80', glow: 'rgba(74,222,128,0.25)', label: 'E2E' } :
		e2eStatus === 'partial'  ? { dot: '#fb923c', glow: 'rgba(251,146,60,0.25)',  label: '~E2E' } :
		e2eStatus === 'inactive' ? { dot: '#6b7280', glow: 'transparent',            label: '' } :
		                           { dot: '#374151', glow: 'transparent',            label: '' }
	)
</script>

<svelte:head>
	<title>DM — {conversation?.other_username ?? tFn('dm.title')}</title>
</svelte:head>

<!-- Layout deux colonnes : sidebar + zone chat -->
<div class="flex h-full bg-gray-950/20">

	<!-- ── Sidebar conversations ──────────────────────────────────────────── -->
	<aside class="hidden sm:flex flex-col w-72 shrink-0 border-r border-white/[0.06] bg-gray-950/60">

		<!-- Header sidebar -->
		<div class="px-4 pt-4 pb-3">
			<div class="flex items-center justify-between mb-3">
				<a href="/dm" class="flex items-center gap-2 group">
					<svg class="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
					</svg>
					<span class="text-xs font-semibold text-gray-500 group-hover:text-gray-300 uppercase tracking-wider transition-colors">{tFn('dm.sidebar_title')}</span>
				</a>
				<a href="/dm" class="w-6 h-6 rounded-lg bg-indigo-600/15 hover:bg-indigo-600/30 border border-indigo-500/20 flex items-center justify-center transition-colors" title={tFn('dm.new_conversation_tooltip')}>
					<svg class="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
					</svg>
				</a>
			</div>
		</div>

		<!-- Liste -->
		<div class="flex-1 overflow-y-auto px-2 pb-3" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.04) transparent">
			{#each conversations as conv}
				<a href="/dm/{conv.id}"
					class="flex items-center gap-2.5 px-2.5 py-2.5 rounded-xl mb-0.5 transition-all
						{conv.id === conversationId
							? 'bg-indigo-600/15 border border-indigo-500/20'
							: 'hover:bg-white/[0.04] border border-transparent'}">
					<!-- Avatar -->
					<div class="relative shrink-0">
						{#if conv.other_avatar}
							<img src={conv.other_avatar} alt={conv.other_username} class="w-8 h-8 rounded-full object-cover"/>
						{:else}
							<div class="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/15 flex items-center justify-center text-xs font-bold"
								style={conv.other_name_color ? `color: ${conv.other_name_color}` : 'color: #818cf8'}>
								{conv.other_username[0].toUpperCase()}
							</div>
						{/if}
					</div>
					<span class="text-sm font-medium truncate
						{conv.id === conversationId ? 'text-white' : 'text-gray-400'}"
						style={conv.id === conversationId && conv.other_name_color ? `color: ${conv.other_name_color}` : ''}>
						{conv.other_username}
					</span>
				</a>
			{/each}
		</div>
	</aside>

	<!-- ── Zone principale ───────────────────────────────────────────────── -->
	<div class="flex-1 flex flex-col min-w-0">

		<!-- Header conversation -->
		<header class="shrink-0 flex items-center gap-3 px-5 py-3.5 border-b border-white/[0.06] bg-gray-950/40 backdrop-blur-sm">
			<!-- Retour mobile -->
			<a href="/dm" aria-label={tFn('dm.back')} class="sm:hidden p-1.5 rounded-lg hover:bg-white/[0.06] text-gray-500 hover:text-white transition-colors">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
				</svg>
			</a>

			{#if conversation}
				<!-- Avatar -->
				{#if conversation.other_avatar}
					<img src={conversation.other_avatar} alt={conversation.other_username} class="w-8 h-8 rounded-full object-cover shrink-0 ring-2 ring-white/[0.06]"/>
				{:else}
					<div class="w-8 h-8 rounded-full bg-indigo-600/20 border border-indigo-500/20 flex items-center justify-center shrink-0 text-sm font-bold"
						style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : 'color: #818cf8'}>
						{conversation.other_username[0].toUpperCase()}
					</div>
				{/if}

				<!-- Nom + lien profil -->
				<div class="flex-1 min-w-0">
					<a href="/users/{conversation.other_username}"
						class="text-sm font-semibold hover:underline block truncate"
						style={conversation.other_name_color ? `color: ${conversation.other_name_color}` : 'color: white'}>
						{conversation.other_username}
					</a>
					{#if typingLabel}
						<span class="text-[11px] text-indigo-400/80 italic">{typingLabel}</span>
					{:else}
						<span class="text-[11px] text-gray-600">{tFn('dm.private_message')}</span>
					{/if}
				</div>

				<!-- Lien profil icône -->
				<a href="/users/{conversation.other_username}" aria-label={tFn('dm.view_profile')} class="p-1.5 rounded-lg hover:bg-white/[0.06] text-gray-600 hover:text-gray-300 transition-colors shrink-0">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
					</svg>
				</a>

				<!-- Shield E2E -->
				{#if e2eStatus !== 'inactive' && e2eStatus !== 'unknown'}
					<div class="flex items-center gap-1.5 px-2.5 py-1 rounded-full border shrink-0 cursor-default"
						style="background: {shieldColor.glow}; border-color: {shieldColor.dot}30"
						title={esyFingerprint ? `ESY: ${esyFingerprint}` : tFn('dm.e2e_tooltip_' + e2eStatus)}>
						<!-- Dot pulsant -->
						<span class="relative flex w-2 h-2">
							<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
								style="background: {shieldColor.dot}"></span>
							<span class="relative inline-flex rounded-full w-2 h-2"
								style="background: {shieldColor.dot}"></span>
						</span>
						<!-- Icône cadenas -->
						<svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
							style="color: {shieldColor.dot}">
							<rect x="5" y="11" width="14" height="10" rx="2"/>
							<path d="M8 11V7a4 4 0 018 0v4"/>
						</svg>
						{#if shieldColor.label}
							<span class="text-[10px] font-bold tracking-wider"
								style="color: {shieldColor.dot}">{shieldColor.label}</span>
						{/if}
					</div>
				{/if}
			{/if}
		</header>

		<!-- Messages -->
		<div
			bind:this={messagesEl}
			onscroll={onScroll}
			class="flex-1 overflow-y-auto px-5 py-4"
			style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.06) transparent"
		>
			{#if loadingMore}
				<div class="flex justify-center py-4">
					<div class="w-4 h-4 border-2 border-indigo-400/60 border-t-transparent rounded-full animate-spin"></div>
				</div>
			{/if}

			{#each groupedMessages as group}
				<!-- Séparateur de date -->
				<div class="flex items-center gap-3 py-4">
					<div class="flex-1 h-px bg-white/[0.05]"></div>
					<span class="text-[10px] text-gray-700 font-semibold uppercase tracking-wider shrink-0 px-2">{group.date}</span>
					<div class="flex-1 h-px bg-white/[0.05]"></div>
				</div>

				{#each group.msgs as msg, i}
					{@const isMine = msg.sender_id === currentUserId}
					{@const first = isFirstInGroup(group.msgs, i)}
					{@const last = isLastInGroup(group.msgs, i)}

					<div class="flex {isMine ? 'justify-end' : 'justify-start'} {first ? 'mt-3' : 'mt-[2px]'} group/msg">
						<!-- Avatar peer (dernier du groupe seulement) -->
						{#if !isMine}
							<div class="w-9 shrink-0 mr-2 self-end mb-0.5">
								{#if last}
									{#if msg.sender_avatar}
										<img src={msg.sender_avatar} alt={msg.sender_username} class="w-7 h-7 rounded-full object-cover"/>
									{:else}
										<div class="w-7 h-7 rounded-full bg-indigo-600/20 border border-indigo-500/15 flex items-center justify-center text-xs font-bold"
											style={msg.sender_name_color ? `color: ${msg.sender_name_color}` : 'color: #818cf8'}>
											{msg.sender_username[0].toUpperCase()}
										</div>
									{/if}
								{/if}
							</div>
						{/if}

						<div class="max-w-[68%] flex flex-col {isMine ? 'items-end' : 'items-start'}">
							<!-- Actions hover -->
							{#if isMine && !msg.deleted_at && editingMsgId !== msg.id}
								<div class="flex gap-0.5 mb-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity">
									{#if !msg.is_encrypted}
										<button onclick={() => startEdit(msg)}
											class="p-1 rounded-md hover:bg-white/[0.08] text-gray-600 hover:text-indigo-400 transition-colors"
											title={tFn('common.edit')}>
											<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
												<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
												<path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
											</svg>
										</button>
									{/if}
									<button onclick={() => deleteMessage(msg.id)}
										class="p-1 rounded-md hover:bg-white/[0.08] text-gray-600 hover:text-red-400 transition-colors"
										title={tFn('common.delete')}>
										<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6m4-6v6"/><path d="M9 6V4h6v2"/>
										</svg>
									</button>
								</div>
							{/if}

							{#if msg.deleted_at}
								<div class="px-3 py-2 rounded-2xl text-xs italic text-gray-700 bg-white/[0.03] border border-white/[0.05]">
									{tFn('dm.deleted_message')}
								</div>
							{:else}
								<div class="relative px-3.5 py-2 text-sm break-words leading-relaxed
									{msg._barbarizing ? 'font-mono tracking-widest opacity-60 animate-pulse' : ''}
									{isMine
										? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/10 '
											+ (first ? 'rounded-t-2xl rounded-bl-2xl rounded-br-md' : last ? 'rounded-b-2xl rounded-tl-2xl rounded-tr-md' : 'rounded-l-2xl rounded-r-md')
										: 'bg-white/[0.07] border border-white/[0.06] text-gray-100 '
											+ (first ? 'rounded-t-2xl rounded-br-2xl rounded-bl-md' : last ? 'rounded-b-2xl rounded-tr-2xl rounded-tl-md' : 'rounded-r-2xl rounded-l-md')}">
									{#if editingMsgId === msg.id}
									<!-- Mode édition inline -->
									<textarea
										bind:value={editingContent}
										onkeydown={onEditKeydown}
										rows="1"
										class="w-full bg-transparent outline-none resize-none text-sm text-white leading-relaxed"
										style="field-sizing: content;"
									></textarea>
									<div class="flex gap-1.5 mt-1.5">
										<button onclick={saveEdit} class="text-[10px] px-2 py-0.5 rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition-colors">Entrée</button>
										<button onclick={cancelEdit} class="text-[10px] px-2 py-0.5 rounded-md bg-white/[0.06] hover:bg-white/[0.10] text-gray-400 transition-colors">Échap</button>
									</div>
								{:else}
									{displayContent(msg)}

									<!-- Lock badge si message chiffré -->
									{#if msg.is_encrypted && !msg._decryptFailed}
										<span class="inline-flex items-center ml-1.5 opacity-50" title={tFn('dm.encrypted_message')}>
											<svg class="w-2.5 h-2.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
												<rect x="5" y="11" width="14" height="10" rx="2"/>
												<path d="M8 11V7a4 4 0 018 0v4"/>
											</svg>
										</span>
									{/if}

								{/if}
								</div>
							{/if}

							{#if last}
								<span class="text-[10px] text-gray-700 mt-1 px-1">
									{formatTime(msg.created_at)}
									{#if msg.edited_at}<span class="italic"> · {tFn('common.edited')}</span>{/if}
								</span>
							{/if}
						</div>
					</div>
				{/each}
			{/each}

			<!-- Indicateur de frappe (maintenant dans header) -->
		</div>

		<!-- Zone de saisie -->
		<div class="shrink-0 px-5 py-4 border-t border-white/[0.06] bg-gray-950/30">
			<!-- Animation barbare d'envoi -->
			{#if sendingVisual}
				<div class="mb-2 px-3 py-1.5 rounded-xl bg-indigo-900/20 border border-indigo-500/15 text-xs font-mono text-indigo-300/60 truncate tracking-widest animate-pulse">
					{sendingVisual}
				</div>
			{/if}
			<div class="flex items-end gap-3 bg-white/[0.04] border border-white/[0.07] rounded-2xl px-4 py-3
						focus-within:border-indigo-500/35 focus-within:bg-indigo-500/[0.04] transition-all duration-200">
				<textarea
					bind:value={messageInput}
					onkeydown={onKeydown}
					oninput={emitTyping}
					placeholder={conversation ? tFn('dm.message_placeholder_user', { user: conversation.other_username }) : tFn('dm.message_placeholder')}
					rows="1"
					class="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none resize-none max-h-36 leading-relaxed"
					style="field-sizing: content;"
				></textarea>
				<button
					onclick={sendMessage}
					disabled={!messageInput.trim() || sendingMsg}
					class="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center
						bg-indigo-600 hover:bg-indigo-500 disabled:opacity-25 disabled:cursor-not-allowed
						transition-all duration-150 shadow-lg shadow-indigo-500/20"
					title={tFn('common.send')}
				>
					<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
						<line x1="22" y1="2" x2="11" y2="13"/>
						<polygon points="22 2 15 22 11 13 2 9 22 2"/>
					</svg>
				</button>
			</div>
			<p class="text-[10px] text-gray-800 mt-1.5 text-right">{tFn('dm.send_instructions')}</p>
		</div>

	</div>
</div>
