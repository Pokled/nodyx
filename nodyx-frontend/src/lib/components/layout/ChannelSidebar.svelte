<script lang="ts">
	import { page } from '$app/state';
	import { tick } from 'svelte';
	import { overlayScroll } from '$lib/actions/overlayScroll';
	import { editZone } from '$lib/actions/editZone';
	import { t } from '$lib/i18n';
	import { activeCommunityNameStore } from '$lib/communityStore';
	import { voiceStore, voiceChannelMembersStore } from '$lib/voice';
	import { unreadCountsStore } from '$lib/unreadStore';
	import { isDarkTheme, contrastSafeColor } from '$lib/theme';
	import ChannelIcon from '$lib/components/ChannelIcon.svelte';
	import VoiceEqualizer from '$lib/components/VoiceEqualizer.svelte';
	import VoicePanel from '$lib/components/VoicePanel.svelte';

	const tFn = $derived($t);
	const activeCommunityName = $derived($activeCommunityNameStore);
	const isActive = (href: string) =>
		href === '/'
			? page.url.pathname === '/'
			: page.url.pathname.startsWith(href);
	const activeChatChannelId = $derived(page.url.searchParams.get('channel') ?? null);

	// ── Pastille de sélection à ressort (contenant flottant, 28/09) ──────────
	// Un seul fond « actif » qui GLISSE d'un lien à l'autre au lieu de
	// s'éteindre ici pour se rallumer là : on voit d'où on vient et où on va.
	// Le salon de chat actif prime sur le lien « Chat » générique. Repositionnée
	// à chaque navigation et quand la liste change de taille (salon vocal qui
	// se déplie au-dessus, par exemple).
	let scrollEl = $state<HTMLDivElement>();
	let pill = $state({ y: 0, h: 0, on: false, ready: false });
	function placePill() {
		if (!scrollEl) return;
		const el = scrollEl.querySelector<HTMLElement>('.channel.active') ?? scrollEl.querySelector<HTMLElement>('.nav-link.active');
		if (!el) { pill.on = false; return; }
		movePillTo(el);
	}
	function movePillTo(el: HTMLElement) {
		if (!scrollEl) return;
		const y = el.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop;
		pill = { y, h: el.offsetHeight, on: true, ready: pill.ready };
		// Première pose sans animation (sinon la pastille glisse depuis le haut
		// à chaque chargement de page) : la transition s'arme juste après.
		if (!pill.ready) requestAnimationFrame(() => { pill.ready = true; });
	}
	$effect(() => {
		void page.url.href;
		void activeChatChannelId;
		tick().then(placePill);
	});
	// La pastille part dès l'APPUI, pas quand la page suivante a fini de
	// charger ses données (mesuré : ~120 ms d'immobilité sinon). Règle de
	// Rauno reprise dans le CDC : une action réversible réagit au début du
	// geste. La navigation terminée, placePill() confirme la même cible.
	$effect(() => {
		const root = scrollEl;
		if (!root) return;
		const onDown = (e: PointerEvent) => {
			if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
			const el = (e.target as HTMLElement).closest<HTMLElement>('a.nav-link, a.channel');
			if (el && root.contains(el)) movePillTo(el);
		};
		root.addEventListener('pointerdown', onDown);
		return () => root.removeEventListener('pointerdown', onDown);
	});
	$effect(() => {
		if (!scrollEl) return;
		const ro = new ResizeObserver(() => placePill());
		for (const child of Array.from(scrollEl.children)) ro.observe(child);
		return () => ro.disconnect();
	});
	const voiceState = $derived($voiceStore);
	const vcMembers = $derived($voiceChannelMembersStore);
	const darkBg = $derived($isDarkTheme);

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
	function chNameStyle(ch: LayoutChannel, override: string | null = null): string {
		const parts: string[] = []
		// Un canal peut avoir une couleur perso choisie pour LE thème actif au
		// moment du choix (ex: blanc, pensé pour un fond sombre) — sans garde-fou,
		// basculer en clair rendrait ce canal illisible. Fallback '' : pas de
		// `color:` du tout, la classe CSS reprend la main avec sa couleur par
		// défaut (déjà adaptée au thème via les tokens --nx-*).
		const rawColor = ch.name_color ?? override
		const color = rawColor ? contrastSafeColor(rawColor, '', darkBg) : null
		if (color)             parts.push(`color: ${color}`)
		if (ch.name_bold)      parts.push('font-weight: 700')
		if (ch.name_italic)    parts.push('font-style: italic')
		if (ch.name_underline) parts.push('text-decoration: underline')
		return parts.join(';')
	}

	interface UserLite {
		id?: string; username: string; avatar?: string | null; role?: string;
	}

	let {
		isBanned,
		showChannelSidebar,
		gallerySidebarOpen = $bindable(),
		panelCollapsed = $bindable(),
		leftPanelWidth = $bindable(),
		isDraggingLeft = $bindable(),
		communityName,
		user,
		mods,
		activeCommunityUrl,
		layoutTextChannels,
		layoutVoiceChannels,
		screenSharingUserIds,
		onShowScreenPreview,
		onHideScreenPreview,
		onOpenStatusModal,
	}: {
		isBanned: boolean;
		showChannelSidebar: boolean;
		gallerySidebarOpen: boolean;
		panelCollapsed: boolean;
		leftPanelWidth: number;
		isDraggingLeft: boolean;
		communityName: string;
		user: UserLite | null;
		mods: Record<string, boolean>;
		activeCommunityUrl: string;
		layoutTextChannels: LayoutChannel[];
		layoutVoiceChannels: LayoutChannel[];
		screenSharingUserIds: Set<string>;
		onShowScreenPreview: (e: MouseEvent, userId: string | null, username: string, avatar: string | null, side: 'left' | 'right') => void;
		onHideScreenPreview: () => void;
		onOpenStatusModal: () => void;
	} = $props();

	const displayCommunityName = $derived(activeCommunityName ?? communityName);

	// ── Redimensionnement du panneau ────────────────────────────────────────
	// Sous-système autonome : rien ici n'échappe au composant sauf
	// `leftPanelWidth`/`isDraggingLeft` (partagés avec le parent pour la nav
	// et le contenu principal) et `panelCollapsed` (partagé avec le rail et
	// la nav). Copié tel quel depuis +layout.svelte (comportement inchangé).
	let draggingPastBoundaryLeft = $state(false);
	let dragStartWidthLeft = 0;
	let leftDragMoved = false;

	function toggleL() {
		panelCollapsed = !panelCollapsed;
	}

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
</script>

