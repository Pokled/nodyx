<script lang="ts">
	import type { PageData } from './$types'
	import { onMount, onDestroy, tick, untrack } from 'svelte'
	import { page } from '$app/stores'
	import { goto } from '$app/navigation'
	import { getSocket } from '$lib/socket'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { linkifyText } from '$lib/linkify'

	let { data }: { data: PageData } = $props()

	const roomId  = $derived($page.params.id)
	const me      = $derived(($page.data as any).user)
	const token   = $derived(($page.data as any).token as string | null)

	// ── State ────────────────────────────────────────────────────────────────
	interface WMessage {
		id: string
		user_id: string | null
		username: string
		avatar: string | null
		content: string
		created_at: string
	}

	let room     = $state(untrack(() => data.room))
	let messages = $state<WMessage[]>(untrack(() => data.messages))
	let input    = $state('')
	let sending  = $state(false)
	let expired  = $state(false)
	let typingUsers = $state<string[]>([])
	let messagesEl  = $state<HTMLElement | null>(null)
	let typingTimer: ReturnType<typeof setTimeout> | null = null

	// ── Socket init ──────────────────────────────────────────────────────────
	let socket = $state(getSocket())

	function avatarUrl(avatar: string | null) {
		if (!avatar) return null
		const base = PUBLIC_API_URL.replace('/api/v1', '')
		return avatar.startsWith('http') ? avatar : `${base}/uploads/${avatar}`
	}

	function formatTime(d: string) {
		return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(d))
	}

	async function scrollBottom() {
		await tick()
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight
	}

	function setupSocketListeners() {
		const s = getSocket()
		if (!s) return
		socket = s

		s.emit('whisper:join', { roomId })

		s.on('whisper:history', (payload: { roomId: string; room: typeof room; messages: WMessage[] }) => {
			if (payload.roomId !== roomId) return
			room     = payload.room
			messages = payload.messages
			scrollBottom()
		})

		s.on('whisper:message', (payload: { roomId: string; message: WMessage }) => {
			if (payload.roomId !== roomId) return
			messages = [...messages, payload.message]
			// Remove from typing
			typingUsers = typingUsers.filter(u => u !== payload.message.username)
			scrollBottom()
		})

		s.on('whisper:typing', (payload: { roomId: string; userId: string; username: string }) => {
			if (payload.roomId !== roomId || payload.userId === me?.id) return
			if (!typingUsers.includes(payload.username)) {
				typingUsers = [...typingUsers, payload.username]
				setTimeout(() => {
					typingUsers = typingUsers.filter(u => u !== payload.username)
				}, 3000)
			}
		})

		s.on('whisper:user_join', (payload: { roomId: string; username: string }) => {
			if (payload.roomId !== roomId) return
		})

		s.on('whisper:expired', (payload: { roomId: string }) => {
			if (payload.roomId !== roomId) return
			expired = true
		})
	}

	function teardownSocket() {
		const s = getSocket()
		if (!s) return
		s.emit('whisper:leave', { roomId })
		s.off('whisper:history')
		s.off('whisper:message')
		s.off('whisper:typing')
		s.off('whisper:user_join')
		s.off('whisper:expired')
	}

	onMount(() => {
		// Socket may not be ready immediately (layout init is async)
		const tryConnect = () => {
			const s = getSocket()
			if (s) { setupSocketListeners(); return }
			setTimeout(tryConnect, 300)
		}
		tryConnect()
		scrollBottom()
	})

	onDestroy(() => {
		teardownSocket()
	})

	function sendTyping() {
		const s = getSocket()
		if (!s) return
		s.emit('whisper:typing', { roomId })
	}

	function onInputKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			sendMessage()
			return
		}
		// Throttle typing events
		if (typingTimer) clearTimeout(typingTimer)
		typingTimer = setTimeout(sendTyping, 400)
	}

	function sendMessage() {
		const s = getSocket()
		const content = input.trim()
		if (!content || !s || sending) return
		sending = true
		s.emit('whisper:message', { roomId, content })
		input   = ''
		sending = false
	}

	let copyDone = $state(false)
	async function copyLink() {
		await navigator.clipboard.writeText(window.location.href)
		copyDone = true
		setTimeout(() => { copyDone = false }, 2000)
	}

	// Expiry countdown
	let expiresIn = $state('')
	function updateExpiry() {
		if (!room?.expires_at) return
		const diff = new Date(room.expires_at).getTime() - Date.now()
		if (diff <= 0) { expiresIn = 'Expiré'; return }
		const m = Math.floor(diff / 60000)
		const s = Math.floor((diff % 60000) / 1000)
		expiresIn = m > 0 ? `${m}m ${s}s` : `${s}s`
	}
	let expiryInterval: ReturnType<typeof setInterval>
	onMount(() => { updateExpiry(); expiryInterval = setInterval(updateExpiry, 5000) })
	onDestroy(() => clearInterval(expiryInterval))
</script>

<svelte:head>
	<title>Chuchotement — Nodyx</title>
</svelte:head>

