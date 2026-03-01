<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { fade, slide } from 'svelte/transition';
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import { socket, getSocket } from '$lib/socket';
	import NexusEditor from '$lib/components/editor/NexusEditor.svelte';
	import VoicePanel from '$lib/components/VoicePanel.svelte';
	import { joinVoice, leaveVoice, voiceStore, startPTT, stopPTT, togglePTTMode, setPeerVolume } from '$lib/voice';
	import type { Socket } from 'socket.io-client';
	import MediaCenter from '$lib/components/MediaCenter.svelte';
	import { voicePanelTarget } from '$lib/voicePanel';

	let { data }: { data: PageData } = $props();

	let localChannels = $state<any[]>([]);
	$effect(() => { localChannels = (data.channels ?? []).slice(); });

	// data.user comes from layout — cast through unknown to extract id safely
	const userId    = $derived(((data as unknown as { user?: { id?: string } }).user?.id) ?? '');
	const token     = $derived(data.token as string | null);
	const isAdmin   = $derived(
		((data as any)?.user?.role === 'owner' || (data as any)?.user?.role === 'admin')
	);

	// ── Types ─────────────────────────────────────────────────────────────────
	type Channel = (typeof localChannels)[number];
	type ReactionSummary = { emoji: string; count: number; userReactedIds: string[] };
	type Message = {
		id:              string;
		channel_id:      string;
		author_id:       string;
		author_username: string;
		author_avatar:   string | null;
		content:         string | null;
		created_at:      string;
		edited_at:       string | null;
		is_deleted:      boolean;
		reactions:       ReactionSummary[];
	};

	// ── State ─────────────────────────────────────────────────────────────────
	let selectedChannel = $state<Channel | null>(null);
	$effect(() => { if (!selectedChannel && localChannels.length > 0) selectedChannel = localChannels[0]; });
	let messages        = $state<Message[]>([]);
	let inputText       = $state('');
	let messagesEl      = $state<HTMLDivElement | null>(null);
	let isLoadingOld    = $state(false);
	let noMoreHistory   = $state(false);

	// Typing indicators
	type TypingEntry = { username: string; timer: ReturnType<typeof setTimeout> };
	let typingMap   = $state<Record<string, TypingEntry>>({});
	const typingUsers = $derived(Object.values(typingMap).map((e) => e.username));
	let typingThrottle: ReturnType<typeof setTimeout> | null = null;

	// Emoji picker
	const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '😮', '😢'];
	let pickerMsgId = $state<string | null>(null);

	// Inline edit
	let editingMsg = $state<{ id: string; content: string } | null>(null);

	// @mention autocomplete
	let mentionQuery       = $state('');
	let mentionSuggestions = $state<{ username: string; avatar: string | null }[]>([]);
	let showMentions       = $state(false);
	let mentionIndex       = $state(0);

	// Rich editor modal
	let showRichModal = $state(false);
	let richContent   = $state('');
	let editorKey     = $state(0);

	// ── Voice ─────────────────────────────────────────────────────────────────
	const voiceState    = $derived($voiceStore);
	const textChannels  = $derived(localChannels.filter((c: Channel) => (c as any).type !== 'voice'));
	const voiceChannels = $derived(localChannels.filter((c: Channel) => (c as any).type === 'voice'));
	let voiceError = $state<string | null>(null);
	let voiceChannelMembers = $state<Record<string, { userId: string; username: string; avatar: string | null; seatIndex?: number }[]>>({});

	const VOICE_ERRORS: Record<string, string> = {
		INSECURE: 'WebRTC exige HTTPS ou localhost. Accède via http://localhost:5173 sur ce PC, ou attends la mise en production avec Caddy (HTTPS).',
		DENIED:   'Microphone bloqué. Vérifier : 1) Paramètres Windows → Confidentialité → Microphone → autoriser les applis bureau ; 2) Icône ⓘ dans la barre d\'adresse → Paramètres du site → Microphone → Autoriser.',
		NOTFOUND: 'Aucun microphone détecté sur cet appareil.',
		BUSY:     'Microphone utilisé par une autre application. Fermez-la et réessayez.',
	};

	async function handleJoinVoice(ch: Channel) {
		if (!s) return;
		voiceError = null;
		// Switch main area view to this voice channel
		if (selectedChannel && (selectedChannel as any).type !== 'voice') {
			s.emit('chat:leave', selectedChannel.id);
		}
		selectedChannel = ch;
		messages = [];
		try {
			if (voiceState.channelId === ch.id) { leaveVoice(); return; }
			if (voiceState.active) leaveVoice();
			await joinVoice(ch.id, s);
		} catch (err: any) {
			voiceError = VOICE_ERRORS[err.message] ?? VOICE_ERRORS['DENIED'];
		}
	}

	// ── D&D reorder (admin only) ───────────────────────────────────────────────
	let dragSrcId = $state<string | null>(null);

	function onDragStart(e: DragEvent, ch: Channel) {
		dragSrcId = ch.id;
		e.dataTransfer!.effectAllowed = 'move';
		// Use text/plain (universal MIME type) — Edge rejects custom format names
		e.dataTransfer!.setData('text/plain', ch.id);
	}

	function onDragOver(e: DragEvent) {
		e.preventDefault();
		e.dataTransfer!.dropEffect = 'move';
	}

	async function onDrop(e: DragEvent, targetCh: Channel) {
		e.preventDefault();
		if (!dragSrcId || dragSrcId === targetCh.id) return;
		// Resolve source channel type from state — never rely on dataTransfer.getData for custom types
		const srcCh = localChannels.find((c: Channel) => c.id === dragSrcId);
		if (!srcCh) return;
		const srcType = (srcCh as any).type ?? 'text';
		const tgtType = (targetCh as any).type ?? 'text';
		if (srcType !== tgtType) return; // no cross-section drag

		const copy = localChannels.slice();
		const srcIdx = copy.findIndex((c: Channel) => c.id === dragSrcId);
		const tgtIdx = copy.findIndex((c: Channel) => c.id === targetCh.id);
		if (srcIdx === -1 || tgtIdx === -1) return;
		const [removed] = copy.splice(srcIdx, 1);
		copy.splice(tgtIdx, 0, removed);
		localChannels = copy;
		dragSrcId = null;

		// Persist optimistically
		try {
			const { PUBLIC_API_URL } = await import('$env/static/public');
			await fetch(`${PUBLIC_API_URL}/admin/channels/reorder`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					...(token ? { Authorization: `Bearer ${token}` } : {}),
				},
				body: JSON.stringify({ ids: localChannels.map((c: Channel) => c.id) }),
			});
		} catch { /* ignore, order will reset on next page load */ }
	}

	// ── Socket ────────────────────────────────────────────────────────────────
	let s: Socket | null = null;

	function joinChannel(channel: Channel) {
		if (!s) return;
		if (selectedChannel && selectedChannel.id !== channel.id) {
			s.emit('chat:leave', selectedChannel.id);
		}
		selectedChannel = channel;
		messages = [];
		noMoreHistory = false;
		pickerMsgId = null;
		editingMsg = null;
		s.emit('chat:join', channel.id);
	}

	function setupSocketListeners(sock: Socket) {
		s = sock;

		// Re-join on reconnect
		sock.on('connect', () => {
			if (selectedChannel) sock.emit('chat:join', selectedChannel.id);
		});

		sock.on('chat:history', ({ channelId, messages: hist }: { channelId: string; messages: Message[] }) => {
			if (channelId !== selectedChannel?.id) return;
			messages = hist.map(normalizeMsg);
			scrollToBottom();
		});

		sock.on('chat:message', (msg: Message) => {
			if (msg.channel_id !== selectedChannel?.id) return;
			messages = [...messages, normalizeMsg(msg)];
			scrollToBottom();
		});

		sock.on('chat:typing', ({ userId: uid, username }: { userId: string; username: string }) => {
			if (typingMap[uid]) clearTimeout(typingMap[uid].timer);
			const timer = setTimeout(() => {
				typingMap = Object.fromEntries(Object.entries(typingMap).filter(([k]) => k !== uid));
			}, 3000);
			typingMap = { ...typingMap, [uid]: { username, timer } };
		});

		sock.on('chat:reaction_update', ({ messageId, reactions }: { messageId: string; reactions: ReactionSummary[] }) => {
			messages = messages.map((m) => m.id === messageId ? { ...m, reactions } : m);
		});

		sock.on('chat:message_edited', ({ messageId, content, editedAt }: { messageId: string; content: string; editedAt: string }) => {
			messages = messages.map((m) => m.id === messageId ? { ...m, content, edited_at: editedAt } : m);
		});

		sock.on('chat:message_deleted', ({ messageId }: { messageId: string }) => {
			messages = messages.map((m) => m.id === messageId ? { ...m, is_deleted: true, content: null } : m);
		});

		sock.on('voice:channel_update', ({ channelId, members }: { channelId: string; members: { userId: string; username: string; avatar: string | null }[] }) => {
			voiceChannelMembers = { ...voiceChannelMembers, [channelId]: members };
		});

		// Demander un snapshot vocal immédiatement après avoir branché le listener.
		// Nécessaire quand le socket était déjà connecté (navigation SvelteKit) —
		// le snapshot initial a été envoyé avant le montage de ce composant.
		sock.emit('voice:request_snapshot');

		// Join first channel
		if (selectedChannel) sock.emit('chat:join', selectedChannel.id);
	}

	function normalizeMsg(msg: Message): Message {
		return { ...msg, reactions: msg.reactions ?? [], is_deleted: msg.is_deleted ?? false, edited_at: msg.edited_at ?? null };
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (!voiceState.pttMode) return;
		if (e.key === 'Alt' && !e.repeat) { e.preventDefault(); startPTT(); }
	}
	function handleGlobalKeyup(e: KeyboardEvent) {
		if (!voiceState.pttMode) return;
		if (e.key === 'Alt') stopPTT();
	}

	onMount(async () => {
		if (!browser) return;

		const existing = getSocket();
		if (existing) {
			setupSocketListeners(existing);
		} else {
			const unsub = socket.subscribe((sock) => {
				if (sock) { setupSocketListeners(sock); unsub(); }
			});
		}

		// Close picker on outside click
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', handleGlobalKeydown);
		document.addEventListener('keyup', handleGlobalKeyup);
	});

	onDestroy(() => {
		if (s && selectedChannel) s.emit('chat:leave', selectedChannel.id);
		if (typingThrottle) clearTimeout(typingThrottle);
		Object.values(typingMap).forEach((e) => clearTimeout(e.timer));
		if (browser) {
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', handleGlobalKeydown);
			document.removeEventListener('keyup', handleGlobalKeyup);
		}
	});

	function onDocClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-picker]')) pickerMsgId = null;
	}

	// ── Scroll ────────────────────────────────────────────────────────────────
	async function scrollToBottom() {
		await tick();
		if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	async function handleScroll() {
		if (!messagesEl || isLoadingOld || noMoreHistory || messages.length === 0) return;
		if (messagesEl.scrollTop > 80) return;

		isLoadingOld = true;
		const before    = messages[0]?.created_at;
		const prevHeight = messagesEl.scrollHeight;

		try {
			const { PUBLIC_API_URL } = await import('$env/static/public');
			const res = await fetch(
				`${PUBLIC_API_URL}/chat/channels/${selectedChannel?.id}/history?limit=50&before=${encodeURIComponent(before)}`,
				{ headers: token ? { Authorization: `Bearer ${token}` } : {} }
			);
			if (res.ok) {
				const { messages: older } = await res.json();
				if (older.length === 0) {
					noMoreHistory = true;
				} else {
					messages = [...older.map(normalizeMsg), ...messages];
					await tick();
					if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight - prevHeight;
				}
			}
		} catch { /* ignore */ }
		finally { isLoadingOld = false; }
	}

	// ── Send ──────────────────────────────────────────────────────────────────
	function sendMessage() {
		if (!s || !selectedChannel || !inputText.trim()) return;
		s.emit('chat:send', { channelId: selectedChannel.id, content: inputText.trim() });
		inputText = '';
		showMentions = false;
	}

	function sendRich() {
		if (!s || !selectedChannel || !richContent.trim()) return;
		s.emit('chat:send', { channelId: selectedChannel.id, content: richContent });
		richContent = '';
		editorKey++;
		showRichModal = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		// @mention navigation
		if (showMentions) {
			if (e.key === 'ArrowDown')  { e.preventDefault(); mentionIndex = Math.min(mentionIndex + 1, mentionSuggestions.length - 1); return; }
			if (e.key === 'ArrowUp')    { e.preventDefault(); mentionIndex = Math.max(mentionIndex - 1, 0); return; }
			if (e.key === 'Enter')      { e.preventDefault(); if (mentionSuggestions[mentionIndex]) selectMention(mentionSuggestions[mentionIndex].username); return; }
			if (e.key === 'Escape')     { showMentions = false; return; }
		}
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
		// Ctrl+Shift+E → open rich modal
		if (e.key === 'E' && e.ctrlKey && e.shiftKey) { e.preventDefault(); showRichModal = true; }
	}

	async function handleInput() {
		// Typing indicator (throttled)
		if (s && selectedChannel) {
			if (!typingThrottle) {
				s.emit('chat:typing', selectedChannel.id);
				typingThrottle = setTimeout(() => { typingThrottle = null; }, 2000);
			}
		}

		// @mention detection
		const textarea  = document.querySelector<HTMLTextAreaElement>('textarea#chat-input');
		const cursor    = textarea?.selectionStart ?? inputText.length;
		const textBefore = inputText.slice(0, cursor);
		const match      = textBefore.match(/@([\w\-]{0,30})$/);

		if (match && match[1].length >= 1) {
			mentionQuery = match[1];
			try {
				const { PUBLIC_API_URL } = await import('$env/static/public');
				const res = await fetch(`${PUBLIC_API_URL}/chat/members?q=${encodeURIComponent(mentionQuery)}`, {
					headers: token ? { Authorization: `Bearer ${token}` } : {}
				});
				if (res.ok) {
					mentionSuggestions = (await res.json()).members ?? [];
					showMentions = mentionSuggestions.length > 0;
					mentionIndex = 0;
				}
			} catch { showMentions = false; }
		} else {
			showMentions = false;
		}
	}

	function selectMention(username: string) {
		const textarea    = document.querySelector<HTMLTextAreaElement>('textarea#chat-input');
		const cursor      = textarea?.selectionStart ?? inputText.length;
		const textBefore  = inputText.slice(0, cursor);
		const textAfter   = inputText.slice(cursor);
		const replaced    = textBefore.replace(/@[\w\-]{0,30}$/, `@${username} `);
		inputText         = replaced + textAfter;
		showMentions      = false;
		// Re-focus textarea
		setTimeout(() => { textarea?.focus(); textarea?.setSelectionRange(replaced.length, replaced.length); }, 0);
	}

	// ── Reactions ─────────────────────────────────────────────────────────────
	function toggleEmojiPicker(msgId: string, e: MouseEvent) {
		e.stopPropagation();
		pickerMsgId = pickerMsgId === msgId ? null : msgId;
	}

	function reactTo(messageId: string, emoji: string) {
		if (!s) return;
		s.emit('chat:react', { messageId, emoji });
		pickerMsgId = null;
	}

	// ── Inline edit ───────────────────────────────────────────────────────────
	function startEdit(msg: Message) {
		// Strip HTML to plain text for editing
		const tmp = document.createElement('div');
		tmp.innerHTML = msg.content ?? '';
		editingMsg = { id: msg.id, content: tmp.textContent ?? '' };
	}

	function confirmEdit() {
		if (!s || !editingMsg?.content.trim()) return;
		s.emit('chat:edit', { messageId: editingMsg.id, content: editingMsg.content });
		editingMsg = null;
	}

	function handleEditKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); confirmEdit(); }
		if (e.key === 'Escape') { editingMsg = null; }
	}

	// ── Delete ────────────────────────────────────────────────────────────────
	function confirmDelete(messageId: string) {
		if (!s || !confirm('Supprimer ce message ?')) return;
		s.emit('chat:delete', { messageId });
	}

	// ── Format ───────────────────────────────────────────────────────────────
	function formatTime(iso: string): string {
		return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
	}

	function groupByDay(msgs: Message[]) {
		const groups: Array<{ day: string; messages: Message[] }> = [];
		for (const msg of msgs) {
			const day  = formatDate(msg.created_at);
			const last = groups.at(-1);
			if (last?.day === day) { last.messages.push(msg); }
			else { groups.push({ day, messages: [msg] }); }
		}
		return groups;
	}

	const messageGroups = $derived(groupByDay(messages));

	// ── Current user info (for voice room display) ─────────────────────────────
	const myUsername = $derived(((data as unknown as { user?: { username?: string } }).user?.username) ?? '');
	const myAvatar   = $derived(((data as unknown as { user?: { avatar?: string | null } }).user?.avatar) ?? null);

	function openVoiceMemberPanel(m: { username: string; avatar: string | null }) {
		if (m.username === myUsername) {
			voicePanelTarget.set({ type: 'self', username: myUsername, avatar: myAvatar })
		} else {
			const peer = voiceState.peers.find((p: any) => p.username === m.username)
			if (peer) voicePanelTarget.set({ type: 'peer', socketId: peer.socketId })
		}
	}

