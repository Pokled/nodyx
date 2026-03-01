<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import type { LayoutData } from './$types';
	import { page } from '$app/stores';
	import { initSocket, unreadCountStore, onlineMembersStore } from '$lib/socket';
	import { tryAutoConnect } from '$lib/socket';

	let { children, data }: { children: any; data: LayoutData } = $props();

	const user            = $derived(data.user);
	const unreadCount     = $derived($unreadCountStore);
	const onlineMembers   = $derived($onlineMembersStore);
	const communityName   = $derived(data.communityName ?? 'Nexus');
	const communityLogo   = $derived((data as any).communityLogoUrl  as string | null);
	const communityBanner = $derived((data as any).communityBannerUrl as string | null);
	const memberCount     = $derived((data as any).memberCount as number ?? 0);

	const isActive = (href: string) =>
		href === '/'
			? $page.url.pathname === '/' || $page.url.pathname.startsWith('/forum')
			: $page.url.pathname.startsWith(href)

	onMount(() => {
		if (data.user && data.token) {
			// SSR provided a valid session — use it directly
			initSocket(data.token, data.unreadCount ?? 0)
		} else {
			// No SSR session (guest page) — try reconnecting from stored token
			tryAutoConnect()
		}
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
	// Phase 3 : remplacer par données réelles du nexus-directory (SSO inter-instances)
	type GalaxyInstance = { name: string; subtitle: string; color: string; logoUrl?: string; unread: number; memberCount: number; vocalCount: number }
	type GalaxyCategory = { name: string; instances: GalaxyInstance[] }

	const GALAXY_CATEGORIES: GalaxyCategory[] = [
		{
			name: 'Tech',
			instances: [
				{ name: 'Gaming',    subtitle: 'gaming.nexus.io',  color: '#8b5cf6', unread: 3, memberCount: 128, vocalCount: 2 },
				{ name: 'Dev Nexus', subtitle: 'dev.nexus.io',     color: '#10b981', unread: 1, memberCount: 47,  vocalCount: 0 },
			],
		},
		{
			name: 'Amis',
			instances: [
				{ name: 'Minecraft', subtitle: 'mc.nexus.io',      color: '#f97316', unread: 0, memberCount: 8,   vocalCount: 1 },
				{ name: 'Manjaro',   subtitle: 'linux.nexus.io',   color: '#35bef8', unread: 2, memberCount: 23,  vocalCount: 0 },
			],
		},
	]

	let expandedKey       = $state<string | null>(null)
	let collapsedCats     = $state<Set<string>>(new Set())

	function toggleCat(name: string) {
		const next = new Set(collapsedCats)
		if (next.has(name)) next.delete(name)
		else next.add(name)
		collapsedCats = next
	}
	function toggleExpand(key: string) {
		expandedKey = expandedKey === key ? null : key
	}
</script>

<div class="min-h-screen bg-gray-950 text-gray-100 flex flex-col">

	<!-- ══ NAV ════════════════════════════════════════════════════════════════ -->
	<nav class="border-b border-gray-800 bg-gray-900 sticky top-0 z-50 shrink-0">
		<div class="px-4 flex items-center gap-1 h-14">
			<a href="/" class="text-lg font-bold text-white tracking-tight mr-4 shrink-0 max-w-[180px] truncate">
				{communityName}
			</a>
			<div class="flex items-center gap-1 flex-1">
				<a href="/" class="px-3 py-2 rounded text-sm transition-colors {isActive('/') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Forum</a>
				<a href="/communities" class="px-3 py-2 rounded text-sm transition-colors {isActive('/communities') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Annuaire</a>
				{#if user}
					<a href="/chat" class="px-3 py-2 rounded text-sm transition-colors {isActive('/chat') ? 'text-white bg-gray-800' : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}">Chat</a>
				{/if}
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

		<!-- ── Galaxy Bar (gauche, 220px) ─────────────────────────────────────── -->
		<aside class="hidden lg:flex fixed left-0 top-14 bottom-0 w-[220px] flex-col border-r border-gray-800 bg-gray-900 overflow-y-auto overflow-x-hidden z-30">

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

			<!-- Catégories + instances demo (Phase 3) -->
			<div class="flex-1 px-3 pb-3 space-y-1 overflow-y-auto overflow-x-hidden">
				{#each GALAXY_CATEGORIES as cat}
					<!-- Header catégorie -->
					<button
						onclick={() => toggleCat(cat.name)}
						class="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-widest font-semibold text-gray-500 hover:text-gray-400 transition-colors group"
					>
						<svg xmlns="http://www.w3.org/2000/svg" class="w-2.5 h-2.5 shrink-0 transition-transform {collapsedCats.has(cat.name) ? '-rotate-90' : ''}" fill="currentColor" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
						{cat.name}
					</button>

					{#if !collapsedCats.has(cat.name)}
						{#each cat.instances as inst}
							{@const key = `${cat.name}::${inst.name}`}
							<div>
								<button
									onclick={() => toggleExpand(key)}
									class="w-full group flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-800/60 transition-colors cursor-not-allowed opacity-60 hover:opacity-90"
									title="{inst.name} — Phase 3"
								>
									<!-- Logo / couleur -->
									<div class="w-8 h-8 shrink-0 flex items-center justify-center text-white font-bold text-sm" style="background-color: {inst.color}; border-radius: 28%">
										{inst.name.charAt(0).toUpperCase()}
									</div>
									<!-- Name + subtitle -->
									<div class="flex-1 min-w-0 text-left">
										<div class="text-sm text-gray-300 truncate group-hover:text-white transition-colors">{inst.name}</div>
										<div class="text-[11px] text-gray-600 truncate">{inst.subtitle}</div>
									</div>
									<!-- Badge unread -->
									{#if inst.unread > 0}
										<span class="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">{inst.unread}</span>
									{/if}
									<!-- Chevron -->
									<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-gray-600 shrink-0 opacity-0 group-hover:opacity-100 transition-all {expandedKey === key ? 'rotate-180 opacity-100' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
										<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
									</svg>
								</button>

								<!-- Expanded demo details -->
								{#if expandedKey === key}
									<div class="mt-0.5 mx-1 rounded-xl bg-gray-800/60 border border-gray-700/60 p-3 text-xs space-y-2">
										<div class="flex items-center gap-2 text-gray-400">
											<span class="text-base">👥</span>
											<span><strong class="text-gray-200">{inst.memberCount}</strong> membres</span>
										</div>
										{#if inst.vocalCount > 0}
											<div class="flex items-center gap-2 text-gray-400">
												<span class="text-base">🎙️</span>
												<span><strong class="text-gray-200">{inst.vocalCount}</strong> salon{inst.vocalCount > 1 ? 's' : ''} vocal actif</span>
											</div>
										{/if}
										<div class="mt-1 px-2 py-1.5 rounded-lg bg-indigo-900/30 border border-indigo-800/30 text-[10px] text-indigo-400 text-center">
											Disponible en Phase 3 — réseau P2P
										</div>
									</div>
								{/if}
							</div>
						{/each}
					{/if}
				{/each}
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
		<main class="flex-1 min-w-0 lg:pl-[220px] xl:pr-[220px] flex flex-col">
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

            <div class="w-full flex-1 flex flex-col {$page.url.pathname.startsWith('/chat') || $page.url.pathname.startsWith('/admin') ? '' : 'max-w-5xl mx-auto px-4 py-8'}">
                {@render children()}
            </div>
        </main>

		<!-- ── Members Bar (droite, 220px) ────────────────────────────────────── -->
		<aside class="hidden xl:flex fixed right-0 top-14 bottom-0 w-[220px] flex-col border-l border-gray-800 bg-gray-900/60 overflow-y-auto z-30">
			{#if user}
				<div class="px-3 pt-4 pb-2 shrink-0">
					<h2 class="text-[11px] uppercase tracking-widest text-gray-500 font-semibold flex items-center gap-1.5">
						<span class="w-1.5 h-1.5 rounded-full bg-green-400 inline-block"></span>
						En ligne — {onlineMembers.length}
					</h2>
				</div>
				<div class="flex flex-col gap-0.5 px-2 pb-4">
					{#each onlineMembers as member (member.userId)}
						<a href="/users/{member.username}" class="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-800/70 transition-colors group">
							<div class="relative shrink-0">
								{#if member.avatar}
									<img src={member.avatar} alt="Avatar" class="w-7 h-7 rounded-full object-cover" />
								{:else}
									<div class="w-7 h-7 rounded-full bg-indigo-700 flex items-center justify-center text-[11px] font-bold text-white select-none">{member.username.charAt(0).toUpperCase()}</div>
								{/if}
								<span class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-green-400 border-2 border-gray-900"></span>
							</div>
							<span class="text-sm text-gray-400 group-hover:text-white truncate transition-colors">{member.username}</span>
						</a>
					{/each}
					{#if onlineMembers.length === 0}
						<p class="px-2 py-3 text-xs text-gray-600 text-center">Aucun membre en ligne</p>
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
</div>