<div class="flex flex-col h-[calc(100vh-64px)] max-w-2xl mx-auto px-2 py-4">

	<!-- Header -->
	<div class="flex items-center gap-3 mb-3 px-2">
		<div class="flex-1 min-w-0">
			<div class="flex items-center gap-2">
				<span class="text-xl">🤫</span>
				<h1 class="text-base font-bold text-white truncate">
					{room?.name ?? 'Chuchotement'}
				</h1>
			</div>
			{#if room?.context_label}
				<p class="text-xs text-gray-500 mt-0.5 truncate">
					Démarré depuis · {room.context_label}
				</p>
			{/if}
		</div>

		<!-- Expiry + share -->
		<div class="flex items-center gap-2 shrink-0">
			{#if expiresIn}
				<span class="text-xs text-amber-500 font-mono bg-amber-950/40 border border-amber-800/40 px-2 py-1 rounded-lg">
					⏱ {expiresIn}
				</span>
			{/if}
			<button
				onclick={copyLink}
				title="Copier le lien du salon"
				class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors text-xs font-medium"
			>
				{copyDone ? '✅ Copié !' : '🔗 Partager'}
			</button>
			<a href="/library" class="p-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors text-sm">
				✕
			</a>
		</div>
	</div>

	<!-- Expired banner -->
	{#if expired}
		<div class="mb-4 px-4 py-3 rounded-xl bg-red-900/30 border border-red-700/50 text-red-300 text-sm text-center">
			Ce salon a expiré. Les messages ne sont plus disponibles.
			<a href="/library" class="underline ml-2 text-red-400 hover:text-red-300">Retourner à la bibliothèque</a>
		</div>
	{/if}

	<!-- Messages -->
	<div
		bind:this={messagesEl}
		class="flex-1 overflow-y-auto rounded-2xl border border-gray-800 bg-gray-950 p-4 space-y-3 scroll-smooth"
	>
		{#if messages.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
				<span class="text-4xl">🤫</span>
				<p class="text-sm">Personne n'a encore chuchoté.</p>
				<p class="text-xs">Les messages disparaissent après 1h d'inactivité.</p>
			</div>
		{/if}

		{#each messages as msg (msg.id)}
			<div class="flex items-start gap-2.5 {msg.user_id === me?.id ? 'flex-row-reverse' : ''}">
				<!-- Avatar -->
				{#if avatarUrl(msg.avatar)}
					<img src={avatarUrl(msg.avatar)} alt={msg.username}
						class="w-8 h-8 rounded-full shrink-0 object-cover border border-gray-700" />
				{:else}
					<div class="w-8 h-8 rounded-full shrink-0 bg-indigo-700 flex items-center justify-center text-xs font-bold text-white border border-gray-700">
						{msg.username[0]?.toUpperCase()}
					</div>
				{/if}

				<!-- Bubble -->
				<div class="max-w-[75%] {msg.user_id === me?.id ? 'items-end' : 'items-start'} flex flex-col gap-0.5">
					<span class="text-[10px] text-gray-500 px-1">
						{msg.user_id === me?.id ? 'Vous' : msg.username} · {formatTime(msg.created_at)}
					</span>
					<div class="px-3 py-2 rounded-2xl text-sm leading-relaxed break-words
						{msg.user_id === me?.id
							? 'bg-indigo-600 text-white rounded-tr-sm'
							: 'bg-gray-800 text-gray-200 rounded-tl-sm'}">
						{#each linkifyText(msg.content) as seg}
							{#if seg.type === 'url'}
								<a href={seg.value} target="_blank" rel="noopener noreferrer"
									class="underline opacity-80 hover:opacity-100 break-all">{seg.value}</a>
							{:else}
								{seg.value}
							{/if}
						{/each}
					</div>
				</div>
			</div>
		{/each}

		<!-- Typing indicator -->
		{#if typingUsers.length > 0}
			<div class="flex items-center gap-2 text-xs text-gray-500 italic">
				<span class="inline-flex gap-0.5">
					<span class="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style="animation-delay:0ms"></span>
					<span class="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style="animation-delay:150ms"></span>
					<span class="w-1.5 h-1.5 bg-gray-500 rounded-full animate-bounce" style="animation-delay:300ms"></span>
				</span>
				{typingUsers.join(', ')} écrit…
			</div>
		{/if}
	</div>

	<!-- Input -->
	{#if !expired}
		<div class="mt-3 flex gap-2">
			<input
				bind:value={input}
				onkeydown={onInputKeydown}
				placeholder="Chuchote quelque chose… (Entrée pour envoyer)"
				maxlength="2000"
				disabled={!me}
				class="flex-1 px-4 py-3 rounded-xl bg-gray-800 border border-gray-700 text-sm text-white
				       placeholder-gray-500 focus:outline-none focus:border-indigo-500 disabled:opacity-50"
			/>
			<button
				onclick={sendMessage}
				disabled={!input.trim() || !me || sending}
				class="px-4 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40
				       text-white text-sm font-semibold transition-colors"
			>
				↗
			</button>
		</div>
		{#if !me}
			<p class="text-xs text-center text-gray-500 mt-2">
				<a href="/auth/login" class="text-indigo-400 hover:underline">Connecte-toi</a> pour participer.
			</p>
		{/if}
	{/if}
</div>