{#if !isBanned && showChannelSidebar}
<div class="nodyx-sb">
<aside use:editZone={{ zone: 'ambiance', label: tFn('edit.zone_ambiance') }} class="panel nx-plate {panelCollapsed ? 'collapsed' : ''} {gallerySidebarOpen ? '' : 'max-lg:!translate-x-[-100%]'}"
       id="variant-a-panel"
       role={gallerySidebarOpen ? 'dialog' : undefined}
       aria-modal={gallerySidebarOpen ? 'true' : undefined}
       aria-label={tFn('nav.community_menu')}
       style="width: var(--left-panel-width, 220px);"
       data-nx-zone="sidebar"
       class:dragging={isDraggingLeft}>
	<div class="nx-zone-img" aria-hidden="true"></div>

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
	        aria-label={tFn('nav.panel_toggle_aria')}
	        title={tFn('nav.panel_toggle_aria')}></button>

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
	<div class="panel-scroll" bind:this={scrollEl} use:overlayScroll={{ inset: 8 }}>
		<div class="sel-pill" class:on={pill.on} class:ready={pill.ready} aria-hidden="true"
		     style="transform: translateY({pill.y}px); height: {pill.h}px;"></div>

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
				{ href: '/musique',  label: tFn('nav.music'),   icon: 'M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z',                                                                                                                                                              show: true },
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
						     onmouseenter={mSharing ? (e: MouseEvent) => onShowScreenPreview(e, m.userId, m.username, m.avatar, 'right') : undefined}
						     onmouseleave={onHideScreenPreview}>
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
		<button type="button" class="user-group" onclick={onOpenStatusModal}>
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

<style>
	/* 28/09 : plaque flottante en verre (.nx-plate, app.css) posée à côté du
	   rail. Repliée, elle repasse DERRIÈRE le rail en s'effaçant, au lieu de
	   laisser dépasser une bande entre les deux. */
	.nodyx-sb .panel {
	  position: fixed; top: var(--shell-gap); bottom: var(--shell-gap);
	  left: calc(var(--shell-gap) * 2 + var(--shell-rail-w));
	  width: var(--left-panel-width, 220px);
	  z-index: 39; display: flex; flex-direction: column;
	  font-family: var(--font-shell);
	  transform: translateX(0);
	  transition: transform .42s var(--ease-out-soft), width .42s var(--ease-out-soft), opacity .3s var(--ease-out-soft);
	}
	.nodyx-sb .panel.collapsed {
	  transform: translateX(calc(-100% - var(--shell-gap) * 2 - var(--shell-rail-w)));
	  opacity: 0;
	}
	.nodyx-sb .panel.dragging {
	  transition: none !important;
	}
	.nodyx-sb .panel .panel-head {
	  padding: 16px 16px 10px 18px; display: flex; align-items: center; gap: 8px;
	  font-weight: 600; font-size: 13px; color: var(--nx-text);
	}
	/* Le nom de la communauté en « grand titre » façon iOS : arrondi, plein,
	   une seule couleur, jamais de dégradé. */
	.nodyx-sb .panel .panel-head .community-name {
	  font-family: var(--font-shell-rounded); font-size: 17px; font-weight: 700; line-height: 1.2;
	  letter-spacing: -.02em; flex: 1; overflow: hidden;
	  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2;
	}
	.nodyx-sb .panel .panel-head .close {
	  margin-left: auto; cursor: pointer; color: var(--nx-text-faint); padding: 3px 7px; border-radius: 6px;
	  font-size: 16px; transition: all .12s; line-height: 1; background: none; border: none;
	}
	.nodyx-sb .panel .panel-head .close:hover { background: var(--nx-surface-raised); color: var(--nx-text); }
	.nodyx-sb .panel .panel-head .head-icon {
	  shrink: 0; color: var(--nx-text-faint); cursor: pointer; padding: 4px; border-radius: 6px;
	  transition: all .12s; display: flex; align-items: center; justify-content: center;
	  text-decoration: none;
	}
	.nodyx-sb .panel .panel-head .head-icon:hover { background: var(--nx-surface-raised); color: var(--nx-header-accent); }

	.nodyx-sb .panel .panel-scroll {
	  position: relative;
	  flex: 1; overflow-y: auto; padding: 4px 10px 12px;
	  scrollbar-width: thin; scrollbar-color: var(--nx-border) transparent;
	}
	.nodyx-sb .panel .panel-scroll::-webkit-scrollbar { width: 4px; }
	.nodyx-sb .panel .panel-scroll::-webkit-scrollbar-thumb { background: var(--nx-border); border-radius: 2px; }
	.nodyx-sb .panel .panel-scroll::-webkit-scrollbar-track { background: transparent; }
	/* Des groupes qui respirent, plus de filets entre eux (CDC : de l'air
	   entre les sections, pas entre chaque ligne). */
	.nodyx-sb .panel .panel-scroll .nav-section {
	  padding: 4px 0; display: flex; flex-direction: column; gap: 1px;
	  margin-bottom: 10px;
	}

	/* La pastille : un seul fond actif pour tout le panneau, qui glisse. Le
	   ressort (--ease-spring) dépasse à peine sa cible puis s'y pose. */
	.nodyx-sb .panel .sel-pill {
	  position: absolute; top: 0; left: 10px; right: 10px; z-index: 0;
	  border-radius: 10px; pointer-events: none;
	  background: var(--nx-header-accent-soft);
	  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nx-header-accent) 22%, transparent);
	  opacity: 0;
	}
	@supports (corner-shape: squircle) {
	  .nodyx-sb .panel .sel-pill { corner-shape: squircle; border-radius: 16px; }
	}
	.nodyx-sb .panel .sel-pill.on { opacity: 1; }
	.nodyx-sb .panel .sel-pill.ready {
	  transition: transform .5s var(--ease-spring), height .35s var(--ease-out-soft), opacity .2s;
	}
	@media (prefers-reduced-motion: reduce) {
	  .nodyx-sb .panel .sel-pill.ready { transition: opacity .2s; }
	}
	.nodyx-sb .panel .panel-scroll .nav-link {
	  position: relative; z-index: 1;
	  border-radius: 10px; padding: 7px 10px;
	  font-size: 13px; font-weight: 500; color: var(--nx-text-muted); gap: 10px; display: flex; align-items: center; cursor: pointer;
	  transition: background-color .12s, color .12s; text-decoration: none;
	}
	.nodyx-sb .panel .panel-scroll .nav-link:hover { background: color-mix(in srgb, var(--nx-text) 6%, transparent); color: var(--nx-text); }
	.nodyx-sb .panel .panel-scroll .nav-link.active { background: transparent; color: var(--nx-header-accent); }

	.nodyx-sb .panel .panel-scroll .nav-link .badge { margin-left: auto; background: #ef4444; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 5px; border-radius: 8px; }
	.nodyx-sb .panel .panel-scroll .channel-group-label {
	  font-size: 10px; padding: 12px 10px 4px;
	  letter-spacing: .08em; font-weight: 600; color: var(--nx-text-faint); text-transform: uppercase;
	}
	.nodyx-sb .panel .panel-scroll .channel {
	  position: relative; z-index: 1;
	  border-radius: 10px; padding: 6px 8px;
	  font-size: 13px; font-weight: 500; color: var(--nx-text-muted); gap: 6px; display: flex; align-items: center; cursor: pointer;
	  transition: background-color .12s, color .12s; text-decoration: none;
	}
	.nodyx-sb .panel .panel-scroll .channel:hover { background: color-mix(in srgb, var(--nx-text) 6%, transparent); color: var(--nx-text); }
	.nodyx-sb .panel .panel-scroll .channel.active { background: transparent; color: var(--nx-header-accent); }
	/* Carte « moi » en bas : une tuile en relief DANS la plaque, comme la
	   carte de compte en tête des Réglages iOS. */
	.nodyx-sb .panel .panel-bottom {
	  margin: 0 8px 8px; padding: 10px 12px; border-radius: 14px;
	  background: color-mix(in srgb, var(--nx-surface-raised) 70%, transparent);
	  box-shadow: inset 0 1px 0 0 var(--nx-glass-rim), 0 0 0 1px var(--nx-glass-edge);
	  display: flex; align-items: center; gap: 8px;
	}
	@media (max-width: 1023px) {
	  .nodyx-sb .panel .panel-bottom { margin: 0; border-radius: 0; box-shadow: none; border-top: 1px solid var(--nx-border-soft); background: var(--nx-surface); }
	}
	.nodyx-sb .panel .panel-bottom .user-group {
	  display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;
	  cursor: pointer; padding: 4px 6px; margin: -4px -6px; border-radius: 8px;
	  transition: background .12s; background: none; border: none; text-align: left;
	}
	.nodyx-sb .panel .panel-bottom .user-group:hover { background: var(--nx-surface-raised); }
	.nodyx-sb .panel .panel-bottom .user-avatar {
	  width: 32px; height: 32px; border-radius: 9px; shrink: 0;
	  display: flex; align-items: center; justify-content: center;
	  font-weight: 600; font-size: 13px; color: var(--nx-on-accent);
	  background: linear-gradient(135deg, var(--nx-header-accent), var(--nx-header-accent-strong));
	  position: relative; overflow: hidden;
	}
	.nodyx-sb .panel .panel-bottom .user-avatar .status {
	  position: absolute; bottom: -2px; right: -2px; width: 10px; height: 10px;
	  border-radius: 50%; background: #22c55e; border: 2px solid var(--nx-surface);
	}
	.nodyx-sb .panel .panel-bottom .user-name {
	  font-weight: 600; font-size: 13px;
	  color: var(--nx-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.nodyx-sb .panel .panel-bottom .user-role {
	  font-size: 10px; font-weight: 600;
	  color: var(--nx-header-accent); text-transform: uppercase; letter-spacing: .06em;
	}
	.nodyx-sb .panel .panel-bottom .quick-icon {
	  shrink: 0; color: var(--nx-text-faint); cursor: pointer; padding: 6px; border-radius: 7px;
	  transition: all .12s; display: flex; align-items: center; justify-content: center;
	}
	.nodyx-sb .panel .panel-bottom .quick-icon:hover { background: var(--nx-surface-raised); color: var(--nx-header-accent); }

	/* Poignée de redimensionnement — copiée de +layout.svelte, qui la partage
	   encore avec `.members-c` (sidebar membres, pas encore extraite). Les
	   deux copies resteront à réconcilier quand ce sera fait. */
	.panel .edge-handle {
	  display: none;
	  position: absolute;
	  top: 0;
	  bottom: 0;
	  right: 0;
	  width: 10px;
	  cursor: ew-resize;
	  z-index: 10;
	  background: transparent;
	  transition: background-color 120ms ease-out, transform 80ms ease-out;
	  border: none;
	  padding: 0;
	}
	@media (min-width: 1024px) {
	  .panel .edge-handle { display: block; }
	}
	.panel .edge-handle:hover {
	  background: var(--nx-border);
	}
	.panel .edge-handle:active {
	  transform: scaleX(1.1);
	}
	.panel .edge-handle.dragging-past-boundary {
	  transform: scaleX(1.1);
	  opacity: 0.7;
	  background: rgba(239, 68, 68, 0.15) !important;
	}

	/* Mobile drawer overrides — copié de +layout.svelte : sous lg le rail
	   disparaît (voir InstanceRail.svelte) et le panneau devient LE tiroir
	   plein écran (280px fixes, au-dessus de tout : z-index 55). */
	@media (max-width: 1023px) {
	  .nodyx-sb .panel { left: 0; width: 280px; z-index: 55; border-right: 1px solid var(--nx-border); }
	  .nodyx-sb .panel.collapsed { opacity: 1; }
	}
</style>
