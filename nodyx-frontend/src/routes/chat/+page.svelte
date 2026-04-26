<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { socket, getSocket } from '$lib/socket';
	import { linkifyHtml } from '$lib/linkify';
	import NodyxEditor from '$lib/components/editor/NodyxEditor.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import ChannelSidebar from '$lib/components/ChannelSidebar.svelte';
	import PollCard    from '$lib/components/PollCard.svelte';
	import PollCreator from '$lib/components/PollCreator.svelte';
	import VoiceRoom from '$lib/components/VoiceRoom.svelte';
	import { joinVoice, leaveVoice, voiceStore, startPTT, stopPTT, voiceChannelMembersStore, voiceEventsStore } from '$lib/voice';
	import type { Socket } from 'socket.io-client';
	import { voicePanelTarget } from '$lib/voicePanel';
	import { p2pManager, p2pStatus, p2pPeerCount, p2pFallback } from '$lib/p2p';
	import MiniProfileCard from '$lib/components/MiniProfileCard.svelte';
	import { buildNameStyle, buildAnimClass, ensureFontLoaded } from '$lib/nameEffects';
	import FloatingReactions from '$lib/components/FloatingReactions.svelte';
	import { t } from '$lib/i18n';
	import { unreadCountsStore, flashChannelIdStore } from '$lib/unreadStore';
	import { playMessage, playMention } from '$lib/sounds';
	const tFn = $derived($t)

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
	type ReactionSummary = { emoji: string; count: number; userReactedIds: string[]; usernames: string[] };
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

	// Select channel from URL ?channel=id param, or default to first text channel
	$effect(() => {
		if (localChannels.length === 0) return;
		const urlChannelId = $page.url.searchParams.get('channel');
		if (urlChannelId) {
			const found = localChannels.find((c: any) => c.id === urlChannelId);
			if (found && found.id !== selectedChannel?.id) {
				if (s) {
					// Socket ready: use joinChannel so socket rooms + state are properly reset
					joinChannel(found);
				} else {
					// Socket not yet ready: set selectedChannel so the connect handler
					// can emit chat:join once the socket connects
					selectedChannel = found;
				}
			}
		} else if (!selectedChannel) {
			const def = localChannels.find((c: any) => c.type === 'text') ?? localChannels[0];
			// Navigate to default channel so URL stays in sync
			if (def) goto(`/chat?channel=${def.id}`, { replaceState: true });
		}
	});
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
	let isLoadingOld        = $state(false);
	let noMoreHistory       = $state(false);
	let isAtBottom          = $state(true);
	let unreadWhileScrolled = $state(0);

	// ── Per-channel unread tracking (via shared store → layout sidebar) ─────
	let _flashTimer: ReturnType<typeof setTimeout> | null = null;

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

	// Son de déconnexion quand leaveVoice() est appelé depuis n'importe où (VoicePanel…)
	let _prevVoiceActive = false;
	$effect(() => {
		const active = voiceState.active;
		if (_prevVoiceActive && !active) playVoiceChime('self_leave');
		_prevVoiceActive = active;
	});
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

	const VOICE_ERRORS = $derived({
		INSECURE: tFn('chat.voice.insecure'),
		DENIED:   tFn('chat.voice.denied'),
		NOTFOUND: tFn('chat.voice.notfound'),
		BUSY:     tFn('chat.voice.busy'),
	});

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
		goto(`/chat?channel=${ch.id}`, { replaceState: true });
	}

	// Rejoindre explicitement le salon sélectionné (bouton dans la Table)
	async function joinCurrentVoiceChannel() {
		if (!s || !selectedChannel) return;
		const ch = selectedChannel;
		try {
			if (voiceState.channelId === ch.id) return;  // déjà connecté
			if (voiceState.active) { playVoiceChime('self_leave'); leaveVoice(); }
			await joinVoice(ch.id, s);
			playVoiceChime('self_join');
		} catch (err: any) {
			voiceError = (VOICE_ERRORS as Record<string, string>)[err.message] ?? VOICE_ERRORS['DENIED'];
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
			// Leave active mode but stay in room as watcher for unread notifications
			s.emit('chat:leave', selectedChannel.id);
			s.emit('chat:watch', selectedChannel.id);
		}
		// Clear unread for this channel
		unreadCountsStore.update(c => ({ ...c, [channel.id]: 0 }));
		selectedChannel = channel;
		goto(`/chat?channel=${channel.id}`, { replaceState: true });
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
			scrollToBottom({ force: true });
		});

		sock.on('chat:message', (msg: Message) => {
			if (msg.channel_id !== selectedChannel?.id) {
				// Message in a background channel — trigger glow + increment badge
				if (msg.channel_id) {
					unreadCountsStore.update(c => ({ ...c, [msg.channel_id]: (c[msg.channel_id] ?? 0) + 1 }));
					flashChannelIdStore.set(msg.channel_id);
					if (_flashTimer) clearTimeout(_flashTimer);
					_flashTimer = setTimeout(() => { flashChannelIdStore.set(null); }, 650);
				}
				return;
			}
			messages = [...messages, normalizeMsg(msg)];
			// Son uniquement si le message vient de quelqu'un d'autre
			if (msg.author_id !== userId) playMessage();
			if (isAtBottom) {
				scrollToBottom();
			} else {
				unreadWhileScrolled++;
			}
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
			blockedNotice = reason ?? tFn('chat.message_refused');
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

		const vcSnapshotInit = new Set<string>();
		sock.on('voice:channel_update', ({ channelId, members }: { channelId: string; members: { userId: string; username: string; avatar: string | null }[] }) => {
			const isFirst = !vcSnapshotInit.has(channelId);
			vcSnapshotInit.add(channelId);
			if (!isFirst) {
				const prev = voiceChannelMembers[channelId] ?? [];
				const ch   = localChannels.find((c: any) => c.id === channelId);
				const chName = ch?.name ?? '';
				for (const m of members) {
					if (!prev.find(p => p.userId === m.userId)) {
						pushVoiceToast(m.username, m.avatar, 'join', chName);
					}
				}
				for (const m of prev) {
					if (!members.find(p => p.userId === m.userId)) {
						pushVoiceToast(m.username, m.avatar ?? null, 'leave', chName);
					}
				}
			}
			voiceChannelMembers = { ...voiceChannelMembers, [channelId]: members };
			voiceChannelMembersStore.update(s => ({ ...s, [channelId]: members }));
		});

		// Demander un snapshot vocal immédiatement après avoir branché le listener.
		// Nécessaire quand le socket était déjà connecté (navigation SvelteKit) —
		// le snapshot initial a été envoyé avant le montage de ce composant.
		sock.emit('voice:request_snapshot');

		// Join first channel
		if (selectedChannel) sock.emit('chat:join', selectedChannel.id);

		// Watch all other text channels for unread notifications (no history)
		const watchIds = localChannels
			.filter((c: any) => c.type !== 'voice' && c.id !== selectedChannel?.id)
			.map((c: any) => c.id);
		if (watchIds.length) sock.emit('chat:watch', watchIds);
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

	// ── Sons vocaux (Web Audio API — aucun fichier externe) ───────────────────
	function playVoiceChime(type: 'self_join' | 'self_leave' | 'peer_join' | 'peer_leave') {
		if (!browser) return;
		try {
			const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
			const master = ctx.createGain();
			master.connect(ctx.destination);
			const now = ctx.currentTime;

			const note = (freq: number, start: number, dur: number, vol = 0.11) => {
				const osc = ctx.createOscillator();
				const env = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.value = freq;
				osc.connect(env);
				env.connect(master);
				env.gain.setValueAtTime(0, now + start);
				env.gain.linearRampToValueAtTime(vol, now + start + 0.018);
				env.gain.exponentialRampToValueAtTime(0.0001, now + start + dur);
				osc.start(now + start);
				osc.stop(now + start + dur + 0.05);
			};

			if      (type === 'self_join')  { note(880, 0, 0.22, 0.14); note(1320, 0.13, 0.30, 0.12); }
			else if (type === 'self_leave') { note(660, 0, 0.20, 0.12); note(440,  0.11, 0.28, 0.10); }
			else if (type === 'peer_join')  { note(1100, 0, 0.22, 0.08); }
			else                            { note(660,  0, 0.22, 0.07); }

			setTimeout(() => ctx.close(), 1500);
		} catch { /* AudioContext non dispo (SSR / test) */ }
	}

	function pushVoiceToast(username: string, avatar: string | null, action: 'join' | 'leave', channelName: string) {
		const id = Math.random().toString(36).slice(2);
		voiceEventsStore.update(evts => [...evts, { id, username, avatar, action, channelName }]);
		setTimeout(() => voiceEventsStore.update(evts => evts.filter(e => e.id !== id)), 4000);
		playVoiceChime(action === 'join' ? 'peer_join' : 'peer_leave');
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
	// `force` re-scrolls over ~1s to catch async-loaded content (avatars, unfurl
	// previews, GIFs) that pushes the bottom down after the initial scroll.
	async function scrollToBottom(opts: { force?: boolean } = {}) {
		await tick();
		const pin = () => { if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight; };
		pin();
		isAtBottom = true;
		unreadWhileScrolled = 0;
		if (opts.force) {
			for (const ms of [50, 150, 350, 600, 1000]) {
				setTimeout(() => { if (isAtBottom) pin(); }, ms);
			}
		}
	}

	async function handleScroll() {
		if (!messagesEl) return;
		const distFromBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
		isAtBottom = distFromBottom < 80;
		if (isAtBottom) unreadWhileScrolled = 0;
		if (isLoadingOld || noMoreHistory || messages.length === 0) return;
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

	// ── Slash commands ────────────────────────────────────────────────────────
	const EIGHT_BALL = [
		'Oui, absolument.', 'C\'est certain.', 'Sans aucun doute.', 'Oui.', 'Tu peux compter dessus.',
		'Très probablement.', 'Les perspectives sont bonnes.', 'Les signes pointent vers oui.',
		'Réponse floue, réessaie.', 'Demande plus tard.', 'Difficile à dire maintenant.',
		'Impossible de prédire pour l\'instant.', 'Ne compte pas dessus.', 'Ma réponse est non.',
		'Mes sources disent non.', 'Les perspectives ne sont pas bonnes.', 'Très douteux.',
	];

	function parseSlashCommand(text: string): string | null {
		if (!text.startsWith('/')) return null;
		const parts = text.slice(1).split(' ');
		const cmd   = parts[0].toLowerCase();
		const args  = parts.slice(1);
		const u     = `<strong>${currentUsername}</strong>`;

		switch (cmd) {
			case 'roll': {
				const match = (args[0] ?? '1d6').match(/^(\d{1,2})d(\d{1,4})$/i);
				const n     = match ? Math.min(parseInt(match[1]), 10)    : 1;
				const sides = match ? Math.min(parseInt(match[2]), 10000) : 6;
				const rolls = Array.from({ length: n }, () => Math.floor(Math.random() * sides) + 1);
				const total = rolls.reduce((a, b) => a + b, 0);
				const detail = n > 1 ? ` <em>(${rolls.join(' + ')})</em>` : '';
				return `🎲 ${u} lance un <strong>${n}d${sides}</strong>${detail} → <strong>${total}</strong>`;
			}
			case 'flip': {
				const r = Math.random() < 0.5 ? 'Pile 🪙' : 'Face ✨';
				return `🪙 ${u} lance une pièce → <strong>${r}</strong>`;
			}
			case '8ball': {
				const q = args.length ? ` « ${args.join(' ')} »` : '';
				const a = EIGHT_BALL[Math.floor(Math.random() * EIGHT_BALL.length)];
				return `🎱 ${u}${q} → <em>${a}</em>`;
			}
			case 'rps': {
				const opts   = ['🪨', '📄', '✂️'];
				const wins   = { '🪨': '✂️', '📄': '🪨', '✂️': '📄' };
				const me     = opts.includes(args[0]) ? args[0] : opts[Math.floor(Math.random() * 3)];
				const bot    = opts[Math.floor(Math.random() * 3)];
				const result = me === bot ? 'Égalité !' : wins[me as keyof typeof wins] === bot ? `${u} gagne 🏆` : 'Le bot gagne 🤖';
				return `✊ ${u} joue ${me} contre le bot ${bot} → <strong>${result}</strong>`;
			}
			default:
				return null; // Commande inconnue → message normal
		}
	}

	// ── Send ──────────────────────────────────────────────────────────────────
	function sendMessage() {
		if (!s || !selectedChannel || !inputText.trim()) return;
		const cmdResult = parseSlashCommand(inputText.trim());
		const content   = cmdResult ?? inputText.trim();
		s.emit('chat:send', { channelId: selectedChannel.id, content, replyToId: replyTo?.id ?? null });
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
				return { ...m, reactions: [...reactions, { emoji, count: 1, userReactedIds: [reactorId], usernames: [] }] };
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

	// ── Réactions flottantes Twitch-style ──────────────────────────────────────
	const FLOAT_EMOJIS  = ['🔥', '❤️', '😂', '👀', '💯', '🎉', '😎', '🚀', '👏', '💀'];
	const QUICK_EMOJIS  = ['👍', '❤️', '😂', '😮', '😢', '🔥', '🎉', '👀'];
	let floatCooldown = $state(false);

	function floatReact(emoji: string) {
		if (!s || !selectedChannel || floatCooldown) return;
		floatCooldown = true;
		const x = 0.05 + Math.random() * 0.82;  // position horizontale aléatoire 5–87%
		s.emit('chat:float_reaction', { channelId: selectedChannel.id, emoji, x });
		setTimeout(() => { floatCooldown = false; }, 280);
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

<!-- Full-height layout — left offset accounts for icon bar (72px) + channel sidebar (220px) = 292px -->
<div class="fixed top-12 bottom-0 lg:left-[292px] xl:right-[220px] left-0 right-0 flex overflow-hidden z-10" style="background: #080810">

	<!-- ── Channel sidebar — mobile drawer only (layout sidebar handles desktop) ── -->
	<div class="lg:hidden">
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
	</div>

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
				<div class="h-11 shrink-0 flex items-center gap-3 px-4" style="background: #0d0d12; border-bottom: 1px solid rgba(255,255,255,.06)">
					<!-- Mobile hamburger -->
					<button class="lg:hidden shrink-0 p-1.5 transition-colors" style="color: #6b7280"
					        onclick={() => drawerOpen = true} aria-label="Ouvrir les canaux" aria-expanded={drawerOpen} aria-controls="channels-drawer">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
						</svg>
					</button>
					<!-- Channel name -->
					<div class="flex items-center gap-2 min-w-0">
						<span class="text-sm font-black shrink-0" style="color: #a78bfa; font-family: 'Space Grotesk', sans-serif">#</span>
						<span class="text-sm font-bold truncate" style="color: #e2e8f0; font-family: 'Space Grotesk', sans-serif">{selectedChannel.name}</span>
						{#if selectedChannel.description}
							<span class="hidden sm:inline text-[11px] truncate" style="color: #374151; border-left: 1px solid rgba(255,255,255,.08); padding-left: 0.75rem; margin-left: 0.25rem">{selectedChannel.description}</span>
						{/if}
					</div>
					<!-- P2P indicator -->
					<div class="ml-auto flex items-center gap-2 shrink-0">
						{#if $p2pStatus === 'p2p'}
							<div class="flex items-center gap-1.5 px-2 h-6 cursor-default"
							     style="background: rgba(234,179,8,.06); border: 1px solid rgba(234,179,8,.2)"
							     title="{tFn('chat.p2p_peers', { n: String($p2pPeerCount) })}">
								<span class="relative flex h-1.5 w-1.5 shrink-0">
									<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60" style="background: #eab308"></span>
									<span class="relative inline-flex h-1.5 w-1.5 rounded-full" style="background: #eab308"></span>
								</span>
								<svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="#eab308"><path d="M13 2L4.09 12.96A1 1 0 005 14h7v8l8.91-10.96A1 1 0 0020 10h-7V2z"/></svg>
								<span class="text-[10px] font-black uppercase tracking-wider" style="color: #eab308">P2P</span>
								<span class="text-[10px] font-black tabular-nums" style="color: #ca8a04">{$p2pPeerCount}</span>
							</div>
						{:else if $p2pStatus === 'connecting'}
							<div class="flex items-center gap-1.5 px-2 h-6" style="border: 1px solid rgba(255,255,255,.05)">
								<span class="w-1.5 h-1.5 rounded-full animate-pulse" style="background: #374151"></span>
								<span class="text-[10px] font-black uppercase tracking-wider" style="color: #374151">P2P</span>
							</div>
						{/if}
					</div>
				</div>

			<!-- Pinned message banner -->
			{#if pinnedMessage && showPinned}
				<div class="shrink-0 flex items-center gap-2.5 px-4 py-1.5 text-xs" style="background: rgba(124,58,237,.06); border-bottom: 1px solid rgba(124,58,237,.15)">
					<svg class="w-3 h-3 shrink-0" viewBox="0 0 24 24" fill="#a78bfa"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2l-2-2z"/></svg>
					<span class="font-black uppercase tracking-wider shrink-0 text-[10px]" style="color: #a78bfa; font-family: 'Space Grotesk', sans-serif">Épinglé</span>
					<span class="truncate flex-1" style="color: #6b7280">
						<span class="font-semibold" style="color: #4b5563">{pinnedMessage.author_username} · </span>{pinnedMessage.content?.replace(/<[^>]*>/g, '').slice(0, 120) ?? ''}
					</span>
					{#if isAdmin}
						<button onclick={() => s?.emit('chat:pin', { channelId: selectedChannel?.id, messageId: null })}
						        class="ml-auto shrink-0 transition-colors w-4 h-4 flex items-center justify-center text-sm leading-none" style="color: #374151" title="Désépingler">×</button>
					{:else}
						<button onclick={() => showPinned = false}
						        class="ml-auto shrink-0 transition-colors w-4 h-4 flex items-center justify-center text-sm leading-none" style="color: #374151" title="Masquer">×</button>
					{/if}
				</div>
			{/if}

			<!-- Messages -->
			<div class="flex-1 relative min-h-0">
			<div
                class="absolute inset-0 overflow-y-auto px-0 py-3 space-y-0 custom-scrollbar"
                bind:this={messagesEl}
                onscroll={handleScroll}
                style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.06) transparent"
            >
				{#if isLoadingOld}
					<p class="text-center text-xs text-gray-600 py-2">Chargement…</p>
				{/if}
				{#if noMoreHistory && messages.length > 0}
					<p class="text-center text-xs text-gray-700 py-2">{tFn('chat.history_start')}</p>
				{/if}

				{#each messageGroups as group (group.day)}
					<!-- Day separator -->
					<div class="flex items-center gap-3 my-4 px-4">
						<div class="flex-1 h-px" style="background: linear-gradient(to right, transparent, rgba(255,255,255,.06))"></div>
						<span class="text-[10px] font-black uppercase tracking-[.15em] px-3 py-1 shrink-0" style="color: #374151; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.05); font-family: 'Space Grotesk', sans-serif">{group.day}</span>
						<div class="flex-1 h-px" style="background: linear-gradient(to left, transparent, rgba(255,255,255,.06))"></div>
					</div>

					{#each group.messages as msg, i (msg.id)}
					{@const prevMsg = group.messages[i - 1]}
					{@const isSameAuthor = prevMsg && prevMsg.author_id === msg.author_id}
					{@const timeDiff = prevMsg ? (new Date(msg.created_at).getTime() - new Date(prevMsg.created_at).getTime()) / 1000 / 60 : 0}
					{@const shouldGroup = isSameAuthor && timeDiff < 5 && !msg.is_deleted && !prevMsg.is_deleted}
					{@const actionsVisible = pickerMsgId === msg.id || longPressMsg === msg.id}
					<div
						class="group message-row relative flex items-start gap-3 px-4 transition-all {shouldGroup ? 'py-px' : 'pt-2.5 pb-px'}"
						style="background: transparent"
						role="listitem"
						onmouseenter={(e) => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,.018)'}
						onmouseleave={(e) => (e.currentTarget as HTMLElement).style.background = 'transparent'}
						ontouchstart={() => handleTouchStart(msg.id)}
						ontouchend={handleTouchEnd}
						ontouchmove={handleTouchEnd}
					>
						<!-- Left accent bar on hover -->
						<span class="absolute left-0 top-0 bottom-0 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style="background: linear-gradient(to bottom, #7c3aed44, #06b6d444)"></span>
						<!-- Avatar / time -->
						<div class="w-9 shrink-0 flex justify-center" style="padding-top: 2px">
							{#if !shouldGroup}
								{#if msg.author_avatar}
									<img src={msg.author_avatar} alt={msg.author_username}
										class="w-9 h-9 object-cover" style="outline: 1px solid rgba(255,255,255,.07)" />
								{:else}
									<div class="w-9 h-9 flex items-center justify-center font-black text-[11px] text-white select-none"
									     style="background: linear-gradient(135deg, #7c3aed80, #0e7490)">
										{msg.author_username.charAt(0).toUpperCase()}
									</div>
								{/if}
							{:else}
								<span class="text-[9px] tabular-nums opacity-0 group-hover:opacity-100 transition-opacity select-none" style="color: #374151; padding-top: 3px">
									{formatTime(msg.created_at)}
								</span>
							{/if}
						</div>

						<!-- Content -->
						<div class="min-w-0 flex-1">
							{#if !shouldGroup}
								<div class="flex items-baseline gap-2 mb-0.5">
									<button
										type="button"
										class="text-sm font-black cursor-pointer leading-none hover:brightness-125 transition-all {buildAnimClass({ nameAnimation: msg.author_name_animation })}"
										style={buildNameStyle({ nameColor: msg.author_name_color, nameGlow: msg.author_name_glow, nameGlowIntensity: msg.author_name_glow_intensity, nameFontFamily: msg.author_name_font_family }, '#e2e8f0')}
										onclick={(e) => openProfilePopup(e, msg.author_username)}
									>
										{msg.author_username}
									</button>
									<span class="text-[10px] tabular-nums" style="color: #374151">
										{formatTime(msg.created_at)}
									</span>
									{#if msg.edited_at && !msg.is_deleted}
										<span class="text-[10px] italic" style="color: #374151">(modifié)</span>
									{/if}
								</div>
							{/if}

							<!-- Reply quote -->
							{#if msg.reply_to_id && !msg.is_deleted}
								<div class="flex items-center gap-2 mb-1.5 pl-2 py-0.5 opacity-70" style="border-left: 2px solid #7c3aed">
									<span class="text-[10px] font-bold shrink-0" style="color: #a78bfa">{msg.reply_to_username}</span>
									<span class="text-[10px] truncate" style="color: #4b5563">{msg.reply_to_content?.replace(/<[^>]*>/g, '').slice(0, 100) ?? tFn('chat.deleted')}</span>
								</div>
							{/if}

							{#if msg.is_deleted}
								<em class="text-xs text-gray-600 italic select-none">{tFn('chat.deleted')}</em>
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
								<div class="nodyx-prose text-sm leading-relaxed break-words" style="color: #d1d5db">
									{@html linkifyHtml(msg.content ?? '')}
									{#if shouldGroup && msg.edited_at}
										<span class="text-[9px] text-gray-700 italic ml-2">(modifié)</span>
									{/if}
								</div>
								<!-- Link preview card -->
								{#each extractUrls(msg.content) as previewUrl (previewUrl)}
									{@const preview = linkPreviews.get(previewUrl)}
									{#if preview && typeof preview === 'object' && (preview.title || preview.image)}
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

							<!-- Reactions -->
							{#if !msg.is_deleted && msg.reactions.length > 0}
								<div class="flex flex-wrap items-center gap-1 mt-1.5">
									{#each msg.reactions as r (r.emoji)}
										<button
											onclick={() => reactTo(msg.id, r.emoji)}
											title={r.usernames?.join(', ') || r.userReactedIds.join(', ')}
											class="chat-reaction-pill flex items-center gap-1 px-2 h-6 text-[11px] font-bold
											       {reactionFlash.get(msg.id)?.has(r.emoji) ? 'p2p-pop' : ''}
											       {r.userReactedIds.includes(userId) ? 'chat-reaction-mine' : 'chat-reaction-other'}"
										>
											<span>{r.emoji}</span>
											<span class="tabular-nums">{r.count}</span>
										</button>
									{/each}
								</div>
							{/if}
						</div>

						<!-- Action toolbar — visible on hover (desktop) or long-press (mobile) -->
						{#if !msg.is_deleted}
							<div
								data-msg-actions
								class="{actionsVisible ? 'flex' : 'hidden group-hover:flex'} items-center gap-0.5 absolute right-4 -top-4 px-1 py-1 shadow-2xl z-20"
								style="background: #0d0d12; border: 1px solid rgba(255,255,255,.08)"
							>
								<!-- Quick reactions (8 emojis directs) -->
								{#each QUICK_EMOJIS as qe}
									<button
										onclick={() => reactTo(msg.id, qe)}
										title={qe}
										class="w-7 h-7 flex items-center justify-center text-base rounded transition-all hover:scale-125 hover:bg-white/[0.07]">
										{qe}
									</button>
								{/each}
								<span class="w-px h-4 mx-0.5" style="background: rgba(255,255,255,.07)"></span>
								<!-- Réagir (full picker) -->
								<div data-picker class="relative">
									<button onclick={() => toggleEmojiPicker(msg.id)} title="Plus…"
									        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: #4b5563"
									        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
									        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = '#4b5563'}>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
									</button>
									{#if pickerMsgId === msg.id}
										<div data-picker class="absolute right-0 bottom-full mb-1 z-40">
											<EmojiPicker onselect={(emoji) => reactTo(msg.id, emoji)} />
										</div>
									{/if}
								</div>
								<span class="w-px h-4 mx-0.5" style="background: rgba(255,255,255,.07)"></span>
								<!-- Répondre -->
								<button onclick={() => startReply(msg)} title="Répondre"
								        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: #4b5563"
								        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
								        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = '#4b5563'}>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
								</button>
								{#if msg.author_id === userId}
									<!-- Modifier -->
									<button onclick={() => startEdit(msg)} title="Modifier"
									        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: #4b5563"
									        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
									        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = '#4b5563'}>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
									</button>
								{/if}
								{#if isAdmin}
									<!-- Épingler -->
									<button onclick={() => pinMessage(msg)} title={pinnedMessage?.id === msg.id ? 'Désépingler' : 'Épingler'}
									        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: {pinnedMessage?.id === msg.id ? '#a78bfa' : '#4b5563'}"
									        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
									        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = pinnedMessage?.id === msg.id ? '#a78bfa' : '#4b5563'}>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"/></svg>
									</button>
								{/if}
								{#if msg.author_id === userId || isAdmin}
									<!-- Supprimer -->
									<button onclick={() => confirmDelete(msg.id)} title="Supprimer"
									        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: #4b5563"
									        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#ef4444'}
									        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = '#4b5563'}>
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
									</button>
								{/if}
								<!-- Copier -->
								<button onclick={() => { navigator.clipboard.writeText(msg.content?.replace(/<[^>]*>/g, '') ?? '') }} title="Copier"
								        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: #4b5563"
								        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#9ca3af'}
								        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = '#4b5563'}>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
								</button>
							</div>
						{/if}
					</div>
					{/each}
				{/each}

				{#if messages.length === 0}
					<div class="flex flex-col items-center justify-center gap-3 mt-16 px-8">
						<div class="w-12 h-12 flex items-center justify-center" style="background: rgba(124,58,237,.08); border: 1px solid rgba(124,58,237,.15)">
							<svg class="w-6 h-6" fill="none" stroke="#7c3aed" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
						</div>
						<p class="text-sm font-semibold text-center" style="color: #4b5563; font-family: 'Space Grotesk', sans-serif">{tFn('chat.no_messages')}</p>
						<p class="text-xs text-center" style="color: #374151">{tFn('chat.empty_channel', { channel: selectedChannel.name })}</p>
					</div>
				{/if}
			</div>

			<!-- Scroll to bottom button -->
			{#if !isAtBottom}
				<button
					onclick={scrollToBottom}
					class="absolute bottom-3 right-4 z-10 flex items-center gap-2 pl-3 pr-2.5 py-1.5 transition-all duration-200 scroll-bottom-btn"
					style="background: rgba(13,13,20,0.95); border: 1px solid rgba(124,58,237,0.4); box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03);"
					transition:fade={{ duration: 120 }}
				>
					<span class="text-xs font-semibold" style="color: #a78bfa;">
						{#if unreadWhileScrolled > 0}{unreadWhileScrolled} nouveau{unreadWhileScrolled > 1 ? 'x' : ''}{:else}Retour en bas{/if}
					</span>
					<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="#a78bfa" stroke-width="2.5" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
					</svg>
				</button>
			{/if}

			</div><!-- end messages wrapper -->

			<!-- Typing indicator -->
			<div class="h-5 px-4 flex items-center gap-2">
				{#if typingUsers.length > 0}
					<div class="flex items-center gap-1.5" transition:fade={{ duration: 120 }}>
						<div class="flex items-center gap-0.5 shrink-0">
							<span class="typing-dot" style="animation-delay: 0ms"></span>
							<span class="typing-dot" style="animation-delay: 160ms"></span>
							<span class="typing-dot" style="animation-delay: 320ms"></span>
						</div>
						<span class="text-[10px] font-semibold italic" style="color: #4b5563">
							{#if typingUsers.length === 1}
								<span style="color: #a78bfa">{typingUsers[0]}</span> {tFn('chat.typing_suffix_one')}
							{:else if typingUsers.length === 2}
								<span style="color: #a78bfa">{typingUsers[0]}</span> {tFn('chat.typing_and')} <span style="color: #a78bfa">{typingUsers[1]}</span> {tFn('chat.typing_suffix_plural')}
							{:else}
								{tFn('chat.typing_many')}
							{/if}
						</span>
					</div>
				{/if}
			</div>

			<!-- Float reaction bar -->
			<div class="px-4 py-1.5 flex items-center gap-1 overflow-x-auto" style="scrollbar-width: none; border-top: 1px solid rgba(255,255,255,.04)">
				{#each FLOAT_EMOJIS as emoji}
					<button
						onclick={() => floatReact(emoji)}
						disabled={floatCooldown || !selectedChannel}
						class="fr-bar-btn"
						title="Réaction flottante"
					>{emoji}</button>
				{/each}
			</div>

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
									<p class="text-xs font-semibold text-white">{tFn('chat.gif_not_configured')}</p>
									<p class="text-xs text-gray-400 leading-relaxed">
										Ajoutez une clé gratuite dans <code class="bg-gray-800 px-1 rounded text-indigo-300">/var/www/nexus/nodyx-frontend/.env</code> puis rebuild :
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
										placeholder={tFn('chat.gif_search')}
										bind:value={gifQuery}
										oninput={onGifInput}
										class="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-600"
									/>
								</div>
								<div class="p-2 grid grid-cols-3 gap-1.5 max-h-56 overflow-y-auto" style="scrollbar-width:thin;">
									{#if gifLoading}
										<div class="col-span-3 text-center py-4 text-xs text-gray-500">{tFn('chat.gif_searching')}</div>
									{:else if gifResults.length === 0 && gifQuery}
										<div class="col-span-3 text-center py-4 text-xs text-gray-500">{tFn('chat.gif_no_results')}</div>
									{:else if gifResults.length === 0}
										<div class="col-span-3 text-center py-4 text-xs text-gray-500">{tFn('chat.gif_type_to_search')}</div>
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
									{tFn('chat.gif_powered_by', { provider: gifProvider })}
								</div>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Reply preview bar -->
				{#if replyTo}
					<div class="flex items-center gap-2.5 px-3 py-1.5 mb-2 text-xs" style="background: rgba(124,58,237,.08); border-left: 2px solid #7c3aed">
						<svg class="w-3 h-3 shrink-0" fill="none" stroke="#a78bfa" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"/></svg>
						<span class="font-bold shrink-0" style="color: #a78bfa">{replyTo.author_username}</span>
						<span class="truncate flex-1" style="color: #4b5563">{replyTo.content?.replace(/<[^>]*>/g, '').slice(0, 80) ?? ''}</span>
						<button onclick={() => replyTo = null} title="Annuler"
						        class="shrink-0 w-4 h-4 flex items-center justify-center text-sm leading-none transition-colors" style="color: #374151">×</button>
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
						<span>{tFn('chat.antispam', { s: String(Math.ceil((rateLimitedUntil - Date.now()) / 1000)) })}</span>
					</div>
				{/if}

				<div class="flex items-end gap-2 px-3 py-2 transition-all" style="background: rgba(255,255,255,.04); border: 1px solid {isRateLimited ? 'rgba(239,68,68,.4)' : 'rgba(255,255,255,.08)'}">
					<!-- Textarea -->
					<textarea
						id="chat-input"
						class="flex-1 bg-transparent py-1.5 text-sm resize-none outline-none max-h-32 disabled:opacity-50"
						style="color: #e2e8f0; font-family: inherit; scrollbar-width: thin"
						placeholder={isRateLimited ? tFn('chat.antispam_loading') : tFn('chat.input_placeholder', { channel: selectedChannel.name })}
						rows={1}
						maxlength={2000}
						bind:value={inputText}
						onkeydown={handleKeydown}
						oninput={handleInput}
						disabled={isRateLimited}
					></textarea>
					<!-- Toolbar -->
					<div class="flex items-center gap-0.5 shrink-0 pb-0.5">
						<!-- GIF -->
						<button data-gif-picker onclick={() => { showGifPicker = !showGifPicker; if (showGifPicker && gifProvider) gifQuery = ''; }}
						        title="GIF"
						        class="w-7 h-7 flex items-center justify-center text-[10px] font-black uppercase tracking-wide transition-colors"
						        style="color: {showGifPicker ? '#a78bfa' : '#4b5563'}; background: {showGifPicker ? 'rgba(124,58,237,.12)' : 'transparent'}">GIF</button>
						<!-- Poll -->
						<button onclick={() => showPollCreator = true} title={tFn('chat.new_poll')}
						        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: #4b5563"
						        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
						        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = '#4b5563'}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
						</button>
						<!-- Rich editor -->
						<button onclick={() => showRichModal = true} title={tFn('chat.rich_editor')}
						        class="w-7 h-7 flex items-center justify-center transition-colors" style="color: #4b5563"
						        onmouseenter={(e) => (e.currentTarget as HTMLElement).style.color = '#a78bfa'}
						        onmouseleave={(e) => (e.currentTarget as HTMLElement).style.color = '#4b5563'}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
						</button>
						<!-- Divider -->
						<span class="w-px h-4 mx-1" style="background: rgba(255,255,255,.07)"></span>
						<!-- Send -->
						<button onclick={sendMessage} disabled={!inputText.trim() || isRateLimited}
						        class="w-7 h-7 flex items-center justify-center transition-all disabled:opacity-30 disabled:cursor-not-allowed"
						        style="background: {isRateLimited ? 'rgba(239,68,68,.3)' : inputText.trim() ? 'linear-gradient(135deg, #7c3aed, #0e7490)' : 'rgba(255,255,255,.06)'}; color: {inputText.trim() ? '#fff' : '#4b5563'}"
						        title={isRateLimited ? tFn('chat.antispam_loading') : tFn('chat.send')}>
							{#if isRateLimited}
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
							{:else}
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
							{/if}
						</button>
					</div>
				</div>
				<p class="text-[10px] mt-1" style="color: #1f2937">↵ Envoyer · ⇧↵ Saut de ligne · ⌃⇧E Éditeur riche</p>
			</div>

			{/if}<!-- end voice/text branch -->

		<!-- Réactions flottantes — overlay fixe sur toute la page -->
		<FloatingReactions />

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
					{tFn('chat.send')}
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

	/* ── Scroll to bottom button ──────────────────────────────────────────── */
	.scroll-bottom-btn {
		animation: scroll-btn-in 150ms ease-out;
	}
	@keyframes scroll-btn-in {
		from { opacity: 0; transform: translateY(6px); }
		to   { opacity: 1; transform: translateY(0); }
	}
	.scroll-bottom-btn:hover {
		border-color: rgba(124, 58, 237, 0.7) !important;
		box-shadow: 0 4px 20px rgba(0,0,0,0.5), 0 0 12px rgba(124,58,237,0.15) !important;
	}

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

	/* ── Chat reaction pills ─────────────────────────────────────────────── */
	.chat-reaction-pill {
		border-radius: 99px;
		transition: transform .12s, background .12s, border-color .12s;
		animation: chat-pill-in .2s cubic-bezier(.34,1.56,.64,1) both;
	}
	.chat-reaction-pill:hover { transform: scale(1.1); }

	.chat-reaction-other {
		background: rgba(255,255,255,.04);
		border: 1px solid rgba(255,255,255,.08);
		color: #6b7280;
	}
	.chat-reaction-other:hover {
		background: rgba(255,255,255,.08);
		border-color: rgba(255,255,255,.15);
		color: #e2e8f0;
	}
	.chat-reaction-mine {
		background: rgba(124,58,237,.18);
		border: 1px solid rgba(124,58,237,.45);
		color: #c4b5fd;
		box-shadow: 0 0 8px rgba(124,58,237,.15);
	}
	.chat-reaction-mine:hover {
		background: rgba(124,58,237,.08);
		border-color: rgba(124,58,237,.2);
	}
	@keyframes chat-pill-in {
		from { transform: scale(0); opacity: 0; }
		to   { transform: scale(1); opacity: 1; }
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

	/* ── Float reaction bar buttons ──────────────────────────────────────── */
	.fr-bar-btn {
		flex-shrink:     0;
		width:           2rem;
		height:          2rem;
		display:         flex;
		align-items:     center;
		justify-content: center;
		font-size:       1.1rem;
		border-radius:   0.5rem;
		background:      transparent;
		border:          1px solid transparent;
		cursor:          pointer;
		transition:      transform 0.15s cubic-bezier(0.34, 1.56, 0.64, 1),
		                 background 0.1s,
		                 border-color 0.1s;
		user-select:     none;
	}
	.fr-bar-btn:hover:not(:disabled) {
		transform:    scale(1.3);
		background:   rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.1);
	}
	.fr-bar-btn:active:not(:disabled) {
		transform: scale(0.9);
	}
	.fr-bar-btn:disabled {
		opacity: 0.45;
		cursor:  not-allowed;
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
