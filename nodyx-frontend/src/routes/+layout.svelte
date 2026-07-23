<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import type { LayoutData } from './$types';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { goto, beforeNavigate } from '$app/navigation';
	import { initSocket, unreadCountStore, chatMentionStore, dmUnreadStore, onlineMembersStore, getSocket } from '$lib/socket';
	import StreamerNotifListener from '$lib/components/streamer/StreamerNotifListener.svelte';
	import { tryAutoConnect } from '$lib/socket';
	import type { UserStatus } from '$lib/socket';
	import { resolveTheme, themeToVars } from '$lib/profileThemes';
	import { buildNameStyle, buildAnimClass, ensureFontLoaded, GOOGLE_FONTS_URL } from '$lib/nameEffects';
	import VoicePanel from '$lib/components/VoicePanel.svelte';
	import StageView from '$lib/components/StageView.svelte';
	import { stageOpenStore } from '$lib/stageStore';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import MatrixRain from '$lib/components/MatrixRain.svelte';
	import MemberScreenPreview from '$lib/components/MemberScreenPreview.svelte';
	import VoiceEqualizer from '$lib/components/VoiceEqualizer.svelte';
	import MaintenanceBanner from '$lib/components/MaintenanceBanner.svelte';
	import NodyxVersionBadge from '$lib/components/NodyxVersionBadge.svelte';
	import FloatingReactions from '$lib/components/FloatingReactions.svelte';
	import ExternalLinkWarning from '$lib/components/ExternalLinkWarning.svelte';
	import ChannelIcon from '$lib/components/ChannelIcon.svelte';
	import { get } from 'svelte/store';
	import { voiceStore, voiceChannelMembersStore, voiceEventsStore, screenShareStore, remoteScreenStore } from '$lib/voice';
	import { locale, t, LOCALES, type Locale } from '$lib/i18n';
	import { unreadCountsStore, flashChannelIdStore } from '$lib/unreadStore';
	import { activeCommunityNameStore, panelCollapsedStore, membersCollapsedStore } from '$lib/communityStore';
	import { playMention, playDm } from '$lib/sounds';
	const tFn = $derived($t)

	let { children, data }: { children: any; data: LayoutData } = $props();

	// Pages qui définissent leur PROPRE og:image dans leur <svelte:head>. Sur
	// celles-ci, le layout n'émet pas son og:image par défaut, sinon les scrapers
	// (Discord, Twitter...) reçoivent deux images et en affichent une galerie.
	const PAGES_WITH_OWN_OG = new Set([
		'/forum/[category]/[thread]',
		'/forum/[category]',
		'/users/[username]',
		'/users/[username]/card',
		'/calendar/[id]',
	]);
	const ownsOgImage = $derived(PAGES_WITH_OWN_OG.has($page.route.id ?? ''));

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
	const activeCommunityName = $derived($activeCommunityNameStore);
	const communityName      = $derived(data.communityName ?? 'Nodyx');
	const displayCommunityName = $derived(activeCommunityName ?? communityName);
	const communityLogo      = $derived((data as any).communityLogoUrl  as string | null);
	const communityBanner    = $derived((data as any).communityBannerUrl as string | null);
	const rawNetworkInstances = $derived((data as any).networkInstances as Array<{
		slug: string; name: string; url: string;
		logo_url: string | null; members: number; online: number; last_seen: string | null;
	}> ?? []);

	const networkInstances = $derived(rawNetworkInstances);
	const activeCommunity = $derived(networkInstances.find(i => i.name === activeCommunityName));
	const activeCommunityUrl = $derived(activeCommunity?.url ? activeCommunity.url.replace(/\/$/, '') : '');

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

	// App-wide theme — cascade : défaut → thème d'INSTANCE (owner, son univers) → thème du MEMBRE (override perso)
	const appVars = $derived(themeToVars(resolveTheme((data as any).appTheme, (data as any).instanceTheme)))
	// Effet de fond posé par l'owner (ex 'matrix' = pluie de caractères derrière le contenu)
	const hasMatrix = $derived((data as any).instanceEffect === 'matrix')

	// ── Mise à jour transparente après un déploiement ───────────────────────────
	// Le service worker signale une nouvelle version (sw:updated / controllerchange).
	// On ne recharge pas brutalement : on attend la PROCHAINE navigation de l'user
	// pour faire un full reload vers sa destination -> il récupère la version fraîche
	// sans jamais avoir à hard-refresh. Plus de "5-6 refresh après une mise à jour".
	let swUpdateReady = false;
	onMount(() => {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		const markReady = () => { swUpdateReady = true; };
		const onMessage = (e: MessageEvent) => { if ((e.data as any)?.type === 'sw:updated') markReady(); };
		navigator.serviceWorker.addEventListener('message', onMessage);
		navigator.serviceWorker.addEventListener('controllerchange', markReady);
		return () => {
			navigator.serviceWorker.removeEventListener('message', onMessage);
			navigator.serviceWorker.removeEventListener('controllerchange', markReady);
		};
	});
	beforeNavigate((nav) => {
		// Navigation interne vers une URL connue : on force un rechargement complet
		// pour basculer sur la nouvelle version (assets + SSR frais).
		if (swUpdateReady && nav.to?.url && nav.type !== 'leave') {
			nav.cancel();
			window.location.href = nav.to.url.href;
		}
	});

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

	// SSR: set locale from cookie/accept-language BEFORE first render — avoids flash of default 'fr'
	if (data.ssrLocale) locale.setSSR(data.ssrLocale as Locale)

	onMount(async () => {
		// Sync/initialize locale on the client side (e.g. read user choice from localStorage)
		locale.init()

		// Register <nodyx-audio-player> custom element (idempotent)
		import('$lib/components/audio/nodyx-audio-player').then(m => m.defineNodyxAudioPlayer())

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

		// Fetch full member list for the offline sidebar section + refresh channels client-side
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
				if (channelsRes?.ok) {
					const fresh = (await channelsRes.json()).channels ?? []
					if (fresh.length > 0) layoutChannels = fresh
				}
			} catch { /* ignore */ }
		}
	})

	// ── Galaxy Bar mobile drawer ───────────────────────────────────────────────
	let gallerySidebarOpen = $state(false)
	let panelCollapsed = $state((data as any).panelCollapsed ?? false)
	let membersCollapsed = $state((data as any).membersCollapsed ?? false)

	function toggleC(velocity: number | MouseEvent = 0) {
		if (typeof velocity === 'number') {
			if (velocity > 500) membersCollapsed = false;
			else if (velocity < -500) membersCollapsed = true;
			else membersCollapsed = !membersCollapsed;
		} else {
			membersCollapsed = !membersCollapsed;
		}
	}

	function toggleL() {
		panelCollapsed = !panelCollapsed;
	}

	$effect(() => {
		panelCollapsedStore.set(panelCollapsed);
		if (browser) {
			document.cookie = `nodyx_panel_collapsed=${panelCollapsed}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	$effect(() => {
		membersCollapsedStore.set(membersCollapsed);
		if (browser) {
			document.cookie = `nodyx_members_collapsed=${membersCollapsed}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	// ── Panel resizing logic ──────────────────────────────────────────────────
	let leftPanelWidth = $state((data as any).leftPanelWidth ?? 220);
	let rightPanelWidth = $state((data as any).rightPanelWidth ?? 220);
	let isDraggingLeft = $state(false);
	let isDraggingRight = $state(false);
	let draggingPastBoundaryLeft = $state(false);
	let draggingPastBoundaryRight = $state(false);

	let dragStartWidthLeft = 0;
	let dragStartWidthRight = 0;
	let leftDragMoved = false;
	let rightDragMoved = false;

	$effect(() => {
		if (browser) {
			document.cookie = `nodyx_left_panel_width=${leftPanelWidth}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	$effect(() => {
		if (browser) {
			document.cookie = `nodyx_right_panel_width=${rightPanelWidth}; path=/; max-age=31536000; SameSite=Lax`;
		}
	});

	function startLeftDrag(e: PointerEvent) {
		if (window.innerWidth < 1024) return;
		if (e.button !== 0) return;
		isDraggingLeft = true;
		leftDragMoved = false;
		dragStartWidthLeft = leftPanelWidth;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function handleLeftDragMove(e: PointerEvent) {
		if (!isDraggingLeft) return;
		leftDragMoved = true;
		const width = e.clientX - 56;
		if (width < 130) {
			draggingPastBoundaryLeft = true;
			leftPanelWidth = Math.max(0, width);
		} else {
			draggingPastBoundaryLeft = false;
			leftPanelWidth = Math.max(160, Math.min(500, width));
		}
	}

	function stopLeftDrag(e: PointerEvent) {
		if (!isDraggingLeft) return;
		isDraggingLeft = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch { /* ignore */ }

		if (!leftDragMoved) {
			toggleL();
		} else if (leftPanelWidth < 130) {
			panelCollapsed = true;
			leftPanelWidth = 220;
		} else if (leftPanelWidth < 160) {
			leftPanelWidth = 160;
		}
		draggingPastBoundaryLeft = false;
	}

	function startRightDrag(e: PointerEvent) {
		if (window.innerWidth < 1280) return;
		if (e.button !== 0) return;
		isDraggingRight = true;
		rightDragMoved = false;
		dragStartWidthRight = rightPanelWidth;
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		e.preventDefault();
	}

	function handleRightDragMove(e: PointerEvent) {
		if (!isDraggingRight) return;
		rightDragMoved = true;
		const width = window.innerWidth - e.clientX;
		if (width < 130) {
			draggingPastBoundaryRight = true;
			rightPanelWidth = Math.max(0, width);
		} else {
			draggingPastBoundaryRight = false;
			rightPanelWidth = Math.max(160, Math.min(500, width));
		}
	}

	function stopRightDrag(e: PointerEvent) {
		if (!isDraggingRight) return;
		isDraggingRight = false;
		try {
			(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		} catch { /* ignore */ }

		if (!rightDragMoved) {
			toggleC();
		} else if (rightPanelWidth < 130) {
			membersCollapsed = true;
			rightPanelWidth = 220;
		} else if (rightPanelWidth < 160) {
			rightPanelWidth = 160;
		}
		draggingPastBoundaryRight = false;
	}

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
	let langView = $state(false)
	let langSaved = $state(false)
	let langSavedTimeout: ReturnType<typeof setTimeout> | undefined
	// Close the language pane when the route changes — otherwise it stays
	// mounted over the new page until the user clicks "back".
	let skipLangReset = false
	$effect(() => {
		$page.url.pathname
		if (skipLangReset) { skipLangReset = false; return }
		langView = false
	})
	function openLang() {
		skipLangReset = true
		langView = true
		goto('/', { noScroll: true })
	}
	const currentLocale = $derived($locale)
	function pickLocale(code: Locale) {
		locale.setLocale(code)
		langSaved = true
		clearTimeout(langSavedTimeout)
		langSavedTimeout = setTimeout(() => langSaved = false, 2000)
	}

	// Swipe-to-dismiss for mobile — F12: spring-feel transition via CSS
	let touchStartY = 0
	let touchCurrentY = 0
	let langDragY = $state(0)
	function onLangTouchStart(e: TouchEvent) { touchStartY = e.touches[0].clientY }
	function onLangTouchMove(e: TouchEvent) {
		touchCurrentY = e.touches[0].clientY
		const diff = touchCurrentY - touchStartY
		if (diff > 0) langDragY = diff
	}
	function onLangTouchEnd() {
		const diff = touchCurrentY - touchStartY
		if (diff > 100) {
			langView = false
		}
		langDragY = 0
	}

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
	type LayoutChannel = {
		id:              string
		name:            string
		type?:           string
		name_color?:     string | null
		name_bold?:      boolean
		name_italic?:    boolean
		name_underline?: boolean
		icon_emoji?:     string | null
	}
	let layoutChannels = $state<LayoutChannel[]>((data as any).channels ?? [])

	const layoutTextChannels = $derived(layoutChannels.filter(c => !c.type || c.type === 'text'))
	const layoutVoiceChannels = $derived(layoutChannels.filter(c => c.type === 'voice'))

	function chNameStyle(ch: LayoutChannel, override: string | null = null): string {
		const parts: string[] = []
		const color = ch.name_color ?? override
		if (color)             parts.push(`color: ${color}`)
		if (ch.name_bold)      parts.push('font-weight: 700')
		if (ch.name_italic)    parts.push('font-style: italic')
		if (ch.name_underline) parts.push('text-decoration: underline')
		return parts.join(';')
	}
	const showChannelSidebar = $derived(
		!isBanned &&
		!$page.url.pathname.startsWith('/admin') &&
		!$page.url.pathname.startsWith('/auth') &&
		$page.url.pathname !== '/banned'
	)

	// Routes /overlay/* sont des pages OBS browser source : fullscreen
	// transparent, AUCUN chrome Nodyx (ni nav, ni sidebar, ni members bar).
	// Routes /deck/* sont des pages mobile-first tactiles (Nodyx Deck) : même
	// principe, on veut tout l'écran pour la grille de boutons.
	// On bypass complètement le rendu du layout pour ces routes.
	const isOverlayRoute = $derived(
		$page.url.pathname.startsWith('/overlay/') ||
		$page.url.pathname.startsWith('/deck/'),
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
		// Escape closes language pane
		if (e.key === 'Escape' && langView) {
			e.preventDefault()
			langView = false
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<svelte:head>
	<!-- The favicon is intentionally not overridden by the community logo
	     anymore. It stays the Nodyx brand mark declared in app.html (and
	     a self-hoster can replace static/favicon.ico if they want their
	     own). Decoupling favicon (brand identity) from communityLogo
	     (community identity) prevents an uploaded square logo from being
	     stretched into a 16×16 tab icon. -->
	<meta property="og:site_name" content={communityName} />
	<!-- og:image en URL ABSOLUE : Discord/Twitter/Facebook ne résolvent pas
	     les chemins relatifs (l'ancien /og-image.jpg de app.html ne
	     s'affichait jamais dans les partages). Les pages qui définissent
	     leur propre og:image (threads) ajoutent la leur en plus. -->
	{#if !ownsOgImage}
		<meta property="og:image" content="{$page.url.origin}/og-image.jpg" />
		<meta property="og:image:width"  content="1200" />
		<meta property="og:image:height" content="630" />
		<meta name="twitter:image" content="{$page.url.origin}/og-image.jpg" />
	{/if}
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="theme-color" content="var(--nx-accent)" />
	<!-- Preload all Google Font presets (avatar/username effects) -->
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link rel="stylesheet" href={GOOGLE_FONTS_URL} />
	<!-- Thème d'instance : surcharge des variables CSS, posé par l'owner (instance_settings.theme_css).
	     On retire tout '<' pour empêcher un breakout </style>. -->
	{#if data.themeCss}
		{@html `<style id="instance-theme">${data.themeCss.replace(/</g, '')}</style>`}
	{/if}
</svelte:head>

{#if isOverlayRoute}
	<!-- Overlay OBS : aucun chrome Nodyx, juste la page transparente. -->
	{@render children()}
{:else}
{#if hasMatrix}<MatrixRain />{/if}
<div class="min-h-screen flex flex-col" style="{appVars}; background: {hasMatrix ? 'transparent' : 'var(--p-bg)'}; color: var(--p-text)">

	<!-- Listener Streamer Hub : joue les sons de notif pour les admins/owners. -->
	{#if data.user?.role}
		<StreamerNotifListener role={data.user.role} />
	{/if}

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
		   style="font-family: 'Space Grotesk', sans-serif; background: linear-gradient(135deg, var(--nx-accent-2-soft), var(--nx-cyan-soft)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent">
			{communityName}
		</a>

		<!-- Desktop: logo + breadcrumb -->
		<div class="hidden lg:flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
			<!-- Logo toujours visible -->
			<a href="/" class="shrink-0 font-black text-sm"
			   style="font-family: 'Space Grotesk', sans-serif; background: linear-gradient(135deg, var(--nx-accent-2-soft), var(--nx-cyan-soft)); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent">
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
						   class="text-xs font-medium shrink-0 transition-colors hover:text-white truncate max-w-40"
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
			<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: #3b3f52; shrink:0">
				<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
			</svg>
			<span class="flex-1 text-xs truncate" style="color: #3b3f52; font-family: 'Space Grotesk', sans-serif">{tFn('common.search_navigate')}</span>
			<div style="display:flex;gap:2px;shrink:0">
				<kbd style="font-size:0.6rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);padding:0.05rem 0.28rem;color:rgba(255,255,255,.18);font-family:ui-monospace,monospace">Ctrl</kbd>
				<kbd style="font-size:0.6rem;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);padding:0.05rem 0.28rem;color:rgba(255,255,255,.18);font-family:ui-monospace,monospace">K</kbd>
			</div>
		</button>

		<!-- Right: actions (notifs + DMs + account) -->
		<div class="flex items-center gap-1 shrink-0 ml-auto lg:ml-0">
			<!-- Language button (guest + logged-in) -->
			<button
				onclick={openLang}
				class="lang-nav-btn p-2 transition-colors flex items-center gap-1.5 text-gray-500"
				title={tFn('settings.language.label')}
				aria-label={tFn('settings.language.label')}>
				<span class="flex items-center leading-none"><ChannelIcon value={LOCALES.find(l => l.code === currentLocale)?.flagIcon} fallback="🌐" size={18} /></span>
				<svg class="hidden sm:block w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>
			</button>
			<!-- Toggle members sidebar (guest + logged-in, XL only to match sidebar) -->
			<button type="button"
			        onclick={toggleC}
			        class="nx-icon-btn hidden xl:flex items-center justify-center w-8 h-8 rounded-lg transition-all relative"
			        class:active={!membersCollapsed}
			        title={tFn('common.members')}
			        aria-label={tFn('members.toggle_aria')}
			        aria-expanded={!membersCollapsed}>
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a3 3 0 0 0-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 0 1 5.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 0 1 9.288 0M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm6 3a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z"/>
				</svg>
			</button>
			{#if user}
				<!-- Notifications -->
				<a href="/notifications"
				   class="nx-icon-btn relative flex items-center justify-center w-8 h-8 rounded-lg transition-all"
				   class:active={isActive('/notifications')}
				   title={tFn('nav.notifications')}>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
					</svg>
					{#if unreadCount > 0}
						<span class="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 flex items-center justify-center text-[9px] font-black text-white rounded-full bg-red-500 leading-none ring-1 ring-[#0a0a0a]">{unreadCount > 9 ? '9+' : unreadCount}</span>
					{/if}
				</a>
				<!-- DMs -->
				<a href="/dm"
				   class="nx-icon-btn relative flex items-center justify-center w-8 h-8 rounded-lg transition-all"
				   class:active={isActive('/dm')}
				   title={tFn('nav.dm')}>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
					</svg>
					{#if dmUnread > 0}
						<span class="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 flex items-center justify-center text-[9px] font-black text-white rounded-full bg-[var(--nx-accent-2-strong)] leading-none ring-1 ring-[#0a0a0a]">{dmUnread > 9 ? '9+' : dmUnread}</span>
					{/if}
				</a>
				{#if user.role === 'owner' || user.role === 'admin'}
					<a href="/admin"
					   class="nx-admin-pill hidden sm:flex items-center px-2.5 h-7 text-[10px] font-black uppercase tracking-wider rounded-md transition-all"
					   class:active={isActive('/admin')}
					   >{tFn('nav.admin')}</a>
				{/if}
				<!-- User dropdown -->
				<div class="relative">
					<button onclick={() => dropdownOpen = !dropdownOpen}
					        class="flex items-center gap-2 px-2 h-8 transition-colors group ml-1"
					        style="border: 1px solid {dropdownOpen ? 'rgb(var(--nx-accent-2-rgb) / .4)' : 'rgba(255,255,255,.07)'}; background: {dropdownOpen ? 'rgb(var(--nx-accent-2-rgb) / .08)' : 'rgba(255,255,255,.04)'}"
					        aria-haspopup="true" aria-expanded={dropdownOpen}>
						<div class="relative shrink-0">
							{#if user.avatar}
								<img src={user.avatar} alt={tFn('common.avatar_alt')} class="w-6 h-6 object-cover" style="outline: 1px solid rgba(255,255,255,.15)" />
							{:else}
								<div class="w-6 h-6 flex items-center justify-center text-xs font-bold text-white select-none" style="background: linear-gradient(135deg, var(--nx-accent-2-strong), var(--nx-cyan-deep))">{user.username.charAt(0).toUpperCase()}</div>
							{/if}
							<span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400 border-[1.5px] border-[#0d0d12]"></span>
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
											<img src={user.avatar} alt={tFn('common.avatar_alt')} class="w-12 h-12 rounded-full object-cover border-2 border-gray-600 shrink-0" />
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
											<div class="h-full rounded-full bg-linear-to-r from-indigo-600 to-indigo-400 transition-all" style="width: {xpInfo.pct}%"></div>
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
				   class="nx-auth-btn flex items-center justify-center h-8 min-w-[5.5rem] px-3 text-xs font-medium rounded-lg transition-all">{tFn('common.login')}</a>
				<a href="/auth/register"
				   class="nx-auth-btn nx-auth-btn--primary flex items-center justify-center h-8 min-w-[5.5rem] px-3 text-xs font-bold rounded-lg transition-all">{tFn('common.register')}</a>
			{/if}
		</div>
	</nav>

	<!-- ══ BODY ═══════════════════════════════════════════════════════════════ -->
	<div class="flex flex-1"
	     style="--left-panel-width: {leftPanelWidth}px; --right-panel-width: {rightPanelWidth}px;"
	     class:layout-dragging={isDraggingLeft || isDraggingRight}>

		<!-- ── Backdrop Channel Sidebar — mobile ──────────────────────────────── -->
		{#if !isBanned && gallerySidebarOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="lg:hidden fixed inset-0 bg-black/60 z-[54] backdrop-blur-xs"
		     role="button" tabindex="-1" aria-label={tFn('common.close_menu')}
		     onclick={() => gallerySidebarOpen = false}
		     onkeydown={e => e.key === 'Escape' && (gallerySidebarOpen = false)}
		     transition:fade={{ duration: 200 }}></div>
		{/if}

		<!-- ── Instance Switcher (56px rail) — desktop only ───────────────────── -->
		{#if !isBanned}
		<div class="nodyx-sb">
		<aside class="rail">
			<div class="scroll">
				<!-- Current instance (logo) — click toggles panel open -->
				<button type="button" class="icon logo {!activeCommunityName ? 'active' : ''}" data-tip={communityName} title={communityName} onclick={() => {
					if (activeCommunityName) {
						activeCommunityNameStore.set(null);
						panelCollapsed = false;
					} else {
						panelCollapsed = !panelCollapsed;
					}
				}}>
					{#if communityLogo}
						<img src={communityLogo} alt={tFn('common.logo_alt')} class="w-full h-full object-cover" />
					{:else}
						{communityName.charAt(0).toUpperCase()}
					{/if}
				</button>

				{#if networkInstances.length > 0}
				<div class="w-8 h-px bg-neutral-900 my-1"></div>
				{/if}

				<!-- Network instances -->
				{#each networkInstances as inst}
					<!-- Decentralized: each instance is its own deployment (own design + data). -->
					<!-- Clicking simply opens that instance's site; we never render a remote instance in place. -->
					<a href={inst.url} target="_blank" rel="noopener noreferrer" class="icon net" data-tip={inst.name} title={inst.name}>
						{#if inst.logo_url}
							<img src={inst.logo_url.startsWith('http') ? inst.logo_url : inst.url.replace(/\/$/, '') + inst.logo_url}
							     alt={inst.name} class="w-full h-full object-cover" />
						{:else}
							{inst.name.charAt(0).toUpperCase()}
						{/if}
						<span class="absolute bottom-0.5 right-0.5 w-2 h-2 rounded-full border-2 border-black {!instanceOnline(inst.last_seen) ? 'bg-neutral-700' : 'bg-green-500'}"></span>
					</a>
				{/each}

				<!-- Add / discover -->
				<a href="/communities" class="icon add" data-tip={tFn('nav.discover_title')} title={tFn('nav.discover_title')}>+</a>
			</div>

			<!-- Docs: pinned at bottom -->
			<a href="https://nodyx.dev" target="_blank" rel="noopener" class="icon docs" data-tip={tFn('nav.docs')} title={tFn('nav.documentation')}>
				<svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"/>
				</svg>
			</a>
		</aside>
		</div>
		{/if}

		<!-- ── Channel Sidebar (220px panel) — sketch 001 ────────────────────── -->
		{#if !isBanned}
		<div class="nodyx-sb">
		<aside class="panel {panelCollapsed ? 'collapsed' : ''} {gallerySidebarOpen ? '' : 'max-lg:!translate-x-[-100%]'}"
		       id="variant-a-panel"
		       role={gallerySidebarOpen ? 'dialog' : undefined}
		       aria-modal={gallerySidebarOpen ? 'true' : undefined}
		       aria-label={tFn('nav.community_menu')}
		       style="width: var(--left-panel-width, 220px);"
		       class:dragging={isDraggingLeft}>

			<button class="edge-handle"
			        onpointerdown={startLeftDrag}
			        onpointermove={handleLeftDragMove}
			        onpointerup={stopLeftDrag}
			        onclick={(e) => {
			            if (leftDragMoved) {
			                e.preventDefault();
			                e.stopPropagation();
			            } else {
			                toggleL();
			            }
			        }}
			        class:dragging-past-boundary={draggingPastBoundaryLeft}
			        aria-label="Resize community menu"
			        title="Drag to resize / click to toggle"></button>

			<!-- Panel head -->
			<div class="panel-head">
				<span class="community-name" id="variant-a-community">{displayCommunityName}</span>
				{#if user?.role === 'owner' || user?.role === 'admin'}
				<a href="/admin" title={tFn('nav.admin')} class="head-icon text-gray-600">
					<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</a>
				{/if}
				<button type="button" class="close" onclick={() => { gallerySidebarOpen = false; panelCollapsed = true; }} aria-label={tFn('common.close')}>×</button>
			</div>

			<!-- Panel scroll: nav + channels together as one block (sketch) -->
			<div class="panel-scroll">

				<!-- Nav section -->
				<div class="nav-section">
					{#each [
						{ href: '/',         label: tFn('nav.home'),    icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z',                                                                                                                                                 show: true },
						{ href: '/feed',     label: tFn('nav.feed'),    icon: 'M3 12h18M3 6h18M3 18h18',                                                                                                                                                               show: !!user },
						{ href: '/forum',    label: tFn('nav.forum'),   icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',                          show: true },
						{ href: '/dm',       label: tFn('nav.dm'),      icon: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',                                                                                    show: mods.dm !== false },
					].filter(i => i.show) as item}
						<a href={activeCommunityUrl ? activeCommunityUrl + item.href : item.href} class="nav-link {isActive(item.href) ? 'active' : ''}">
							<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d={item.icon}/>
							</svg>
							{item.label}
						</a>
					{/each}
				</div>

				<!-- Modules section -->
				<div class="nav-section">
					{#each [
						{ href: '/canvas',   label: 'Canvas',             icon: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',                                                                                                                                                              show: !!mods.canvas },
						{ href: '/calendar', label: tFn('nav.calendar'),   icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',                                                                                                                                                                                                          show: mods.calendar !== false },
						{ href: '/polls',    label: tFn('nav.polls'),     icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',                                                                                          show: mods.polls !== false },
						{ href: '/tasks',    label: tFn('nav.tasks'),       icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',                                                                                                                                                    show: mods.tasks !== false },
						{ href: '/wiki',     label: tFn('nav.wiki'),         icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',                                             show: !!mods.wiki },
						{ href: '/library',  label: tFn('nav.library'), icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',                                             show: true },
						{ href: '/garden',   label: tFn('nav.garden'),       icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',                                                                                                                                            show: true },
						{ href: '/discover', label: tFn('nav.discover'),    icon: 'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',                                                                                         show: true },
					].filter(i => i.show) as item}
						<a href={activeCommunityUrl ? activeCommunityUrl + item.href : item.href} class="nav-link {isActive(item.href) ? 'active' : ''}">
							<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" d={item.icon}/>
							</svg>
							{item.label}
						</a>
					{/each}
				</div>

				<!-- Text channels (flat, like sketch) -->
				{#if mods.chat !== false && layoutTextChannels.length > 0}
				<div class="channel-group-label">{tFn('channels.text')}</div>
				{#each layoutTextChannels as ch}
					{@const chActive = activeChatChannelId === ch.id}
					{@const chUnread = ($unreadCountsStore[ch.id] ?? 0)}
					{@const hasUnread = chUnread > 0 && !chActive}
					<a href={activeCommunityUrl ? activeCommunityUrl + "/chat?channel=" + ch.id : "/chat?channel=" + ch.id} class="channel {chActive ? 'active' : ''}">
						<span class="text-neutral-700"><ChannelIcon value={ch.icon_emoji} fallback="#" size={14} color={ch.name_color ?? null} /></span>
						<span style={chNameStyle(ch)}>{ch.name}</span>
						{#if hasUnread}<span class="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400"></span>{/if}
					</a>
				{/each}
				{/if}

				<!-- Voice channels (flat, like sketch) -->
				{#if mods.voice !== false && layoutVoiceChannels.length > 0}
				<div class="channel-group-label">{tFn('channels.voice')}</div>
				{#each layoutVoiceChannels as ch}
					{@const chActive = activeChatChannelId === ch.id}
					{@const inThis   = voiceState.active && voiceState.channelId === ch.id}
					{@const members  = inThis
						? [
							...voiceState.peers.map((p: any) => ({ username: p.username, avatar: p.avatar ?? null, speaking: p.speaking ?? false, muted: false, deafened: false, isMe: false, userId: p.userId ?? null, socketId: p.socketId ?? null })),
							{ username: user?.username ?? tFn('common.you'), avatar: user?.avatar ?? null, speaking: voiceState.mySpeaking, muted: voiceState.muted, deafened: voiceState.deafened, isMe: true, userId: (user as any)?.id ?? null, socketId: null },
						]
						: (vcMembers[ch.id] ?? []).map((m: any) => ({ ...m, speaking: false, muted: false, deafened: false, isMe: false, userId: m.userId ?? null, socketId: null }))}
					<a href={activeCommunityUrl ? activeCommunityUrl + "/chat?channel=" + ch.id : "/chat?channel=" + ch.id} class="channel {chActive ? 'active' : ''}">
						<span class="text-neutral-700"><ChannelIcon value={ch.icon_emoji} fallback="🔊" size={14} color={ch.name_color ?? null} /></span>
						<span style={chNameStyle(ch)}>{ch.name}</span>
						{#if members.length > 0}
							<span style="margin-left:auto;font-size:10px;color:{inThis ? '#818cf8' : '#333'}">{members.length}</span>
						{/if}
					</a>
					{#if members.length > 0}
						<div class="flex flex-col pl-5 pr-1 pt-0.5 pb-1.5 gap-0.5">
							{#each members.slice(0, 6) as m}
								{@const mSharing = !!(m.userId && screenSharingUserIds.has(m.userId))}
								{@const borderColor = m.speaking ? 'rgba(74,222,128,0.6)' : m.deafened ? 'rgba(249,115,22,0.45)' : m.muted ? 'rgba(239,68,68,0.35)' : mSharing ? 'rgba(59,130,246,0.35)' : 'rgba(255,255,255,0.04)'}
								{@const bgColor    = m.speaking ? 'rgba(74,222,128,0.07)' : m.deafened ? 'rgba(249,115,22,0.05)' : m.muted ? 'rgba(239,68,68,0.04)' : 'rgba(255,255,255,0.02)'}
								{@const nameColor  = m.speaking ? '#86efac' : m.deafened ? '#fdba74' : m.muted ? '#fca5a5' : m.isMe ? 'var(--nx-accent-2-soft2)' : '#6b7280'}
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="vc-member-card relative flex items-center gap-2 px-2 py-1.5 transition-all duration-200"
								     style="background:{bgColor}; border-left:2px solid {borderColor};"
								     onmouseenter={mSharing ? (e: MouseEvent) => showScreenPreview(e, m.userId, m.username, m.avatar, 'right') : undefined}
								     onmouseleave={() => { screenPreview = null }}>
									<div class="relative shrink-0">
										<div class="w-[22px] h-[22px] rounded-full overflow-hidden transition-all duration-200"
										     style="box-shadow:{m.speaking ? '0 0 0 2px rgba(74,222,128,0.55), 0 0 8px rgba(74,222,128,0.25)' : 'none'}">
											{#if m.avatar}
												<img src={m.avatar} alt={m.username} class="w-full h-full object-cover"/>
											{:else}
												<div class="w-full h-full flex items-center justify-center text-[9px] font-black text-white select-none bg-linear-to-br from-[var(--nx-accent-2-strong)] to-[var(--nx-cyan-deep)]">
													{m.username.charAt(0).toUpperCase()}
												</div>
											{/if}
										</div>
										{#if mSharing}
											<div class="absolute -bottom-0.5 -right-0.5 w-[11px] h-[11px] rounded-full flex items-center justify-center bg-blue-500 border-[1.5px] border-[#0d0d12]">
												<svg class="w-1.5 h-1" fill="none" stroke="white" stroke-width="3" viewBox="0 0 24 17">
													<rect x="1" y="1" width="22" height="13" rx="2"/>
												</svg>
											</div>
										{/if}
									</div>
									<span class="text-[11px] font-medium truncate flex-1 transition-colors duration-200"
									      style="color:{nameColor}">
										{m.isMe ? tFn('common.you') : m.username}
									</span>
									{#if m.speaking && !m.muted && !m.deafened}
										<VoiceEqualizer socketId={m.socketId} isMe={m.isMe} />
									{:else}
										<div class="flex items-center gap-0.5 shrink-0">
											{#if m.deafened}
												<svg class="w-[11px] h-[11px] text-orange-400" aria-label={tFn('voice.deafened_aria')} fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
													<path stroke-linecap="round" d="M3 18v-6a9 9 0 0118 0v6"/>
													<path stroke-linecap="round" d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/>
													<path stroke-linecap="round" d="M2 2l20 20"/>
												</svg>
											{/if}
											{#if m.muted}
												<svg class="w-[11px] h-[11px] text-red-400" aria-label={tFn('voice.muted_aria')} fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
													<path stroke-linecap="round" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
													<path stroke-linecap="round" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2"/>
												</svg>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
							{#if members.length > 6}
								<span class="text-[10px] pl-2 pt-0.5 text-gray-700">{tFn('common.others_more', { n: members.length - 6 })}</span>
							{/if}
						</div>
					{/if}
				{/each}
				{/if}

			</div>

			<!-- Voice controls -->
			<VoicePanel mode="sidebar" />

			<!-- Panel bottom: user group + settings gear -->
			{#if user}
			<div class="panel-bottom">
				<button type="button" class="user-group" onclick={openStatusModal}>
					<div class="user-avatar">
						{#if user.avatar}
							<img src={user.avatar} alt="" class="w-full h-full object-cover" />
						{:else}
							{user.username.charAt(0).toUpperCase()}
						{/if}
						<span class="status"></span>
					</div>
					<div class="flex-1 min-w-0">
						<div class="user-name">{user.username}</div>
						<div class="user-role">{user.role === 'owner' ? 'Owner' : user.role === 'admin' ? 'Admin' : tFn('common.member')}</div>
					</div>
				</button>
				<a href="/settings" title={tFn('nav.settings')} class="quick-icon">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</a>
			</div>
			{:else}
			<div class="panel-bottom">
				<a href="/auth/login" class="user-group">
					<div class="user-avatar">?<span class="status"></span></div>
					<div class="flex-1 min-w-0">
						<div class="user-name">{tFn('common.login')}</div>
					</div>
				</a>
				<a class="quick-icon" title={tFn('nav.settings')} href="/settings">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<circle cx="12" cy="12" r="3"/>
						<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
					</svg>
				</a>
			</div>
			{/if}

		</aside>
		</div>
		{/if}


		<!-- ── Contenu principal ───────────────────────────────────────────────── -->
		<div class="flex-1 overflow-hidden">
		<main class="{langView ? 'h-[calc(100vh-48px)] overflow-hidden' : 'h-full overflow-y-auto'} min-w-0 pb-[var(--bottom-nav-h)]"
		      class:panel-collapsed={isBanned || !showChannelSidebar || panelCollapsed}
		      class:members-collapsed={membersCollapsed}>

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
                        aria-label={tFn('announcement.dismiss')}
                    >
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            {/if}


            <div class="w-full flex-1 flex flex-col {langView ? 'lang-view-wrap h-full' : ($page.url.pathname === '/' || $page.url.pathname.startsWith('/chat') || $page.url.pathname.startsWith('/admin') || $page.url.pathname.startsWith('/users/') || $page.url.pathname.startsWith('/feed') || $page.url.pathname.startsWith('/settings') || $page.url.pathname.startsWith('/garden') || $page.url.pathname.startsWith('/calendar') || $page.url.pathname.startsWith('/discover') || $page.url.pathname.startsWith('/wiki') || $page.url.pathname.startsWith('/library') || $page.url.pathname.startsWith('/dm') || $page.url.pathname.startsWith('/auth/') ? 'h-full' : ($page.url.pathname.startsWith('/forum') || $page.url.pathname.startsWith('/tasks')) ? 'px-4 sm:px-6 py-8' : 'max-w-5xl mx-auto px-4 py-8')}">
                {#if langView}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div class="fixed inset-0 bg-black/40 backdrop-blur-xs z-40" onclick={() => langView = false} transition:fade={{ duration: 200 }}></div>
                    <div
                        class="lang-view flex flex-col gap-4 w-full h-full min-h-0 p-6 sm:p-8 relative z-41"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="lang-title"
                        aria-describedby="lang-desc"
                        style="transform: translateY({langDragY}px); transition: transform {langDragY > 0 ? 'none' : '0.3s cubic-bezier(0.16, 1, 0.3, 1)'};"
                        transition:fly={{ y: 20, duration: 300, easing: cubicOut }}
                        ontouchstart={onLangTouchStart}
                        ontouchmove={onLangTouchMove}
                        ontouchend={onLangTouchEnd}
                    >
                        <button onclick={() => langView = false} class="lang-back inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-400 shrink-0 bg-transparent border border-white/[0.12] rounded-md px-3 py-2 cursor-pointer" aria-label={tFn('common.back')}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 12H5M12 5l-7 7 7 7"/>
                            </svg>
                            {tFn('common.back')}
                        </button>
                        <div class="flex flex-col gap-4 min-h-0 flex-1">
                            <div class="flex items-start gap-4 mb-1 shrink-0">
                                <div class="lang-icon w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75">
                                        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/>
                                    </svg>
                                </div>
                                <div>
                                    <h2 id="lang-title" class="lang-title text-xl font-bold text-slate-100 m-0 mb-1 leading-tight">{tFn('settings.language.title')}</h2>
                                    <p id="lang-desc" class="text-[13px] text-gray-500 leading-relaxed m-0">{tFn('settings.language.desc')}</p>
                                </div>
                            </div>
                            <div class="lang-card rounded-lg p-5 min-h-0 flex flex-col flex-1">
                                <div class="lang-segments flex flex-col gap-2 overflow-y-auto overflow-x-hidden flex-1 min-h-0 px-2">
                                    {#each LOCALES as loc}
                                    <button
                                        onclick={() => pickLocale(loc.code)}
                                        class="lang-seg flex items-center gap-4 p-4 rounded-lg border border-white/[0.06] bg-white/[0.02] cursor-pointer w-full relative overflow-hidden shrink-0 text-left {currentLocale === loc.code ? 'active' : ''}"
                                    >
                                        <span class="shrink-0 flex items-center leading-none"><ChannelIcon value={loc.flagIcon} size={26} /></span>
                                        <span class="flex-1 min-w-0">
                                            <span class="lang-label text-sm font-semibold text-slate-200 block leading-relaxed">{loc.label}</span>
                                        </span>
                                        {#if currentLocale === loc.code}
                                        <svg class="lang-seg-check w-5 h-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                                            <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
                                        </svg>
                                        {/if}
                                    </button>
                                    {/each}
                                </div>
                            </div>
                            {#if langSaved}
                            <div class="lang-success mt-3 py-2 px-3 rounded-md text-[13px] font-medium shrink-0 bg-green-400/10 border border-green-400/20 text-green-400">{tFn('settings.language.saved')}</div>
                            {/if}
                        </div>
                    </div>
                {:else}
                    {@render children()}
                {/if}
            </div>
        </main>
		</div>

		<aside class="hidden xl:flex members members-c"
		       class:collapsed={membersCollapsed}
		       id="members-c"
		       style="width: {membersCollapsed ? '0px' : 'var(--right-panel-width, 220px)'};"
		       class:dragging={isDraggingRight}>
			<button class="edge-handle"
			        onpointerdown={startRightDrag}
			        onpointermove={handleRightDragMove}
			        onpointerup={stopRightDrag}
			        onclick={(e) => {
			            if (rightDragMoved) {
			                e.preventDefault();
			                e.stopPropagation();
			            } else {
			                toggleC();
			            }
			        }}
			        class:dragging-past-boundary={draggingPastBoundaryRight}
			        aria-label={tFn('members.toggle_aria')}
			        title={tFn('members.toggle_aria')}></button>
			<div class="members-header">
				<span class="label">{tFn('common.members')}</span>
				<div class="online-count">
					<span class="online-dot"></span>
					<span class="online-num">{onlineMembers.length}</span>
				</div>
			</div>

			{#if user}
			<div class="members-scroll">
				<div class="scroll-inner">

					<!-- ── Grouped by grade ──────────────────────────────────────── -->
					{#each [...memberGroups.groups.entries()] as [gradeName, members]}
						<div class="group-label">
							<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background: {members[0]?.grade?.color ?? '#6b7280'}"></span>
							<span class="gt">{gradeName}</span>
							<span class="gc">{members.length}</span>
						</div>
						{#each members as member (member.userId)}
							{@const isMe        = member.userId === (user as any)?.id}
							{@const hasStatus   = !!(member.status?.text || member.status?.emoji)}
							{@const isSharing   = screenSharingUserIds.has(member.userId)}
							{@const isStreaming = streamingUserIds.has(member.userId)}
							{@const avatarColor = members[0]?.grade?.color ?? 'var(--nx-accent-2-strong)'}

							<button type="button"
							        class="member {isMe ? 'me' : ''}"
							        onclick={isMe ? openStatusModal : () => goto(`/users/${member.username}`)}
							        onmouseenter={isSharing && !isMe ? (e: MouseEvent) => showScreenPreview(e, member.userId, member.username, member.avatar, 'left') : undefined}
							        onmouseleave={() => { screenPreview = null }}>
								<span class="hover-bar"></span>
								<div class="avatar-wrap">
									{#if member.avatar}
										<img src={member.avatar} alt="" class="avatar object-cover" />
									{:else}
										<div class="avatar" style="background: linear-gradient(135deg, {avatarColor}80, var(--nx-cyan-deep))">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
									<span class="status-dot">
										{#if isSharing}
											<svg style="width:10px;height:10px;color:rgb(96,165,250)" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
												<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
											</svg>
										{:else if isStreaming}
											<span class="w-2 h-2 rounded-full bg-red-500 block animate-pulse"></span>
										{:else}
											<span class="d"></span>
										{/if}
									</span>
								</div>
								<div class="info">
									<div class="name-row">
										<span class="name {buildAnimClass(member)}" style={buildNameStyle(member, isMe ? 'var(--nx-accent-2-soft2)' : '#9ca3af')}>{member.username}</span>
										{#if isMe}<span class="you-tag">vous</span>{/if}
									</div>
									{#if isSharing || isStreaming}
										<div class="status-text flex items-center gap-1">
											{#if isSharing}
												<span class="text-[9px] font-bold px-1 py-px bg-blue-500/10 border border-blue-500/20 text-blue-400">{tFn('voice.screen_badge')}</span>
											{/if}
											{#if isStreaming}
												<span class="text-[9px] font-bold px-1 py-px bg-red-500/10 border border-red-500/20 text-red-400">LIVE</span>
											{/if}
										</div>
									{:else if hasStatus}
										<div class="status-text">{member.status?.emoji} {member.status?.text}</div>
									{:else if isMe}
										<div class="status-text">{tFn('common.set_status')}</div>
									{/if}
								</div>
							</button>
						{/each}
					{/each}

					<!-- ── No-grade online members ───────────────────────────────── -->
					{#if memberGroups.ungrouped.length > 0}
						<div class="group-label">
							<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-green-400"></span>
							<span class="gt">{tFn('members.online')}</span>
							<span class="gc">{memberGroups.ungrouped.length}</span>
						</div>
						{#each memberGroups.ungrouped as member (member.userId)}
							{@const isMe        = member.userId === (user as any)?.id}
							{@const hasStatus   = !!(member.status?.text || member.status?.emoji)}
							{@const isSharing   = screenSharingUserIds.has(member.userId)}
							{@const isStreaming = streamingUserIds.has(member.userId)}

							<button type="button"
							        class="member {isMe ? 'me' : ''}"
							        onclick={isMe ? openStatusModal : () => goto(`/users/${member.username}`)}
							        onmouseenter={isSharing && !isMe ? (e: MouseEvent) => showScreenPreview(e, member.userId, member.username, member.avatar, 'left') : undefined}
							        onmouseleave={() => { screenPreview = null }}>
								<span class="hover-bar"></span>
								<div class="avatar-wrap">
									{#if member.avatar}
										<img src={member.avatar} alt="" class="avatar object-cover" />
									{:else}
										<div class="avatar bg-linear-to-br from-[#7c3aed80] to-[var(--nx-cyan-deep)]">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
									<span class="status-dot">
										{#if isSharing}
											<svg style="width:10px;height:10px;color:rgb(96,165,250)" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
												<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
											</svg>
										{:else if isStreaming}
											<span class="w-2 h-2 rounded-full bg-red-500 block animate-pulse"></span>
										{:else}
											<span class="d"></span>
										{/if}
									</span>
								</div>
								<div class="info">
									<div class="name-row">
										<span class="name {buildAnimClass(member)}" style={buildNameStyle(member, isMe ? 'var(--nx-accent-2-soft2)' : '#9ca3af')}>{member.username}</span>
										{#if isMe}<span class="you-tag">vous</span>{/if}
									</div>
									{#if isSharing || isStreaming}
										<div class="status-text flex items-center gap-1">
											{#if isSharing}
												<span class="text-[9px] font-bold px-1 py-px bg-blue-500/10 border border-blue-500/20 text-blue-400">{tFn('voice.screen_badge')}</span>
											{/if}
											{#if isStreaming}
												<span class="text-[9px] font-bold px-1 py-px bg-red-500/10 border border-red-500/20 text-red-400">LIVE</span>
											{/if}
										</div>
									{:else if hasStatus}
										<div class="status-text">{member.status?.emoji} {member.status?.text}</div>
									{:else if isMe}
										<div class="status-text">{tFn('common.set_status')}</div>
									{/if}
								</div>
							</button>
						{/each}
					{/if}

					<!-- ── Offline members ───────────────────────────────────────── -->
					{#if offlineMembers.length > 0}
						<div class="group-label">
							<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-700"></span>
							<span class="gt">{tFn('members.offline')}</span>
							<span class="gc">{offlineMembers.length}</span>
						</div>
						{#each offlineMembers.slice(0, 10) as member (member.user_id)}
							<button type="button"
							        class="member offline"
							        onclick={() => goto(`/users/${member.username}`)}>
								<div class="avatar-wrap">
									{#if member.avatar}
										<img src={member.avatar} alt="" class="avatar grayscale object-cover" />
									{:else}
										<div class="avatar">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
									<span class="status-dot"><span class="d offline"></span></span>
								</div>
								<div class="info">
									<div class="name-row">
										<span class="name">{member.username}</span>
									</div>
								</div>
							</button>
						{/each}
						{#if offlineMembers.length > 10}
							<a href="/members" class="flex items-center justify-center gap-1 mx-2 my-1 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors text-gray-700 border border-white/5">
								{tFn('members.see_all')} <span class="text-[9px] text-gray-600">({offlineMembers.length})</span>
							</a>
						{/if}
					{/if}

				</div>
			</div>
			{:else}
				<!-- Not logged in — invite card -->
				<a href="/auth/login" class="guest-members-card" aria-label={tFn('members.guest_aria')}>
					<!-- Radar animé -->
					<div class="guest-radar">
						<div class="guest-radar-ring r1"></div>
						<div class="guest-radar-ring r2"></div>
						<div class="guest-radar-ring r3"></div>
						<div class="guest-radar-core">
							<svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.75">
								<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
							</svg>
						</div>
					</div>
					<!-- Avatars fantômes -->
					<div class="guest-ghosts">
						{#each ['M','J','A','K','S','T','R','L'] as letter, i}
						<div class="guest-ghost" style="--gi:{i}; --gc:{['var(--nx-accent-soft)','var(--nx-accent-2-soft)','#34d399','#fb923c','#f472b6','var(--nx-cyan-soft)','#facc15','#f87171'][i]}">
							{letter}
						</div>
						{/each}
					</div>
					<div class="guest-live-row">
						<span class="guest-live-dot"></span>
						<span class="guest-live-label">
							{memberCount > 0 ? tFn('members.guest_count', { count: memberCount }) : tFn('members.guest_active')}
						</span>
					</div>
					<p class="guest-tagline">{tFn('members.guest_tagline')}</p>
					<div class="guest-cta">
						<svg width="13" height="13" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>
						</svg>
						{tFn('common.login')}
					</div>
				</a>
			{/if}
			<NodyxVersionBadge version={data.nodyxVersion ?? 'unknown'} variant="footer" />
		</aside>

	</div>

	<!-- ══ BOTTOM NAV mobile (lg:hidden) — hidden for banned users ═════════ -->
	{#if !isBanned}
	<nav class="lg:hidden fixed bottom-0 left-0 right-0 z-45 border-t border-gray-800 flex items-stretch"
	     style="background: var(--p-card-bg); border-color: var(--p-card-border); padding-bottom: env(safe-area-inset-bottom, 0px)">

		<!-- Fil d'actu (si connecté) -->
		{#if user}
		<a href="/feed" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/feed') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 12h18M3 6h18M3 18h12"/>
			</svg>
			<span class="text-[10px] font-medium">Actu</span>
		</a>
		{/if}

		<!-- Forum -->
		<a href="/forum" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/forum') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
				<polyline stroke-linecap="round" stroke-linejoin="round" points="9 22 9 12 15 12 15 22"/>
			</svg>
			<span class="text-[10px] font-medium">Forum</span>
		</a>

		<!-- Chat (si connecté) -->
		{#if user}
		<a href="/chat" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 relative {isActive('/chat') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
			</svg>
			{#if unreadCount > 0}
				<span class="absolute top-1.5 right-[calc(50%-14px)] min-w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-bold px-1 flex items-center justify-center">
					{unreadCount > 9 ? '9+' : unreadCount}
				</span>
			{/if}
			<span class="text-[10px] font-medium">Chat</span>
		</a>
		{/if}

		<!-- Messages privés (si connecté) -->
		{#if user}
		<a href="/dm" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 relative {isActive('/dm') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-5l-4 4v-4z"/>
			</svg>
			{#if dmUnread > 0}
				<span class="absolute top-1.5 right-[calc(50%-14px)] min-w-4 h-4 rounded-full bg-indigo-500 text-white text-[9px] font-bold px-1 flex items-center justify-center">
					{dmUnread > 9 ? '9+' : dmUnread}
				</span>
			{/if}
			<span class="text-[10px] font-medium">DMs</span>
		</a>
		{/if}

		<!-- Bibliothèque -->
		<a href="/library" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/library') ? 'text-indigo-400' : 'text-gray-500'}">
			<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
				<path stroke-linecap="round" stroke-linejoin="round" d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
			</svg>
			<span class="text-[10px] font-medium">Biblio</span>
		</a>

		<!-- Annuaire -->
		<a href="/communities" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {isActive('/communities') ? 'text-indigo-400' : 'text-gray-500'}">
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
		   class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 {$page.url.pathname.startsWith('/users/') ? 'text-indigo-400' : 'text-gray-500'}">
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
		<a href="/auth/login" class="flex-1 flex flex-col items-center justify-center py-2 min-h-14 gap-0.5 text-gray-500">
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
{/if}<!-- /isOverlayRoute -->

<!-- ── Status modal ──────────────────────────────────────────────────────── -->
{#if showStatusModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-xs"
		role="presentation"
		onclick={(e) => { if (e.target === e.currentTarget) showStatusModal = false }}>
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-5"
			onclick={(e) => e.stopPropagation()}>
			<h2 class="text-sm font-bold text-white mb-4">{tFn('status.modal_title')}</h2>

			<!-- Current status preview -->
			<div class="flex items-center gap-2.5 mb-4 px-3 py-2 bg-gray-800 rounded-xl border border-gray-700">
				<span class="text-xl w-8 text-center">{statusEmoji || '😶'}</span>
				<span class="text-sm text-gray-300 flex-1 truncate">{statusText || tFn('status.none')}</span>
			</div>

			<!-- Emoji + text inputs -->
			<div class="flex gap-2 mb-3">
				<input
					type="text"
					placeholder="😀"
					bind:value={statusEmoji}
					maxlength={8}
					class="w-14 bg-gray-800 border border-gray-700 rounded-lg px-2 py-2 text-center text-lg outline-hidden focus:border-indigo-600 transition-colors"
				/>
				<input
					type="text"
					placeholder={tFn('status.placeholder')}
					bind:value={statusText}
					maxlength={60}
					class="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 outline-hidden focus:border-indigo-600 transition-colors"
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
						{tFn('common.clear')}
					</button>
				{/if}
				<button onclick={() => showStatusModal = false} class="px-3 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs text-gray-400 hover:text-white transition-colors ml-auto">
					{tFn('common.cancel')}
				</button>
				<button onclick={saveStatus} class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs text-white font-medium transition-colors">
					{tFn('common.save')}
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
					     style="background: linear-gradient(135deg, var(--nx-accent-2-strong), var(--nx-cyan-deep))">
						{evt.username.charAt(0).toUpperCase()}
					</div>
				{/if}
				<span class="text-xs whitespace-nowrap">
					<span class="font-bold" style="color: #e2e8f0">{evt.username}</span>
					<span style="color: #4b5563"> {evt.action === 'join' ? tFn('presence.joined') : tFn('presence.left')} </span>
					<span style="color: var(--nx-accent-2-soft)"># {evt.channelName}</span>
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

<!-- ── Floating Reactions overlay (Layer 2) ──────────────────────────────────
     Écoute les 3 events socket (chat, forum, DM) et fait monter l'emoji
     avec le nom de l'auteur. Le composant est pointer-events:none donc il
     ne bloque jamais un clic. -->
<FloatingReactions />

<!-- ── External Link Warning ─────────────────────────────────────────────────
     Modal éducatif anti-phishing. Activé via le store externalLinkGuard
     quand un composant (MessageBody, etc.) demande à ouvrir un lien externe. -->
<ExternalLinkWarning />

<!-- ── La Scène (partage d'écran) ────────────────────────────────────────────
     Montée ICI, à la RACINE, et surtout PAS dans VoicePanel : celui-ci vit dans
     <aside id="galaxy-sidebar">, qui est `fixed` + `z-30` et crée donc un contexte
     d'empilement. Un enfant en z-[500] y restait prisonnier, et la sidebar des
     membres (z-30, plus loin dans le DOM) peignait par-dessus la Scène : écran
     rogné à droite, en-tête de la Scène (boutons Chat / PiP) invisible.
     À la racine, le plein écran est vraiment plein écran. -->
{#if $stageOpenStore}
	<StageView onclose={() => stageOpenStore.set(false)} />
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
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

/* ── Main content transition during collapse/expand ──────────────────────── */
:global(main) {
  transition: padding-left .25s cubic-bezier(.4,0,.2,1), margin-right .25s cubic-bezier(.4,0,.2,1);
}

.layout-dragging :global(main) {
  transition: none !important;
}

@media (min-width: 1024px) {
  :global(main) {
    padding-left: calc(56px + var(--left-panel-width, 220px)) !important;
  }
  :global(main.panel-collapsed) {
    padding-left: 56px !important;
  }
}

@media (min-width: 1280px) {
  :global(main) {
    margin-right: var(--right-panel-width, 220px) !important;
  }
  :global(main.members-collapsed) {
    margin-right: 0px !important;
  }
}

/* ── Sketch 001: Discord two-tier sidebar — exact sketch CSS, scoped ────── */
.nodyx-sb .rail {
  position: fixed; top: 48px; bottom: 0; left: 0; width: 56px;
  background: #000; border-right: 1px solid #111;
  display: flex; flex-direction: column; align-items: center; padding: 8px 0; gap: 4px; z-index: 40;
}
.nodyx-sb .rail .scroll {
  flex: 1; overflow-y: auto; width: 100%; display: flex; flex-direction: column;
  align-items: center; gap: 4px; padding: 4px 0; scrollbar-width: none;
}
.nodyx-sb .rail .scroll::-webkit-scrollbar { display: none; }
.nodyx-sb .rail .icon {
  width: 32px; height: 32px; border-radius: 6px; shrink: 0; cursor: pointer;
  display: flex; align-items: center; justify-content: center; position: relative;
  transition: all .12s; font-weight: 700; font-size: 12px; font-family: 'JetBrains Mono', monospace;
  text-decoration: none;
}
.nodyx-sb .rail .icon.logo { background: #6366f1; color: #fff; }
.nodyx-sb .rail .icon.logo:hover { border-radius: 8px; }
.nodyx-sb .rail .icon.net { background: #1a1a1a; color: #9ca3af; border: 1px solid #222; }
.nodyx-sb .rail .icon.net:hover { background: #222; border-radius: 8px; }
.nodyx-sb .rail .icon.net.active { background: #222; color: #e2e8f0; border-color: #333; }
.nodyx-sb .rail .icon.add { background: transparent; border: 1px dashed #333; color: #4b5563; font-size: 15px; font-weight: 300; }
.nodyx-sb .rail .icon.add:hover { border-color: #6366f1; color: #6366f1; border-radius: 8px; }
.nodyx-sb .rail .icon.docs { background: transparent; color: #4b5563; border: none; margin-top: auto; }
.nodyx-sb .rail .icon.docs:hover { background: #111; color: #818cf8; border-radius: 8px; }

.nodyx-sb .panel {
  position: fixed; top: 48px; bottom: 0; left: 56px;
  width: var(--left-panel-width, 220px);
  background: #0a0a0a; border-right: 1px solid #111;
  z-index: 39; display: flex; flex-direction: column;
  transform: translateX(0); transition: transform .25s cubic-bezier(.4,0,.2,1), width .25s cubic-bezier(.4,0,.2,1);
}
.nodyx-sb .panel.collapsed { transform: translateX(-100%); }
.nodyx-sb .panel.dragging {
  transition: none !important;
}
.nodyx-sb .panel .panel-head {
  padding: 12px 14px; border-bottom: 1px solid #111; display: flex; align-items: center; gap: 8px;
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 13px; color: #e2e8f0;
}
.nodyx-sb .panel .panel-head .community-name { letter-spacing: -.01em; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.nodyx-sb .panel .panel-head .close {
  margin-left: auto; cursor: pointer; color: #4b5563; padding: 2px 6px; border-radius: 4px;
  font-size: 16px; transition: all .12s; line-height: 1; background: none; border: none;
}
.nodyx-sb .panel .panel-head .close:hover { background: #111; color: #e2e8f0; }
.nodyx-sb .panel .panel-head .head-icon {
  shrink: 0; color: #4b5563; cursor: pointer; padding: 4px; border-radius: 4px;
  transition: all .12s; display: flex; align-items: center; justify-content: center;
  text-decoration: none;
}
.nodyx-sb .panel .panel-head .head-icon:hover { background: #111; color: #818cf8; }

.nodyx-sb .panel .panel-scroll {
  flex: 1; overflow-y: auto; padding: 6px 8px 12px;
  scrollbar-width: thin; scrollbar-color: #1a1a1a transparent;
}
.nodyx-sb .panel .panel-scroll::-webkit-scrollbar { width: 4px; }
.nodyx-sb .panel .panel-scroll::-webkit-scrollbar-thumb { background: #1a1a1a; border-radius: 2px; }
.nodyx-sb .panel .panel-scroll::-webkit-scrollbar-track { background: transparent; }
.nodyx-sb .panel .panel-scroll .nav-section {
  padding: 6px 0; display: flex; flex-direction: column; gap: 1px;
  border-bottom: 1px solid #111; margin-bottom: 4px;
}
.nodyx-sb .panel .panel-scroll .nav-link {
  border-radius: 4px; padding: 6px 10px; font-family: 'JetBrains Mono', monospace;
  font-size: 12px; color: #6b7280; gap: 10px; display: flex; align-items: center; cursor: pointer;
  transition: all .12s; text-decoration: none;
}
.nodyx-sb .panel .panel-scroll .nav-link:hover { background: #111; color: #e2e8f0; }
.nodyx-sb .panel .panel-scroll .nav-link.active { background: rgba(99,102,241,.12); color: #818cf8; }

.nodyx-sb .panel .panel-scroll .nav-link .badge { margin-left: auto; background: #ef4444; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 8px; }
.nodyx-sb .panel .panel-scroll .channel-group-label {
  font-family: 'JetBrains Mono', monospace; font-size: 9px; padding: 10px 8px 4px;
  letter-spacing: .15em; font-weight: 700; color: #333;
}
.nodyx-sb .panel .panel-scroll .channel {
  border-radius: 4px; padding: 5px 8px; font-family: 'JetBrains Mono', monospace;
  font-size: 12px; color: #6b7280; gap: 6px; display: flex; align-items: center; cursor: pointer;
  transition: all .12s; text-decoration: none;
}
.nodyx-sb .panel .panel-scroll .channel:hover { background: #111; color: #e2e8f0; }
.nodyx-sb .panel .panel-scroll .channel.active { background: rgba(99,102,241,.12); color: #818cf8; }
.nodyx-sb .panel .panel-bottom {
  padding: 8px 10px; border-top: 1px solid #111; background: #0d0d12;
  display: flex; align-items: center; gap: 8px;
}
.nodyx-sb .panel .panel-bottom .user-group {
  display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
  cursor: pointer; padding: 4px 6px; margin: -4px -6px; border-radius: 6px;
  transition: background .12s; background: none; border: none; text-align: left;
}
.nodyx-sb .panel .panel-bottom .user-group:hover { background: #111; }
.nodyx-sb .panel .panel-bottom .user-avatar {
  width: 32px; height: 32px; border-radius: 6px; shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-weight: 700; font-size: 12px; color: #fff; font-family: 'JetBrains Mono', monospace;
  background: linear-gradient(135deg, #6366f1, #3730a3);
  position: relative; overflow: hidden;
}
.nodyx-sb .panel .panel-bottom .user-avatar .status {
  position: absolute; bottom: -2px; right: -2px; width: 10px; height: 10px;
  border-radius: 50%; background: #22c55e; border: 2px solid #0d0d12;
}
.nodyx-sb .panel .panel-bottom .user-name {
  font-family: 'JetBrains Mono', monospace; font-weight: 700; font-size: 12px;
  color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nodyx-sb .panel .panel-bottom .user-role {
  font-family: 'JetBrains Mono', monospace; font-size: 9px; font-weight: 700;
  color: #818cf8; text-transform: uppercase; letter-spacing: .1em;
}
.nodyx-sb .panel .panel-bottom .quick-icon {
  shrink: 0; color: #333; cursor: pointer; padding: 6px; border-radius: 4px;
  transition: all .12s; display: flex; align-items: center; justify-content: center;
}
.nodyx-sb .panel .panel-bottom .quick-icon:hover { background: #111; color: #818cf8; }


/* Mobile drawer overrides */
@media (max-width: 1023px) {
  .nodyx-sb .rail { display: none; }
  .nodyx-sb .panel { left: 0; width: 280px; z-index: 55; }
}

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
	shrink: 0;
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
	color: var(--nx-accent-2-soft);
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
	shrink: 0;
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
	color: var(--nx-accent-2-soft2);
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


/* ── Layout channel sub-labels (Texte / Vocal) ───────────────────────────── */
.lch-sublabel {
	display: flex; align-items: center; gap: 5px;
	padding: 8px 10px 3px;
	font-size: 9px; font-weight: 800;
	text-transform: uppercase; letter-spacing: .16em;
	color: #374151;
}
.lch-sublabel svg { width: 10px; height: 10px; shrink: 0; }
.lch-sublabel--voice { color: #14532d; margin-top: 4px; }
.lch-sublabel--voice svg { stroke: #166834; }

.lch-voice-ico { width: 14px; height: 14px; shrink: 0; transition: stroke .15s; }

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
	background: rgb(var(--nx-accent-2-rgb) / .12);
}

.lch-unread {
	color: #e2e8f0;
	background: rgb(var(--nx-accent-rgb) / .07);
	box-shadow: inset 2px 0 0 rgb(var(--nx-accent-2-rgb) / .65);
	animation: lch-breathe 2.8s ease-in-out infinite;
}
.lch-unread:hover { background: rgb(var(--nx-accent-rgb) / .13); }

@keyframes lch-breathe {
	0%,100% {
		box-shadow: inset 2px 0 0 rgb(var(--nx-accent-2-rgb) / .5);
		background: rgb(var(--nx-accent-rgb) / .06);
	}
	50% {
		box-shadow: inset 2px 0 0 rgba(167,139,250,.95), 0 0 12px rgb(var(--nx-accent-rgb) / .12);
		background: rgb(var(--nx-accent-rgb) / .11);
	}
}

.lch-flash::after {
	content: '';
	position: absolute;
	inset: 0;
	background: linear-gradient(
		90deg,
		transparent 0%,
		rgb(var(--nx-accent-rgb) / .2) 35%,
		rgba(167,139,250,.28) 50%,
		rgb(var(--nx-accent-rgb) / .2) 65%,
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
	shrink: 0;
	min-width: 15px;
	height: 15px;
	padding: 0 4px;
	border-radius: 99px;
	background: var(--nx-accent-2-strong);
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

/* ── Language view (state-swapped, no route) ────────────────────────────── */
.lang-view-wrap {
    background: rgba(6, 6, 10, 0.85);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    color: #e2e8f0;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
/* ── Top bar icon buttons + auth buttons ─────────────────────────────────── */
.nx-icon-btn {
    color: #6b7280;
    background: transparent;
    border: 1px solid transparent;
}
.nx-icon-btn:hover {
    color: #d1d5db;
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.06);
}
.nx-icon-btn:active { transform: scale(0.94); }
.nx-icon-btn.active {
    color: var(--nx-accent-2-soft, #818cf8);
    background: rgba(var(--nx-accent-2-rgb, 99, 102, 241), 0.08);
    border-color: rgba(var(--nx-accent-2-rgb, 99, 102, 241), 0.2);
}
.nx-icon-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--nx-accent-rgb, 99, 102, 241), 0.4);
}
/* Admin pill — uses .nx-icon-btn.active styles */
a.nx-icon-btn[class*="active"],
.nx-icon-btn.active {
    color: var(--nx-accent-2-soft, #818cf8);
}
/* Admin pill in top bar */
.nx-admin-pill {
    color: #4b5563;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.06);
}
.nx-admin-pill:hover {
    color: #d1d5db;
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.12);
}
.nx-admin-pill.active {
    color: var(--nx-accent-2-soft, #818cf8);
    background: rgba(var(--nx-accent-2-rgb, 99, 102, 241), 0.08);
    border-color: rgba(var(--nx-accent-2-rgb, 99, 102, 241), 0.3);
}
/* Auth buttons (Sign in / Register) */
.nx-auth-btn {
    color: #9ca3af;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.08);
}
.nx-auth-btn:hover {
    color: #f3f4f6;
    background: rgba(255,255,255,0.05);
    border-color: rgba(255,255,255,0.14);
}
.nx-auth-btn:active { transform: scale(0.97); }
.nx-auth-btn--primary {
    color: #fff;
    background: var(--nx-accent-2-strong, #6366f1);
    border-color: transparent;
    box-shadow: 0 1px 2px rgba(0,0,0,0.2), 0 0 12px rgba(var(--nx-accent-2-rgb, 99, 102, 241), 0.25);
}
.nx-auth-btn--primary:hover {
    background: var(--nx-accent-2-strong, #6366f1);
    filter: brightness(1.1);
    border-color: transparent;
    box-shadow: 0 2px 6px rgba(0,0,0,0.25), 0 0 18px rgba(var(--nx-accent-2-rgb, 99, 102, 241), 0.4);
}
.nx-auth-btn--primary:active { transform: scale(0.97); }

.lang-nav-btn {
    border-radius: 6px;
    transition: color 200ms cubic-bezier(0.25, 0.1, 0.25, 1),
                background 200ms cubic-bezier(0.25, 0.1, 0.25, 1),
                transform 100ms ease-out;
}
.lang-nav-btn:hover {
    color: #9ca3af !important;
    background: rgba(255,255,255,0.05);
}
.lang-nav-btn:active { transform: scale(0.95); }
.lang-nav-btn:focus-visible {
    outline: none;
    box-shadow: 0 0 0 2px rgba(var(--nx-accent-rgb), 0.4);
}
.lang-back {
    transition: all 200ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.lang-back:hover { color: #fff; border-color: rgba(255,255,255,0.25); }
.lang-back:active { transform: scale(0.98); }
.lang-back:focus-visible { outline: none; border-color: var(--nx-accent); }
.lang-card {
    background: rgba(255, 255, 255, 0.03);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.06);
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
}
.lang-icon {
    border-color: rgba(var(--nx-accent-rgb), 0.2);
    background: rgba(var(--nx-accent-rgb), 0.1);
    color: var(--nx-accent-soft);
}
.lang-title {
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: -0.03em;
}
.lang-label {
    font-family: 'Space Grotesk', sans-serif;
    letter-spacing: -0.005em;
}
.lang-segments {
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.06) transparent;
}
.lang-segments::-webkit-scrollbar { width: 5px; position: absolute; }
.lang-segments::-webkit-scrollbar-track { background: transparent; }
.lang-segments::-webkit-scrollbar-thumb { background: rgba(255,255,255,.06); border-radius: 99px; }
.lang-segments::-webkit-scrollbar-thumb:hover { background: rgba(var(--nx-accent-rgb), 0.4); }
.lang-seg {
    transition: all 300ms cubic-bezier(0.25, 0.1, 0.25, 1);
}
.lang-seg::before {
    content: '';
    position: absolute;
    left: 0; top: 0; bottom: 0;
    width: 2px;
    background: linear-gradient(180deg, var(--nx-accent), var(--nx-accent-2));
    opacity: 0;
    transform: translateX(-100%);
    transition: all 300ms cubic-bezier(0.25, 0.1, 0.25, 1);
    box-shadow: 0 0 8px var(--nx-accent);
}
.lang-seg:hover {
    border-color: rgba(255,255,255,0.12);
    background: rgba(255,255,255,0.04);
}
.lang-seg:active {
    transform: scale(0.98);
    background: rgba(255, 255, 255, 0.05);
    transition: transform 100ms ease-out, background 100ms ease-out;
}
.lang-seg:focus-visible {
    outline: none;
    border-color: var(--nx-accent);
    box-shadow: 0 0 0 3px rgba(var(--nx-accent-rgb), 0.3);
}
.lang-seg.active {
    border-color: #4f46e5;
    background: #4f46e5;
}
.lang-seg.active::before { opacity: 1; transform: translateX(0); }
.lang-seg.active .text-slate-200 { color: #fff; }
.lang-seg.active .lang-seg-check { color: #fff; }
.lang-seg-check {
    color: var(--nx-accent);
    transform: scale(0);
    transition: transform 350ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.lang-seg.active .lang-seg-check { transform: scale(1); }
.lang-success {
    animation: lang-success-in 200ms ease-out;
}
@keyframes lang-success-in {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
}

/* ── Reduced motion ──────────────────────────────────────────────────────── */
@media (prefers-reduced-motion: reduce) {
    .lang-back,
    .lang-seg,
    .lang-seg::before,
    .lang-seg-check,
    .lang-success {
        transition: none !important;
        animation: none !important;
        transform: none !important;
    }
}

/* ── Members Sidebar (members-c) ─────────────────────────────────────────── */
.members-c {
  position: fixed;
  right: 0;
  top: 48px;
  bottom: 0;
  width: var(--right-panel-width, 220px);
  background: #0d0d12;
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  display: flex;
  flex-direction: column;
  z-index: 30;
  transition: transform 280ms cubic-bezier(0.34, 1.56, 0.64, 1), width 280ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 200ms ease-out;
  will-change: transform, width;
  overflow: hidden;
}

.members-c.dragging {
  transition: none !important;
}

.members-c.collapsed {
  width: 0;
  border-left-color: transparent;
  pointer-events: none;
}

.panel .edge-handle,
.members-c .edge-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 6px;
  cursor: ew-resize;
  z-index: 10;
  background: transparent;
  transition: background-color 120ms ease-out, transform 80ms ease-out;
  border: none;
  padding: 0;
}

.panel .edge-handle {
  right: 0;
}

.members-c .edge-handle {
  left: 0;
}

.panel .edge-handle:hover,
.members-c .edge-handle:hover {
  background: rgba(255, 255, 255, 0.05);
}

.panel .edge-handle:active,
.members-c .edge-handle:active {
  transform: scaleX(1.1);
}

.panel .edge-handle.dragging-past-boundary,
.members-c .edge-handle.dragging-past-boundary {
  transform: scaleX(1.1);
  opacity: 0.7;
  background: rgba(239, 68, 68, 0.15) !important;
}

.members-c .members-header {
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  align-items: center;
  justify-content: space-between;
  shrink: 0;
  overflow: hidden;
}

.members-c.collapsed .members-header {
  padding: 0;
  justify-content: center;
  transition: padding 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.members-c .members-header .label {
  font-family: 'Space Grotesk', sans-serif;
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: #374151;
}

.members-c.collapsed .members-header .label {
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

.members-c .members-header .online-count {
  display: flex;
  align-items: center;
  gap: 6px;
}

.members-c.collapsed .members-header .online-count {
  opacity: 0;
  transform: translateX(-8px);
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

.members-c .members-header .online-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 8px #4ade8088;
}

.members-c .members-header .online-num {
  font-size: 10px;
  font-weight: 700;
  color: #4ade80;
  font-family: 'JetBrains Mono', monospace;
}

.members-c .members-header .toggle-btn {
  background: transparent;
  border: none;
  color: #4b5563;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: color 120ms ease-out, background-color 120ms ease-out, transform 80ms ease-out;
}

.members-c .members-header .toggle-btn:hover {
  color: #818cf8;
  background: rgba(255, 255, 255, 0.03);
}

.members-c .members-header .toggle-btn:active {
  transform: scale(0.95);
}

.members-c .members-header .toggle-btn svg {
  width: 14px;
  height: 14px;
  transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
}

.members-c.collapsed .members-header .toggle-btn svg {
  transform: rotate(180deg);
}

.members-c .members-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.06) transparent;
}

.members-c .scroll-inner {
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.members-c .group-label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 8px 6px;
  font-family: 'Space Grotesk', sans-serif;
  font-size: 9px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #374151;
  overflow: hidden;
}

.members-c.collapsed .group-label {
  opacity: 0;
  transform: translateY(-4px);
  pointer-events: none;
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

.members-c .group-label .gt {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.members-c .group-label .gc {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
}

.members-c .member {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: 6px;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease-out, transform 80ms ease-out;
}

.members-c .member:active {
  transform: scale(0.98);
}

.members-c.collapsed .member {
  justify-content: center;
  padding: 6px 0;
  transition: padding 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.members-c .member:hover {
  background: rgba(255, 255, 255, 0.03);
}

.members-c .member.me {
  background: rgba(99, 102, 241, 0.06);
}

.members-c .member.offline {
  opacity: 0.35;
}

.members-c .member .hover-bar {
  position: absolute;
  left: 0;
  top: 4px;
  bottom: 4px;
  width: 2px;
  border-radius: 0 2px 2px 0;
  background: linear-gradient(to bottom, var(--nx-accent-2-strong), var(--nx-cyan));
  opacity: 0;
  transition: opacity 180ms cubic-bezier(0.4, 0, 0.2, 1);
}

.members-c .member:hover .hover-bar {
  opacity: 1;
}

.members-c.collapsed .member .hover-bar {
  opacity: 0;
}

.members-c .member .avatar-wrap {
  position: relative;
  shrink: 0;
}

.members-c .member .avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 900;
  color: #fff;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  user-select: none;
}

.members-c .member .status-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #0d0d12;
  display: flex;
  align-items: center;
  justify-content: center;
}

.members-c .member .status-dot .d {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #4ade80;
  box-shadow: 0 0 4px #4ade8088;
}

.members-c .member .status-dot .d.offline {
  background: #374151;
  box-shadow: none;
}

.members-c .member .info {
  flex: 1;
  min-w: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.members-c.collapsed .member .info {
  opacity: 0;
  transform: translateX(-8px);
  pointer-events: none;
  transition: opacity 200ms ease-out, transform 200ms ease-out;
}

.members-c .member .name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-w: 0;
}

.members-c .member .name {
  font-size: 12px;
  font-weight: 600;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.members-c .member.me .name {
  color: var(--nx-accent-2-soft2);
}

.members-c .member .you-tag {
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(99, 102, 241, 0.25);
  color: var(--nx-accent-2-soft);
  line-height: 1;
  shrink: 0;
}

.members-c .member .status-text {
  font-size: 10px;
  color: #374151;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.members-c .member.me .status-text {
  color: #4b5563;
}


</style>