</script>

<svelte:head><title>Chat — Nexus</title></svelte:head>

<!-- Full-height layout -->
<div class="fixed top-14 bottom-0 lg:left-[220px] xl:right-[220px] left-0 right-0 flex overflow-hidden bg-gray-950 border-l border-gray-800 z-10">

	<!-- ── Channel sidebar ──────────────────────────────────────────────────── -->
	<aside class="w-56 shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col">
		<div class="h-12 flex items-center px-4 border-b border-gray-800">
			<span class="text-xs font-semibold text-gray-500 uppercase tracking-wider">Canaux</span>
		</div>
		<nav class="flex-1 overflow-y-auto py-2 px-2 custom-scrollbar">
			<!-- Canaux texte -->
			{#if textChannels.length > 0}
				<p class="px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Texte</p>
				<div class="space-y-0.5 mb-3">
					{#each textChannels as ch (ch.id)}
						<button
							onclick={() => joinChannel(ch)}
							draggable={isAdmin}
							ondragstart={isAdmin ? (e) => onDragStart(e, ch) : undefined}
							ondragover={isAdmin ? onDragOver : undefined}
							ondrop={isAdmin ? (e) => onDrop(e, ch) : undefined}
							class="w-full text-left flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors
							       {isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}
							       {selectedChannel?.id === ch.id ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}"
						>
							<span class="text-gray-500">#</span>
							<span class="truncate">{ch.slug}</span>
						</button>
					{/each}
				</div>
			{/if}

			<!-- Canaux vocaux -->
			{#if voiceChannels.length > 0}
				<p class="px-2 pt-1 pb-1 text-[10px] uppercase tracking-widest text-gray-600 font-semibold">Vocal</p>
				<div class="space-y-0.5">
					{#each voiceChannels as ch (ch.id)}
						{@const inThisChannel = voiceState.channelId === ch.id}
						<button
							onclick={() => handleJoinVoice(ch)}
							draggable={isAdmin}
							ondragstart={isAdmin ? (e) => onDragStart(e, ch) : undefined}
							ondragover={isAdmin ? onDragOver : undefined}
							ondrop={isAdmin ? (e) => onDrop(e, ch) : undefined}
							class="w-full text-left flex items-center gap-1.5 px-2.5 py-1.5 rounded text-sm transition-colors
							       {isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}
							       {inThisChannel ? 'bg-green-900/40 text-green-300 border border-green-800/40' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}"
							title={inThisChannel ? 'Quitter le salon vocal' : 'Rejoindre le salon vocal'}
						>
							<span class="text-base leading-none">{inThisChannel ? '🔴' : '🔊'}</span>
							<span class="truncate flex-1">{ch.name}</span>
							{#if inThisChannel}
								<span class="text-[10px] text-green-400 shrink-0">En ligne</span>
							{/if}
						</button>
						{@const members = inThisChannel
								? [
										...voiceState.peers.map((p: any) => ({ username: p.username, avatar: p.avatar ?? null, speaking: p.speaking ?? false })),
										{ username: myUsername || 'Vous', avatar: myAvatar ?? null, speaking: voiceState.mySpeaking },
									]
								: (voiceChannelMembers[ch.id] ?? []).map((m: any) => ({ ...m, speaking: false }))}
						{#if members.length > 0}
							<div class="flex flex-col gap-0.5 pl-6 pt-0.5 pb-1.5">
								{#each members.slice(0, 6) as m}
									{@const isMe = m.username === myUsername}
									{@const isInVoice = inThisChannel}
									<button
										onclick={() => isInVoice ? openVoiceMemberPanel(m) : undefined}
										class="flex items-center gap-1.5 w-full text-left rounded px-1 py-0.5 -mx-1 transition-colors
										       {isInVoice ? 'hover:bg-gray-800/60 cursor-pointer' : 'cursor-default'}"
										title={isInVoice ? (isMe ? 'Voir mes stats audio' : `Voir les stats de ${m.username}`) : m.username}
									>
										{#if m.avatar}
											<img src={m.avatar} alt={m.username} class="w-4 h-4 rounded-full object-cover shrink-0 {m.speaking ? 'ring-1 ring-green-400' : ''}" />
										{:else}
											<div class="w-4 h-4 rounded-full bg-indigo-700 flex items-center justify-center text-[8px] font-bold text-white shrink-0 {m.speaking ? 'ring-1 ring-green-400' : ''}">
												{m.username.charAt(0).toUpperCase()}
											</div>
										{/if}
										<span class="text-xs truncate leading-tight {isMe ? 'text-green-400' : 'text-gray-400'}">
											{m.username}{isMe ? ' (vous)' : ''}
										</span>
										{#if isInVoice}
											<svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5 text-gray-700 shrink-0 ml-auto opacity-0 group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
											</svg>
										{/if}
									</button>
								{/each}
								{#if members.length > 6}
									<span class="text-[10px] text-gray-600 pl-5">+{members.length - 6} autres</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			{/if}

			{#if localChannels.length === 0}
				<p class="px-3 py-2 text-xs text-gray-600 italic">Aucun canal</p>
			{/if}
		</nav>

		<!-- Erreur micro -->
		{#if voiceError}
			<div class="mx-2 mb-2 p-2.5 rounded-lg bg-red-900/30 border border-red-800/40 text-xs text-red-300 leading-relaxed">
				<div class="flex items-start gap-1.5">
					<span class="shrink-0 mt-0.5">🎙️</span>
					<div>
						<p class="font-medium mb-1">Micro inaccessible</p>
						<p>{voiceError}</p>
					</div>
				</div>
				<button onclick={() => voiceError = null} class="mt-2 text-[10px] text-red-500 hover:text-red-300 underline">Fermer</button>
			</div>
		{/if}

		<!-- Voice controls (sidebar footer Discord-style) -->
		<VoicePanel mode="sidebar" />
	</aside>

	<!-- ── Main chat area ───────────────────────────────────────────────────── -->
	<div class="flex-1 flex flex-col min-w-0">

		{#if selectedChannel}

			{#if (selectedChannel as any).type === 'voice'}
				<!-- ── Voice room view ───────────────────────────────────────────── -->
				<div class="h-12 shrink-0 border-b border-gray-800 bg-gray-900/50 flex items-center gap-2 px-4">
					<span class="text-xl">🔊</span>
					<span class="font-semibold text-white">{selectedChannel.name}</span>
					{#if selectedChannel.description}
						<span class="text-gray-500 text-sm hidden sm:inline">— {selectedChannel.description}</span>
					{/if}
				</div>

				<div class="flex-1 flex flex-col items-center justify-center gap-6 px-4">
					{#if voiceState.active && voiceState.channelId === selectedChannel.id}
						<p class="text-xs text-green-400 flex items-center gap-1.5">
							<span class="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0"></span>
							Vocal actif · {voiceState.peers.length + 1} connecté{voiceState.peers.length > 0 ? 's' : ''}
						</p>

						<!-- ── Table Ronde ── -->
						{@const mySeat = voiceState.mySeatIndex ?? 0}
						{@const R = 108}
						<!-- Trier les seatIndex pour gérer les indices non-contigus après qu'un user quitte.
						     Ex: seats 0 et 2 avec totalSeats=2 → (2-0+2)%2 = 0 → superposition.
						     La solution: positionner selon l'ordre dans la liste triée, pas la valeur absolue. -->
						{@const allSeatsSorted = [...new Set([mySeat, ...voiceState.peers.map(p => p.seatIndex)])].sort((a, b) => a - b)}
						{@const totalSeats = allSeatsSorted.length}
						{@const myPosIdx = allSeatsSorted.indexOf(mySeat)}

						<div class="relative mx-auto select-none" style="width:288px;height:288px;">
							<!-- Table circulaire -->
							<div class="absolute inset-6 rounded-full border border-gray-700/40 bg-gray-900/20 flex items-center justify-center">
								<span class="text-xs text-gray-700">{selectedChannel.name}</span>
							</div>

							<!-- Mon avatar (relSeat = 0 → bas, 6 o'clock) — sin(0)=0, cos(0)*108=108 -->
							<div class="absolute flex flex-col items-center gap-1"
								style="left:calc(50% + 0px - 28px);top:calc(50% + {R}px - 28px);">
								{#if myAvatar}
									<img src={myAvatar} alt={myUsername}
										class="w-14 h-14 rounded-full object-cover ring-2 transition-all {voiceState.muted ? 'ring-gray-700' : voiceState.mySpeaking ? 'ring-green-400 ring-offset-2 ring-offset-gray-950' : 'ring-gray-600'}" />
								{:else}
									<div class="w-14 h-14 rounded-full bg-indigo-700 flex items-center justify-center text-lg font-bold text-white ring-2 transition-all {voiceState.muted ? 'ring-gray-700' : voiceState.mySpeaking ? 'ring-green-400 ring-offset-2 ring-offset-gray-950' : 'ring-gray-600'}">
										{(myUsername || 'M').charAt(0).toUpperCase()}
									</div>
								{/if}
								<span class="text-[10px] text-gray-400">Vous{voiceState.muted ? ' 🔇' : ''}</span>
							</div>

							<!-- Peers -->
							{#each voiceState.peers as peer (peer.socketId)}
								{@const peerPosIdx = allSeatsSorted.indexOf(peer.seatIndex)}
								{@const relPos    = ((peerPosIdx - myPosIdx) + totalSeats) % totalSeats}
								{@const angle     = relPos / totalSeats * 2 * Math.PI}
								{@const px = Math.sin(angle) * R}
								{@const py = Math.cos(angle) * R}
								<div class="absolute flex flex-col items-center gap-1"
									style="left:calc(50% + {px}px - 28px);top:calc(50% + {py}px - 28px);">
									{#if peer.avatar}
										<img src={peer.avatar} alt={peer.username}
											
											class="w-14 h-14 rounded-full object-cover ring-2 transition-all {peer.speaking ? 'ring-green-400 ring-offset-2 ring-offset-gray-950 speaking-active' : 'ring-gray-700'}"/>
									{:else}
										<div class="w-14 h-14 rounded-full bg-indigo-700 flex items-center justify-center text-lg font-bold text-white ring-2 transition-all {peer.speaking ? 'ring-green-400 ring-offset-2 ring-offset-gray-950' : 'ring-gray-700'}">
											{peer.username.charAt(0).toUpperCase()}
										</div>
									{/if}
									<span class="text-[10px] text-gray-400 truncate max-w-[60px]">{peer.username}</span>
									{#if peer.iceState && peer.iceState !== 'connected' && peer.iceState !== 'completed'}
										<span class="text-[10px] px-1 py-0.5 rounded {peer.iceState === 'failed' || peer.iceState === 'disconnected' ? 'bg-red-900/50 text-red-400' : 'bg-yellow-900/50 text-yellow-400'}">
											{peer.iceState}
										</span>
									{/if}
									<input type="range" min="0" max="200" value="100"
										class="w-12 h-1 accent-indigo-500"
										title="Volume"
										oninput={(e) => setPeerVolume(peer.socketId, parseInt((e.currentTarget as HTMLInputElement).value) / 100)}
									/>
								</div>
							{/each}
						</div>

						{#if voiceState.peers.length === 0}
							<p class="text-sm text-gray-600">Personne d'autre n'est connecté pour le moment.</p>
						{/if}
					{:else}
						<!-- Not joined yet -->
						<div class="flex flex-col items-center gap-4 text-gray-500">
							<span class="text-7xl opacity-20 select-none">🔊</span>
							<p class="text-sm">Vous n'êtes pas connecté à ce salon vocal.</p>
							<button
								onclick={() => handleJoinVoice(selectedChannel!)}
								class="px-6 py-2.5 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-semibold transition-colors flex items-center gap-2"
							>
								<span>🎙️</span> Rejoindre le vocal
							</button>
						</div>
					{/if}
				</div>

			{:else}
				<!-- ── Text chat ──────────────────────────────────────────────────── -->
				<!-- Header -->
				<div class="h-12 shrink-0 border-b border-gray-800 bg-gray-900/50 flex items-center gap-2 px-4">
					<span class="text-gray-500 font-mono">#</span>
					<span class="font-semibold text-white">{selectedChannel.name}</span>
					{#if selectedChannel.description}
						<span class="text-gray-500 text-sm hidden sm:inline">— {selectedChannel.description}</span>
					{/if}
				</div>

			<!-- Messages -->
			<div
                class="flex-1 overflow-y-auto px-4 py-4 space-y-1 custom-scrollbar"
                bind:this={messagesEl}
                onscroll={handleScroll}
            >
				{#if isLoadingOld}
					<p class="text-center text-xs text-gray-600 py-2">Chargement…</p>
				{/if}
				{#if noMoreHistory && messages.length > 0}
					<p class="text-center text-xs text-gray-700 py-2">— Début de l'historique —</p>
				{/if}

				{#each messageGroups as group (group.day)}
					<!-- Day separator -->
					<div class="flex items-center gap-2 my-3">
						<div class="flex-1 h-px bg-gray-800"></div>
						<span class="text-xs text-gray-600 shrink-0">{group.day}</span>
						<div class="flex-1 h-px bg-gray-800"></div>
					</div>

					{#each group.messages as msg, i (msg.id)}
    				{@const prevMsg = group.messages[i - 1]}
    				{@const isSameAuthor = prevMsg && prevMsg.author_id === msg.author_id}
    				{@const timeDiff = prevMsg ? (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()) / 1000 / 60 : 0}
    				{@const shouldGroup = isSameAuthor && timeDiff < 5 && !msg.is_deleted && !prevMsg.is_deleted}
						<div class="group message-row flex items-start gap-4 px-3 py-1 rounded-xl transition-all relative hover:bg-white/[0.02] {shouldGroup ? 'mt-0' : 'mt-4'}">
    <div class="w-10 shrink-0 flex justify-center pt-1">
        {#if !shouldGroup}
            {#if msg.author_avatar}
                <img
                    src={msg.author_avatar}
                    alt={msg.author_username}
                    class="w-10 h-10 rounded-2xl object-cover shadow-xl border border-white/5"
                />
            {:else}
                <div class="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 flex items-center justify-center font-black text-[10px] text-white shadow-lg border border-white/10 select-none">
                    {msg.author_username.charAt(0).toUpperCase()}
                </div>
            {/if}
        {:else}
            <span class="text-[9px] font-black text-gray-700 opacity-0 group-hover:opacity-100 transition-opacity pt-2 select-none">
                {formatTime(msg.created_at)}
            </span>
        {/if}
    </div>

    <div class="min-w-0 flex-1">
        {#if !shouldGroup}
            <div class="flex items-baseline gap-2 mb-1">
                <span class="text-sm font-black text-white hover:text-indigo-400 cursor-pointer transition-colors leading-none">
                    {msg.author_username}
                </span>
                <span class="text-[10px] text-gray-600 font-bold uppercase tracking-tighter">
                    {formatTime(msg.created_at)}
                </span>
                {#if msg.edited_at && !msg.is_deleted}
                    <span class="text-[10px] text-gray-700 font-black uppercase tracking-tighter italic">(modifié)</span>
                {/if}
            </div>
        {/if}

        {#if msg.is_deleted}
            <div class="flex items-center gap-3 py-2 px-4 bg-red-950/20 border border-red-900/30 rounded-xl max-w-fit my-1 shadow-lg shadow-red-900/5">
                <div class="w-7 h-7 bg-red-600 rounded-lg flex items-center justify-center text-sm shadow-lg shadow-red-900/40">🤖</div>
                <div class="flex flex-col">
                    <span class="text-[9px] font-black text-red-500 uppercase tracking-widest leading-none mb-0.5">Nexus Guard Protocol</span>
                    <em class="text-xs text-red-300/60 not-italic font-bold tracking-tight">Transmission neutralisée : Contenu toxique détecté</em>
                </div>
            </div>
        {:else if editingMsg?.id === msg.id}
            <div class="bg-gray-800 p-2 rounded-xl border border-indigo-500/50 mt-1 shadow-2xl">
                <textarea
                    class="w-full bg-transparent text-sm text-white outline-none resize-none custom-scrollbar"
                    rows={2}
                    bind:value={editingMsg.content}
                    onkeydown={handleEditKeydown}
                ></textarea>
                <div class="flex justify-end gap-2 mt-2">
                    <button onclick={() => { editingMsg = null }} class="text-[10px] font-black text-gray-500 hover:text-white uppercase tracking-widest">Annuler</button>
                    <button onclick={confirmEdit} class="text-[10px] font-black text-indigo-400 hover:text-indigo-300 uppercase tracking-widest underline">Valider</button>
                </div>
            </div>
        {:else}
            <div class="nexus-prose text-sm text-gray-300 leading-relaxed break-words">
                {@html msg.content}
                {#if shouldGroup && msg.edited_at}
                    <span class="text-[9px] text-gray-700 font-black uppercase ml-2">(modifié)</span>
                {/if}
            </div>
        {/if}

        {#if msg.reactions && msg.reactions.length > 0 && !msg.is_deleted}
            <div class="flex flex-wrap gap-1.5 mt-2">
                {#each msg.reactions as r (r.emoji)}
                    <button
                        onclick={() => reactTo(msg.id, r.emoji)}
                        class="flex items-center gap-2 px-2.5 py-1 rounded-lg border transition-all text-[11px] font-black
                               {r.userReactedIds.includes(userId) ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300 shadow-lg shadow-indigo-500/10 scale-105' : 'border-gray-800 bg-gray-800/40 text-gray-500 hover:border-gray-500'}"
                    >
                        <span>{r.emoji}</span>
                        <span class="text-[10px]">{r.count}</span>
                    </button>
                {/each}
            </div>
        {/if}
    </div>

    {#if !msg.is_deleted}
        <div class="hidden group-hover:flex gap-1 absolute right-4 -top-3.5 bg-gray-900 border border-gray-800 rounded-xl px-1.5 py-1 shadow-2xl z-20">
            <div data-picker class="relative">
                <button
                    onclick={(e) => toggleEmojiPicker(msg.id, e)}
                    class="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors text-sm"
                    title="Réagir"
                >😀</button>
                {#if pickerMsgId === msg.id}
                    <div
                        data-picker
                        class="absolute right-0 bottom-full mb-2 flex gap-1 bg-gray-800 border border-gray-700 rounded-xl px-2 py-2 shadow-2xl z-30 animate-in fade-in slide-in-from-bottom-2"
                    >
                        {#each QUICK_EMOJIS as emoji}
                            <button
                                onclick={() => reactTo(msg.id, emoji)}
                                class="text-xl hover:scale-125 transition-transform p-1"
                            >{emoji}</button>
                        {/each}
                    </div>
                {/if}
            </div>
            {#if msg.author_id === userId || isAdmin}
                <div class="w-px h-4 bg-gray-800 self-center mx-1"></div>
                <button
                    onclick={() => startEdit(msg)}
                    class="p-1.5 rounded-lg text-gray-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors text-xs"
                    title="Modifier"
                >✏️</button>
                <button
                    onclick={() => confirmDelete(msg.id)}
                    class="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-xs"
                    title="Supprimer"
                >🗑️</button>
            {/if}
        </div>
    {/if}
</div>
					{/each}
				{/each}

				{#if messages.length === 0}
					<p class="text-center text-gray-600 text-sm mt-8">Aucun message. Soyez le premier !</p>
				{/if}
			</div>

			<!-- Typing indicator -->
			{#if typingUsers.length > 0}
				<div class="px-4 pb-1 text-xs text-gray-500 italic h-5">
					{#if typingUsers.length === 1}
						{typingUsers[0]} est en train d'écrire…
					{:else if typingUsers.length === 2}
						{typingUsers[0]} et {typingUsers[1]} sont en train d'écrire…
					{:else}
						Plusieurs personnes écrivent…
					{/if}
				</div>
			{:else}
				<div class="h-5"></div>
			{/if}

			<!-- Input area -->
			<div class="px-4 pb-4 shrink-0">
				<!-- @mention dropdown -->
				{#if showMentions && mentionSuggestions.length > 0}
					<div class="relative">
						<div class="absolute bottom-full left-0 mb-1 w-56 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden z-20">
							{#each mentionSuggestions as m, i}
								<button
									onclick={() => selectMention(m.username)}
									class="w-full text-left flex items-center gap-2 px-3 py-2 text-sm transition-colors
									       {i === mentionIndex ? 'bg-indigo-700 text-white' : 'text-gray-300 hover:bg-gray-700'}"
								>
									<span class="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
										{m.username.charAt(0).toUpperCase()}
									</span>
									@{m.username}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				<div class="flex gap-2 bg-gray-800 rounded-lg border border-gray-700 focus-within:border-indigo-600 transition-colors">
					<textarea
						id="chat-input"
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 resize-none outline-none max-h-32"
						placeholder="Message #{selectedChannel.slug}"
						rows={1}
						maxlength={2000}
						bind:value={inputText}
						onkeydown={handleKeydown}
						oninput={handleInput}
					></textarea>
					<!-- Rich editor button -->
					<button
						onclick={() => { showRichModal = true; }}
						class="px-2 py-2 m-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors shrink-0 text-sm"
						title="Éditeur riche (Ctrl+Maj+E)"
					>✏️</button>
					<button
						onclick={sendMessage}
						disabled={!inputText.trim()}
						class="px-3 py-2 m-1.5 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
					>
						Envoyer
					</button>
				</div>
				<p class="text-xs text-gray-700 mt-1">Entrée pour envoyer · Maj+Entrée pour saut de ligne · Ctrl+Maj+E pour l'éditeur riche</p>
			</div>

			{/if}<!-- end voice/text branch -->

		{:else}
			<!-- No channel -->
			<div class="flex-1 flex items-center justify-center flex-col gap-3 text-gray-600">
				<span class="text-5xl">💬</span>
				<p class="text-sm">Aucun canal disponible pour le moment.</p>
				<p class="text-xs">Un admin peut en créer depuis le panneau Administration → Canaux texte.</p>
			</div>
			
		{/if}
	</div>
</div>

<!-- ── Rich editor modal ───────────────────────────────────────────────────── -->
{#if showRichModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
    class="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
    role="presentation"
    onclick={(e) => { if (e.target === e.currentTarget) showRichModal = false; }}
    onkeydown={(e) => { if (e.key === 'Escape') showRichModal = false; }}
>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]"
		 onclick={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between px-6 py-4 border-b border-gray-800">
			 
			
				<h2 class="text-lg font-semibold text-white">Composer un message riche</h2>
				<button onclick={() => { showRichModal = false; }} class="text-gray-400 hover:text-white text-xl leading-none">×</button>
			</div>
			
			
			<div class="flex-1 overflow-y-auto p-4">
				{#key editorKey}
					<NexusEditor
						compact={false}
						onchange={(v) => { richContent = v; }}
					/>
				{/key}
			</div>
			<div class="px-6 py-4 border-t border-gray-800 flex justify-end gap-3">
				<button onclick={() => { showRichModal = false; }} class="px-4 py-2 rounded bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors">
					Annuler
				</button>
				<button
					onclick={sendRich}
					disabled={!richContent.trim()}
					class="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-sm text-white font-medium transition-colors"
				>
					Envoyer
				</button>
			</div>
		</div>
	</div>

	
{/if}

<style>

	.message-row {
    border-left: 3px solid transparent;
    transition: all 0.2s ease;
	}
	
	.message-row:hover {
    border-left-color: #6366f1; /* Indigo */
    background: linear-gradient(to right, rgba(99, 102, 241, 0.05), transparent);
	}	

    /* Style pour le contenu des messages (Rich Text) */
    :global(.nexus-prose) {
        line-height: 1.6;
        color: #d1d5db; /* gray-300 */
    }

    :global(.nexus-prose p) {
        margin-bottom: 0.5rem;
    }

    :global(.nexus-prose strong) {
        color: #ffffff;
        font-weight: 700;
    }

    /* Scrollbar ultra-fine et stylisée pour le look "Nexus" */
    /* SCROLLBAR CUSTOM - On force le style pour écraser Windows */
    .custom-scrollbar {
        scrollbar-width: thin;
        scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
    }

    /* Pour Chrome, Edge, Safari */
    .custom-scrollbar::-webkit-scrollbar {
        width: 6px !important;
    }

    .custom-scrollbar::-webkit-scrollbar-track {
        background: transparent !important;
    }

    .custom-scrollbar::-webkit-scrollbar-thumb {
        background-color: rgba(255, 255, 255, 0.1) !important;
        border-radius: 20px !important;
    }

    .custom-scrollbar:hover::-webkit-scrollbar-thumb {
        background-color: rgba(99, 102, 241, 0.4) !important;
    }

    /* 3. On l'illumine un peu au survol pour le côté Nexus */
    .custom-scrollbar:hover::-webkit-scrollbar-thumb {
        background-color: rgba(99, 102, 241, 0.4); /* Indigo translucide */
    }
    /* Animation de pulsation pour le vocal */
    @keyframes pulse-subtle {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.7; transform: scale(1.05); }
    }

/* Animation de pulsation pour le vocal */
@keyframes breath {
    0%, 100% {
        transform: scale(1);
        filter: brightness(1);
    }
    50% {
        transform: scale(1.03);
        filter: brightness(1.2);
    }
}

@keyframes sound-wave {
    0% {
        opacity: 0.7;
        transform: translate(-50%, -50%) scale(1);
    }
    100% {
        opacity: 0;
        transform: translate(-50%, -50%) scale(2.2);
    }
}

.speaking-active {
    position: relative;
    animation: breath 2s infinite ease-in-out;
    z-index: 2;  /* L'avatar au-dessus */
}

.speaking-active::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(222, 74, 215, 0.6) 0%, transparent 70%);
    animation: sound-wave 1.5s infinite;
    pointer-events: none;
    z-index: 1;  /* L'onde juste derrière l'avatar */
}
</style>
