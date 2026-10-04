<script lang="ts">
	import { editMode } from '$lib/editMode';
	import { editZone } from '$lib/actions/editZone';
	import { page } from '$app/state';
	import { t, LOCALES } from '$lib/i18n';
	import { themePreference, isDarkTheme } from '$lib/theme';
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ChannelIcon from '$lib/components/ChannelIcon.svelte';

	const tFn = $derived($t);
	const isActive = (href: string) =>
		href === '/'
			? page.url.pathname === '/'
			: page.url.pathname.startsWith(href);

	interface Crumb { href?: string; label: string; }
	interface UserLite {
		username: string; avatar?: string | null; role?: string; points?: number;
		grade?: { name: string; color: string } | null;
	}

	let {
		isBanned,
		showChannelSidebar,
		gallerySidebarOpen = $bindable(),
		panelCollapsed = $bindable(),
		leftPanelWidth,
		isDraggingLeftPanel,
		communityName,
		breadcrumbs,
		currentLocale,
		membersCollapsed,
		user,
		unreadCount,
		dmUnread,
		myStatus,
		onOpenPalette,
		onOpenLang,
		langOpen = false,
		onToggleMembers,
		onOpenStatusModal,
	}: {
		isBanned: boolean;
		showChannelSidebar: boolean;
		gallerySidebarOpen: boolean;
		panelCollapsed: boolean;
		leftPanelWidth: number;
		isDraggingLeftPanel: boolean;
		communityName: string;
		breadcrumbs: Crumb[];
		currentLocale: string;
		membersCollapsed: boolean;
		user: UserLite | null;
		unreadCount: number;
		dmUnread: number;
		myStatus: { emoji?: string; text?: string } | null;
		onOpenPalette: () => void;
		onOpenLang: () => void;
		langOpen?: boolean;
		onToggleMembers: (velocity?: number | MouseEvent) => void;
		onOpenStatusModal: () => void;
	} = $props();

	let dropdownOpen = $state(false);

	// Meme calcul que le composant d'origine, recopie ici plutot que passe en
	// prop : depend uniquement de `user`, deja disponible, pas la peine de le
	// faire transiter par le parent.
	const xpInfo = $derived((() => {
		const pts   = user?.points ?? 0;
		const level = Math.floor(Math.sqrt(Math.max(0, pts) / 10)) + 1;
		const from  = (level - 1) * (level - 1) * 10;
		const to    = level * level * 10;
		const pct   = Math.min(100, Math.round(((pts - from) / (to - from)) * 100));
		return { pts, from, to, pct, level };
	})());

	function gradeTextColor(hex: string): string {
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
		return luminance > 0.5 ? '#111827' : '#ffffff';
	}
</script>

