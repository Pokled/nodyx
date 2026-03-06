<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import type { LayoutData } from './$types';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { initSocket, unreadCountStore, chatMentionStore, onlineMembersStore, getSocket } from '$lib/socket';
	import { tryAutoConnect } from '$lib/socket';
	import type { UserStatus } from '$lib/socket';
	import { resolveTheme, themeToVars } from '$lib/profileThemes';

	let { children, data }: { children: any; data: LayoutData } = $props();

	const user            = $derived(data.user);
	const unreadCount     = $derived($unreadCountStore);
	const chatMentions    = $derived($chatMentionStore);
	const onlineMembers   = $derived($onlineMembersStore);

	// Reset chat mention badge when user is on /chat
	$effect(() => {
		if ($page.url.pathname.startsWith('/chat') && $chatMentionStore > 0) {
			chatMentionStore.set(0)
		}
	})
	const communityName   = $derived(data.communityName ?? 'Nexus');
	const communityLogo   = $derived((data as any).communityLogoUrl  as string | null);
	const communityBanner = $derived((data as any).communityBannerUrl as string | null);
	const memberCount     = $derived((data as any).memberCount as number ?? 0);

	const isActive = (href: string) =>
		href === '/'
			? $page.url.pathname === '/' || $page.url.pathname.startsWith('/forum')
			: $page.url.pathname.startsWith(href)

	// App-wide theme — uses the logged-in user's theme, falls back to default
	const appVars = $derived(themeToVars(resolveTheme((data as any).appTheme)))

	// All community members (for offline section in presence sidebar)
	let allMembers = $state<{ user_id: string; username: string; avatar: string | null }[]>([])

	// Offline = members who are NOT currently in the online list
	const offlineMembers = $derived(
		allMembers.filter(m => !onlineMembers.some(o => o.userId === m.user_id))
	)
	let showOffline = $state(false)

	onMount(async () => {
		if (data.user && data.token) {
			// SSR provided a valid session — use it directly
			initSocket(data.token, data.unreadCount ?? 0)
		} else {
			// No SSR session (guest page) — try reconnecting from stored token
			tryAutoConnect()
		}

		// Fetch full member list for the offline sidebar section
		if (data.user) {
			try {
				const { PUBLIC_API_URL } = await import('$env/static/public')
				const res = await fetch(`${PUBLIC_API_URL}/api/v1/instance/members`)
				if (res.ok) allMembers = (await res.json()).members ?? []
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

	const MILESTONES = [0, 100, 250, 500, 1000, 2000, 4000, 8000, 15000]
	const xpInfo = $derived((() => {
		const pts = user?.points ?? 0
		let idx = 0
		for (let i = 0; i < MILESTONES.length - 1; i++) {
			if (pts >= MILESTONES[i]) idx = i
			else break
		}
		const from = MILESTONES[idx]
		const to   = MILESTONES[idx + 1] ?? null
		const pct  = to ? Math.min(100, Math.round((pts - from) / (to - from) * 100)) : 100
		return { pts, from, to, pct }
	})())

	function gradeTextColor(hex: string): string {
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
		return luminance > 0.5 ? '#111827' : '#ffffff'
	}

	// ── Galaxy Bar ─────────────────────────────────────────────────────────────
	// Phase 3 (SPEC 012) : réseau inter-instances P2P — données réelles à venir
	let expandedKey = $state<string | null>(null)
	function toggleExpand(key: string) {
		expandedKey = expandedKey === key ? null : key
	}

	// ── Custom status ─────────────────────────────────────────────────────────
	let showStatusModal = $state(false)
	let statusEmoji     = $state('')
	let statusText      = $state('')

	const PRESET_STATUSES = [
		{ emoji: '💼', text: 'Au travail' },
		{ emoji: '🎮', text: 'En train de jouer' },
		{ emoji: '🎵', text: 'En train d\'écouter' },
		{ emoji: '📚', text: 'En train de lire' },
		{ emoji: '🍕', text: 'En pause déj' },
		{ emoji: '🤔', text: 'Réfléchis' },
		{ emoji: '😴', text: 'Ne pas déranger' },
		{ emoji: '🏃', text: 'De retour plus tard' },
	]

	// Find logged-in user's current status from the store
	const myStatus = $derived(onlineMembers.find(m => m.userId === (user as any)?.id)?.status ?? null)

	function openStatusModal() {
		statusEmoji = myStatus?.emoji ?? ''
		statusText  = myStatus?.text ?? ''
		showStatusModal = true
	}

	function saveStatus() {
		const sock = getSocket()
		if (!sock) return
		const payload = (statusEmoji || statusText)
			? { emoji: statusEmoji.trim(), text: statusText.trim() }
			: null
		sock.emit('presence:set_status', payload)
		showStatusModal = false
	}

	function clearStatus() {
		const sock = getSocket()
		if (sock) sock.emit('presence:set_status', null)
		showStatusModal = false
	}
</script>

<svelte:head>
	{#if communityLogo}
		<link rel="icon" href={communityLogo} />
	{/if}
</svelte:head>

<div class="min-h-screen flex flex-col" style="{appVars}; background: var(--p-bg); color: var(--p-text)">

	<!-- ══ NAV ════════════════════════════════════════════════════════════════ -->
	<nav class="border-b border-gray-800 sticky top-0 z-50 shrink-0"
	     style="background: var(--p-card-bg); border-color: var(--p-card-border)">
		<div class="px-4 flex items-center gap-1 h-14">
			<!-- Hamburger Galaxy Bar — mobile only -->
			<button
				class="lg:hidden mr-1 p-2 rounded min-w-[44px] min-h-[44px] flex items-center justify-center transition-colors
				       {gallerySidebarOpen ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}"
				onclick={() => gallerySidebarOpen = !gallerySidebarOpen}
				aria-label="Menu communauté"
				aria-expanded={gallerySidebarOpen}
				aria-controls="galaxy-sidebar">
				{#if gallerySidebarOpen}
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
					</svg>
				{:else}
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
					</svg>
				{/if}
			</button>
			<a href="/" class="text-lg font-bold text-white tracking-tight mr-4 shrink-0 max-w-[180px] truncate">
				{communityName}
			</a>
			<div class="hidden lg:flex items-center gap-1 flex-1">
				<a href="/" class="px-3 py-2 rounded text-sm transition-colors {isActive('/') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Forum</a>
				<a href="/communities" class="px-3 py-2 rounded text-sm transition-colors {isActive('/communities') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Annuaire</a>
				{#if user}
					<a href="/chat" class="relative px-3 py-2 rounded text-sm transition-colors {isActive('/chat') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">
						Chat
						{#if chatMentions > 0}
							<span class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full bg-red-500 text-white text-[9px] font-bold px-1 flex items-center justify-center">{chatMentions > 9 ? '9+' : chatMentions}</span>
						{/if}
					</a>
				{/if}
				<a href="/library" class="px-3 py-2 rounded text-sm transition-colors {isActive('/library') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Bibliothèque</a>
				<a href="/garden" class="px-3 py-2 rounded text-sm transition-colors {isActive('/garden') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Jardin</a>
				<a href="/polls" class="px-3 py-2 rounded text-sm transition-colors {isActive('/polls') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Sondages</a>
			</div>
			<div class="flex items-center gap-1 shrink-0">
				<a href="/search" class="p-2 rounded text-gray-400 hover:text-white hover:bg-gray-800/60 transition-colors" title="Rechercher">
					<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
				</a>
				{#if user}
					<a href="/notifications" class="relative p-2 rounded transition-colors {isActive('/notifications') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}" title="Notifications">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
						{#if unreadCount > 0}
							<span class="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none">{unreadCount > 9 ? '9+' : unreadCount}</span>
						{/if}
					</a>
					{#if user.role === 'owner' || user.role === 'admin'}
						<a href="/admin" class="hidden sm:inline px-3 py-1.5 rounded text-sm font-medium {isActive('/admin') ? 'bg-indigo-700 text-white' : 'text-indigo-400 hover:text-white hover:bg-indigo-700/60'} transition-colors">Admin</a>
					{/if}
					<!-- User dropdown -->
					<div class="relative">
						<button onclick={() => dropdownOpen = !dropdownOpen} class="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-800/60 transition-colors group" aria-haspopup="true" aria-expanded={dropdownOpen}>
							<div class="relative">
								{#if user.avatar}
									<img src={user.avatar} alt="Avatar" class="w-7 h-7 rounded-full object-cover border border-gray-700" />
								{:else}
									<div class="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center text-xs font-bold text-white select-none">{user.username.charAt(0).toUpperCase()}</div>
								{/if}
								<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-gray-900"></span>
							</div>
							<span class="hidden sm:inline text-sm text-gray-300 group-hover:text-white transition-colors max-w-[120px] truncate">{user.username}</span>
							<svg xmlns="http://www.w3.org/2000/svg" class="hidden sm:block w-3 h-3 text-gray-500 transition-transform {dropdownOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
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
												<span class="text-xs text-gray-500">Membre</span>
											{/if}
										</div>
									</div>
									<div class="mt-3">
										<div class="flex justify-between items-center mb-1">
											<span class="text-[11px] text-gray-400">{#if xpInfo.to}{xpInfo.pts.toLocaleString('fr-FR')} / {xpInfo.to.toLocaleString('fr-FR')} pts{:else}{xpInfo.pts.toLocaleString('fr-FR')} pts · Max{/if}</span>
											<span class="text-[11px] text-indigo-400 font-medium">{xpInfo.pct}%</span>
										</div>
										<div class="h-1.5 rounded-full bg-gray-700 overflow-hidden">
											<div class="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all" style="width: {xpInfo.pct}%"></div>
										</div>
										{#if xpInfo.to}<div class="text-[10px] text-gray-600 mt-1">Encore {(xpInfo.to - xpInfo.pts).toLocaleString('fr-FR')} pts pour le prochain palier</div>{/if}
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
											<span class="text-xs text-gray-600">Définir un statut…</span>
										{/if}
									</span>
									<svg class="w-3.5 h-3.5 text-gray-600 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
								</button>

								<div class="py-1.5">
									<a href="/users/{user.username}" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors"><span class="text-base">👤</span><span>Mon profil</span></a>
									<a href="/users/me/edit" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors"><span class="text-base">✏️</span><span>Modifier mon profil</span></a>
									<a href="/notifications" onclick={() => dropdownOpen = false} class="flex items-center gap-3 px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800/60 transition-colors">
										<span class="text-base">🔔</span><span class="flex-1">Notifications</span>
										{#if unreadCount > 0}<span class="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>{/if}
									</a>
								</div>
								<div class="border-t border-gray-700/60 mx-3"></div>
								<div class="py-1.5">
									{#each [{ icon: '📊', label: 'Mon activité' }, { icon: '👫', label: 'Amis' }, { icon: '✉️', label: 'Messages privés' }, { icon: '🏆', label: 'Mes badges' }, { icon: '⚙️', label: 'Préférences' }] as item}
										<div class="flex items-center gap-3 px-4 py-2 text-sm text-gray-600 cursor-not-allowed select-none">
											<span class="text-base opacity-50">{item.icon}</span><span class="flex-1">{item.label}</span><span class="text-[10px] uppercase tracking-wider text-gray-700 font-medium">bientôt</span>
										</div>
									{/each}
								</div>
								<div class="border-t border-gray-700/60 mx-3"></div>
								<div class="py-1.5">
									<form method="POST" action="/auth/logout">
										<button type="submit" class="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-400 hover:text-red-400 hover:bg-gray-800/60 transition-colors text-left">
											<span class="text-base">🚪</span><span>Déconnexion</span>
										</button>
									</form>
								</div>
							</div>
						{/if}
					</div>
				{:else}
					<a href="/auth/login" class="px-3 py-1.5 rounded text-sm text-gray-400 hover:text-white hover:bg-gray-800/60 transition-colors">Connexion</a>
					<a href="/auth/register" class="px-3 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors">Inscription</a>
				{/if}
			</div>
		</div>
	</nav>

	<!-- ══ BODY ═══════════════════════════════════════════════════════════════ -->
	<div class="flex flex-1">

		<!-- ── Backdrop Galaxy Bar — mobile ───────────────────────────────────── -->
		{#if gallerySidebarOpen}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="lg:hidden fixed inset-0 bg-black/60 z-[54] backdrop-blur-sm"
		     role="button" tabindex="-1" aria-label="Fermer le menu"
		     onclick={() => gallerySidebarOpen = false}
		     onkeydown={e => e.key === 'Escape' && (gallerySidebarOpen = false)}
		     transition:fade={{ duration: 200 }}></div>
		{/if}

		<!-- ── Galaxy Bar (gauche, 220px) ─────────────────────────────────────── -->
		<aside
			id="galaxy-sidebar"
			class="flex flex-col fixed left-0 top-14 bottom-0 w-[280px] lg:w-[220px]
			       border-r border-gray-800 overflow-y-auto overflow-x-hidden
			       z-[55] lg:z-30
			       transition-transform duration-300 ease-in-out
			       {gallerySidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}"
			style="background: var(--p-card-bg); border-color: var(--p-card-border)"
			role={gallerySidebarOpen ? 'dialog' : undefined}
			aria-modal={gallerySidebarOpen ? 'true' : undefined}
			aria-label="Menu communauté">

			<!-- Instance active (cette instance) -->
			<div class="px-3 pt-4 pb-3 shrink-0">
				<button
					onclick={() => toggleExpand('__current__')}
					class="w-full group flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-gray-800/70 transition-colors relative border-l-2 border-indigo-500 pl-3"
				>
					<!-- Logo -->
					<div class="w-9 h-9 shrink-0 overflow-hidden flex items-center justify-center" style="border-radius: 28%">
						{#if communityLogo}
							<img src={communityLogo} alt="Logo" class="w-full h-full object-cover" />
						{:else}
							<div class="w-full h-full bg-indigo-600 flex items-center justify-center text-white font-bold text-base" style="border-radius: 28%">
								{communityName.charAt(0).toUpperCase()}
							</div>
						{/if}
					</div>
					<!-- Name + subtitle -->
					<div class="flex-1 min-w-0 text-left">
						<div class="text-sm font-semibold text-white truncate">{communityName}</div>
						<div class="text-[11px] text-indigo-400 truncate flex items-center gap-1">
							<span class="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0"></span>
							{onlineMembers.length} en ligne · {memberCount} membres
						</div>
					</div>
					<!-- Chevron -->
					<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 text-gray-500 shrink-0 transition-transform {expandedKey === '__current__' ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
					</svg>
				</button>

				<!-- Expanded details — instance active -->
				{#if expandedKey === '__current__'}
					<div class="mt-1 mx-1 rounded-xl bg-gray-800/60 border border-gray-700/60 p-3 text-xs space-y-2">
						<div class="flex items-center gap-2 text-gray-300">
							<span class="text-base">👥</span>
							<span><strong class="text-white">{memberCount}</strong> membres</span>
						</div>
						<div class="flex items-center gap-2 text-gray-300">
							<span class="w-2 h-2 rounded-full bg-green-400 ml-1 shrink-0"></span>
							<span><strong class="text-white">{onlineMembers.length}</strong> en ligne maintenant</span>
						</div>
						<div class="flex items-center gap-2 text-gray-300">
							<span class="text-base">💬</span>
							<span>Chat actif</span>
						</div>
						<a href="/chat" class="mt-1 flex items-center justify-center gap-1.5 w-full py-1.5 rounded-lg bg-indigo-700/60 hover:bg-indigo-600/80 text-indigo-200 hover:text-white transition-colors text-[11px] font-medium">
							Rejoindre le chat →
						</a>
					</div>
				{/if}
			</div>

			<!-- Séparateur -->
			<div class="mx-4 border-t border-gray-800 mb-2 shrink-0"></div>

			<!-- Galaxy Network — Phase 3 (SPEC 012) -->
			<div class="flex-1 px-3 pb-3 overflow-y-auto overflow-x-hidden flex flex-col items-center justify-center gap-2 text-center">
				<div class="w-10 h-10 rounded-2xl bg-indigo-950/60 border border-indigo-800/40 flex items-center justify-center">
					<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
					</svg>
				</div>
				<p class="text-[11px] text-gray-600 leading-relaxed px-2">Réseau inter-communautés<br>bientôt disponible</p>
			</div>

			<!-- Bouton ajouter / découvrir -->
			<div class="px-3 pt-3.5 pb-3 shrink-0 border-t border-gray-800">
				<a href="/communities" class="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-dashed border-gray-700 hover:border-indigo-500/60 hover:bg-indigo-950/30 text-gray-500 hover:text-indigo-300 transition-all group">
					<div class="w-6 h-6 rounded-full border border-dashed border-current flex items-center justify-center shrink-0">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
					</div>
					<span class="text-xs font-medium">Découvrir des communautés</span>
				</a>
			</div>
		</aside>

		<!-- ── Contenu principal ───────────────────────────────────────────────── -->
		<main class="flex-1 min-w-0 lg:pl-[220px] xl:pr-[220px] flex flex-col" style="padding-bottom: var(--bottom-nav-h)">
            {#if communityBanner && ($page.url.pathname === '/' || $page.url.pathname.startsWith('/forum'))}
                <div class="relative w-full h-32 overflow-hidden">
                    <img src={communityBanner} alt="Bannière" class="w-full h-full object-cover" />
                    <div class="absolute inset-0 bg-gradient-to-b from-transparent via-gray-950/40 to-gray-950"></div>
                    <div class="absolute bottom-4 left-6">
                        <h1 class="text-xl font-bold text-white drop-shadow">{communityName}</h1>
                        {#if onlineMembers.length > 0}
                            <p class="text-xs text-green-300 flex items-center gap-1.5 mt-0.5">
                                <span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                                {onlineMembers.length} membre{onlineMembers.length > 1 ? 's' : ''} en ligne
                            </p>
                        {/if}
                    </div>
                </div>
            {/if}

            <div class="w-full flex-1 flex flex-col {$page.url.pathname.startsWith('/chat') || $page.url.pathname.startsWith('/admin') || $page.url.pathname.startsWith('/users/') ? '' : $page.url.pathname === '/' || $page.url.pathname.startsWith('/forum') ? 'px-4 sm:px-6 py-8' : 'max-w-5xl mx-auto px-4 py-8'}">
                {@render children()}
            </div>
        </main>

		<!-- ── Members Bar (droite, 220px) ────────────────────────────────────── -->
		<aside class="hidden xl:flex fixed right-0 top-14 bottom-0 w-[220px] flex-col border-l border-gray-800 overflow-y-auto z-30"
		       style="background: var(--p-card-bg); border-color: var(--p-card-border)">
			{#if user}
				<div class="px-3 pt-4 pb-2 shrink-0">
					<h2 class="text-[11px] uppercase tracking-widest text-gray-500 font-semibold flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
						En ligne — {onlineMembers.length}
					</h2>
				</div>
				<div class="flex flex-col gap-0.5 px-2 pb-4">
					{#each onlineMembers as member (member.userId)}
						{@const isMe = member.userId === (user as any)?.id}
						{#if isMe}
							<!-- Own entry — clickable to set status -->
							<button onclick={openStatusModal} class="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-800/70 transition-colors group text-left">
								<div class="relative shrink-0">
									{#if member.avatar}
										<img src={member.avatar} alt="Avatar" class="w-7 h-7 rounded-full object-cover" />
									{:else}
										<div class="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center text-[11px] font-bold text-white select-none">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
									<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-gray-900"></span>
								</div>
								<div class="min-w-0 flex-1">
									<div class="text-sm text-indigo-300 group-hover:text-white truncate transition-colors font-medium leading-tight">{member.username}</div>
									{#if member.status?.text || member.status?.emoji}
										<div class="text-[10px] text-gray-500 truncate leading-tight">{member.status.emoji} {member.status.text}</div>
									{:else}
										<div class="text-[10px] text-gray-700 truncate leading-tight group-hover:text-gray-500 transition-colors">Définir un statut…</div>
									{/if}
								</div>
							</button>
						{:else}
							<a href="/users/{member.username}" class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-800/70 transition-colors group">
								<div class="relative shrink-0">
									{#if member.avatar}
										<img src={member.avatar} alt="Avatar" class="w-7 h-7 rounded-full object-cover" />
									{:else}
										<div class="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center text-[11px] font-bold text-white select-none">{member.username.charAt(0).toUpperCase()}</div>
									{/if}
									<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-gray-900"></span>
								</div>
								<div class="min-w-0 flex-1">
									<div class="text-sm text-gray-400 group-hover:text-white truncate transition-colors leading-tight">{member.username}</div>
									{#if member.status?.text || member.status?.emoji}
										<div class="text-[10px] text-gray-500 truncate leading-tight">{member.status.emoji} {member.status.text}</div>
									{/if}
								</div>
							</a>
						{/if}
					{/each}
					{#if onlineMembers.length === 0}
						<p class="px-2 py-3 text-xs text-gray-600 text-center">Aucun membre en ligne</p>
					{/if}

					<!-- Offline section -->
					{#if offlineMembers.length > 0}
						<div class="px-1 pt-3 pb-1">
							<button
								onclick={() => showOffline = !showOffline}
								class="w-full flex items-center gap-1.5 px-1 py-0.5 text-[11px] uppercase tracking-widest text-gray-600 hover:text-gray-400 transition-colors font-semibold"
							>
								<span class="w-1.5 h-1.5 rounded-full bg-gray-700 inline-block shrink-0"></span>
								<span class="flex-1 text-left">Hors ligne — {offlineMembers.length}</span>
								<svg class="w-3 h-3 transition-transform {showOffline ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
							</button>
						</div>
						{#if showOffline}
							<div class="flex flex-col gap-0.5 px-2 pb-2">
								{#each offlineMembers as member (member.user_id)}
									<a href="/users/{member.username}" class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-800/50 transition-colors group opacity-50 hover:opacity-80">
										<div class="relative shrink-0">
											{#if member.avatar}
												<img src={member.avatar} alt="Avatar" class="w-6 h-6 rounded-full object-cover grayscale" />
											{:else}
												<div class="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-[10px] font-bold text-gray-500 select-none">{member.username.charAt(0).toUpperCase()}</div>
											{/if}
											<span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-gray-700 border-2 border-gray-900"></span>
										</div>
										<span class="text-xs text-gray-600 group-hover:text-gray-400 truncate transition-colors">{member.username}</span>
									</a>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{:else}
				<div class="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
					<div class="w-10 h-10 rounded-full bg-gray-800 flex items-center justify-center text-gray-600">
						<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
					</div>
					<p class="text-xs text-gray-600 leading-relaxed"><a href="/auth/login" class="text-indigo-400 hover:text-indigo-300">Connecte-toi</a> pour voir qui est en ligne</p>
				</div>
			{/if}
		</aside>

	</div>

	<!-- ══ BOTTOM NAV mobile (lg:hidden) ═══════════════════════════════════ -->
	<nav class="lg:hidden fixed bottom-0 left-0 right-0 z-45 border-t border-gray-800 flex items-stretch"
	     style="background: var(--p-card-bg); border-color: var(--p-card-border); padding-bottom: env(safe-area-inset-bottom, 0px)">

		<!-- Forum -->
		<a href="/" class="flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-0.5 {isActive('/') ? 'text-indigo-400' : 'text-gray-500'}">
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
			<span class="text-[10px] font-medium">Connexion</span>
		</a>
		{/if}
	</nav>
</div>

<!-- ── Status modal ──────────────────────────────────────────────────────── -->
{#if showStatusModal}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm"
		role="presentation"
		onclick={(e) => { if (e.target === e.currentTarget) showStatusModal = false }}>
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
