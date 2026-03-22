<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import type { PageData } from './$types';
	import { socket, getSocket } from '$lib/socket';
	import { linkifyHtml } from '$lib/linkify';
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import ChannelSidebar from '$lib/components/ChannelSidebar.svelte';
	import PollCard    from '$lib/components/PollCard.svelte';
	import PollCreator from '$lib/components/PollCreator.svelte';
	import VoiceRoom from '$lib/components/VoiceRoom.svelte';
	import { joinVoice, leaveVoice, voiceStore, startPTT, stopPTT } from '$lib/voice';
	import type { Socket } from 'socket.io-client';
	import { voicePanelTarget } from '$lib/voicePanel';
	import { p2pManager, p2pStatus, p2pPeerCount, p2pFallback } from '$lib/p2p';
	import MiniProfileCard from '$lib/components/MiniProfileCard.svelte';
	import { buildNameStyle, buildAnimClass, ensureFontLoaded } from '$lib/nameEffects';

	let { data }: { data: PageData } = $props();

	let localChannels = $state<any[]>([]);
	$effect(() => { localChannels = (data.channels ?? []).slice(); });

	// data.user comes from layout — cast through unknown to extract id safely
	const userId          = $derived(((data as unknown as { user?: { id?: string } }).user?.id) ?? '');
	const currentUsername = $derived(((data as unknown as { user?: { username?: string } }).user?.username) ?? '');
	const token     = $derived(data.token as string | null);
	const isAdmin   = $derived(
		((data as any)?.user?.role === 'owner' || (data as any)?.user?.role === 'admin')
	);

	// ── Types ─────────────────────────────────────────────────────────────────
	type Channel = (typeof localChannels)[number];
	type ReactionSummary = { emoji: string; count: number; userReactedIds: string[] };
	type Message = {
		id:                   string;
		channel_id:           string;
		author_id:            string;
		author_username:      string;
		author_avatar:        string | null;
		author_name_color:        string | null;
		author_name_glow:         string | null;
		author_name_glow_intensity: number | null;
		author_name_animation:    string | null;
		author_name_font_family:  string | null;
		author_name_font_url:     string | null;
		content:              string | null;
		created_at:           string;
		edited_at:            string | null;
		is_deleted:           boolean;
		reactions:            ReactionSummary[];
		reply_to_id?:         string | null;
		reply_to_username?:   string | null;
		reply_to_content?:    string | null;
		poll_id?:             string | null;
		poll?:                any;
	};

	// ── State ─────────────────────────────────────────────────────────────────
	let selectedChannel = $state<Channel | null>(null);
	$effect(() => { if (!selectedChannel && localChannels.length > 0) selectedChannel = localChannels[0]; });
	let messages        = $state<Message[]>([]);
	// Ensure custom fonts are loaded whenever messages change
	$effect(() => {
		for (const m of messages) {
			if (m.author_name_font_family && m.author_name_font_url) {
				ensureFontLoaded(m.author_name_font_family, m.author_name_font_url)
			}
		}
	});
	let inputText       = $state('');
	let messagesEl      = $state<HTMLDivElement | null>(null);
	let isLoadingOld    = $state(false);
	let noMoreHistory   = $state(false);

	// Typing indicators
	type TypingEntry = { username: string; timer: ReturnType<typeof setTimeout> };
	let typingMap   = $state<Record<string, TypingEntry>>({});
	const typingUsers = $derived(Object.values(typingMap).map((e) => e.username));
	let typingThrottle: ReturnType<typeof setTimeout> | null = null;

	// Anti-spam cooldown
	let rateLimitedUntil = $state(0);
	const isRateLimited  = $derived(rateLimitedUntil > Date.now());
	let rateLimitTimer: ReturnType<typeof setInterval> | null = null;

	// Content filter feedback
	let blockedNotice = $state<string | null>(null);
	let blockedTimer: ReturnType<typeof setTimeout> | null = null;

	// Emoji picker
	let pickerMsgId    = $state<string | null>(null);
	// P2P reaction flash — messageId → Set of emojis currently animating
	let reactionFlash  = $state(new Map<string, Set<string>>());

	// GIF picker
	let showGifPicker   = $state(false);
	let gifQuery        = $state('');
	let gifResults      = $state<{ id: string; preview: string; url: string }[]>([]);
	let gifLoading      = $state(false);
	let gifTimer: ReturnType<typeof setTimeout> | null = null;
	// Computed once at mount — which GIF provider is configured
	let gifProvider     = $state<'tenor' | 'giphy' | null>(null);

	// Mobile long-press
	let longPressMsg    = $state<string | null>(null);
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;

	// Inline edit
	let editingMsg = $state<{ id: string; content: string } | null>(null);

	// @mention autocomplete
	let mentionQuery       = $state('');
	let mentionSuggestions = $state<{ username: string; avatar: string | null }[]>([]);
	let showMentions       = $state(false);
	let mentionIndex       = $state(0);

	// Reply/quote
	let replyTo = $state<{ id: string; author_username: string; content: string } | null>(null);

	// Pinned message
	let pinnedMessage = $state<Message | null>(null);
	let showPinned    = $state(true);

	// Link preview cache: url → preview data
	type LinkPreview = { url: string; title: string | null; description: string | null; image: string | null; siteName: string | null };
	let linkPreviews = $state(new Map<string, LinkPreview | false>());

	// Rich editor modal
	let showRichModal = $state(false);
	let richContent   = $state('');
	let editorKey     = $state(0);

	// Poll creator
	let showPollCreator = $state(false);

	// Mini profile popup
	let profilePopupUsername = $state<string | null>(null);
	let profilePopupAnchor   = $state<HTMLElement | null>(null);

	function openProfilePopup(e: MouseEvent, username: string) {
		profilePopupAnchor   = e.currentTarget as HTMLElement;
		profilePopupUsername = username;
	}

	// ── Voice ─────────────────────────────────────────────────────────────────
	const voiceState    = $derived($voiceStore);
	const textChannels  = $derived(localChannels.filter((c: Channel) => (c as any).type !== 'voice'));
	const voiceChannels = $derived(localChannels.filter((c: Channel) => (c as any).type === 'voice'));
	// Channel where the canvas session recap will be posted (prefer selected text channel)
	const canvasRecapChannelId = $derived(
		selectedChannel && (selectedChannel as any).type !== 'voice'
			? selectedChannel.id
			: (textChannels[0]?.id ?? null)
	);
	let voiceError = $state<string | null>(null);
	let voiceChannelMembers = $state<Record<string, { userId: string; username: string; avatar: string | null; seatIndex?: number }[]>>({});

	const VOICE_ERRORS: Record<string, string> = {
		INSECURE: 'WebRTC exige HTTPS ou localhost. Accède via http://localhost:5173 sur ce PC, ou attends la mise en production avec Caddy (HTTPS).',
		DENIED:   'Microphone bloqué. Vérifier : 1) Paramètres Windows → Confidentialité → Microphone → autoriser les applis bureau ; 2) Icône ⓘ dans la barre d\'adresse → Paramètres du site → Microphone → Autoriser.',
		NOTFOUND: 'Aucun microphone détecté sur cet appareil.',
		BUSY:     'Microphone utilisé par une autre application. Fermez-la et réessayez.',
	};

	// Sélectionner un salon vocal (sidebar) — ne connecte pas, ne déconnecte pas
	function handleJoinVoice(ch: Channel) {
		drawerOpen = false;
		if (!s) return;
		voiceError = null;
		if (selectedChannel && (selectedChannel as any).type !== 'voice') {
			s.emit('chat:leave', selectedChannel.id);
		}
		selectedChannel = ch;
		messages = [];
	}

	// Rejoindre explicitement le salon sélectionné (bouton dans la Table)
	async function joinCurrentVoiceChannel() {
		if (!s || !selectedChannel) return;
		const ch = selectedChannel;
		try {
			if (voiceState.channelId === ch.id) return;  // déjà connecté
			if (voiceState.active) leaveVoice();
			await joinVoice(ch.id, s);
		} catch (err: any) {
			voiceError = VOICE_ERRORS[err.message] ?? VOICE_ERRORS['DENIED'];
		}
	}

	// ── Mobile drawer ─────────────────────────────────────────────────────────
	let drawerOpen = $state(false)

	// Bloque le scroll quand le drawer est ouvert
	$effect(() => {
		if (!browser) return
		if (drawerOpen) {
			document.body.classList.add('no-scroll')
		} else {
			document.body.classList.remove('no-scroll')
		}
		return () => document.body.classList.remove('no-scroll')
	})

	// ── Socket ────────────────────────────────────────────────────────────────
	let s = $state<Socket | null>(null);

	function joinChannel(channel: Channel) {
		drawerOpen = false;
		if (!s) return;
		if (selectedChannel && selectedChannel.id !== channel.id) {
			s.emit('chat:leave', selectedChannel.id);
		}
		selectedChannel = channel;
		messages = [];
		noMoreHistory = false;
		pickerMsgId = null;
		editingMsg = null;
		replyTo = null;
		pinnedMessage = null;
		showPinned = true;
		s.emit('chat:join', channel.id);
		// P2P — join the DataChannel pool for this text channel
		if ((channel as any).type !== 'voice') p2pManager.joinChannel(channel.id);
	}

	function setupSocketListeners(sock: Socket) {
		s = sock;
		// P2P — attach to the existing Socket.IO instance
		p2pManager.init(sock);

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

		sock.on('chat:pinned', ({ channelId, message }: { channelId: string; message: Message | null }) => {
			if (channelId !== selectedChannel?.id) return;
			pinnedMessage = message;
			showPinned = true;
		});

		sock.on('chat:blocked', ({ reason }: { reason: string }) => {
			blockedNotice = reason ?? 'Message refusé : contenu interdit';
			if (blockedTimer) clearTimeout(blockedTimer);
			blockedTimer = setTimeout(() => { blockedNotice = null; }, 5000);
		});

		sock.on('chat:rate_limited', ({ retryAfter }: { retryAfter: number }) => {
			rateLimitedUntil = Date.now() + retryAfter;
			if (rateLimitTimer) clearInterval(rateLimitTimer);
			// Force reactivity re-check every second so the countdown updates
			rateLimitTimer = setInterval(() => {
				if (Date.now() >= rateLimitedUntil) {
					if (rateLimitTimer) clearInterval(rateLimitTimer);
					rateLimitTimer = null;
					rateLimitedUntil = 0;
				}
			}, 500);
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
		return {
			...msg,
			reactions:         msg.reactions ?? [],
			is_deleted:        msg.is_deleted ?? false,
			edited_at:         msg.edited_at ?? null,
			reply_to_id:       msg.reply_to_id ?? null,
			reply_to_username: msg.reply_to_username ?? null,
			reply_to_content:  msg.reply_to_content ?? null,
		};
	}

	// ── Link preview ──────────────────────────────────────────────────────────
	const URL_RE = /https?:\/\/[^\s<>"']+/gi;

	async function fetchPreview(url: string) {
		if (linkPreviews.has(url)) return;
		linkPreviews = new Map(linkPreviews).set(url, false); // mark as loading
		try {
			const { PUBLIC_API_URL } = await import('$env/static/public');
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/chat/unfurl?url=${encodeURIComponent(url)}`, {
				headers: token ? { Authorization: `Bearer ${token}` } : {}
			});
			if (res.ok) {
				const data = await res.json();
				linkPreviews = new Map(linkPreviews).set(url, data);
			}
		} catch { /* ignore */ }
	}

	function extractUrls(content: string | null): string[] {
		if (!content) return [];
		// Strip HTML tags, find bare URLs
		const text = content.replace(/<[^>]*>/g, ' ');
		return [...new Set((text.match(URL_RE) ?? []).slice(0, 1))]; // max 1 preview per message
	}

	// Fetch previews for new messages (only plain-text URL messages)
	$effect(() => {
		for (const msg of messages) {
			if (msg.is_deleted || !msg.content) continue;
			// Only unfurl if the message is just a URL (no other significant text)
			const text = msg.content.replace(/<[^>]*>/g, '').trim();
			if (!URL_RE.test(text)) continue;
			URL_RE.lastIndex = 0;
			const urls = extractUrls(msg.content);
			for (const url of urls) {
				if (!linkPreviews.has(url)) fetchPreview(url);
			}
		}
	});

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
		// Detect configured GIF provider
		const { PUBLIC_TENOR_KEY, PUBLIC_GIPHY_KEY } = await import('$env/static/public');
		if (PUBLIC_TENOR_KEY) gifProvider = 'tenor';
		else if (PUBLIC_GIPHY_KEY) gifProvider = 'giphy';

		const existing = getSocket();
		if (existing) {
			setupSocketListeners(existing);
		} else {
			const unsub = socket.subscribe((sock) => {
				if (sock) { setupSocketListeners(sock); unsub(); }
			});
		}

		// P2P message bus (typing + reactions from peers)
		window.addEventListener('p2p:message', handleP2PMessage);
		// Close picker on outside click
		document.addEventListener('click', onDocClick);
		document.addEventListener('keydown', handleGlobalKeydown);
		document.addEventListener('keyup', handleGlobalKeyup);
	});

	onDestroy(() => {
		if (s && selectedChannel) s.emit('chat:leave', selectedChannel.id);
		// Do NOT call p2pManager.leaveChannel() here — the DataChannel must survive navigation
		// (e.g. user goes to /library while staying in the same channel).
		// leaveChannel() is called automatically by joinChannel() when switching channels.
		if (typingThrottle) clearTimeout(typingThrottle);
		Object.values(typingMap).forEach((e) => clearTimeout(e.timer));
		if (browser) {
			window.removeEventListener('p2p:message', handleP2PMessage);
			document.removeEventListener('click', onDocClick);
			document.removeEventListener('keydown', handleGlobalKeydown);
			document.removeEventListener('keyup', handleGlobalKeyup);
		}
	});

	function onDocClick(e: MouseEvent) {
		const target = e.target as HTMLElement;
		if (!target.closest('[data-picker]')) pickerMsgId = null;
		if (!target.closest('[data-gif-picker]')) { showGifPicker = false; }
		if (!target.closest('[data-msg-actions]')) longPressMsg = null;
	}

	// ── GIF picker ────────────────────────────────────────────────────────────
	async function searchGifs(q: string) {
		if (!q.trim() || !gifProvider) { gifResults = []; return; }
		gifLoading = true;
		try {
			const { PUBLIC_TENOR_KEY, PUBLIC_GIPHY_KEY } = await import('$env/static/public');

			if (gifProvider === 'tenor' && PUBLIC_TENOR_KEY) {
				const res = await fetch(
					`https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(q)}&key=${PUBLIC_TENOR_KEY}&limit=20&media_filter=gif`
				);
				if (res.ok) {
					const data = await res.json();
					gifResults = (data.results ?? []).map((r: any) => ({
						id:      r.id,
						preview: r.media_formats?.tinygif?.url ?? r.media_formats?.gif?.url,
						url:     r.media_formats?.gif?.url,
					}));
				}
			} else if (gifProvider === 'giphy' && PUBLIC_GIPHY_KEY) {
				const res = await fetch(
					`https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(q)}&api_key=${PUBLIC_GIPHY_KEY}&limit=20&rating=g`
				);
				if (res.ok) {
					const data = await res.json();
					gifResults = (data.data ?? []).map((r: any) => ({
						id:      r.id,
						preview: r.images?.fixed_height_small?.url ?? r.images?.downsized?.url,
						url:     r.images?.downsized?.url ?? r.images?.original?.url,
					}));
				}
			}
		} catch { /* ignore */ }
		finally { gifLoading = false; }
	}

	function onGifInput() {
		if (gifTimer) clearTimeout(gifTimer);
		gifTimer = setTimeout(() => searchGifs(gifQuery), 400);
	}

	function sendGif(url: string) {
		if (!s || !selectedChannel) return;
		// Only allow https GIF URLs — prevents data:/javascript: injection in img src
		if (!/^https:\/\//i.test(url)) return;
		const safeUrl = url.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
		const content = `<img src="${safeUrl}" alt="GIF" style="max-width:360px;border-radius:8px;">`;
		s.emit('chat:send', { channelId: selectedChannel.id, content });
		showGifPicker = false;
		gifQuery = '';
		gifResults = [];
	}

	// ── Mobile long-press ─────────────────────────────────────────────────────
	function handleTouchStart(msgId: string) {
		longPressTimer = setTimeout(() => { longPressMsg = msgId; }, 450);
	}
	function handleTouchEnd() {
		if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
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
				`${PUBLIC_API_URL}/api/v1/chat/channels/${selectedChannel?.id}/history?limit=50&before=${encodeURIComponent(before)}`,
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
		s.emit('chat:send', { channelId: selectedChannel.id, content: inputText.trim(), replyToId: replyTo?.id ?? null });
		inputText = '';
		showMentions = false;
		replyTo = null;
	}

	function sendRich() {
		if (!s || !selectedChannel || !richContent.trim()) return;
		s.emit('chat:send', { channelId: selectedChannel.id, content: richContent, replyToId: replyTo?.id ?? null });
		richContent = '';
		editorKey++;
		showRichModal = false;
		replyTo = null;
	}

	function htmlToText(html: string): string {
		return new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''
	}

	// ── Reply / Pin ───────────────────────────────────────────────────────────
	function startReply(msg: Message) {
		const plain = htmlToText(msg.content ?? '');
		replyTo = { id: msg.id, author_username: msg.author_username, content: plain.slice(0, 80) };
		longPressMsg = null;
		// Focus textarea
		setTimeout(() => document.querySelector<HTMLTextAreaElement>('textarea#chat-input')?.focus(), 50);
	}

	function pinMessage(msg: Message) {
		if (!s || !selectedChannel) return;
		const already = pinnedMessage?.id === msg.id;
		s.emit('chat:pin', { channelId: selectedChannel.id, messageId: already ? null : msg.id });
		longPressMsg = null;
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
		// Typing indicator (throttled) — server + P2P fast path
		if (s && selectedChannel) {
			if (!typingThrottle) {
				s.emit('chat:typing', selectedChannel.id);
				// P2P fast path: peers see it near-instantly (~1–5ms vs ~100ms)
				p2pManager.send({ type: 'p2p:typing', userId, username: currentUsername });
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
				const res = await fetch(`${PUBLIC_API_URL}/api/v1/chat/members?q=${encodeURIComponent(mentionQuery)}`, {
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
	function toggleEmojiPicker(msgId: string) {
		pickerMsgId = pickerMsgId === msgId ? null : msgId;
	}

	// Apply a reaction optimistically (add or toggle off) for a given reactor
	function applyReactionOptimistic(msgs: typeof messages, messageId: string, emoji: string, reactorId: string): typeof messages {
		return msgs.map(m => {
			if (m.id !== messageId) return m;
			const reactions = m.reactions ? [...m.reactions] : [];
			const idx = reactions.findIndex(r => r.emoji === emoji);
			if (idx >= 0) {
				const r = reactions[idx];
				const alreadyReacted = r.userReactedIds.includes(reactorId);
				if (alreadyReacted) {
					const newCount = r.count - 1;
					if (newCount <= 0) return { ...m, reactions: reactions.filter((_, i) => i !== idx) };
					return { ...m, reactions: reactions.map((r2, i) => i === idx
						? { ...r2, count: newCount, userReactedIds: r2.userReactedIds.filter(id => id !== reactorId) }
						: r2
					)};
				} else {
					return { ...m, reactions: reactions.map((r2, i) => i === idx
						? { ...r2, count: r2.count + 1, userReactedIds: [...r2.userReactedIds, reactorId] }
						: r2
					)};
				}
			} else {
				return { ...m, reactions: [...reactions, { emoji, count: 1, userReactedIds: [reactorId] }] };
			}
		});
	}

	// Trigger a brief pop animation on a reaction bubble (P2P path)
	function flashReaction(messageId: string, emoji: string) {
		const set = new Set(reactionFlash.get(messageId) ?? []);
		set.add(emoji);
		reactionFlash = new Map(reactionFlash).set(messageId, set);
		setTimeout(() => {
			const current = reactionFlash.get(messageId);
			if (current) { current.delete(emoji); reactionFlash = new Map(reactionFlash); }
		}, 550);
	}

	function reactTo(messageId: string, emoji: string) {
		if (!s) return;
		messages = applyReactionOptimistic(messages, messageId, emoji, userId);
		flashReaction(messageId, emoji);
		p2pManager.send({ type: 'p2p:reaction', messageId, emoji, userId, username: currentUsername });
		s.emit('chat:react', { messageId, emoji });
		pickerMsgId = null;
		longPressMsg = null;
	}

	// P2P message handler — typing + reactions from peers
	function handleP2PMessage(e: Event) {
		const data = (e as CustomEvent).detail;
		if (!data?.type) return;

		if (data.type === 'p2p:typing') {
			const { userId: uid, username } = data;
			if (uid === userId) return; // ignore own echoes
			if (typingMap[uid]) clearTimeout(typingMap[uid].timer);
			const timer = setTimeout(() => {
				typingMap = Object.fromEntries(Object.entries(typingMap).filter(([k]) => k !== uid));
			}, 3000);
			typingMap = { ...typingMap, [uid]: { username, timer } };
		}

		if (data.type === 'p2p:reaction') {
			const { messageId, emoji, userId: reactorId } = data;
			if (reactorId === userId) return; // ignore own echoes
			messages = applyReactionOptimistic(messages, messageId, emoji, reactorId);
			flashReaction(messageId, emoji);
		}
	}

	// ── Inline edit ───────────────────────────────────────────────────────────
	function startEdit(msg: Message) {
		// Strip HTML to plain text for editing
		editingMsg = { id: msg.id, content: htmlToText(msg.content ?? '') };
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

<svelte:head><title>Chat — Nodyx</title></svelte:head>

<!-- Full-height layout -->
<div class="fixed top-14 bottom-0 lg:left-[220px] xl:right-[220px] left-0 right-0 flex overflow-hidden bg-gray-950 border-l border-gray-800 z-10">

	<!-- ── Channel sidebar ──────────────────────────────────────────────────── -->
	<ChannelSidebar
		{textChannels}
		{voiceChannels}
		selectedChannelId={selectedChannel?.id ?? null}
		{voiceState}
		{voiceChannelMembers}
		{isAdmin}
		{myUsername}
		{myAvatar}
		{token}
		{voiceError}
		bind:drawerOpen
		bind:localChannels
		onjoinChannel={joinChannel}
		onjoinVoice={handleJoinVoice}
		onopenVoiceMemberPanel={openVoiceMemberPanel}
		ondismissVoiceError={() => voiceError = null}
	/>

	<!-- ── Main chat area ───────────────────────────────────────────────────── -->
	<div class="flex-1 flex flex-col min-w-0">

		{#if selectedChannel}

			{#if (selectedChannel as any).type === 'voice'}
				<!-- ── Voice room ────────────────────────────────────────────────── -->
				<VoiceRoom
					{selectedChannel}
					{voiceState}
					bind:drawerOpen
					{myUsername}
					{myAvatar}
					{token}
					socket={s}
					{userId}
					{canvasRecapChannelId}
					onjoinCurrentVoice={joinCurrentVoiceChannel}
				/>


			{:else}
				<!-- ── Text chat ──────────────────────────────────────────────────── -->
				<!-- Header -->
				<div class="h-12 shrink-0 border-b border-gray-800 bg-gray-900/50 flex items-center gap-2 px-4">
					<button class="lg:hidden -ml-1 mr-1 p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800/60 min-w-[44px] min-h-[44px] flex items-center justify-center"
					        onclick={() => drawerOpen = true} aria-label="Ouvrir les canaux" aria-expanded={drawerOpen} aria-controls="channels-drawer">
						<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
						</svg>
					</button>
					<span class="text-gray-500 font-mono">#</span>
					<span class="font-semibold text-white">{selectedChannel.name}</span>
					{#if selectedChannel.description}
						<span class="text-gray-500 text-sm hidden sm:inline">— {selectedChannel.description}</span>
					{/if}
					<!-- P2P connection indicator -->
					<div class="ml-auto flex items-center">
						{#if $p2pStatus === 'p2p'}
							<div
								class="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-yellow-400/10 border border-yellow-400/20 cursor-default"
								title="{$p2pPeerCount} pair{$p2pPeerCount > 1 ? 's' : ''} connecté{$p2pPeerCount > 1 ? 's' : ''} directement — zéro serveur"
							>
								<div class="relative flex-shrink-0">
									<div class="w-2 h-2 rounded-full bg-yellow-400"></div>
									<div class="absolute inset-0 w-2 h-2 rounded-full bg-yellow-400 animate-ping opacity-60"></div>
								</div>
								<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-yellow-400 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
									<path d="M13 2L4.09 12.96A1 1 0 005 14h7v8l8.91-10.96A1 1 0 0020 10h-7V2z"/>
								</svg>
								<span class="text-[10px] font-black text-yellow-400 uppercase tracking-widest">P2P</span>
								<span class="text-[10px] font-bold text-yellow-300/60">·</span>
								<span class="text-[10px] font-black text-yellow-300">{$p2pPeerCount}</span>
							</div>
						{:else if $p2pStatus === 'connecting'}
							<div class="flex items-center gap-1.5 px-2 py-0.5 rounded-lg" title="Recherche de pairs P2P…">
								<div class="w-1.5 h-1.5 rounded-full bg-gray-600 animate-pulse"></div>
								<span class="text-[10px] font-black text-gray-600 uppercase tracking-widest">P2P</span>
							</div>
						{/if}
					</div>
				</div>

			<!-- Pinned message banner -->
			{#if pinnedMessage && showPinned}
				<div class="shrink-0 flex items-center gap-2 px-4 py-1.5 bg-indigo-950/60 border-b border-indigo-900/40 text-xs">
					<svg class="w-3.5 h-3.5 text-indigo-400 shrink-0" viewBox="0 0 24 24" fill="currentColor">
						<path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2l-2-2z"/>
					</svg>
					<span class="text-indigo-300 font-semibold shrink-0">Épinglé</span>
					<span class="text-gray-400 truncate">
						<span class="text-gray-500">{pinnedMessage.author_username} :</span>
						{pinnedMessage.content?.replace(/<[^>]*>/g, '').slice(0, 120) ?? ''}
					</span>
					{#if isAdmin}
						<button
							onclick={() => s?.emit('chat:pin', { channelId: selectedChannel?.id, messageId: null })}
							class="ml-auto shrink-0 text-gray-600 hover:text-white transition-colors text-base leading-none"
							title="Désépingler"
						>×</button>
					{:else}
						<button
							onclick={() => showPinned = false}
							class="ml-auto shrink-0 text-gray-700 hover:text-gray-400 transition-colors text-base leading-none"
							title="Masquer"
						>×</button>
					{/if}
				</div>
			{/if}

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
					{@const actionsVisible = pickerMsgId === msg.id || longPressMsg === msg.id}
					<div
						class="group message-row flex items-start gap-4 px-3 py-1 rounded-xl transition-all relative hover:bg-white/[0.02] {shouldGroup ? 'mt-0' : 'mt-4'}"
						ontouchstart={() => handleTouchStart(msg.id)}
						ontouchend={handleTouchEnd}
						ontouchmove={handleTouchEnd}
					>
						<!-- Avatar -->
						<div class="w-10 shrink-0 flex justify-center pt-1">
							{#if !shouldGroup}
								{#if msg.author_avatar}
									<img src={msg.author_avatar} alt={msg.author_username}
										class="w-10 h-10 rounded-2xl object-cover shadow-xl border border-white/5" />
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

						<!-- Content -->
						<div class="min-w-0 flex-1">
							{#if !shouldGroup}
								<div class="flex items-baseline gap-2 mb-1">
																	<button
										type="button"
										class="text-sm font-black cursor-pointer leading-none hover:brightness-125 transition-all {buildAnimClass({ nameAnimation: msg.author_name_animation })}"
										style={buildNameStyle({ nameColor: msg.author_name_color, nameGlow: msg.author_name_glow, nameGlowIntensity: msg.author_name_glow_intensity, nameFontFamily: msg.author_name_font_family }, '#ffffff')}
										onclick={(e) => openProfilePopup(e, msg.author_username)}
									>
										{msg.author_username}
									</button>
									<span class="text-[10px] text-gray-600 font-bold uppercase tracking-tighter">
										{formatTime(msg.created_at)}
									</span>
									{#if msg.edited_at && !msg.is_deleted}
										<span class="text-[10px] text-gray-700 italic">(modifié)</span>
									{/if}
								</div>
							{/if}

							<!-- Reply quote -->
							{#if msg.reply_to_id && !msg.is_deleted}
								<div class="flex items-start gap-1.5 mb-1.5 pl-2 border-l-2 border-indigo-600/50 opacity-70">
									<span class="text-[10px] text-indigo-400 font-bold shrink-0">{msg.reply_to_username}</span>
									<span class="text-[10px] text-gray-500 truncate">{msg.reply_to_content?.replace(/<[^>]*>/g, '').slice(0, 100) ?? '— message supprimé —'}</span>
								</div>
							{/if}

							{#if msg.is_deleted}
								<em class="text-xs text-gray-600 italic select-none">— message supprimé —</em>
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
							{:else if msg.poll_id}
							<!-- ── Sondage intégré ── -->
							<PollCard pollId={msg.poll_id} inline={true} {token} socket={s} />
						{:else}
								<div class="nodyx-prose text-sm text-gray-300 leading-relaxed break-words">
									{@html linkifyHtml(msg.content ?? '')}
									{#if shouldGroup && msg.edited_at}
										<span class="text-[9px] text-gray-700 italic ml-2">(modifié)</span>
									{/if}
								</div>
								<!-- Link preview card -->
								{#each extractUrls(msg.content) as previewUrl (previewUrl)}
									{@const preview = linkPreviews.get(previewUrl)}
									{#if preview && preview !== false && (preview.title || preview.image)}
										<a
											href={previewUrl}
											target="_blank"
											rel="noopener noreferrer"
											class="mt-2 flex gap-3 bg-gray-800/60 border border-gray-700/60 rounded-xl overflow-hidden max-w-sm hover:border-indigo-600/40 transition-colors no-underline"
											style="display:flex; text-decoration:none;"
										>
											{#if preview.image}
												<img src={preview.image} alt="" class="w-20 h-20 object-cover shrink-0" loading="lazy" />
											{/if}
											<div class="flex-1 p-2.5 min-w-0">
												{#if preview.siteName}
													<p class="text-[10px] text-indigo-400 font-bold uppercase tracking-wide truncate">{preview.siteName}</p>
												{/if}
												{#if preview.title}
													<p class="text-xs font-semibold text-white truncate mt-0.5">{preview.title}</p>
												{/if}
												{#if preview.description}
													<p class="text-[11px] text-gray-400 line-clamp-2 mt-0.5">{preview.description}</p>
												{/if}
											</div>
										</a>
									{/if}
								{/each}
							{/if}

							<!-- Reactions + add-reaction -->
							{#if !msg.is_deleted}
								<div class="flex flex-wrap items-center gap-1.5 mt-1.5">
									{#each msg.reactions as r (r.emoji)}
										<button
											onclick={() => reactTo(msg.id, r.emoji)}
											class="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all text-[11px] font-black
												{r.userReactedIds.includes(userId) ? 'border-indigo-500 bg-indigo-500/20 text-indigo-300 shadow-lg shadow-indigo-500/10' : 'border-gray-800 bg-gray-800/40 text-gray-500 hover:border-gray-600 hover:bg-gray-800'}
												{reactionFlash.get(msg.id)?.has(r.emoji) ? 'p2p-pop' : ''}"
										>
											<span>{r.emoji}</span>
											<span>{r.count}</span>
										</button>
									{/each}

									<!-- Add-reaction button (hover or after long-press) -->
									<div data-picker class="relative {pickerMsgId === msg.id ? '' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'} transition-opacity">
										<button
											onclick={() => toggleEmojiPicker(msg.id)}
											class="w-7 h-7 flex items-center justify-center rounded-lg border border-gray-800 bg-gray-900 text-gray-500 hover:text-white hover:border-gray-600 transition-all text-sm"
											title="Ajouter une réaction"
										>+</button>
										{#if pickerMsgId === msg.id}
											<div data-picker class="absolute left-0 bottom-full mb-1 z-40">
												<EmojiPicker onselect={(emoji) => reactTo(msg.id, emoji)} />
											</div>
										{/if}
									</div>
								</div>
							{/if}
						</div>

						<!-- Action toolbar — visible on hover (desktop) or long-press (mobile) -->
						{#if !msg.is_deleted}
							<div
								data-msg-actions
								class="{actionsVisible ? 'flex' : 'hidden group-hover:flex'} gap-1 absolute right-4 -top-3.5 bg-gray-900 border border-gray-800 rounded-xl px-1.5 py-1 shadow-2xl z-20"
							>
								<button
									onclick={() => startReply(msg)}
									class="p-1.5 rounded-lg text-gray-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors text-xs"
									title="Répondre"
								>↩️</button>
								{#if msg.author_id === userId}
									<button
										onclick={() => startEdit(msg)}
										class="p-1.5 rounded-lg text-gray-500 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors text-xs"
										title="Modifier"
									>✏️</button>
								{/if}
								{#if isAdmin}
									<button
										onclick={() => pinMessage(msg)}
										class="p-1.5 rounded-lg transition-colors text-xs {pinnedMessage?.id === msg.id ? 'text-indigo-400' : 'text-gray-500 hover:text-indigo-400 hover:bg-indigo-500/10'}"
										title={pinnedMessage?.id === msg.id ? 'Désépingler' : 'Épingler'}
									>📌</button>
								{/if}
								{#if msg.author_id === userId || isAdmin}
									<button
										onclick={() => confirmDelete(msg.id)}
										class="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors text-xs"
										title="Supprimer"
									>🗑️</button>
								{/if}
								<button
									onclick={() => { navigator.clipboard.writeText(msg.content?.replace(/<[^>]*>/g, '') ?? '') }}
									class="p-1.5 rounded-lg text-gray-500 hover:text-white hover:bg-gray-800 transition-colors text-xs"
									title="Copier"
								>📋</button>
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
				<div class="px-4 pb-1 h-5 flex items-center gap-2" transition:fade={{ duration: 120 }}>
					<div class="flex items-center gap-0.5 shrink-0">
						<span class="typing-dot" style="animation-delay: 0ms"></span>
						<span class="typing-dot" style="animation-delay: 160ms"></span>
						<span class="typing-dot" style="animation-delay: 320ms"></span>
					</div>
					<span class="text-[11px] text-gray-500 font-semibold">
						{#if typingUsers.length === 1}
							{typingUsers[0]} écrit…
						{:else if typingUsers.length === 2}
							{typingUsers[0]} et {typingUsers[1]} écrivent…
						{:else}
							Plusieurs personnes écrivent…
						{/if}
					</span>
				</div>
			{:else}
				<div class="h-5"></div>
			{/if}

			<!-- Input area -->
			<div class="px-4 shrink-0" style="padding-bottom: max(1rem, var(--bottom-nav-h))">
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

				<!-- GIF picker popup -->
				{#if showGifPicker}
					<div data-gif-picker class="relative mb-2">
						<div class="absolute bottom-full left-0 mb-1 w-80 bg-gray-900 border border-gray-700 rounded-xl shadow-2xl z-30 overflow-hidden">
							{#if !gifProvider}
								<!-- No key configured — setup instructions -->
								<div class="p-4 space-y-3">
									<p class="text-xs font-semibold text-white">GIFs non configurés</p>
									<p class="text-xs text-gray-400 leading-relaxed">
										Ajoutez une clé gratuite dans <code class="bg-gray-800 px-1 rounded text-indigo-300">/var/www/nodyx/nexus-frontend/.env</code> puis rebuild :
									</p>
									<div class="space-y-1.5 text-xs text-gray-500">
										<div class="bg-gray-800 rounded p-2 font-mono">
											<span class="text-green-400"># Tenor (Google)</span><br>
											<span class="text-amber-300">PUBLIC_TENOR_KEY</span>=votre_clé<br>
											<span class="text-gray-600 text-[10px]">console.cloud.google.com → Tenor API v2</span>
										</div>
										<div class="bg-gray-800 rounded p-2 font-mono">
											<span class="text-green-400"># Giphy (Meta)</span><br>
											<span class="text-amber-300">PUBLIC_GIPHY_KEY</span>=votre_clé<br>
											<span class="text-gray-600 text-[10px]">developers.giphy.com → Create App</span>
										</div>
									</div>
									<p class="text-[10px] text-gray-600">Les deux sont gratuits avec un quota généreux.</p>
								</div>
							{:else}
								<div class="p-2 border-b border-gray-800">
									<input
										type="text"
										placeholder="Rechercher un GIF…"
										bind:value={gifQuery}
										oninput={onGifInput}
										class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-600"
									/>
								</div>
								<div class="p-2 grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto" style="scrollbar-width:thin;">
									{#if gifLoading}
										<div class="col-span-3 text-center py-4 text-xs text-gray-500">Recherche…</div>
									{:else if gifResults.length === 0 && gifQuery}
										<div class="col-span-3 text-center py-4 text-xs text-gray-500">Aucun résultat</div>
									{:else if gifResults.length === 0}
										<div class="col-span-3 text-center py-4 text-xs text-gray-500">Tapez pour rechercher</div>
									{:else}
										{#each gifResults as gif (gif.id)}
											<button
												onclick={() => sendGif(gif.url)}
												class="rounded-lg overflow-hidden hover:ring-2 hover:ring-indigo-500 transition-all aspect-square"
											>
												<img src={gif.preview} alt="GIF" class="w-full h-full object-cover" loading="lazy" />
											</button>
										{/each}
									{/if}
								</div>
								<div class="px-3 py-1.5 border-t border-gray-800 text-[10px] text-gray-600 text-right capitalize">
									Powered by {gifProvider}
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Reply preview bar -->
				{#if replyTo}
					<div class="flex items-center gap-2 px-3 py-1.5 mb-1 bg-gray-800/80 border border-gray-700 rounded-lg text-xs">
						<span class="text-indigo-400 shrink-0">↩ {replyTo.author_username}</span>
						<span class="text-gray-500 truncate flex-1">{replyTo.content}</span>
						<button
							onclick={() => replyTo = null}
							class="shrink-0 text-gray-600 hover:text-white transition-colors text-base leading-none"
							title="Annuler la réponse"
						>×</button>
					</div>
				{/if}

				{#if blockedNotice}
					<div class="flex items-center gap-2 px-3 py-2 mb-1 bg-red-950/60 border border-red-600/60 rounded-lg text-xs text-red-300">
						<span>⛔</span>
						<span>{blockedNotice}</span>
					</div>
				{/if}

				{#if isRateLimited}
					<div class="flex items-center gap-2 px-3 py-2 mb-1 bg-red-900/40 border border-red-700/60 rounded-lg text-xs text-red-300">
						<span>⏱</span>
						<span>Anti-spam actif — réessaie dans {Math.ceil((rateLimitedUntil - Date.now()) / 1000)} s</span>
					</div>
				{/if}

				<div class="flex gap-2 bg-gray-800 rounded-lg border {isRateLimited ? 'border-red-700/60' : 'border-gray-700 focus-within:border-indigo-600'} transition-colors">
					<textarea
						id="chat-input"
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-gray-100 placeholder-gray-600 resize-none outline-none max-h-32 disabled:opacity-50"
						placeholder={isRateLimited ? 'Anti-spam actif…' : `Message #${selectedChannel.slug}`}
						rows={1}
						maxlength={2000}
						bind:value={inputText}
						onkeydown={handleKeydown}
						oninput={handleInput}
						disabled={isRateLimited}
					></textarea>
					<!-- GIF button — always visible -->
					<button
						data-gif-picker
						onclick={() => { showGifPicker = !showGifPicker; if (showGifPicker && gifProvider) gifQuery = ''; }}
						class="px-2 py-2 m-1 rounded transition-colors shrink-0 text-xs font-bold {showGifPicker ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}"
						title="Envoyer un GIF"
					>GIF</button>
					<!-- Poll button -->
					<button
						onclick={() => showPollCreator = true}
						class="px-2 py-2 m-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors shrink-0 text-sm"
						title="Créer un sondage"
					>📊</button>
					<!-- Rich editor button -->
					<button
						onclick={() => { showRichModal = true; }}
						class="px-2 py-2 m-1 rounded text-gray-400 hover:text-white hover:bg-gray-700 transition-colors shrink-0 text-sm"
						title="Éditeur riche (Ctrl+Maj+E)"
					>✏️</button>
					<button
						onclick={sendMessage}
						disabled={!inputText.trim() || isRateLimited}
						class="px-3 py-2 m-1.5 rounded {isRateLimited ? 'bg-red-700/60 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500'} disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors shrink-0"
					>
						{isRateLimited ? '⏱' : 'Envoyer'}
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

<!-- ── Poll creator modal ─────────────────────────────────────────────────── -->
{#if showPollCreator}
	<PollCreator
		{token}
		channelId={selectedChannel?.id ?? null}
		onCreated={() => showPollCreator = false}
		onClose={() => showPollCreator = false}
	/>
{/if}

<!-- ── P2P fallback toast ──────────────────────────────────────────────────── -->
{#if $p2pFallback}
	<div
		class="fixed bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2.5 px-4 py-2.5 bg-gray-900/95 border border-gray-700/60 rounded-xl shadow-2xl backdrop-blur-sm z-50"
		transition:fade={{ duration: 280 }}
	>
		<div class="w-1.5 h-1.5 rounded-full bg-gray-500 shrink-0"></div>
		<span class="text-xs text-gray-400 font-medium whitespace-nowrap">Relais serveur actif — connexion directe indisponible</span>
	</div>
{/if}

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
					<NodyxEditor
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

<!-- ── Mini profile popup ─────────────────────────────────────────────────── -->
{#if profilePopupUsername}
	<MiniProfileCard
		username={profilePopupUsername}
		anchorEl={profilePopupAnchor}
		onclose={() => { profilePopupUsername = null; profilePopupAnchor = null; }}
	/>
{/if}

<style>

	/* ── P2P animations ───────────────────────────────────────────────────── */

	/* Typing dots — three bouncing orbs */
	.typing-dot {
		display: inline-block;
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: #818cf8; /* indigo-400 */
		animation: typing-bounce 1.1s infinite ease-in-out;
	}
	@keyframes typing-bounce {
		0%, 55%, 100% { transform: translateY(0);   opacity: 0.4; }
		27%            { transform: translateY(-5px); opacity: 1;   }
	}

	/* Reaction pop — spring physics burst when a P2P reaction arrives */
	.p2p-pop {
		animation: reaction-pop 0.52s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
	}
	@keyframes reaction-pop {
		0%   { transform: scale(1);    filter: brightness(1);   }
		35%  { transform: scale(1.55); filter: brightness(1.4); }
		65%  { transform: scale(0.88); filter: brightness(1.1); }
		100% { transform: scale(1.05); filter: brightness(1);   }
	}

	/* ── Message rows ─────────────────────────────────────────────────────── */

	.message-row {
    border-left: 3px solid transparent;
    transition: all 0.2s ease;
	}
	
	.message-row:hover {
    border-left-color: #6366f1; /* Indigo */
    background: linear-gradient(to right, rgba(99, 102, 241, 0.05), transparent);
	}	

    /* Style pour le contenu des messages (Rich Text) */
    :global(.nodyx-prose) {
        line-height: 1.6;
        color: #d1d5db; /* gray-300 */
    }

    :global(.nodyx-prose p) {
        margin-bottom: 0.5rem;
    }

    :global(.nodyx-prose strong) {
        color: #ffffff;
        font-weight: 700;
    }

    /* Scrollbar ultra-fine et stylisée pour le look "Nodyx" */
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

    /* 3. On l'illumine un peu au survol pour le côté Nodyx */
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

</style>