<nav class="nx-app-nav nx-plate sticky top-0 z-50 shrink-0 h-12 flex items-center px-4 gap-3"
     data-nx-zone="header"
     use:editZone={{ zone: 'decor', label: tFn('edit.zone_decor') }}
     class:dragging={isDraggingLeftPanel}>
	<div class="nx-zone-img" aria-hidden="true"></div>

	<!-- Mobile hamburger : ne s'affiche que si le panneau qu'il ouvre existe -->
	{#if !isBanned && showChannelSidebar}
	<button
		class="lg:hidden shrink-0 p-2.5 -m-1 flex items-center justify-center transition-colors"
		style="color: {gallerySidebarOpen ? 'var(--nx-text)' : 'var(--nx-text-muted)'}"
		onclick={() => {
			gallerySidebarOpen = !gallerySidebarOpen;
			// Ouvrir le tiroir doit AUSSI le deplier. `panelCollapsed` est un
			// etat de BUREAU (replier le panneau sur le rail), mais la regle
			// `.panel.collapsed` pose son propre `translateX(-100%)`, qui
			// survit sur mobile. Or la croix du panneau pose
			// `panelCollapsed = true` en fermant : au clic suivant sur le
			// burger, le voile revenait SANS le panneau, reste hors ecran.
			// Bug du 16/08, reproduit puis corrige.
			if (gallerySidebarOpen) panelCollapsed = false;
		}}
		aria-label={tFn('nav.community_menu')} aria-expanded={gallerySidebarOpen} aria-controls="galaxy-sidebar">
		{#if gallerySidebarOpen}
			<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
			</svg>
		{:else}
			<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
			</svg>
		{/if}
	</button>
	{/if}

	<!-- Mobile: community name logo -->
	<!-- min-w-0 (pas shrink-0) : sur écran étroit c'est le TITRE qui cède et se
	     tronque, pas les boutons d'action à droite. Un nom long comme
	     « Nodyx - Hub Communautaire » débordait sinon de ~25px. -->
	<!-- Ancien traitement : dégradé violet->cyan en background-clip: text, en
	     Space Grotesk (jamais chargée nulle part, retombait en silence sur la
	     police système depuis le début). Remplacé par une couleur pleine sur
	     l'accent du contenant + le poulpe, mascotte réelle de Nodyx (jusque là
	     utilisée seulement sur /about et le badge de version, jamais dans le
	     chrome de l'appli). Cf SPECS/NODYX_CONTENANT_DESIGN_CDC.md. -->
	<a href="/" class="lg:hidden min-w-0 flex items-center gap-1.5 font-bold text-sm truncate max-w-[140px]"
	   style="color: var(--nx-text)">
		<img src="/nodyx-octopus.png" alt="" class="nx-mark-octopus w-5 h-5 shrink-0" />
		<span class="truncate">{communityName}</span>
	</a>

	<!-- Desktop: logo + breadcrumb -->
	<div class="hidden lg:flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
		<!-- Logo toujours visible -->
		<a href="/" class="shrink-0 flex items-center gap-1.5 font-bold text-sm" style="color: var(--nx-text)">
			<img src="/nodyx-octopus.png" alt="" class="nx-mark-octopus w-5 h-5 shrink-0" />
			<span>{communityName}</span>
		</a>
		<!-- Breadcrumb dynamique (masqué sur la homepage) -->
		{#if breadcrumbs.length > 0}
			<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="color: var(--nx-text-faint)">
				<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
			</svg>
			{#each breadcrumbs as crumb, i}
				{#if i > 0}
					<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="color: var(--nx-text-faint)">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
					</svg>
				{/if}
				{#if crumb.href && i < breadcrumbs.length - 1}
					<a href={crumb.href}
					   class="nx-breadcrumb-link text-xs font-medium shrink-0 transition-colors truncate max-w-40">{crumb.label}</a>
				{:else}
					<span class="text-xs font-semibold truncate min-w-0"
					      style="color: var(--nx-text)">{crumb.label}</span>
				{/if}
			{/each}
		{/if}
	</div>

	<!-- Desktop: command palette trigger -->
	<button
		type="button"
		onclick={onOpenPalette}
		class="nx-palette-trigger hidden lg:flex items-center gap-2 px-3 h-7 w-56 rounded-lg transition-colors"
		style="cursor: text; text-align: left;"
		aria-label={tFn('common.command_palette_hint')}
	>
		<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--nx-text-faint); shrink:0">
			<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
		</svg>
		<span class="flex-1 text-xs truncate" style="color: var(--nx-text-faint)">{tFn('common.search_navigate')}</span>
		<div style="display:flex;gap:2px;shrink:0">
			<kbd class="nx-kbd">Ctrl</kbd>
			<kbd class="nx-kbd">K</kbd>
		</div>
	</button>

	<!-- Right: actions (notifs + DMs + account) -->
	<div class="flex items-center gap-1 shrink-0 ml-auto lg:ml-0">
		<!-- Theme toggle (guest + logged-in) -->
		<button type="button"
		        onclick={() => themePreference.setPreference($isDarkTheme ? 'light' : 'dark')}
		        class="nx-icon-btn flex items-center justify-center w-8 h-8 rounded-lg transition-all"
		        title={tFn($isDarkTheme ? 'settings.theme.switch_to_light' : 'settings.theme.switch_to_dark')}
		        aria-label={tFn($isDarkTheme ? 'settings.theme.switch_to_light' : 'settings.theme.switch_to_dark')}>
			{#if $isDarkTheme}
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<circle cx="12" cy="12" r="4"/>
					<path stroke-linecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
				</svg>
			{:else}
				<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
				</svg>
			{/if}
		</button>
		<!-- Language button (guest + logged-in) -->
		<button
			onclick={onOpenLang}
			aria-expanded={langOpen}
			class="lang-nav-btn p-2 transition-colors flex items-center gap-1.5"
			style="color: var(--nx-text-muted)"
			title={tFn('settings.language.label')}
			aria-label={tFn('settings.language.label')}>
			<span class="flex items-center leading-none"><ChannelIcon value={LOCALES.find(l => l.code === currentLocale)?.flagIcon} fallback="🌐" size={18} /></span>
			<svg class="hidden sm:block w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6"/></svg>
		</button>
		<!-- Toggle members sidebar (guest + logged-in, XL only to match sidebar) -->
		<button type="button"
		        onclick={onToggleMembers}
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
					<span class="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 flex items-center justify-center text-[9px] font-black text-white rounded-full bg-red-500 leading-none ring-1" style="--tw-ring-color: var(--nx-surface)">{unreadCount > 9 ? '9+' : unreadCount}</span>
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
					<span class="absolute top-0.5 right-0.5 min-w-3.5 h-3.5 px-0.5 flex items-center justify-center text-[9px] font-black rounded-full leading-none ring-1" style="background: var(--nx-header-accent); color: var(--nx-on-accent); --tw-ring-color: var(--nx-surface)">{dmUnread > 9 ? '9+' : dmUnread}</span>
				{/if}
			</a>
			{#if user.role === 'owner' || user.role === 'admin'}
				<!-- Bouton scindé : Administration | stylo (mode édition en direct,
				     grand écran seulement, comme le contenant flottant). -->
				<div class="nx-admin-split hidden sm:flex">
					<a href="/admin"
					   class="nx-admin-pill flex items-center px-2.5 h-7 text-[10px] font-black uppercase tracking-wider transition-all"
					   class:active={isActive('/admin')}
					   >{tFn('nav.admin')}</a>
					<button type="button" class="nx-admin-pen hidden lg:inline-flex" class:on={$editMode}
					        aria-pressed={$editMode} title={$editMode ? tFn('edit.pen_exit') : tFn('edit.pen_enter')}
					        aria-label={$editMode ? tFn('edit.pen_exit') : tFn('edit.pen_enter')}
					        onclick={() => editMode.update(v => !v)}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
					</button>
				</div>
			{/if}
			<!-- User dropdown -->
			<div class="relative">
				<button onclick={() => dropdownOpen = !dropdownOpen}
				        class="nx-user-trigger flex items-center gap-2 px-2 h-8 rounded-lg transition-colors group ml-1"
				        class:active={dropdownOpen}
				        aria-haspopup="true" aria-expanded={dropdownOpen}>
					<div class="relative shrink-0">
						{#if user.avatar}
							<img src={user.avatar} alt={tFn('common.avatar_alt')} class="w-6 h-6 rounded-md object-cover" style="outline: 1px solid var(--nx-border)" />
						{:else}
							<div class="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold select-none" style="background: var(--nx-header-accent); color: var(--nx-on-accent)">{user.username.charAt(0).toUpperCase()}</div>
						{/if}
						<span class="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-400" style="border: 1.5px solid var(--nx-surface)"></span>
					</div>
					<span class="hidden sm:inline text-xs font-semibold max-w-[90px] truncate" style="color: var(--nx-text)">{user.username}</span>
					<svg class="hidden sm:block w-2.5 h-2.5 transition-transform {dropdownOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" style="color: var(--nx-text-faint)"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
				</button>

					{#if dropdownOpen}
						<div class="fixed inset-0 z-40" role="none" onclick={() => dropdownOpen = false} onkeydown={() => {}}></div>
						<div class="nx-dropdown absolute right-0 top-full mt-2 w-72 z-50 rounded-xl overflow-hidden"
						     transition:scale={{ duration: 150, start: 0.97, opacity: 0, easing: cubicOut }}>
							<div class="px-4 pt-4 pb-3 nx-dropdown-head">
								<div class="flex items-center gap-3">
									{#if user.avatar}
										<img src={user.avatar} alt={tFn('common.avatar_alt')} class="w-12 h-12 rounded-full object-cover shrink-0" style="border: 2px solid var(--nx-border)" />
									{:else}
										<div class="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold shrink-0 select-none" style="background: var(--nx-header-accent); color: var(--nx-on-accent); border: 2px solid var(--nx-border)">{user.username.charAt(0).toUpperCase()}</div>
									{/if}
									<div class="min-w-0 flex-1">
										<div class="font-semibold text-sm truncate" style="color: var(--nx-text)">{user.username}</div>
										{#if user.grade}
											<span class="inline-block text-[11px] font-medium rounded px-1.5 py-0.5 mt-0.5" style="background-color: {user.grade.color}; color: {gradeTextColor(user.grade.color)}">{user.grade.name}</span>
										{:else}
											<span class="text-xs" style="color: var(--nx-text-faint)">{tFn('common.member')}</span>
										{/if}
									</div>
								</div>
								<div class="mt-3">
									<div class="flex justify-between items-center mb-1">
										<span class="text-[11px]" style="color: var(--nx-text-muted)">{#if xpInfo.to}{xpInfo.pts.toLocaleString()} / {xpInfo.to.toLocaleString()} pts{:else}{xpInfo.pts.toLocaleString()} pts · Max{/if}</span>
										<span class="text-[11px] font-medium" style="color: var(--nx-header-accent)">{xpInfo.pct}%</span>
									</div>
									<div class="h-1.5 rounded-full overflow-hidden" style="background: var(--nx-border)">
										<div class="h-full rounded-full transition-all" style="width: {xpInfo.pct}%; background: var(--nx-header-accent)"></div>
									</div>
								</div>
							</div>
							<!-- Status quick-set -->
							<button
								onclick={() => { dropdownOpen = false; onOpenStatusModal(); }}
								class="nx-dropdown-status w-full flex items-center gap-3 px-4 py-2.5 transition-colors text-left"
							>
								<span class="text-base shrink-0">{myStatus?.emoji || '😶'}</span>
								<span class="flex-1 min-w-0">
									{#if myStatus?.text}
										<span class="text-xs truncate block" style="color: var(--nx-text-muted)">{myStatus.text}</span>
									{:else}
										<span class="text-xs" style="color: var(--nx-text-faint)">{tFn('common.set_status')}</span>
									{/if}
								</span>
								<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="color: var(--nx-text-faint)"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
							</button>

							<div class="py-1.5">
								<a href="/users/{user.username}" onclick={() => dropdownOpen = false} class="nx-dropdown-item flex items-center gap-3 px-4 py-2 text-sm transition-colors"><span class="text-base">👤</span><span>{tFn('user.my_profile')}</span></a>
								<a href="/users/me/edit" onclick={() => dropdownOpen = false} class="nx-dropdown-item flex items-center gap-3 px-4 py-2 text-sm transition-colors"><span class="text-base">✏️</span><span>{tFn('user.edit_profile')}</span></a>
								<a href="/notifications" onclick={() => dropdownOpen = false} class="nx-dropdown-item flex items-center gap-3 px-4 py-2 text-sm transition-colors">
									<span class="text-base">🔔</span><span class="flex-1">{tFn('nav.notifications')}</span>
									{#if unreadCount > 0}<span class="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>{/if}
								</a>
							</div>
							<div class="mx-3" style="border-top: 1px solid var(--nx-border)"></div>
							<div class="py-1.5">
								<a href="/settings" onclick={() => dropdownOpen = false} class="nx-dropdown-item flex items-center gap-3 px-4 py-2 text-sm transition-colors"><span class="text-base">⚙️</span><span>{tFn('nav.settings')}</span></a>
								<a href="https://nodyx.dev" target="_blank" rel="noopener" onclick={() => dropdownOpen = false} class="nx-dropdown-item flex items-center gap-3 px-4 py-2 text-sm transition-colors"><span class="text-base">📖</span><span>{tFn('nav.documentation')}</span></a>
								{#each [{ icon: '📊', label: tFn('user.my_activity') }, { icon: '👫', label: tFn('user.friends') }, { icon: '🏆', label: tFn('user.badges') }] as item}
									<div class="flex items-center gap-3 px-4 py-2 text-sm cursor-not-allowed select-none" style="color: var(--nx-text-faint)">
										<span class="text-base opacity-50">{item.icon}</span><span class="flex-1">{item.label}</span><span class="text-[10px] uppercase tracking-wider font-medium" style="color: var(--nx-text-faint)">{tFn('common.soon')}</span>
									</div>
								{/each}
							</div>
							<div class="mx-3" style="border-top: 1px solid var(--nx-border)"></div>
							<div class="py-1.5">
								<form method="POST" action="/auth/logout">
									<button type="submit" class="nx-dropdown-item nx-dropdown-item--danger w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left">
										<span class="text-base">🚪</span><span>{tFn('common.logout')}</span>
									</button>
								</form>
							</div>
						</div>
					{/if}
				</div>
		{:else}
			<a href="/auth/login"
			   class="nx-auth-btn flex items-center justify-center h-8 px-2.5 sm:min-w-[5.5rem] sm:px-3 text-xs font-medium rounded-lg transition-all whitespace-nowrap">{tFn('common.login')}</a>
			<a href="/auth/register"
			   class="nx-auth-btn nx-auth-btn--primary flex items-center justify-center h-8 px-2.5 sm:min-w-[5.5rem] sm:px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap">{tFn('common.register')}</a>
		{/if}
	</div>
</nav>

<style>
	/* ── Décalage rail/panneau ────────────────────────────────────────────────
	   Le rail (56px) puis le panneau de canaux (largeur variable) vivent en
	   `position: fixed` hors du flux ; sans ce décalage la nav (sticky, z-50)
	   dessine son fond PAR-DESSUS eux dès qu'elle est en flux normal — bug
	   réel trouvé le 20/09 en vérifiant le rail sur vieuxlooters après son
	   extraction (son icône logo était invisible depuis le début).
	   `--panel-offset` est calculé par le composant (JS), la media query ne
	   fait que décider QUAND l'appliquer : sous lg le rail/panneau sont un
	   tiroir superposé, la nav doit rester pleine largeur. Transition coupée
	   pendant un drag de redimensionnement pour ne pas trainer derrière le
	   curseur (même principe que `.layout-dragging main.app-shell-main`). */
	/* 28/09 : barre flottante en verre (.nx-plate, app.css). Son bord gauche
	   suit --shell-left, calculé UNE fois dans +layout.svelte pour elle, <main>
	   et les pages en `fixed` : plus de second calcul ici qui puisse diverger.
	   Sous lg, marges nulles (--shell-gap = 0) : barre pleine largeur, inchangée. */
	.nx-app-nav {
		font-family: var(--font-shell);
		transition: margin-left .42s var(--ease-out-soft);
	}
	.nx-app-nav.dragging {
		transition: none !important;
	}
	@media (max-width: 1023px) {
		.nx-app-nav { border-bottom: 1px solid var(--nx-border); }
	}
	@media (min-width: 1024px) {
		.nx-app-nav {
			top: var(--shell-gap);
			margin: var(--shell-gap) var(--shell-gap) 0 var(--shell-left);
		}
	}

	.nx-breadcrumb-link {
		color: var(--nx-text-muted);
	}
	.nx-breadcrumb-link:hover,
	.nx-breadcrumb-link:focus-visible {
		color: var(--nx-text);
	}
	.nx-dropdown {
		background: var(--nx-surface-raised);
		border: 1px solid var(--nx-border);
		box-shadow: 0 1px 2px rgba(0,0,0,.3), 0 12px 32px -8px rgba(0,0,0,.5);
	}
	.nx-dropdown-head { background: var(--nx-surface); }
	.nx-dropdown-status {
		background: color-mix(in srgb, var(--nx-surface) 60%, transparent);
		border-bottom: 1px solid var(--nx-border);
	}
	.nx-dropdown-status:hover { background: var(--nx-surface); }
	.nx-dropdown-item { color: var(--nx-text-muted); }
	.nx-dropdown-item:hover { color: var(--nx-text); background: var(--nx-surface); }
	.nx-dropdown-item--danger:hover { color: #f87171; }
	.nx-user-trigger {
		background: var(--nx-surface-raised);
		border: 1px solid var(--nx-border);
	}
	.nx-user-trigger.active {
		background: var(--nx-header-accent-soft);
		border-color: color-mix(in srgb, var(--nx-header-accent) 40%, transparent);
	}
	.nx-palette-trigger {
		background: var(--nx-surface-raised);
		border: 1px solid var(--nx-border);
	}
	.nx-palette-trigger:hover {
		border-color: color-mix(in srgb, var(--nx-text) 20%, var(--nx-border));
	}
	.nx-palette-trigger:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--nx-header-accent) 45%, transparent);
	}
	.nx-kbd {
		font-size: 0.6rem;
		background: var(--nx-surface);
		border: 1px solid var(--nx-border);
		padding: 0.05rem 0.28rem;
		border-radius: 4px;
		color: var(--nx-text-faint);
		font-family: ui-monospace, monospace;
	}
	.nx-icon-btn {
		color: var(--nx-text-muted);
		background: transparent;
		border: 1px solid transparent;
		transition: color 150ms cubic-bezier(0.32, 0.72, 0, 1),
		            background 150ms cubic-bezier(0.32, 0.72, 0, 1),
		            border-color 150ms cubic-bezier(0.32, 0.72, 0, 1);
	}
	.nx-icon-btn:hover {
		color: var(--nx-text);
		background: var(--nx-surface-raised);
		border-color: var(--nx-border);
	}
	.nx-icon-btn:active { transform: scale(0.94); }
	.nx-icon-btn.active {
		color: var(--nx-header-accent);
		background: var(--nx-header-accent-soft);
		border-color: color-mix(in srgb, var(--nx-header-accent) 30%, transparent);
	}
	.nx-icon-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--nx-header-accent) 45%, transparent);
	}
	/* Bouton scindé : les deux moitiés partagent une seule forme arrondie. */
	.nx-admin-split { align-items: stretch; }
	.nx-admin-split .nx-admin-pill { border-radius: 6px; }
	@media (min-width: 1024px) {
		.nx-admin-split .nx-admin-pill { border-radius: 6px 0 0 6px; }
	}
	.nx-admin-pen {
		align-items: center; justify-content: center; width: 30px; height: 28px; margin-left: -1px; cursor: pointer;
		border-radius: 0 6px 6px 0; border: 1px solid var(--nx-border); background: transparent; color: var(--nx-text-faint);
		transition: color .15s, background-color .15s, border-color .15s;
	}
	.nx-admin-pen svg { width: 14px; height: 14px; transition: transform .35s var(--ease-spring); }
	.nx-admin-pen:hover { color: var(--nx-text); background: var(--nx-surface-raised); }
	.nx-admin-pen:hover svg { transform: rotate(-12deg); }
	.nx-admin-pen.on { color: var(--nx-on-accent); background: var(--nx-header-accent); border-color: var(--nx-header-accent); }
	.nx-admin-pen:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	/* Admin pill in top bar */
	.nx-admin-pill {
		color: var(--nx-text-faint);
		background: transparent;
		border: 1px solid var(--nx-border);
	}
	.nx-admin-pill:hover {
		color: var(--nx-text);
		background: var(--nx-surface-raised);
		border-color: color-mix(in srgb, var(--nx-text) 15%, transparent);
	}
	.nx-admin-pill.active {
		color: var(--nx-header-accent);
		background: var(--nx-header-accent-soft);
		border-color: color-mix(in srgb, var(--nx-header-accent) 35%, transparent);
	}
	/* Auth buttons (Sign in / Register) */
	.nx-auth-btn {
		color: var(--nx-text-muted);
		background: transparent;
		border: 1px solid var(--nx-border);
	}
	.nx-auth-btn:hover {
		color: var(--nx-text);
		background: var(--nx-surface-raised);
		border-color: color-mix(in srgb, var(--nx-text) 20%, transparent);
	}
	.nx-auth-btn:active { transform: scale(0.97); }
	.nx-auth-btn--primary {
		color: var(--nx-on-accent);
		background: var(--nx-header-accent);
		border-color: transparent;
		box-shadow: 0 1px 2px rgba(0,0,0,0.3), 0 4px 14px color-mix(in srgb, var(--nx-header-accent) 30%, transparent);
	}
	.nx-auth-btn--primary:hover {
		background: var(--nx-header-accent);
		filter: brightness(1.08);
		border-color: transparent;
		box-shadow: 0 2px 6px rgba(0,0,0,0.35), 0 6px 20px color-mix(in srgb, var(--nx-header-accent) 40%, transparent);
	}
	.nx-auth-btn--primary:active { transform: scale(0.97); }

	.lang-nav-btn {
		border-radius: 6px;
		transition: color 150ms cubic-bezier(0.32, 0.72, 0, 1),
		            background 150ms cubic-bezier(0.32, 0.72, 0, 1),
		            transform 100ms ease-out;
	}
	.lang-nav-btn:hover {
		color: var(--nx-text) !important;
		background: var(--nx-surface-raised);
	}
	.lang-nav-btn:active { transform: scale(0.95); }
	.lang-nav-btn:focus-visible {
		outline: none;
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--nx-header-accent) 45%, transparent);
	}
</style>
