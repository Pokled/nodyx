<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { LayoutData } from './$types';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { initSocket, unreadCountStore, chatMentionStore, dmUnreadStore, onlineMembersStore, getSocket } from '$lib/socket';
	import { tryAutoConnect } from '$lib/socket';
	import type { UserStatus } from '$lib/socket';
	import { resolveTheme, themeToVars } from '$lib/profileThemes';
	import { buildNameStyle, buildAnimClass, ensureFontLoaded, GOOGLE_FONTS_URL } from '$lib/nameEffects';
	import VoicePanel from '$lib/components/VoicePanel.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import MemberScreenPreview from '$lib/components/MemberScreenPreview.svelte';
	import MaintenanceBanner from '$lib/components/MaintenanceBanner.svelte';
	import { get } from 'svelte/store';
	import { voiceStore, voiceChannelMembersStore, voiceEventsStore, screenShareStore, remoteScreenStore } from '$lib/voice';
	import { locale, t } from '$lib/i18n';
	import { unreadCountsStore, flashChannelIdStore } from '$lib/unreadStore';
	import { playMention, playDm } from '$lib/sounds';
	const tFn = $derived($t)

	let { children, data }: { children: any; data: LayoutData } = $props();

	const user            = $derived(data.user);
	const isBanned        = $derived(data.user?.is_banned === true);
	const announcement    = $derived((data as any).activeAnnouncement as { id: string; message: string; color: string } | null);
	let announcementDismissed = $state<string | null>(null)
	const showAnnouncement = $derived(
		announcement !== null && announcementDismissed !== announcement?.id
	)
	const unreadCount     = $derived($unreadCountStore);
	const chatMentions    = $derived($chatMentionStore);
	const dmUnread        = $derived($dmUnreadStore);
	const onlineMembers   = $derived($onlineMembersStore);

	// ── Activités en temps réel ────────────────────────────────────────────────
	// Dérivé des stores voice : aucune modif backend requise.
	// Extensible : ajouter streamingUserIds quand le plugin Twitch Rust sera prêt.
	const screenSharingUserIds = $derived((() => {
		const ids = new Set<string>()
		// Partages distants : socketId → userId via peers
		for (const [socketId] of $remoteScreenStore) {
			const peer = $voiceStore.peers.find(p => p.socketId === socketId)
			if (peer) ids.add(peer.userId)
		}
		// Propre partage
		if ($screenShareStore) {
			const uid = (data.user as any)?.id
			if (uid) ids.add(uid)
		}
		return ids
	})())
	// Hook futur plugin Twitch/streaming — à peupler par le plugin Rust
	const streamingUserIds = $derived(new Set<string>())

	// Reset chat mention badge when user is on /chat
	$effect(() => {
		if ($page.url.pathname.startsWith('/chat') && $chatMentionStore > 0) {
			chatMentionStore.set(0)
		}
	})

	// Sound — @mention (play once per new mention, not on /chat which handles its own)
	let _lastMentionCount = 0
	$effect(() => {
		const c = $chatMentionStore
		if (c > _lastMentionCount && !$page.url.pathname.startsWith('/chat')) {
			playMention()
		}
		_lastMentionCount = c
	})

	// Sound — nouveau DM
	let _lastDmCount = 0
	$effect(() => {
		const c = $dmUnreadStore
		if (c > _lastDmCount) playDm()
		_lastDmCount = c
	})
	const communityName      = $derived(data.communityName ?? 'Nodyx');
	const communityLogo      = $derived((data as any).communityLogoUrl  as string | null);
	const communityBanner    = $derived((data as any).communityBannerUrl as string | null);
	const networkInstances   = $derived((data as any).networkInstances as Array<{
		slug: string; name: string; url: string;
		logo_url: string | null; members: number; online: number; last_seen: string | null;
	}> ?? []);

	function instanceOnline(last_seen: string | null): boolean {
		if (!last_seen) return false;
		return Date.now() - new Date(last_seen).getTime() < 5 * 60 * 1000;
	}
	const memberCount     = $derived((data as any).memberCount as number ?? 0);
	const mods            = $derived((data as any).modules as Record<string, boolean> ?? {});

	const isActive = (href: string) =>
		href === '/'
			? $page.url.pathname === '/'
			: $page.url.pathname.startsWith(href)

	// App-wide theme — uses the logged-in user's theme, falls back to default
	const appVars = $derived(themeToVars(resolveTheme((data as any).appTheme)))

	// All community members (for offline section in presence sidebar)
	let allMembers = $state<{ user_id: string; username: string; avatar: string | null }[]>([])

	// Offline = members who are NOT currently in the online list AND are not the current user
	// The logged-in user is always considered online (belt-and-suspenders against race conditions)
	const offlineMembers = $derived(
		allMembers.filter(m =>
			m.user_id !== (user as any)?.id &&
			!onlineMembers.some(o => o.userId === m.user_id)
		)
	)
	let showOffline = $state(false)

	onMount(async () => {
		locale.init()
		if (data.user && data.token && !data.user.is_banned) {
			// SSR provided a valid session — use it directly (skip if banned)
			initSocket(data.token, data.unreadCount ?? 0)

			// Optimistically add current user to the online store immediately.
			// presence:init will override with server-authoritative data once the
			// socket connects, but this prevents the user from seeing themselves
			// in the offline section during the connection window.
			const uid = (data.user as any).id as string | undefined
			if (uid && !onlineMembers.some(o => o.userId === uid)) {
				onlineMembersStore.update(list => {
					if (list.some(m => m.userId === uid)) return list
					return [...list, {
						userId:            uid,
						username:          data.user!.username,
						avatar:            (data.user as any).avatar ?? null,
						nameColor:         null,
						nameGlow:          null,
						nameGlowIntensity: null,
						nameAnimation:     null,
						nameFontFamily:    null,
						nameFontUrl:       null,
						grade:             null,
						status:            null,
					}]
				})
			}
		} else if (!data.user?.is_banned) {
			// No SSR session (guest page) — try reconnecting from stored token
			tryAutoConnect()
		}

		// Fetch full member list for the offline sidebar section + channels for layout sidebar
		if (data.user) {
			try {
				const { PUBLIC_API_URL } = await import('$env/static/public')
				const [membersRes, channelsRes] = await Promise.all([
					fetch(`${PUBLIC_API_URL}/api/v1/instance/members`),
					data.token
						? fetch(`${PUBLIC_API_URL}/api/v1/chat/channels`, {
								headers: { Authorization: `Bearer ${data.token}` }
							})
						: Promise.resolve(null),
				])
				if (membersRes.ok) allMembers = (await membersRes.json()).members ?? []
				if (channelsRes?.ok) layoutChannels = (await channelsRes.json()).channels ?? []
			} catch { /* ignore */ }
		}
	})

	// ── Galaxy Bar mobile drawer ───────────────────────────────────────────────
	let gallerySidebarOpen = $state(false)

	// Ferme le drawer sur changement de page (navigation SvelteKit)
	$effect(() => {
		const _ = $page.url.pathname
		gallerySidebarOpen = false
	})

	// Bloque le scroll du body quand le drawer est ouvert
	$effect(() => {
		if (!browser) return
		if (gallerySidebarOpen) {
			document.body.classList.add('no-scroll')
		} else {
			document.body.classList.remove('no-scroll')
		}
		return () => document.body.classList.remove('no-scroll')
	})

	// ── User dropdown ──────────────────────────────────────────────────────────
	let dropdownOpen = $state(false)

	// XP info — formule sqrt identique à ProfileCard / MiniProfileCard / page profil
	const xpInfo = $derived((() => {
		const pts   = user?.points ?? 0
		const level = Math.floor(Math.sqrt(Math.max(0, pts) / 10)) + 1
		const from  = (level - 1) * (level - 1) * 10
		const to    = level * level * 10
		const pct   = Math.min(100, Math.round(((pts - from) / (to - from)) * 100))
		return { pts, from, to, pct, level }
	})())

	function gradeTextColor(hex: string): string {
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
		return luminance > 0.5 ? '#111827' : '#ffffff'
	}

	// ── Channel Sidebar ────────────────────────────────────────────────────────
	let layoutChannels = $state<{id: string; name: string; type?: string}[]>([])
	const layoutTextChannels = $derived(layoutChannels.filter(c => !c.type || c.type === 'text'))
	const layoutVoiceChannels = $derived(layoutChannels.filter(c => c.type === 'voice'))
	const showChannelSidebar = $derived(
		!isBanned &&
		!$page.url.pathname.startsWith('/admin') &&
		!$page.url.pathname.startsWith('/auth') &&
		$page.url.pathname !== '/banned'
	)

	// Active channel ID from URL (used on /chat to highlight the current channel)
	const activeChatChannelId = $derived($page.url.searchParams.get('channel') ?? null)

	// ── Voice state (for member roster in sidebar) ─────────────────────────────
	const voiceState       = $derived($voiceStore)
	const vcMembers        = $derived($voiceChannelMembersStore)
	const voiceToasts      = $derived($voiceEventsStore)

	// ── Member groups by grade ─────────────────────────────────────────────────
	const memberGroups = $derived((() => {
		const groups = new Map<string, typeof onlineMembers>()
		const ungrouped: typeof onlineMembers = []
		for (const m of onlineMembers) {
			if (m.grade) {
				if (!groups.has(m.grade.name)) groups.set(m.grade.name, [])
				groups.get(m.grade.name)!.push(m)
			} else {
				ungrouped.push(m)
			}
		}
		return { groups, ungrouped }
	})())


	// ── Screen preview hover popup ────────────────────────────────────────────
	let screenPreview = $state<{ stream: MediaStream; username: string; avatar: string | null; x: number; y: number; side: 'left' | 'right' } | null>(null)

	// Use get() to read store values from within event handlers (not reactive context)
	function getScreenStream(userId: string): MediaStream | null {
		const peers  = get(voiceStore).peers
		const screens = get(remoteScreenStore)
		const peer = peers.find((p: any) => p.userId === userId)
		if (!peer) return null
		return screens.get(peer.socketId) ?? null
	}

	function showScreenPreview(e: MouseEvent, userId: string | null, username: string, avatar: string | null, side: 'left' | 'right') {
		if (!userId) return
		const stream = getScreenStream(userId)
		if (!stream) return
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const x = side === 'right' ? rect.right : rect.left
		screenPreview = { stream, username, avatar, x, y: rect.top, side }
	}

	// ── Custom status ─────────────────────────────────────────────────────────
	let showStatusModal = $state(false)
	let statusEmoji     = $state('')
	let statusText      = $state('')

	const PRESET_STATUSES = $derived([
		{ emoji: '💼', text: tFn('status.working') },
		{ emoji: '🎮', text: tFn('status.gaming') },
		{ emoji: '🎵', text: tFn('status.listening') },
		{ emoji: '📚', text: tFn('status.reading') },
		{ emoji: '🍕', text: tFn('status.lunch') },
		{ emoji: '🤔', text: tFn('status.thinking') },
		{ emoji: '😴', text: tFn('status.dnd') },
		{ emoji: '🏃', text: tFn('status.back_later') },
	])

	// Load custom fonts for online members whenever the list changes
	$effect(() => {
		for (const m of onlineMembers) {
			ensureFontLoaded(m.nameFontFamily ?? null, m.nameFontUrl ?? null)
		}
	})

	// Find logged-in user's current status from the store
	const myStatus = $derived(onlineMembers.find(m => m.userId === (user as any)?.id)?.status ?? null)

	function openStatusModal() {
		statusEmoji = myStatus?.emoji ?? ''
		statusText  = myStatus?.text ?? ''
		showStatusModal = true
	}

	async function saveStatus() {
		const payload = (statusEmoji || statusText)
			? { emoji: statusEmoji.trim(), text: statusText.trim() }
			: null
		showStatusModal = false

		// Optimistic local update — UI reflects the change immediately
		const uid = (user as any)?.id as string | undefined
		if (uid) {
			onlineMembersStore.update(list =>
				list.map(m => m.userId === uid ? { ...m, status: payload } : m)
			)
		}

		try {
			await fetch('/api/v1/instance/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
				body: JSON.stringify(payload ?? {}),
			})
		} catch { /* ignore network errors */ }
	}

	async function clearStatus() {
		showStatusModal = false
		const uid = (user as any)?.id as string | undefined
		if (uid) {
			onlineMembersStore.update(list =>
				list.map(m => m.userId === uid ? { ...m, status: null } : m)
			)
		}
		try {
			await fetch('/api/v1/instance/status', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${data.token}` },
				body: JSON.stringify({}),
			})
		} catch { /* ignore */ }
	}

	// ── Contextual breadcrumb ──────────────────────────────────────────────────
	const breadcrumbs = $derived((() => {
		const path = $page.url.pathname;
		const d = $page.data as any;
		if (path === '/') return [];
		const crumbs: { label: string; href?: string }[] = [];
		if (path.startsWith('/forum')) {
			crumbs.push({ label: tFn('nav.forum'), href: '/forum' });
			if (d?.category?.name) {
				const name = (d.category.name as string).replace(/^\p{Emoji}\s*/u, '');
				crumbs.push({ label: name, href: `/forum/${d.category.slug ?? d.category.id}` });
			}
			if (d?.thread?.title) crumbs.push({ label: d.thread.title });
		} else if (path.startsWith('/chat')) {
			crumbs.push({ label: tFn('nav.chat') });
			const chId = $page.url.searchParams.get('channel');
			if (chId) {
				const ch = layoutChannels.find(c => c.id === chId);
				if (ch) crumbs.push({ label: (ch.type === 'voice' ? '🔊 ' : '# ') + ch.name });
			}
		} else if (path.startsWith('/dm'))           { crumbs.push({ label: tFn('nav.dm') });
		} else if (path.startsWith('/calendar'))     { crumbs.push({ label: tFn('nav.calendar') });
		} else if (path.startsWith('/discover'))     { crumbs.push({ label: tFn('nav.discover') });
		} else if (path.startsWith('/admin'))        { crumbs.push({ label: tFn('nav.admin') });
		} else if (path.startsWith('/notifications')){ crumbs.push({ label: tFn('nav.notifications') });
		} else if (path.startsWith('/settings'))     { crumbs.push({ label: tFn('nav.settings') });
		} else if (path.startsWith('/users/me/edit')){ crumbs.push({ label: tFn('nav.edit_profile') });
		} else if (path.startsWith('/users/'))       { crumbs.push({ label: path.split('/')[2] ?? tFn('nav.profile') });
		} else if (path.startsWith('/communities'))  { crumbs.push({ label: tFn('nav.communities') });
		} else if (path.startsWith('/polls'))        { crumbs.push({ label: tFn('nav.polls') });
		} else if (path.startsWith('/tasks'))        { crumbs.push({ label: tFn('nav.tasks') });
		} else if (path.startsWith('/wiki'))         { crumbs.push({ label: tFn('nav.wiki') });
		} else if (path.startsWith('/library'))      { crumbs.push({ label: tFn('nav.library') });
		} else if (path.startsWith('/search'))       { crumbs.push({ label: tFn('nav.search') });
		} else if (path.startsWith('/garden'))       { crumbs.push({ label: tFn('nav.garden') });
		} else {
			const seg = path.split('/')[1];
			if (seg) crumbs.push({ label: seg.charAt(0).toUpperCase() + seg.slice(1) });
		}
		return crumbs;
	})())

	// ── Header search ──────────────────────────────────────────────────────────
	let searchQ      = $state('');
	let searchFocused = $state(false);
	function doSearch(e: Event) {
		e.preventDefault();
		if (searchQ.trim()) { goto(`/search?q=${encodeURIComponent(searchQ.trim())}`); searchQ = ''; }
	}

	// ── Command Palette ────────────────────────────────────────────────────────
	let paletteOpen = $state(false)

	function handleGlobalKeydown(e: KeyboardEvent) {
		// Ctrl+K or Cmd+K — open palette
		if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
			e.preventDefault()
			paletteOpen = true
			return
		}
		// Close on Escape only if palette is open (palette handles its own Esc)
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
	{#if communityLogo}
		<link rel="icon" href={communityLogo} />
	{/if}
	<meta property="og:site_name" content={communityName} />
	<meta name="theme-color" content="#6366f1" />
	<!-- Preload all Google Font presets (avatar/username effects) -->
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href={GOOGLE_FONTS_URL} />
</svelte:head>

<div class="min-h-screen flex flex-col" style="{appVars}; background: var(--p-bg); color: var(--p-text)">

	<!-- ══ MAINTENANCE BANNER (sticky top, hidden when no op in progress) ════════ -->
	<MaintenanceBanner />

	<!-- ══ CONTEXT BAR ══════════════════════════════════════════════════════== -->
	<nav class="sticky top-0 z-50 shrink-0 h-12 flex items-center px-4 gap-3"
	     style="background: #0d0d12; border-bottom: 1px solid rgba(255,255,255,.05)">

		<!-- Mobile hamburger -->
		{#if !isBanned}
		<button
			class="lg:hidden shrink-0 p-1.5 flex items-center justify-center transition-colors"
			style="color: {gallerySidebarOpen ? '#fff' : '#6b7280'}"
			onclick={() => gallerySidebarOpen = !gallerySidebarOpen}
			aria-label={tFn('nav.community_menu')} aria-expanded={gallerySidebarOpen} aria-controls="galaxy-sidebar">
			{#if gallerySidebarOpen}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
				</svg>
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
				</svg>
			{/if}
		</button>
		{/if}

		<!-- Mobile: community name logo -->
		<a href="/" class="lg:hidden shrink-0 font-black text-sm truncate max-w-[140px]"
		   style="font-family: 'Space Grotesk', sans-serif; background: linear-gradient(135deg, #a78bfa, #67e8f9); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent">
			{communityName}
		</a>

		<!-- Desktop: logo + breadcrumb -->
		<div class="hidden lg:flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
			<!-- Logo toujours visible -->
			<a href="/" class="shrink-0 font-black text-sm"
			   style="font-family: 'Space Grotesk', sans-serif; background: linear-gradient(135deg, #a78bfa, #67e8f9); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent">
				{communityName}
			</a>
			<!-- Breadcrumb dynamique (masqué sur la homepage) -->
			{#if breadcrumbs.length > 0}
				<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="color: #374151">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
				</svg>
				{#each breadcrumbs as crumb, i}
					{#if i > 0}
						<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="color: #374151">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
						</svg>
					{/if}
					{#if crumb.href && i < breadcrumbs.length - 1}
						<a href={crumb.href}
						   class="text-xs font-medium shrink-0 transition-colors hover:text-white truncate max-w-[160px]"
						   style="color: #6b7280">{crumb.label}</a>
					{:else}
						<span class="text-xs font-semibold truncate min-w-0"
						      style="color: #e2e8f0">{crumb.label}</span>
					{/if}
				{/each}
			{/if}
		</div>

		<!-- Desktop: command palette trigger -->
		<button
			type="button"
			onclick={() => paletteOpen = true}
			class="hidden lg:flex items-center gap-2 px-3 h-7 w-56 transition-colors"
			style="background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); cursor: text; text-align: left;"
			aria-label={tFn('common.command_palette_hint')}
		>
			<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: #3b3f52; flex-shrink:0">
				<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
			</svg>
			<span class="flex-1 text-xs truncate" style="color: #3b3f52; font-family: 'Space Grotesk', sans-serif">{tFn('common.search_navigate')}</span>
			<div style="display:flex;gap:2px;flex-shrink:0">
				<kbd style="font-size:0.6rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);padding:0.05rem 0.28rem;color:rgba(255,255,255,.18);font-family:ui-monospace,monospace">Ctrl</kbd>
				<kbd style="font-size:0.6rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);padding:0.05rem 0.28rem;color:rgba(255,255,255,.18);font-family:ui-monospace,monospace">K</kbd>
			</div>
		</button>

		<!-- Right: actions (notifs + DMs + account) -->
		<div class="flex items-center gap-1 shrink-0 ml-auto lg:ml-0">
			{#if user}
				<!-- Notifications -->
				<a href="/notifications"
				   class="relative p-2 transition-colors"
				   style="color: {isActive('/notifications') ? '#a78bfa' : '#6b7280'}"
				   title={tFn('nav.notifications')}>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
					</svg>
					{#if unreadCount > 0}
						<span class="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center text-[9px] font-black text-white rounded-full" style="background: #ef4444; line-height: 1">{unreadCount > 9 ? '9+' : unreadCount}</span>
					{/if}
				</a>
				<!-- DMs -->
				<a href="/dm"
				   class="relative p-2 transition-colors"
				   style="color: {isActive('/dm') ? '#a78bfa' : '#6b7280'}"
				   title={tFn('nav.dm')}>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
					</svg>
					{#if dmUnread > 0}
						<span class="absolute top-0.5 right-0.5 min-w-[14px] h-3.5 px-0.5 flex items-center justify-center text-[9px] font-black text-white rounded-full" style="background: #7c3aed; line-height: 1">{dmUnread > 9 ? '9+' : dmUnread}</span>
					{/if}
				</a>
				{#if user.role === 'owner' || user.role === 'admin'}
					<a href="/admin"
					   class="hidden sm:flex items-center px-2.5 h-7 text-[10px] font-black uppercase tracking-wider transition-colors"
					   style="color: {isActive('/admin') ? '#a78bfa' : '#4b5563'}; border: 1px solid {isActive('/admin') ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.06)'}">Admin</a>
				{/if}
				<!-- User dropdown -->
				<div class="relative">
					<button onclick={() => dropdownOpen = !dropdownOpen}
					        class="flex items-center gap-2 px-2 h-8 transition-colors group ml-1"
					        style="border: 1px solid {dropdownOpen ? 'rgba(124,58,237,.4)' : 'rgba(255,255,255,.07)'}; background: {dropdownOpen ? 'rgba(124,58,237,.08)' : 'rgba(255,255,255,.04)'}"
					        aria-haspopup="true" aria-expanded={dropdownOpen}>
						<div class="relative shrink-0">
							{#if user.avatar}
								<img src={user.avatar} alt="Avatar" class="w-6 h-6 object-cover" style="outline: 1px solid rgba(255,255,255,.15)" />
							{:else}
								<div class="w-6 h-6 flex items-center justify-center text-xs font-bold text-white select-none" style="background: linear-gradient(135deg, #7c3aed, #0e7490)">{user.username.charAt(0).toUpperCase()}</div>
							{/if}
							<span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full" style="background: #4ade80; border: 1.5px solid #0d0d12"></span>
						</div>
						<span class="hidden sm:inline text-xs font-semibold max-w-[90px] truncate" style="color: #d1d5db; font-family: 'Space Grotesk', sans-serif">{user.username}</span>
						<svg class="hidden sm:block w-2.5 h-2.5 transition-transform {dropdownOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="color: #4b5563"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
					</button>

						{#if dropdownOpen}
							<div class="fixed inset-0 z-40" role="none" onclick={() => dropdownOpen = false} onkeydown={() => {}}></div>
							<div class="absolute right-0 top-full mt-2 w-72 z-50 rounded-xl bg-gray-900 border border-gray-700/80 shadow-2xl overflow-hidden">
								<div class="px-4 pt-4 pb-3 bg-gray-800/50">
									<div class="flex items-center gap-3">
										{#if user.avatar}
											<img src={user.avatar} alt="Avatar" class="w-12 h-12 rounded-full object-cover border-2 border-gray-600 shrink-0" />
										{:else}
											<div class="w-12 h-12 rounded-full bg-indigo-700 flex items-center justify-center text-white text-xl font-bold border-2 border-gray-600 shrink-0 select-none">{user.username.charAt(0).toUpperCase()}</div>
										{/if}
										<div class="min-w-0 flex-1">
											<div class="font-semibold text-white text-sm truncate">{user.username}</div>
											{#if user.grade}
												<span class="inline-block text-[11px] font-medium rounded px-1.5 py-0.5 mt-0.5" style="background-color: {user.grade.color}; color: {gradeTextColor(user.grade.color)}">{user.grade.name}</span>
											{:else}
												<span class="text-xs text-gray-500">{tFn('common.member')}</span>
											{/if}
										</div>
									</div>
									<div class="mt-3">
										<div class="flex justify-between items-center mb-1">
											<span class="text-[11px] text-gray-400">{#if xpInfo.to}{xpInfo.pts.toLocaleString()} / {xpInfo.to.toLocaleString()} pts{:else}{xpInfo.pts.toLocaleString()} pts · Max{/if}</span>
											<span class="text-[11px] text-indigo-400 font-medium">{xpInfo.pct}%</span>
										</div>
										<div class="h-1.5 rounded-full bg-gray-700 overflow-hidden">
											<div class="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all" style="width: {xpInfo.pct}%"></div>
										</div>
									</div>
								</div>
								<!-- Status quick-set -->
								<button
									onclick={() => { dropdownOpen = false; openStatusModal(); }}
									class="w-full flex items-center gap-3 px-4 py-2.5 bg-gray-800/40 border-b border-gray-700/40 hover:bg-gray-800/80 transition-colors text-left"
								>
									<span class="text-base shrink-0">{myStatus?.emoji || '😶'}</span>
									<span class="flex-1 min-w-0">
										{#if myStatus?.text}
											<span class="text-xs text-gray-300 truncate block">{myStatus.text}</span>
										{:else}
											<span class="text-xs text-gray-600">{tFn('common.set_status')}</span>
										{/if}
									</span>
									<svg class="w-3.5 h-3.5 text-gray-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
								</button>

								<div class="py-1.5">
									<a href="/users/{user.username}" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors"><span class="text-base">👤</span><span>{tFn('user.my_profile')}</span></a>
									<a href="/users/me/edit" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors"><span class="text-base">✏️</span><span>{tFn('user.edit_profile')}</span></a>
									<a href="/notifications" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors">
										<span class="text-base">🔔</span><span class="flex-1">{tFn('nav.notifications')}</span>
										{#if unreadCount > 0}<span class="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>{/if}
									</a>
								</div>
								<div class="border-t border-gray-700/60 mx-3"></div>
								<div class="py-1.5">
									<a href="/settings" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors"><span class="text-base">⚙️</span><span>{tFn('nav.settings')}</span></a>
									<a href="https://nodyx.dev" target="_blank" rel="noopener" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors"><span class="text-base">📖</span><span>{tFn('nav.documentation')}</span></a>
									{#each [{ icon: '📊', label: tFn('user.my_activity') }, { icon: '👫', label: tFn('user.friends') }, { icon: '🏆', label: tFn('user.badges') }] as item}
										<div class="flex items-center gap-3 px-4 py-2 text-sm text-gray-600 cursor-not-allowed select-none">
											<span class="text-base opacity-50">{item.icon}</span><span class="flex-1">{item.label}</span><span class="text-[10px] uppercase tracking-wider text-gray-700 font-medium">{tFn('common.soon')}</span>
										</div>
									{/each}
								</div>
								<div class="border-t border-gray-700/60 mx-3"></div>
								<div class="py-1.5">
									<form method="POST" action="/auth/logout">
										<button type="submit" class="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800/60 transition-colors text-left">
											<span class="text-base">🚪</span><span>{tFn('common.logout')}</span>
										</button>
									</form>
								</div>
							</div>
						{/if}
					</div>
			{:else}
				<a href="/auth/login"
				   class="px-2.5 h-6 flex items-center text-xs transition-colors"
				   style="color: #9ca3af; border: 1px solid rgba(255,255,255,.06)">{tFn('common.login')}</a>
				<a href="/auth/register"
				   class="px-2.5 h-6 flex items-center text-xs font-bold transition-colors"
				   style="background: #7c3aed; color: #fff">{tFn('common.register')}</a>
			{/if}
		</div>
	</nav>

	<!-- ══ BODY ═══════════════════════════════════════════════════════════════ -->
	<div class="flex flex-1">

		<!-- ── Backdrop Channel Sidebar — mobile ──────────────────────────────── -->
		{#if !isBanned && gallerySidebarOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="lg:hidden fixed inset-0 bg-black/60 z-[54] backdrop-blur-sm"
		     role="button" tabindex="-1" aria-label={tFn('common.close_menu')}
		     onclick={() => gallerySidebarOpen = false}
		     onkeydown={e => e.key === 'Escape' && (gallerySidebarOpen = false)}
		     transition:fade={{ duration: 200 }}></div>
		{/if}

		<!-- ── Instance Switcher (72px) — desktop only ────────────────────────── -->
		{#if !isBanned}
		<aside class="hidden lg:flex flex-col items-center fixed left-0 top-12 bottom-0 w-[72px]
		              border-r border-gray-800/60 py-3 gap-2 z-[55] overflow-y-auto overflow-x-hidden"
		       style="background: var(--p-bg)">

			<!-- Current instance — active with violet ring -->
			<div class="relative flex items-center group">
				<span class="absolute -left-3 w-1 h-8 rounded-r-full bg-white pointer-events-none"></span>
				<a href="/" title={communityName}
				   class="w-12 h-12 flex items-center justify-center rounded-[30%]
				          hover:rounded-[40%] transition-all duration-200 overflow-hidden shrink-0
				          ring-2 ring-indigo-500 ring-offset-2 ring-offset-gray-950">
					{#if communityLogo}
						<img src={communityLogo} alt="Logo" class="w-full h-full object-cover" />
					{:else}
						<div class="w-full h-full bg-indigo-600 flex items-center justify-center text-white font-bold text-lg select-none">
							{communityName.charAt(0).toUpperCase()}
						</div>
					{/if}
				</a>
			</div>

			<!-- Separator -->
			{#if networkInstances.length > 0}
			<div class="w-8 border-t border-gray-700/60 my-0.5 shrink-0"></div>
			{/if}

			<!-- Network instances -->
			{#each networkInstances as inst}
				<a href={inst.url} target="_blank" rel="noopener noreferrer" title={inst.name}
				   class="relative w-11 h-11 flex items-center justify-center rounded-[30%]
				          hover:rounded-[40%] transition-all duration-200
				          bg-gray-700/80 hover:bg-gray-600 overflow-hidden shrink-0">
					{#if inst.logo_url}
						<img src={inst.logo_url.startsWith('http') ? inst.logo_url : inst.url.replace(/\/$/, '') + inst.logo_url}
						     alt={inst.name} class="w-full h-full object-cover" />
					{:else}
						<span class="text-sm font-bold text-gray-200 select-none">
							{inst.name.charAt(0).toUpperCase()}
						</span>
					{/if}
					<span class="absolute bottom-0.5 right-0.5 w-2.5 h-2.5 rounded-full border-2 border-gray-900
					             {instanceOnline(inst.last_seen) ? 'bg-green-400' : 'bg-gray-600'}"></span>
				</a>
			{/each}

			<!-- Add / discover -->
			<a href="/communities" title={tFn('nav.discover_title')}
			   class="w-11 h-11 flex items-center justify-center rounded-full shrink-0
			          border-2 border-dashed border-gray-600 hover:border-indigo-500
			          text-gray-500 hover:text-indigo-400 transition-all duration-200
			          text-xl font-light leading-none">
				+
			</a>

			<!-- Settings at bottom -->
			{#if user}
			<div class="mt-auto flex flex-col items-center gap-1">
				<a href="https://nodyx.dev" target="_blank" rel="noopener" title="Documentation"
				   class="w-11 h-11 flex items-center justify-center rounded-[30%]
				          hover:rounded-[40%] bg-gray-800/60 hover:bg-gray-700 transition-all
				          text-gray-500 hover:text-indigo-400">
					<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
					</svg>
				</a>
				<a href="/settings" title={tFn('nav.settings')}
				   class="w-11 h-11 flex items-center justify-center rounded-[30%]
				          hover:rounded-[40%] bg-gray-800 hover:bg-gray-700 transition-all
				          text-gray-500 hover:text-gray-300">
					<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</a>
			</div>
			{/if}
		</aside>
		{/if}

		<!-- ── Channel Sidebar (220px) — mobile drawer + desktop conditional ──── -->
		{#if !isBanned}
		<aside
			id="galaxy-sidebar"
			class="flex flex-col fixed top-12 bottom-0
			       max-lg:left-0 max-lg:w-[280px] max-lg:z-[55]
			       lg:left-[72px] lg:w-[220px] lg:z-30
			       {showChannelSidebar ? 'lg:flex' : 'lg:hidden'}
			       transition-transform duration-300 ease-in-out
			       {gallerySidebarOpen ? 'translate-x-0' : 'max-lg:-translate-x-full'}"
			style="background: #12121a; border-right: 1px solid rgba(255,255,255,.05)"
			role={gallerySidebarOpen ? 'dialog' : undefined}
			aria-modal={gallerySidebarOpen ? 'true' : undefined}
			aria-label={tFn('nav.community_menu')}>

			<!-- Community header -->
			<div class="flex items-center justify-between px-4 py-3 shrink-0"
			     style="border-bottom: 1px solid rgba(255,255,255,.06); background: #0d0d12">
				<span class="text-sm font-bold truncate"
				      style="font-family: 'Space Grotesk', sans-serif; color: #e2e8f0; letter-spacing: -.01em">
					{communityName}
				</span>
				{#if user?.role === 'owner' || user?.role === 'admin'}
				<a href="/admin" title="Administration" class="shrink-0 transition-colors" style="color: #4b5563">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</a>
				{/if}
			</div>

			<!-- Nav -->
			<nav class="flex-1 overflow-y-auto py-4 px-3 space-y-5" style="scrollbar-width: none">

				<!-- NAVIGATION -->
				<div>
					<p class="px-2 mb-1.5 text-[9px] uppercase tracking-[.2em] font-black"
					   style="color: #374151">{tFn('nav.section.navigation')}</p>
					<div class="space-y-px">
						{#each [
							{ href: '/',         label: tFn('nav.home'),    icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',                                                                                                                                                 show: true },
							{ href: '/feed',     label: 'Fil d\'actu', icon: 'M3 12h18M3 6h18M3 18h18',                                                                                                                                                               show: !!user },
							{ href: '/forum',    label: tFn('nav.forum'),   icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',                          show: true },
							{ href: '/chat',     label: tFn('nav.chat'),    icon: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',                                                                                                                                    show: mods.chat !== false },
							{ href: '/dm',       label: tFn('nav.dm'),      icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',                                                                                    show: mods.dm !== false },
						].filter(i => i.show) as item}
						<a href={item.href}
						   class="relative flex items-center gap-2.5 px-2.5 py-2 text-sm transition-all"
						   style="color: {isActive(item.href) ? '#e2e8f0' : '#6b7280'}; background: {isActive(item.href) ? 'rgba(124,58,237,.12)' : 'transparent'}">
							{#if isActive(item.href)}
								<span class="absolute left-0 top-1 bottom-1 w-0.5"
								      style="background: linear-gradient(to bottom, #7c3aed, #06b6d4)"></span>
							{/if}
							<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d={item.icon}/>
							</svg>
							<span class="text-xs font-semibold">{item.label}</span>
						</a>
						{/each}
					</div>
				</div>

				<!-- MODULES -->
				<div>
					<p class="px-2 mb-1.5 text-[9px] uppercase tracking-[.2em] font-black"
					   style="color: #374151">{tFn('nav.section.modules')}</p>
					<div class="space-y-px">
						{#each [
							{ href: '/calendar', label: tFn('nav.calendar'),   icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',                                                                                                                                                                                                          show: mods.calendar !== false },
							{ href: '/polls',    label: tFn('nav.polls'),     icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',                                                                                          show: mods.polls !== false },
							{ href: '/tasks',    label: tFn('nav.tasks'),       icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',                                                                                                                                                    show: mods.tasks !== false },
							{ href: '/wiki',     label: tFn('nav.wiki'),         icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',                                             show: !!mods.wiki },
							{ href: '/library',  label: tFn('nav.library'), icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',                                             show: true },
							{ href: '/garden',   label: tFn('nav.garden'),       icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',                                                                                                                                            show: true },
							{ href: '/discover', label: tFn('nav.discover'),    icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',                                                                                         show: true },
						].filter(i => i.show) as item}
						<a href={item.href}
						   class="relative flex items-center gap-2.5 px-2.5 py-2 text-sm transition-all"
						   style="color: {isActive(item.href) ? '#e2e8f0' : '#6b7280'}; background: {isActive(item.href) ? 'rgba(124,58,237,.12)' : 'transparent'}">
							{#if isActive(item.href)}
								<span class="absolute left-0 top-1 bottom-1 w-0.5"
								      style="background: linear-gradient(to bottom, #7c3aed, #06b6d4)"></span>
							{/if}
							<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d={item.icon}/>
							</svg>
							<span class="text-xs font-medium">{item.label}</span>
						</a>
						{/each}
					</div>
				</div>

				<!-- COMMUNICATIONS -->
				{#if (layoutTextChannels.length > 0 && mods.chat !== false) || (layoutVoiceChannels.length > 0 && mods.voice !== false)}
				<div>
					<p class="px-2 mb-1.5 text-[9px] uppercase tracking-[.2em] font-black"
					   style="color: #374151">{tFn('nav.section.communications')}</p>
					<div class="space-y-px">
						{#if mods.chat !== false && layoutTextChannels.length > 0}
						<!-- Sous-label Texte -->
						<div class="lch-sublabel">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M7.875 14.25l1.214 1.942a2.25 2.25 0 001.908 1.058h2.006c.776 0 1.497-.4 1.908-1.058l1.214-1.942M2.41 9h4.636a2.25 2.25 0 011.872 1.002l.164.246a2.25 2.25 0 001.872 1.002h2.092a2.25 2.25 0 001.872-1.002l.164-.246A2.25 2.25 0 0116.954 9h4.636M2.41 9a2.25 2.25 0 00-.16.832V12a2.25 2.25 0 002.25 2.25h15a2.25 2.25 0 002.25-2.25V9.832c0-.287-.055-.57-.16-.832M2.41 9a2.25 2.25 0 01.382-.632l3.285-3.832a2.25 2.25 0 011.708-.786h8.43c.657 0 1.281.287 1.709.786l3.284 3.832c.163.19.291.404.382.632"/>
							</svg>
							<span>Texte</span>
						</div>
					{#each layoutTextChannels as ch}
						{@const chActive = activeChatChannelId === ch.id}
						{@const chUnread = ($unreadCountsStore[ch.id] ?? 0)}
						{@const chFlash  = $flashChannelIdStore === ch.id}
						{@const hasUnread = chUnread > 0 && !chActive}
						<a href="/chat?channel={ch.id}"
						   class="lch-item relative flex items-center gap-2.5 px-2.5 py-2 text-sm
						          {chActive ? 'lch-active' : hasUnread ? 'lch-unread' : 'lch-idle'}
						          {chFlash ? 'lch-flash' : ''}">
							{#if chActive}
								<span class="absolute left-0 top-1 bottom-1 w-0.5" style="background: linear-gradient(to bottom, #7c3aed, #06b6d4)"></span>
							{/if}
							<span class="text-base font-bold leading-none shrink-0"
							      style="color: {chActive ? '#a78bfa' : hasUnread ? '#7c3aed' : '#374151'}">#</span>
							<span class="text-xs truncate flex-1" class:font-semibold={hasUnread}>{ch.name}</span>
							{#if hasUnread}
								<span class="lch-badge">{chUnread > 99 ? '99+' : chUnread}</span>
							{/if}
						</a>
						{/each}
					{/if}
					{#if mods.voice !== false && layoutVoiceChannels.length > 0}
						<!-- Sous-label Vocal -->
						<div class="lch-sublabel lch-sublabel--voice">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/>
							</svg>
							<span>Vocal</span>
						</div>
						{#each layoutVoiceChannels as ch}
						{@const chActive = activeChatChannelId === ch.id}
						{@const inThis   = voiceState.active && voiceState.channelId === ch.id}
						{@const members  = inThis
							? [
								...voiceState.peers.map((p: any) => ({ username: p.username, avatar: p.avatar ?? null, speaking: p.speaking ?? false, muted: false, deafened: false, isMe: false, userId: p.userId ?? null, socketId: p.socketId ?? null })),
								{ username: user?.username ?? tFn('common.you'), avatar: user?.avatar ?? null, speaking: voiceState.mySpeaking, muted: voiceState.muted, deafened: voiceState.deafened, isMe: true, userId: (user as any)?.id ?? null, socketId: null },
							]
							: (vcMembers[ch.id] ?? []).map((m: any) => ({ ...m, speaking: false, muted: false, deafened: false, isMe: false, userId: m.userId ?? null, socketId: null }))}
						<a href="/chat?channel={ch.id}"
						   class="relative flex items-center gap-2.5 px-2.5 py-2 text-sm transition-all"
						   style="color: {chActive ? '#e2e8f0' : '#4b5563'}; background: {chActive ? 'rgba(124,58,237,.12)' : 'transparent'}">
							{#if chActive}
								<span class="absolute left-0 top-1 bottom-1 w-0.5" style="background: linear-gradient(to bottom, #7c3aed, #06b6d4)"></span>
							{/if}
							<svg class="lch-voice-ico" fill="none" stroke="{inThis ? '#4ade80' : chActive ? '#a78bfa' : '#374151'}" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z"/>
							</svg>
							<span class="text-xs truncate flex-1">{ch.name}</span>
							{#if members.length > 0}
								<span class="text-[10px] font-bold shrink-0" style="color: {inThis ? '#a78bfa' : '#374151'}">{members.length}</span>
							{/if}
						</a>
						<!-- Membres connectés -->
						{#if members.length > 0}
							<div class="flex flex-col pl-5 pr-1 pt-0.5 pb-1.5 gap-0.5">
								{#each members.slice(0, 6) as m}
									{@const mSharing = !!(m.userId && screenSharingUserIds.has(m.userId))}
									{@const borderColor = m.speaking ? 'rgba(74,222,128,0.6)' : m.deafened ? 'rgba(249,115,22,0.45)' : m.muted ? 'rgba(239,68,68,0.35)' : mSharing ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.04)'}
									{@const bgColor    = m.speaking ? 'rgba(74,222,128,0.07)' : m.deafened ? 'rgba(249,115,22,0.05)' : m.muted ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.02)'}
									{@const nameColor  = m.speaking ? '#86efac' : m.deafened ? '#fdba74' : m.muted ? '#fca5a5' : m.isMe ? '#c4b5fd' : '#6b7280'}
									<!-- svelte-ignore a11y_no_static_element_interactions -->
									<div class="vc-member-card relative flex items-center gap-2 px-2 py-1.5 transition-all duration-200"
									     style="background:{bgColor}; border-left:2px solid {borderColor};"
									     onmouseenter={mSharing ? (e: MouseEvent) => showScreenPreview(e, m.userId, m.username, m.avatar, 'right') : undefined}
									     onmouseleave={() => { screenPreview = null }}>

										<!-- Avatar -->
										<div class="relative shrink-0">
											<div class="w-[22px] h-[22px] rounded-full overflow-hidden transition-all duration-200"
											     style="box-shadow:{m.speaking ? '0 0 0 2px rgba(74,222,128,0.55), 0 0 8px rgba(74,222,128,0.25)' : 'none'}">
												{#if m.avatar}
													<img src={m.avatar} alt={m.username} class="w-full h-full object-cover"/>
												{:else}
													<div class="w-full h-full flex items-center justify-center text-[9px] font-black text-white select-none"
													     style="background:linear-gradient(135deg,#7c3aed,#0e7490)">
														{m.username.charAt(0).toUpperCase()}
													</div>
												{/if}
											</div>
											<!-- Screen share badge -->
											{#if mSharing}
												<div class="absolute -bottom-0.5 -right-0.5 w-[11px] h-[11px] rounded-full flex items-center justify-center"
												     style="background:#3b82f6;border:1.5px solid #0d0d12">
													<svg style="width:6px;height:5px" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 17">
														<rect x="1" y="1" width="22" height="13" rx="2"/>
													</svg>
												</div>
											{/if}
										</div>

										<!-- Username -->
										<span class="text-[11px] font-medium truncate flex-1 transition-colors duration-200"
										      style="color:{nameColor}">
											{m.isMe ? tFn('common.you') : m.username}
										</span>

										<!-- Right: wave bars if speaking, else status icons -->
										{#if m.speaking && !m.muted && !m.deafened}
											<div class="vc-wave-bars shrink-0" aria-label="Parle">
												<span class="vc-bar" style="animation-delay:0s"></span>
												<span class="vc-bar" style="animation-delay:0.18s"></span>
												<span class="vc-bar" style="animation-delay:0.09s"></span>
											</div>
										{:else}
											<div class="flex items-center gap-0.5 shrink-0">
												{#if m.deafened}
													<svg class="w-[11px] h-[11px]" aria-label="Écouteurs coupés" style="color:#fb923c" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
														<path stroke-linecap="round" d="M3 18v-6a9 9 0 0118 0v6"/>
														<path stroke-linecap="round" d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>
														<path stroke-linecap="round" d="M2 2l20 20"/>
													</svg>
												{/if}
												{#if m.muted}
													<svg class="w-[11px] h-[11px]" aria-label="Micro coupé" style="color:#f87171" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
														<path stroke-linecap="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
														<path stroke-linecap="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>
													</svg>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
								{#if members.length > 6}
									<span class="text-[10px] pl-2 pt-0.5" style="color:#374151">{tFn('common.others_more', { n: members.length - 6 })}</span>
								{/if}
							</div>
						{/if}
						{/each}
					{/if}
					</div>
				</div>
				{/if}

				</nav>

			<!-- Voice controls (micro, déconnexion, statut) -->
			<VoicePanel mode="sidebar" />

			<!-- User footer -->
			{#if user}
			<div class="shrink-0 px-3 py-3 flex items-center gap-2.5"
			     style="border-top: 1px solid rgba(255,255,255,.05); background: #0d0d12">
				<div class="relative shrink-0">
					{#if user.avatar}
						<img src={user.avatar} alt="" class="w-8 h-8 object-cover" style="outline: 1px solid rgba(255,255,255,.1)" />
					{:else}
						<div class="w-8 h-8 flex items-center justify-center text-xs font-bold text-white select-none"
						     style="background: linear-gradient(135deg, #7c3aed, #0e7490)">
							{user.username.charAt(0).toUpperCase()}
						</div>
					{/if}
					<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
					      style="background: #4ade80; border-color: #0d0d12"></span>
				</div>
				<div class="flex-1 min-w-0">
					<div class="text-xs font-bold truncate" style="color: #e2e8f0; font-family: 'Space Grotesk', sans-serif">{user.username}</div>
					<div class="text-[10px] uppercase tracking-wide" style="color: {user.role === 'owner' || user.role === 'admin' ? '#a78bfa' : '#4b5563'}; font-weight: 700">
						{user.role === 'owner' ? 'Owner' : user.role === 'admin' ? 'Admin' : tFn('common.member')}
					</div>
				</div>
				<button onclick={openStatusModal} title="Statut" class="shrink-0 transition-colors" style="color: #374151">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
					</svg>
				</button>
			</div>
			{/if}

		</aside>
		{/if}


		<!-- ── Contenu principal ───────────────────────────────────────────────── -->
		<div class="flex-1 overflow-hidden">
		<main class="h-full overflow-y-auto min-w-0 {isBanned ? '' : showChannelSidebar ? 'lg:pl-[292px] xl:mr-[220px]' : 'lg:pl-[72px] xl:mr-[220px]'}" style="padding-bottom: var(--bottom-nav-h)">

            <!-- ── System announcement banner ─────────────────────────────────── -->
            {#if showAnnouncement && announcement}
                {@const colorClass = {
                    indigo: 'bg-indigo-950/90 border-indigo-700/60 text-indigo-100',
                    amber:  'bg-amber-950/90  border-amber-700/60  text-amber-100',
                    green:  'bg-green-950/90  border-green-700/60  text-green-100',
                    red:    'bg-red-950/90    border-red-700/60    text-red-100',
                    sky:    'bg-sky-950/90    border-sky-700/60    text-sky-100',
                    rose:   'bg-rose-950/90   border-rose-700/60   text-rose-100',
                }[announcement.color] ?? 'bg-indigo-950/90 border-indigo-700/60 text-indigo-100'}
                <div class="border-b px-4 py-2.5 flex items-center gap-3 text-sm {colorClass}">
                    <svg class="w-4 h-4 shrink-0 opacity-80" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"/>
                    </svg>
                    <span class="flex-1 font-medium">{announcement.message}</span>
                    <button
                        onclick={() => announcementDismissed = announcement!.id}
                        class="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-2"
                        aria-label="Fermer l'annonce"
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            {/if}


            <div class="w-full flex-1 flex flex-col {$page.url.pathname === '/' || $page.url.pathname.startsWith('/chat') || $page.url.pathname.startsWith('/admin') || $page.url.pathname.startsWith('/users/') || $page.url.pathname.startsWith('/feed') || $page.url.pathname.startsWith('/settings') || $page.url.pathname.startsWith('/garden') || $page.url.pathname.startsWith('/calendar') || $page.url.pathname.startsWith('/discover') || $page.url.pathname.startsWith('/wiki') || $page.url.pathname.startsWith('/library') || $page.url.pathname.startsWith('/dm') ? '' : $page.url.pathname.startsWith('/forum') ? 'px-4 sm:px-6 py-8' : 'max-w-5xl mx-auto px-4 py-8'}">
                {@render children()}
            </div>
        </main>
		</div>

		<!-- ── Members Bar (droite, 200px) ────────────────────────────────────── -->
		<aside class="hidden xl:flex fixed right-0 top-12 bottom-0 w-[220px] flex-col overflow-hidden z-30"
		       style="background: #0d0d12; border-left: 1px solid rgba(255,255,255,.05)">

			<!-- ── Header ──────────────────────────────────────────────────────── -->
			<div class="shrink-0 px-4 py-3 flex items-center justify-between"
			     style="border-bottom: 1px solid rgba(255,255,255,.05); background: rgba(255,255,255,.02)">
				<span class="text-[10px] font-black uppercase tracking-[.18em]" style="color: #374151; font-family: 'Space Grotesk', sans-serif">{tFn('common.members')}</span>
				{#if user}
					<div class="flex items-center gap-1.5">
						<span class="relative flex h-1.5 w-1.5">
							<span class="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style="background: #4ade80"></span>
							<span class="relative inline-flex h-1.5 w-1.5 rounded-full" style="background: #4ade80"></span>
						</span>
						<span class="text-[10px] font-bold tabular-nums" style="color: #4ade80">{onlineMembers.length}</span>
					</div>
				{/if}
			</div>

			{#if user}
			<div class="flex-1 overflow-y-auto overflow-x-hidden" style="scrollbar-width: thin; scrollbar-color: rgba(255,255,255,.06) transparent">
				<div class="px-2 py-2 space-y-px">

					<!-- ── Grouped by grade ──────────────────────────────────────── -->
					{#each [...memberGroups.groups.entries()] as [gradeName, members]}
						<!-- Grade label -->
						<div class="flex items-center gap-2 px-2 pt-3 pb-1.5">
							<span class="w-1.5 h-1.5 shrink-0" style="background: {members[0]?.grade?.color ?? '#6b7280'}"></span>
							<span class="text-[9px] font-black uppercase tracking-[.18em] truncate flex-1" style="color: {members[0]?.grade?.color ?? '#6b7280'}; font-family: 'Space Grotesk', sans-serif">{gradeName}</span>
							<span class="text-[9px] font-bold tabular-nums shrink-0" style="color: #374151">{members.length}</span>
						</div>
						{#each members as member (member.userId)}
							{@const isMe        = member.userId === (user as any)?.id}
							{@const hasStatus   = !!(member.status?.text || member.status?.emoji)}
							{@const isSharing   = screenSharingUserIds.has(member.userId)}
							{@const isStreaming = streamingUserIds.has(member.userId)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<svelte:element
								this={isMe ? 'button' : 'a'}
								href={isMe ? undefined : `/users/${member.username}`}
								onclick={isMe ? openStatusModal : undefined}
								onmouseenter={isSharing && !isMe ? (e: MouseEvent) => showScreenPreview(e, member.userId, member.username, member.avatar, 'left') : undefined}
								onmouseleave={() => { screenPreview = null }}
								class="relative w-full flex items-center gap-2.5 px-2 py-2 transition-all group"
								style="background: {isMe ? 'rgba(124,58,237,.06)' : 'transparent'}; text-align: left">
								<!-- Hover bar -->
								<span class="absolute left-0 top-0.5 bottom-0.5 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style="background: linear-gradient(to bottom, #7c3aed, #06b6d4)"></span>
								<!-- Avatar -->
								<div class="relative shrink-0">
									{#if member.avatar}
										<img src={member.avatar} alt="" class="w-7 h-7 object-cover" style="outline: 1px solid rgba(255,255,255,.08)" />
									{:else}
										<div class="w-7 h-7 flex items-center justify-center text-[11px] font-black text-white select-none"
										     style="background: linear-gradient(135deg, {members[0]?.grade?.color ?? '#7c3aed'}80, #0e7490)">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
									<!-- Online dot — remplacé par icône activité si besoin -->
									<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 flex items-center justify-center"
									      style="background: #0d0d12">
										{#if isSharing}
											<svg style="width:10px;height:10px;color:rgb(96,165,250)" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
												<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
											</svg>
										{:else if isStreaming}
											<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;animation:pulse 1.5s infinite;display:block"></span>
										{:else}
											<span class="w-1.5 h-1.5 rounded-full" style="background: #4ade80; box-shadow: 0 0 4px #4ade8088"></span>
										{/if}
									</span>
								</div>
								<!-- Info -->
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1 min-w-0">
										<span class="text-[11px] font-semibold leading-tight truncate transition-colors group-hover:brightness-125 {buildAnimClass(member)}"
										      style={buildNameStyle(member, isMe ? '#c4b5fd' : '#9ca3af')}>{member.username}</span>
										{#if isMe}
											<span class="shrink-0 text-[8px] font-black uppercase px-1 py-px leading-none" style="background: rgba(124,58,237,.25); color: #a78bfa">vous</span>
										{/if}
									</div>
									<!-- Activité temps réel -->
									{#if isSharing || isStreaming}
										<div class="flex items-center gap-1 mt-0.5">
											{#if isSharing}
												<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;padding:1px 5px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.22);color:rgb(96,165,250)">
													<svg style="width:7px;height:7px;shrink:0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
													ÉCRAN
												</span>
											{/if}
											{#if isStreaming}
												<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;padding:1px 5px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.22);color:rgb(248,113,113)">
													<span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:pulse 1.5s infinite;display:inline-block"></span>
													LIVE
												</span>
											{/if}
										</div>
									{:else if hasStatus}
										<div class="text-[10px] truncate leading-tight mt-px" style="color: #4b5563">{member.status?.emoji} {member.status?.text}</div>
									{:else if isMe}
										<div class="text-[10px] leading-tight mt-px transition-colors group-hover:opacity-80" style="color: #374151">{tFn('common.set_status')}</div>
									{/if}
									<!-- Statut custom affiché sous l'activité si les deux existent -->
									{#if (isSharing || isStreaming) && hasStatus}
										<div class="text-[10px] truncate leading-tight" style="color: #374151">{member.status?.emoji} {member.status?.text}</div>
									{/if}
								</div>
							</svelte:element>
						{/each}
					{/each}

					<!-- ── No-grade online members ───────────────────────────────── -->
					{#if memberGroups.ungrouped.length > 0}
						<div class="flex items-center gap-2 px-2 pt-3 pb-1.5">
							<span class="w-1.5 h-1.5 shrink-0 rounded-full" style="background: #4ade80"></span>
							<span class="text-[9px] font-black uppercase tracking-[.18em] flex-1" style="color: #374151; font-family: 'Space Grotesk', sans-serif">En ligne</span>
							<span class="text-[9px] font-bold tabular-nums" style="color: #374151">{memberGroups.ungrouped.length}</span>
						</div>
						{#each memberGroups.ungrouped as member (member.userId)}
							{@const isMe        = member.userId === (user as any)?.id}
							{@const hasStatus   = !!(member.status?.text || member.status?.emoji)}
							{@const isSharing   = screenSharingUserIds.has(member.userId)}
							{@const isStreaming = streamingUserIds.has(member.userId)}
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<svelte:element
								this={isMe ? 'button' : 'a'}
								href={isMe ? undefined : `/users/${member.username}`}
								onclick={isMe ? openStatusModal : undefined}
								onmouseenter={isSharing && !isMe ? (e: MouseEvent) => showScreenPreview(e, member.userId, member.username, member.avatar, 'left') : undefined}
								onmouseleave={() => { screenPreview = null }}
								class="relative w-full flex items-center gap-2.5 px-2 py-2 transition-all group"
								style="background: {isMe ? 'rgba(124,58,237,.06)' : 'transparent'}; text-align: left">
								<span class="absolute left-0 top-0.5 bottom-0.5 w-0.5 opacity-0 group-hover:opacity-100 transition-opacity" style="background: linear-gradient(to bottom, #7c3aed, #06b6d4)"></span>
								<div class="relative shrink-0">
									{#if member.avatar}
										<img src={member.avatar} alt="" class="w-7 h-7 object-cover" style="outline: 1px solid rgba(255,255,255,.08)" />
									{:else}
										<div class="w-7 h-7 flex items-center justify-center text-[11px] font-black text-white select-none"
										     style="background: linear-gradient(135deg, #7c3aed80, #0e7490)">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
									<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 flex items-center justify-center" style="background: #0d0d12">
										{#if isSharing}
											<svg style="width:10px;height:10px;color:rgb(96,165,250)" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
												<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
											</svg>
										{:else if isStreaming}
											<span style="width:8px;height:8px;border-radius:50%;background:#ef4444;animation:pulse 1.5s infinite;display:block"></span>
										{:else}
											<span class="w-1.5 h-1.5 rounded-full" style="background: #4ade80; box-shadow: 0 0 4px #4ade8088"></span>
										{/if}
									</span>
								</div>
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-1 min-w-0">
										<span class="text-[11px] font-semibold leading-tight truncate transition-colors group-hover:brightness-125 {buildAnimClass(member)}"
										      style={buildNameStyle(member, isMe ? '#c4b5fd' : '#9ca3af')}>{member.username}</span>
										{#if isMe}
											<span class="shrink-0 text-[8px] font-black uppercase px-1 py-px leading-none" style="background: rgba(124,58,237,.25); color: #a78bfa">vous</span>
										{/if}
									</div>
									{#if isSharing || isStreaming}
										<div class="flex items-center gap-1 mt-0.5">
											{#if isSharing}
												<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;padding:1px 5px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.22);color:rgb(96,165,250)">
													<svg style="width:7px;height:7px" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>
													ÉCRAN
												</span>
											{/if}
											{#if isStreaming}
												<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:700;padding:1px 5px;background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.22);color:rgb(248,113,113)">
													<span style="width:5px;height:5px;border-radius:50%;background:currentColor;animation:pulse 1.5s infinite;display:inline-block"></span>
													LIVE
												</span>
											{/if}
										</div>
									{:else if hasStatus}
										<div class="text-[10px] truncate leading-tight mt-px" style="color: #4b5563">{member.status?.emoji} {member.status?.text}</div>
									{:else if isMe}
										<div class="text-[10px] leading-tight mt-px" style="color: #374151">{tFn('common.set_status')}</div>
									{/if}
									{#if (isSharing || isStreaming) && hasStatus}
										<div class="text-[10px] truncate leading-tight" style="color: #374151">{member.status?.emoji} {member.status?.text}</div>
									{/if}
								</div>
							</svelte:element>
						{/each}
					{/if}

					{#if onlineMembers.length === 0}
						<div class="flex flex-col items-center gap-2 px-3 py-8">
							<div class="w-8 h-8 flex items-center justify-center" style="background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06)">
								<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="color: #374151"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
							</div>
							<p class="text-[10px] text-center" style="color: #374151">Aucun membre en ligne</p>
						</div>
					{/if}

					<!-- ── Offline ───────────────────────────────────────────────── -->
					{#if offlineMembers.length > 0}
						<div class="flex items-center gap-2 px-2 pt-4 pb-1.5" style="border-top: 1px solid rgba(255,255,255,.04); margin-top: 8px">
							<span class="w-1.5 h-1.5 shrink-0" style="background: #374151"></span>
							<span class="text-[9px] font-black uppercase tracking-[.18em] flex-1" style="color: #2d3748; font-family: 'Space Grotesk', sans-serif">Hors ligne</span>
							<span class="text-[9px] font-bold tabular-nums" style="color: #2d3748">{offlineMembers.length}</span>
						</div>
						{#each offlineMembers.slice(0, 10) as member (member.user_id)}
							<a href="/users/{member.username}"
							   class="relative flex items-center gap-2.5 px-2 py-1.5 transition-all group"
							   style="opacity: 0.35">
								<div class="relative shrink-0">
									{#if member.avatar}
										<img src={member.avatar} alt="" class="w-6 h-6 object-cover grayscale" style="outline: 1px solid rgba(255,255,255,.04)" />
									{:else}
										<div class="w-6 h-6 flex items-center justify-center text-[10px] font-bold select-none" style="background: rgba(255,255,255,.04); color: #4b5563">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
								</div>
								<span class="text-[11px] truncate group-hover:opacity-100 transition-opacity" style="color: #6b7280; font-family: 'Space Grotesk', sans-serif">{member.username}</span>
							</a>
						{/each}
						{#if offlineMembers.length > 10}
							<a href="/members"
							   class="flex items-center justify-center gap-1 mx-2 my-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors"
							   style="color: #374151; border: 1px solid rgba(255,255,255,.05)">
								Voir tous
								<span class="text-[9px]" style="color: #4b5563">({offlineMembers.length})</span>
							</a>
						{/if}
					{/if}

				</div>
			</div>
			{:else}
				<!-- Not logged in — invite card -->
				<a href="/auth/login" class="guest-members-card" aria-label="Se connecter pour voir les membres">

					<!-- Radar animé -->
					<div class="guest-radar">
						<div class="guest-radar-ring r1"></div>
						<div class="guest-radar-ring r2"></div>
						<div class="guest-radar-ring r3"></div>
						<!-- Icône centrale -->
						<div class="guest-radar-core">
							<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
								<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
								<circle cx="9" cy="7" r="4"/>
								<path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
								<path d="M16 3.13a4 4 0 0 1 0 7.75"/>
							</svg>
						</div>
					</div>

					<!-- Avatars fantômes -->
					<div class="guest-ghosts">
						{#each ['M','J','A','K','S','T','R','L'] as letter, i}
						<div class="guest-ghost" style="--gi:{i}; --gc:{['#818cf8','#a78bfa','#34d399','#fb923c','#f472b6','#67e8f9','#facc15','#f87171'][i]}">
							{letter}
						</div>
						{/each}
					</div>

					<!-- Live badge + compteur -->
					<div class="guest-live-row">
						<span class="guest-live-dot"></span>
						<span class="guest-live-label">
							{memberCount > 0 ? `${memberCount} membre${memberCount > 1 ? 's' : ''}` : 'Communauté active'}
						</span>
					</div>

					<!-- Texte -->
					<p class="guest-tagline">Connecte-toi pour voir<br>qui est en ligne</p>

					<!-- CTA -->
					<div class="guest-cta">
						<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
							<polyline points="10 17 15 12 10 7"/>
							<line x1="15" y1="12" x2="3" y2="12"/>
						</svg>
						Se connecter
					</div>
				</a>
			{/if}
		</aside>

	</div>

	<!-- ══ BOTTOM NAV mobile (lg:hidden) — hidden for banned users ═════════ -->
	{#if !isBanned}
	<nav class="lg:hidden fixed bottom-0 left-0 right-0 z-45 border-t border-gray-800 flex items-stretch"
	     style="background: var(--p-card-bg); border-color: var(--p-card-border); padding-bottom: env(safe-area-inset-bottom, 0px)">

		<!-- Fil d'actu (si connecté) -->
		{#if user}
		<a href="/feed" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 {isActive('/feed') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18M3 6h18M3 18h12"/>
			</svg>
			<span class="text-[10px] font-medium">Actu</span>
		</a>
		{/if}

		<!-- Forum -->
		<a href="/forum" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 {isActive('/forum') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
				<polyline stroke-linecap="round" stroke-linejoin="round" points="9 22 9 12 15 12 15 22"/>
			</svg>
			<span class="text-[10px] font-medium">Forum</span>
		</a>

		<!-- Chat (si connecté) -->
		{#if user}
		<a href="/chat" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 relative {isActive('/chat') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
			</svg>
			{#if unreadCount > 0}
				<span class="absolute top-1.5 right-[calc(50%-14px)] min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold px-1 flex items-center justify-center">
					{unreadCount > 9 ? '9+' : unreadCount}
				</span>
			{/if}
			<span class="text-[10px] font-medium">Chat</span>
		</a>
		{/if}

		<!-- Messages privés (si connecté) -->
		{#if user}
		<a href="/dm" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 relative {isActive('/dm') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
			</svg>
			{#if dmUnread > 0}
				<span class="absolute top-1.5 right-[calc(50%-14px)] min-w-[16px] h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold px-1 flex items-center justify-center">
					{dmUnread > 9 ? '9+' : dmUnread}
				</span>
			{/if}
			<span class="text-[10px] font-medium">DMs</span>
		</a>
		{/if}

		<!-- Bibliothèque -->
		<a href="/library" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 {isActive('/library') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
				<path stroke-linecap="round" stroke-linejoin="round" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
			</svg>
			<span class="text-[10px] font-medium">Biblio</span>
		</a>

		<!-- Annuaire -->
		<a href="/communities" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 {isActive('/communities') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<circle cx="12" cy="12" r="10"/>
				<line x1="2" y1="12" x2="22" y2="12"/>
				<path stroke-linecap="round" stroke-linejoin="round" d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
			</svg>
			<span class="text-[10px] font-medium">Annuaire</span>
		</a>

		<!-- Profil / Connexion -->
		{#if user}
		<a href="/users/{user.username}"
		   class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 {$page.url.pathname.startsWith('/users/') ? 'text-indigo-400' : 'text-gray-500'}">
			{#if user.avatar}
				<img src={user.avatar} class="w-5 h-5 rounded-full object-cover" alt="" />
			{:else}
				<div class="w-5 h-5 rounded-full bg-indigo-700 flex items-center justify-center text-[9px] font-bold text-white">
					{user.username.charAt(0).toUpperCase()}
				</div>
			{/if}
			<span class="text-[10px] font-medium">Profil</span>
		</a>
		{:else}
		<a href="/auth/login" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 text-gray-500">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
				<polyline stroke-linecap="round" stroke-linejoin="round" points="10 17 15 12 10 7"/>
				<line x1="15" y1="12" x2="3" y2="12"/>
			</svg>
			<span class="text-[10px] font-medium">{tFn("common.login")}</span>
		</a>
		{/if}
	</nav>
	{/if}
</div>

<!-- ── Status modal ──────────────────────────────────────────────────────── -->
{#if showStatusModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
		role="presentation"
		onclick={(e) => { if (e.target === e.currentTarget) showStatusModal = false }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5"
			onclick={(e) => e.stopPropagation()}>
			<h2 class="text-sm font-bold text-white mb-4">Définir ton statut</h2>

			<!-- Current status preview -->
			<div class="flex items-center gap-2.5 mb-4 px-3 py-2 bg-gray-800 rounded-xl border border-gray-700">
				<span class="text-xl w-8 text-center">{statusEmoji || '😶'}</span>
				<span class="text-sm text-gray-300 flex-1 truncate">{statusText || 'Aucun statut'}</span>
			</div>

			<!-- Emoji + text inputs -->
			<div class="flex gap-2 mb-3">
				<input
					type="text"
					placeholder="😀"
					bind:value={statusEmoji}
					maxlength={8}
					class="w-14 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-center text-lg outline-none focus:border-indigo-600 transition-colors"
				/>
				<input
					type="text"
					placeholder="Ce que tu fais…"
					bind:value={statusText}
					maxlength={60}
					class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-none focus:border-indigo-600 transition-colors"
				/>
			</div>

			<!-- Preset statuses -->
			<div class="grid grid-cols-2 gap-1.5 mb-4">
				{#each PRESET_STATUSES as preset}
					<button
						onclick={() => { statusEmoji = preset.emoji; statusText = preset.text }}
						class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors border {statusEmoji === preset.emoji && statusText === preset.text ? 'border-indigo-500 bg-indigo-500/20 text-white' : 'border-gray-700 bg-gray-800/60 text-gray-400 hover:border-gray-600 hover:text-white'}"
					>
						<span>{preset.emoji}</span>
						<span class="truncate">{preset.text}</span>
					</button>
				{/each}
			</div>

			<div class="flex gap-2">
				{#if myStatus}
					<button onclick={clearStatus} class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 hover:text-white transition-colors">
						Effacer
					</button>
				{/if}
				<button onclick={() => showStatusModal = false} class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 hover:text-white transition-colors ml-auto">
					Annuler
				</button>
				<button onclick={saveStatus} class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium transition-colors">
					Enregistrer
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- ── Voice toasts ─────────────────────────────────────────────────────────── -->
{#if voiceToasts.length > 0}
	<div class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse items-center gap-2 pointer-events-none">
		{#each voiceToasts as evt (evt.id)}
			<div
				class="flex items-center gap-3 px-4 py-2.5 pointer-events-auto"
				style="background: rgba(13,13,20,0.97); border: 1px solid rgba(255,255,255,0.07); box-shadow: 0 8px 32px rgba(0,0,0,0.6);"
				transition:fade={{ duration: 200 }}
			>
				{#if evt.avatar}
					<img src={evt.avatar} alt={evt.username} class="w-6 h-6 rounded-full object-cover shrink-0" />
				{:else}
					<div class="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
					     style="background: linear-gradient(135deg, #7c3aed, #0e7490)">
						{evt.username.charAt(0).toUpperCase()}
					</div>
				{/if}
				<span class="text-xs whitespace-nowrap">
					<span class="font-bold" style="color: #e2e8f0">{evt.username}</span>
					<span style="color: #4b5563"> {evt.action === 'join' ? 'a rejoint' : 'a quitté'} </span>
					<span style="color: #a78bfa"># {evt.channelName}</span>
				</span>
				<div class="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
				     style="background: {evt.action === 'join' ? 'rgba(74,222,128,0.15)' : 'rgba(239,68,68,0.15)'};">
					{#if evt.action === 'join'}
						<svg class="w-2.5 h-2.5" fill="none" stroke="#4ade80" stroke-width="2.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
						</svg>
					{:else}
						<svg class="w-2.5 h-2.5" fill="none" stroke="#f87171" stroke-width="2.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M20 12H4"/>
						</svg>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}

<!-- ── Command Palette ────────────────────────────────────────────────────── -->
<CommandPalette
	open={paletteOpen}
	user={user}
	token={data.token ?? null}
	onClose={() => paletteOpen = false}
/>

<!-- ── Screen share hover preview ────────────────────────────────────────── -->
{#if screenPreview}
	<MemberScreenPreview {...screenPreview} />
{/if}

<style>
/* ── Guest members sidebar ───────────────────────────────────────────────── */
.guest-members-card {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	flex: 1;
	gap: 18px;
	padding: 28px 16px;
	text-decoration: none;
	cursor: pointer;
	position: relative;
	overflow: hidden;
	transition: background 0.3s;
}
.guest-members-card::before {
	content: '';
	position: absolute;
	inset: 0;
	background: radial-gradient(ellipse at 50% 40%, rgba(139,92,246,0.07) 0%, transparent 70%);
	pointer-events: none;
	transition: opacity 0.4s;
	opacity: 1;
}
.guest-members-card:hover::before { opacity: 1.6; }
.guest-members-card:hover { background: rgba(139,92,246,0.04); }

/* Radar */
.guest-radar {
	position: relative;
	width: 72px;
	height: 72px;
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
}
.guest-radar-ring {
	position: absolute;
	border-radius: 50%;
	border: 1px solid rgba(139,92,246,0.35);
	animation: guest-ping 2.4s ease-out infinite;
}
.r1 { width: 72px; height: 72px; animation-delay: 0s; }
.r2 { width: 72px; height: 72px; animation-delay: 0.8s; }
.r3 { width: 72px; height: 72px; animation-delay: 1.6s; }
@keyframes guest-ping {
	0%   { transform: scale(0.4); opacity: 0.8; border-color: rgba(139,92,246,0.5); }
	100% { transform: scale(1.9); opacity: 0; }
}
.guest-radar-core {
	width: 40px;
	height: 40px;
	border-radius: 50%;
	background: rgba(139,92,246,0.12);
	border: 1px solid rgba(139,92,246,0.3);
	display: flex;
	align-items: center;
	justify-content: center;
	color: #a78bfa;
	position: relative;
	z-index: 1;
	transition: background 0.3s, border-color 0.3s;
}
.guest-members-card:hover .guest-radar-core {
	background: rgba(139,92,246,0.2);
	border-color: rgba(139,92,246,0.5);
}

/* Ghost avatars */
.guest-ghosts {
	display: flex;
	flex-wrap: wrap;
	justify-content: center;
	gap: 6px;
	width: 100%;
	max-width: 160px;
}
.guest-ghost {
	width: 28px;
	height: 28px;
	border-radius: 50%;
	background: rgba(255,255,255,0.04);
	border: 1px solid rgba(255,255,255,0.08);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	font-weight: 700;
	color: var(--gc);
	filter: blur(0.5px);
	opacity: 0.55;
	animation: guest-ghost-float 3s ease-in-out infinite;
	animation-delay: calc(var(--gi) * 0.3s);
	transition: opacity 0.3s, filter 0.3s;
}
.guest-members-card:hover .guest-ghost {
	opacity: 0.8;
	filter: blur(0px);
}
@keyframes guest-ghost-float {
	0%, 100% { transform: translateY(0px); }
	50%       { transform: translateY(-3px); }
}

/* Live row */
.guest-live-row {
	display: flex;
	align-items: center;
	gap: 6px;
}
.guest-live-dot {
	width: 7px;
	height: 7px;
	border-radius: 50%;
	background: #4ade80;
	box-shadow: 0 0 6px rgba(74,222,128,0.6);
	animation: guest-live-pulse 1.8s ease-in-out infinite;
	flex-shrink: 0;
}
@keyframes guest-live-pulse {
	0%, 100% { box-shadow: 0 0 6px rgba(74,222,128,0.6); }
	50%       { box-shadow: 0 0 12px rgba(74,222,128,0.9), 0 0 20px rgba(74,222,128,0.3); }
}
.guest-live-label {
	font-size: 11px;
	font-weight: 700;
	color: #4ade80;
	letter-spacing: 0.03em;
}

/* Tagline */
.guest-tagline {
	font-size: 11px;
	line-height: 1.6;
	color: #6b7280;
	text-align: center;
	margin: 0;
}

/* CTA */
.guest-cta {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 9px 18px;
	border-radius: 20px;
	background: rgba(139,92,246,0.12);
	border: 1px solid rgba(139,92,246,0.25);
	color: #c4b5fd;
	font-size: 12px;
	font-weight: 700;
	letter-spacing: 0.02em;
	transition: background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
}
.guest-members-card:hover .guest-cta {
	background: rgba(139,92,246,0.22);
	border-color: rgba(139,92,246,0.5);
	color: #e9d5ff;
	box-shadow: 0 0 18px rgba(139,92,246,0.25);
}

/* ── Voice channel member cards ─────────────────────────────────────────── */
.vc-member-card {
	border-radius: 0;
}
.vc-member-card:hover {
	background: rgba(255,255,255,0.035) !important;
}

/* Animated equalizer bars — shown when a member is speaking */
.vc-wave-bars {
	display: flex;
	align-items: flex-end;
	gap: 2px;
	height: 12px;
	width: 14px;
}
.vc-bar {
	display: block;
	width: 2.5px;
	background: #4ade80;
	border-radius: 1px;
	transform-origin: bottom center;
	animation: vc-wave 0.65s ease-in-out infinite;
	height: 100%;
}
@keyframes vc-wave {
	0%, 100% { transform: scaleY(0.25); opacity: 0.55 }
	50%       { transform: scaleY(1);    opacity: 1    }
}

/* ── Layout channel sub-labels (Texte / Vocal) ───────────────────────────── */
.lch-sublabel {
	display: flex; align-items: center; gap: 5px;
	padding: 8px 10px 3px;
	font-size: 9px; font-weight: 800;
	text-transform: uppercase; letter-spacing: .16em;
	color: #374151;
}
.lch-sublabel svg { width: 10px; height: 10px; flex-shrink: 0; }
.lch-sublabel--voice { color: #14532d; margin-top: 4px; }
.lch-sublabel--voice svg { stroke: #166834; }

.lch-voice-ico { width: 14px; height: 14px; flex-shrink: 0; transition: stroke .15s; }

/* ── Layout channel items — unread glow ──────────────────────────────────── */
.lch-item {
	position: relative;
	overflow: hidden;
	transition: color .15s, background .15s;
	border-radius: 4px;
}
.lch-idle  { color: #4b5563; }
.lch-idle:hover { color: #e2e8f0; background: rgba(255,255,255,.03); }

.lch-active {
	color: #e2e8f0;
	background: rgba(124,58,237,.12);
}

.lch-unread {
	color: #e2e8f0;
	background: rgba(99,102,241,.07);
	box-shadow: inset 2px 0 0 rgba(124,58,237,.65);
	animation: lch-breathe 2.8s ease-in-out infinite;
}
.lch-unread:hover { background: rgba(99,102,241,.13); }

@keyframes lch-breathe {
	0%,100% {
		box-shadow: inset 2px 0 0 rgba(124,58,237,.5);
		background: rgba(99,102,241,.06);
	}
	50% {
		box-shadow: inset 2px 0 0 rgba(167,139,250,.95), 0 0 12px rgba(99,102,241,.12);
		background: rgba(99,102,241,.11);
	}
}

.lch-flash::after {
	content: '';
	position: absolute;
	inset: 0;
	background: linear-gradient(
		90deg,
		transparent 0%,
		rgba(99,102,241,.2) 35%,
		rgba(167,139,250,.28) 50%,
		rgba(99,102,241,.2) 65%,
		transparent 100%
	);
	transform: translateX(-110%);
	animation: lch-sweep .55s cubic-bezier(.4,0,.2,1) forwards;
	pointer-events: none;
}
@keyframes lch-sweep {
	from { transform: translateX(-110%); }
	to   { transform: translateX(110%); }
}

.lch-badge {
	flex-shrink: 0;
	min-width: 15px;
	height: 15px;
	padding: 0 4px;
	border-radius: 99px;
	background: #7c3aed;
	color: white;
	font-size: 8px;
	font-weight: 800;
	text-align: center;
	line-height: 15px;
	animation: lch-badge-pop .2s cubic-bezier(.34,1.56,.64,1) both;
}
@keyframes lch-badge-pop {
	from { transform: scale(0); opacity: 0; }
	to   { transform: scale(1); opacity: 1; }
}
</style>
