<script lang="ts">
	import type { PageData } from './$types';
	import { fly, fade } from 'svelte/transition';
	import type { FlyParams, FadeParams } from 'svelte/transition';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props();

	// ── Données typées ────────────────────────────────────────────────
	const threads = $derived(data.threads as Thread[] || []);
	// Use slug for URLs if available (SEO), fall back to UUID
	const categoryId = $derived((data.category?.slug ?? data.categoryId) as string);
	const subcategories = $derived((data.category?.children ?? []) as any[]);
	const user = $derived((data as any).user as any); // Si user est passé

	// Pour le moment, pas de category, on utilise un nom par défaut
	// Mais tu pourrais ajouter un appel API pour récupérer les infos de la catégorie
	const categoryName = $derived(
	data.category?.name || 
	// Si pas de catégorie, on utilise un nom générique
	`Catégorie`
); // À remplacer quand l'API fournira la catégorie

	// ── Types ──────────────────────────────────────────────────────────
	type Tag = {
		id: string;
		name: string;
		color: string;
	};

	type Thread = {
		id: string;
		title: string;
		content?: string;
		author_id: string;
		author_username: string;
		author_avatar?: string | null;
		author_points?: number;
		author_grade_name?: string | null;
		author_grade_color?: string | null;
		author_member_since?: string;
		created_at: string;
		updated_at?: string;
		post_count: number;
		views: number;
		is_pinned: boolean;
		is_locked: boolean;
		is_featured: boolean;
		tags?: Tag[];
		posts?: Post[];
	};

	type Post = {
		id: string;
		author_id: string;
		author_username: string;
		author_avatar?: string | null;
		created_at: string;
	};

	// ── État pour le tri ──────────────────────────────────────────────
	type SortOption = 'recent' | 'popular' | 'views' | 'lastReply';
	// AJOUT DE $state ICI
	let sortBy = $state<SortOption>('recent'); 
	let sortDropdownOpen = $state(false);
	let sortButtonRef: HTMLDivElement | null = $state(null);

	// --- État pour les filtres ---
	type FilterType = 'all' | 'pinned' | 'unanswered' | 'popular' | 'today';
	// AJOUT DE $state ICI
	let filterBy = $state<FilterType>('all');
	let filterDropdownOpen = $state(false);
	let filterButtonRef: HTMLDivElement | null = $state(null);

	// ── État pour la recherche ────────────────────────────────────────
	let searchQuery = $state('');
	let searchInputRef: HTMLInputElement | null = $state(null);

	// ── État pour la pagination ───────────────────────────────────────
	let currentPage = $state(1);
	let itemsPerPage = $state(20);
	let pageInputValue = $state('1');

	// ── Gestion du tri ───────────────────────────────────────────────
	function getFilteredAndSortedThreads(): Thread[] {
		let filtered = [...threads];
		
		// Application des filtres
		switch(filterBy) {
			case 'pinned':
				filtered = filtered.filter(t => t.is_pinned);
				break;
			case 'unanswered':
				filtered = filtered.filter(t => (t.post_count || 0) === 0);
				break;
			case 'popular':
				filtered = filtered.filter(t => (t.post_count || 0) >= 10);
				break;
			case 'today':
				const today = new Date();
				today.setHours(0, 0, 0, 0);
				filtered = filtered.filter(t => new Date(t.created_at) >= today);
				break;
		}
		
		// Recherche textuelle
		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter(t => 
				t.title.toLowerCase().includes(query) ||
				t.author_username.toLowerCase().includes(query) ||
				(t.tags || []).some(tag => tag.name.toLowerCase().includes(query))
			);
		}
		
		// Tri
		switch(sortBy) {
			case 'recent':
				return filtered.sort((a, b) => 
					new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
				);
			case 'popular':
				return filtered.sort((a, b) => (b.post_count || 0) - (a.post_count || 0));
			case 'views':
				return filtered.sort((a, b) => (b.views || 0) - (a.views || 0));
			case 'lastReply':
				return filtered.sort((a, b) => 
					new Date(b.updated_at || b.created_at).getTime() - 
					new Date(a.updated_at || a.created_at).getTime()
				);
			default:
				return filtered;
		}
	}

	const filteredThreads = $derived(getFilteredAndSortedThreads());
	
	// Pagination
	const totalPages = $derived(Math.ceil(filteredThreads.length / itemsPerPage));
	const paginatedThreads = $derived(
		filteredThreads.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage)
	);

	// ── Gestionnaires d'événements ───────────────────────────────────
	$effect(() => {
		if (sortDropdownOpen) {
			const handler = (e: MouseEvent) => {
				if (sortButtonRef && !sortButtonRef.contains(e.target as Node)) {
					sortDropdownOpen = false;
				}
			};
			document.addEventListener('click', handler);
			return () => document.removeEventListener('click', handler);
		}
	});

	$effect(() => {
		if (filterDropdownOpen) {
			const handler = (e: MouseEvent) => {
				if (filterButtonRef && !filterButtonRef.contains(e.target as Node)) {
					filterDropdownOpen = false;
				}
			};
			document.addEventListener('click', handler);
			return () => document.removeEventListener('click', handler);
		}
	});

	// Reset page when filters change
	$effect(() => {
		currentPage = 1;
		pageInputValue = '1';
	});

	// ── Formatage ────────────────────────────────────────────────────
	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString([], {
			day: '2-digit', month: 'short', year: 'numeric'
		});
	}

	function formatRelativeTime(iso: string): string {
		const now = new Date();
		const date = new Date(iso);
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMins / 60);
		const diffDays = Math.floor(diffHours / 24);

		if (diffMins < 1) return tFn('forum.ago_now');
		if (diffMins < 60) return tFn('forum.ago_min', { n: String(diffMins) });
		if (diffHours < 24) return tFn('forum.ago_h', { n: String(diffHours) });
		if (diffDays === 1) return tFn('forum.ago_yesterday');
		if (diffDays < 7) return tFn('forum.ago_days', { n: String(diffDays) });
		return formatDate(iso);
	}

	// ── Dernier posteur ─────────────────────────────────────────────
	function getLastPoster(thread: Thread): Post | null {
		if (!thread.posts || thread.posts.length === 0) return null;
		return thread.posts[thread.posts.length - 1];
	}

	// ── Labels ───────────────────────────────────────────────────────
	const sortLabels = $derived<Record<SortOption, string>>({
		recent: tFn('forum.sort_recent'),
		popular: tFn('forum.sort_popular'),
		views: tFn('forum.sort_views'),
		lastReply: tFn('forum.sort_last_reply')
	});

	const filterLabels = $derived<Record<FilterType, string>>({
		all: tFn('forum.filter_all'),
		pinned: tFn('forum.filter_pinned'),
		unanswered: tFn('forum.filter_unanswered'),
		popular: tFn('forum.filter_popular_10'),
		today: tFn('forum.filter_today')
	});

	// ── Stats de la catégorie ────────────────────────────────────────
	const categoryStats = $derived({
		total: threads.length,
		pinned: threads.filter(t => t.is_pinned).length,
		unanswered: threads.filter(t => (t.post_count || 0) === 0).length,
		popular: threads.filter(t => (t.post_count || 0) >= 10).length,
		today: threads.filter(t => {
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			return new Date(t.created_at) >= today;
		}).length
	});

	// ── Gestionnaire de page ─────────────────────────────────────────
	function goToPage(page: number): void {
		currentPage = Math.max(1, Math.min(page, totalPages));
		pageInputValue = currentPage.toString();
	}

	// ── Icône de catégorie (basée sur l'ID) ─────────────────────────
	function getCategoryIcon(): string {
		// Pour l'instant, on utilise une icône par défaut
		// Plus tard, on pourra avoir une map categoryId -> icône
		return '📋';
	}
</script>

<svelte:head>
	<title>{categoryName} — {$page.data.communityName ?? 'Nodyx'}</title>
	<meta name="description" content="Discussions dans {categoryName} — forum {$page.data.communityName ?? 'Nodyx'}" />
	<link rel="canonical" href={$page.url.href} />
	<meta property="og:title"       content="{categoryName} — {$page.data.communityName ?? 'Nodyx'}" />
	<meta property="og:description" content="Discussions dans {categoryName} — forum {$page.data.communityName ?? 'Nodyx'}" />
	<meta property="og:type"        content="website" />
	<meta property="og:url"         content={$page.url.href} />
	<meta property="og:image"       content={$page.data.communityBannerUrl ?? $page.data.communityLogoUrl ?? `${$page.url.origin}/default-og-image.png`} />
	<meta property="og:site_name"   content={$page.data.communityName ?? 'Nodyx'} />
</svelte:head>

<!-- EN-TÊTE DE CATÉGORIE -->
<div class="relative mb-8 overflow-hidden border border-white/[.06] bg-gradient-to-br from-gray-900 via-gray-900 to-indigo-950/30 p-8">
	<!-- Effets de lumière -->
	<div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
	<div class="absolute -top-20 -right-20 w-80 h-80 bg-indigo-600/10 blur-3xl"></div>
	<div class="absolute -bottom-20 -left-20 w-80 h-80 bg-violet-600/10 blur-3xl"></div>

	<div class="relative flex flex-wrap items-start justify-between gap-6">
		<div class="flex items-start gap-6">
			<!-- Icône de catégorie -->
			<div class="relative">
				<div class="w-14 h-14 sm:w-20 sm:h-20 bg-gradient-to-br from-indigo-600 to-violet-600
							flex items-center justify-center text-2xl sm:text-4xl shadow-xl shadow-indigo-600/30">
					{getCategoryIcon()}
				</div>
			</div>

			<div>
				<!-- Fil d'Ariane -->
				<div class="flex items-center gap-2 mb-2">
					<a href="/" class="text-sm text-gray-500 hover:text-indigo-400 transition-colors">{tFn('nav.home')}</a>
					<svg xmlns="http://www.w3.org/2000/svg" class="w-3 h-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
					</svg>
					<span class="text-sm font-medium text-indigo-400">{categoryName}</span>
				</div>

				<h1 class="text-2xl sm:text-4xl font-bold text-white tracking-tight mb-2">{categoryName}</h1>

				<!-- Stats de la catégorie -->
				<div class="flex flex-wrap items-center gap-4 mt-4">
					<div class="flex items-center gap-2 px-3 py-1.5 bg-gray-800/60 border border-gray-700">
						<span class="text-xs text-gray-400">{tFn('forum.total')}</span>
						<span class="text-sm font-bold text-white">{categoryStats.total}</span>
					</div>
					{#if categoryStats.pinned > 0}
						<div class="flex items-center gap-2 px-3 py-1.5 bg-indigo-900/20 border border-indigo-800/50">
							<span class="text-xs text-indigo-400">{tFn('forum.pinned_stat')}</span>
							<span class="text-sm font-bold text-indigo-400">{categoryStats.pinned}</span>
						</div>
					{/if}
					{#if categoryStats.unanswered > 0}
						<div class="flex items-center gap-2 px-3 py-1.5 bg-yellow-900/20 border border-yellow-800/50">
							<span class="text-xs text-yellow-400">{tFn('forum.unanswered_stat')}</span>
							<span class="text-sm font-bold text-yellow-400">{categoryStats.unanswered}</span>
						</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</div>

<!-- SOUS-CATÉGORIES -->
{#if subcategories.length > 0}
	<div class="mb-6">
		<h2 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">{tFn('forum.subcategories')}</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
			{#each subcategories as sub}
				<a
					href="/forum/{sub.slug ?? sub.id}"
					class="flex items-start gap-3 border border-gray-800 bg-gray-900/60
					       px-4 py-3.5 hover:border-indigo-700/60 hover:bg-gray-900
					       transition-all group"
				>
					<div class="mt-0.5 w-8 h-8 bg-indigo-600/15 border border-indigo-600/20
					            flex items-center justify-center flex-shrink-0 text-indigo-400
					            group-hover:bg-indigo-600/25 transition-colors">
						<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
						</svg>
					</div>
					<div class="flex-1 min-w-0">
						<p class="text-sm font-semibold text-white group-hover:text-indigo-300 transition-colors truncate">
							{sub.name}
						</p>
						{#if sub.description}
							<p class="text-xs text-gray-500 mt-0.5 line-clamp-1">{sub.description}</p>
						{/if}
						{#if sub.thread_count > 0}
							<p class="text-xs text-gray-600 mt-1">{sub.thread_count} {tFn('common.topics').toLowerCase()}</p>
						{/if}
					</div>
					<svg class="w-4 h-4 text-gray-700 group-hover:text-indigo-500 transition-colors flex-shrink-0 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
					</svg>
				</a>
			{/each}
		</div>
	</div>
{/if}

<!-- BARRE D'OUTILS (identique) -->
<div class="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
	<!-- Recherche et légende -->
	<div class="flex flex-wrap items-center gap-4">
		<!-- Barre de recherche -->
		<div class="relative w-full sm:w-80">
			<input
				bind:this={searchInputRef}
				type="text"
				placeholder={tFn('forum.search_placeholder')}
				bind:value={searchQuery}
				class="w-full pl-10 pr-4 py-2.5 bg-gray-800/80 border border-gray-700
					   text-sm text-white placeholder-gray-600 focus:outline-none focus:border-indigo-500
					   transition-colors"
			/>
			<svg xmlns="http://www.w3.org/2000/svg" class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
			</svg>
			{#if searchQuery}
				<button 
					onclick={() => searchQuery = ''}
					class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400"
				>
					<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			{/if}
		</div>

		<!-- Légende compacte -->
		<div class="flex items-center gap-3 text-xs">
			<div class="flex items-center gap-1.5">
				<span class="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
				<span class="text-gray-500">{tFn('forum.legend_active')}</span>
			</div>
			<div class="flex items-center gap-1.5">
				<span class="w-2 h-2 rounded-full bg-yellow-500"></span>
				<span class="text-gray-500">Épinglé</span>
			</div>
			<div class="flex items-center gap-1.5">
				<span class="w-2 h-2 rounded-full bg-green-500"></span>
				<span class="text-gray-500">{tFn('forum.legend_new')}</span>
			</div>
		</div>
	</div>

	<!-- Filtres et tri -->
	<div class="flex flex-wrap items-center gap-2">
		<!-- Filtre dropdown -->
		<div class="relative" bind:this={filterButtonRef}>
			<button
				onclick={() => filterDropdownOpen = !filterDropdownOpen}
				class="flex items-center gap-2 px-4 py-2 bg-gray-800/80 border border-gray-700
					   text-gray-300 hover:text-white hover:border-indigo-500/50 transition-all duration-200"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
				</svg>
				<span class="text-sm hidden sm:inline">{tFn('forum.filter_label_full', { label: filterLabels[filterBy] })}</span>
				<span class="text-sm sm:hidden">{tFn('forum.filter_label_short')}</span>
				{#if filterBy !== 'all'}
					<span class="ml-1 px-1.5 py-0.5 bg-indigo-600/30 text-indigo-400 text-xs">{filteredThreads.length}</span>
				{/if}
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 ml-1 text-gray-500 transition-transform duration-200 {filterDropdownOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{#if filterDropdownOpen}
				<div
					class="absolute right-0 mt-2 w-64 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 shadow-2xl shadow-indigo-500/10 overflow-hidden z-50"
					transition:fly={{ y: -10, duration: 200 }}
				>
					<div class="py-1">
						{#each Object.entries(filterLabels) as [value, label]}
							<button
								onclick={() => {
									filterBy = value as FilterType;
									filterDropdownOpen = false;
								}}
								class="w-full text-left px-4 py-3 text-sm transition-colors
									   {filterBy === value 
										   ? 'bg-indigo-600/20 text-indigo-400 border-l-2 border-indigo-500' 
										   : 'text-gray-300 hover:bg-gray-800 hover:text-white'}"
							>
								<div class="flex items-center justify-between">
									<span>{label}</span>
									{#if filterBy === value}
										<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									{/if}
								</div>
								<span class="block text-[10px] text-gray-600 mt-0.5">
									{value === 'all' ? 'Aucun filtre' :
									 value === 'pinned' ? 'Sujets épinglés uniquement' :
									 value === 'unanswered' ? 'Sujets sans réponse' :
									 value === 'popular' ? 'Plus de 10 réponses' :
									 'Créés aujourd\'hui'}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Tri dropdown -->
		<div class="relative" bind:this={sortButtonRef}>
			<button
				onclick={() => sortDropdownOpen = !sortDropdownOpen}
				class="flex items-center gap-2 px-4 py-2 bg-gray-800/80 border border-gray-700
					   text-gray-300 hover:text-white hover:border-indigo-500/50 transition-all duration-200"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 4h13M3 8h9m-9 4h6m4 0h4m-4-4v12m0 0l-4-4m4 4l4-4" />
				</svg>
				<span class="text-sm hidden sm:inline">{tFn('forum.sort_label_full', { label: sortLabels[sortBy] })}</span>
				<span class="text-sm sm:hidden">{tFn('forum.sort_label_short')}</span>
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 ml-1 text-gray-500 transition-transform duration-200 {sortDropdownOpen ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
				</svg>
			</button>

			{#if sortDropdownOpen}
				<div
					class="absolute right-0 mt-2 w-56 max-w-[calc(100vw-2rem)] bg-gray-900 border border-gray-700 shadow-2xl shadow-indigo-500/10 overflow-hidden z-50"
					transition:fly={{ y: -10, duration: 200 }}
				>
					<div class="py-1">
						{#each Object.entries(sortLabels) as [value, label]}
							<button
								onclick={() => {
									sortBy = value as SortOption;
									sortDropdownOpen = false;
								}}
								class="w-full text-left px-4 py-3 text-sm transition-colors
									   {sortBy === value 
										   ? 'bg-indigo-600/20 text-indigo-400 border-l-2 border-indigo-500' 
										   : 'text-gray-300 hover:bg-gray-800 hover:text-white'}"
							>
								<div class="flex items-center justify-between">
									<span>{label}</span>
									{#if sortBy === value}
										<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										</svg>
									{/if}
								</div>
								<span class="block text-[10px] text-gray-600 mt-0.5">
									{value === 'recent' ? 'Date de création' :
									 value === 'popular' ? 'Nombre de réponses' :
									 value === 'views' ? 'Nombre de vues' :
									 'Dernière activité'}
								</span>
							</button>
						{/each}
					</div>
				</div>
			{/if}
		</div>

		<!-- Bouton Nouveau sujet -->
		{#if user}
			<a
				href="/forum/{categoryId}/new"
				class="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500
					   px-5 py-2 text-sm font-semibold text-white transition-colors"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
					<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4" />
				</svg>
				{tFn('forum.new_topic_btn')}
			</a>
		{/if}
	</div>
</div>

<!-- RÉSULTATS DE RECHERCHE -->
{#if searchQuery}
	<div class="mb-4 flex items-center justify-between">
		<p class="text-sm text-gray-400">
			🔍 Recherche pour "<span class="text-white font-medium">{searchQuery}</span>" · 
			{filteredThreads.length} résultat{filteredThreads.length > 1 ? 's' : ''}
		</p>
		<button 
			onclick={() => searchQuery = ''}
			class="text-xs text-gray-600 hover:text-gray-400 transition-colors"
		>
			Effacer
		</button>
	</div>
{/if}

<!-- LISTE DES SUJETS -->
{#if paginatedThreads.length === 0}
	<div class="flex flex-col items-center justify-center py-20 px-4 border border-dashed border-gray-800 bg-gray-900/50">
		<div class="w-24 h-24 bg-gray-800 flex items-center justify-center mb-4">
			<svg xmlns="http://www.w3.org/2000/svg" class="w-12 h-12 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
				<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
			</svg>
		</div>
		<h3 class="text-xl font-semibold text-white mb-2">
			{#if searchQuery}
				{tFn('forum.no_filter_results')}
			{:else if filterBy !== 'all'}
				{tFn('forum.no_filter_results')}
			{:else}
				{tFn('forum.no_topics_in_category')}
			{/if}
		</h3>
		<p class="text-sm text-gray-500 text-center max-w-sm mb-6">
			{#if searchQuery}
				{tFn('forum.try_keywords')}
			{:else}
				Soyez le premier à lancer une discussion !
			{/if}
		</p>
		{#if user && !searchQuery}
			<a href="/forum/{categoryId}/new" class="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors">
				Créer le premier sujet
			</a>
		{/if}
	</div>
{:else}
	<div class="space-y-2">
		{#each paginatedThreads as thread, index (thread.id)}
			<!-- En-tête épinglés -->
			{#if index === 0 && thread.is_pinned && filterBy === 'all' && currentPage === 1}
				<div class="flex items-center gap-2 mt-2 mb-3">
					<div class="h-px flex-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
					<span class="text-xs font-medium text-indigo-400 px-3 py-1 bg-indigo-900/20 border border-indigo-800/50 flex items-center gap-1">
						{tFn('forum.pinned_header')}
					</span>
					<div class="h-px flex-1 bg-gradient-to-r from-transparent via-indigo-500/50 to-transparent"></div>
				</div>
			{/if}

			{@const lastPoster = getLastPoster(thread)}
			{@const isNew = new Date(thread.updated_at || thread.created_at) > new Date(Date.now() - 24*60*60*1000)}
			
			<a
				href="/forum/{categoryId}/{thread.slug ?? thread.id}"
				class="group relative flex flex-wrap sm:flex-nowrap items-center gap-4
					   border border-white/[.06] bg-gray-900/60
					   px-5 py-4 hover:border-indigo-700/50 hover:bg-gray-900
					   transition-colors duration-200 overflow-hidden"
			>
				<!-- ... reste du code identique ... -->
				<!-- Avatar créateur -->
				<div class="relative flex-shrink-0 hidden sm:block">
					{#if thread.author_avatar}
						<img
							src={thread.author_avatar}
							alt={thread.author_username}
							class="w-10 h-10 rounded-full object-cover ring-2 ring-gray-700 group-hover:ring-indigo-500/30 transition-all"
						/>
					{:else}
						<div class="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-600 to-violet-600
									flex items-center justify-center text-sm font-bold text-white
									ring-2 ring-gray-700 group-hover:ring-indigo-500/30 transition-all">
							{thread.author_username.charAt(0).toUpperCase()}
						</div>
					{/if}
				</div>

				<!-- Contenu principal -->
				<div class="flex-1 min-w-0">
					<!-- Badges -->
					<div class="flex flex-wrap items-center gap-1.5 mb-1.5">
						{#if thread.is_pinned}
							<span class="inline-flex items-center gap-0.5 text-xs font-medium text-indigo-400 bg-indigo-900/20 border border-indigo-800/50 px-2 py-0.5">
								{tFn('forum.badge_pinned')}
							</span>
						{/if}
						{#if thread.is_locked}
							<span class="inline-flex items-center gap-0.5 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 px-2 py-0.5">
								{tFn('forum.badge_locked')}
							</span>
						{/if}
						{#if thread.is_featured}
							<span class="inline-flex items-center gap-0.5 text-xs font-medium text-yellow-400 bg-yellow-900/30 border border-yellow-800/50 px-2 py-0.5">
								{tFn('forum.badge_featured')}
							</span>
						{/if}
						{#each (thread.tags || []).slice(0, 2) as tag}
							<span class="inline-flex items-center px-2 py-0.5 text-xs font-medium"
								style="background-color: {tag.color}22; color: {tag.color}; border: 1px solid {tag.color}44">
								{tag.name}
							</span>
						{/each}
						{#if (thread.tags?.length || 0) > 2}
							<span class="text-xs text-gray-600">+{(thread.tags?.length || 0) - 2}</span>
						{/if}
					</div>

					<!-- Titre -->
					<p class="text-base font-semibold text-white group-hover:text-indigo-400 transition-colors line-clamp-1">
						{thread.title}
					</p>

					<!-- Métadonnées -->
					<div class="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
						<!-- Auteur -->
						<div class="flex items-center gap-1 text-gray-500">
							<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
							</svg>
							<span class="text-gray-400">{thread.author_username}</span>
						</div>

						<!-- Date -->
						<div class="flex items-center gap-1 text-gray-600">
							<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
							</svg>
							<span>{formatRelativeTime(thread.created_at)}</span>
						</div>

						<!-- Vues -->
						<div class="flex items-center gap-1 text-gray-600">
							<svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
								<path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
							</svg>
							<span>{thread.views || 0} {tFn('forum.views')}</span>
						</div>
					</div>
				</div>

				<!-- Stats et dernier posteur -->
				<div class="flex items-center gap-4 shrink-0">
					<!-- Compteur de réponses -->
					<div class="flex flex-col items-center px-3 py-1.5 border border-white/[.06] group-hover:border-indigo-700/50 transition-colors min-w-[60px] text-center">
						<span class="text-lg font-bold text-indigo-400 leading-none">{thread.post_count}</span>
						<span class="text-[10px] text-gray-500 uppercase tracking-wider">{tFn('forum.replies_label')}</span>
					</div>

					<!-- Dernier posteur -->
					{#if lastPoster}
						<div class="flex items-center gap-2 pl-2 border-l border-gray-800">
							<div class="text-right hidden sm:block">
								<p class="text-[10px] text-gray-600">{tFn('forum.last_reply')}</p>
								<p class="text-xs font-medium text-gray-300">{lastPoster.author_username}</p>
								<p class="text-[9px] text-gray-700">{formatRelativeTime(lastPoster.created_at)}</p>
							</div>
							{#if lastPoster.author_avatar}
								<img src={lastPoster.author_avatar} alt="" class="w-8 h-8 rounded-full object-cover ring-1 ring-gray-700" />
							{:else}
								<div class="w-8 h-8 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold text-white">
									{lastPoster.author_username.charAt(0).toUpperCase()}
								</div>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Flèche -->
				<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-gray-700 group-hover:text-indigo-500 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
				</svg>
			</a>
		{/each}
	</div>

	<!-- PAGINATION PROFESSIONNELLE -->
	<div class="mt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
		<div class="text-sm text-gray-600 order-2 sm:order-1">
			{tFn('forum.showing', { from: String((currentPage - 1) * itemsPerPage + 1), to: String(Math.min(currentPage * itemsPerPage, filteredThreads.length)), total: String(filteredThreads.length) })}
		</div>
		
		<div class="flex items-center gap-1 order-1 sm:order-2">
			<!-- Page précédente -->
			<button
				onclick={() => goToPage(currentPage - 1)}
				disabled={currentPage === 1}
				class="w-9 h-9 bg-gray-800 text-gray-400 hover:text-white hover:bg-indigo-600
					   disabled:opacity-30 disabled:cursor-not-allowed transition-all
					   flex items-center justify-center"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
			</button>

			{#each { length: Math.min(5, totalPages) } as _, i}
				{@const pageNum = (() => {
					if (totalPages <= 5) return i + 1;
					if (currentPage <= 3) return i + 1;
					if (currentPage >= totalPages - 2) return totalPages - 4 + i;
					return currentPage - 2 + i;
				})()}
				<button
					onclick={() => goToPage(pageNum)}
					class="w-9 h-9 text-sm font-medium transition-all
						   {currentPage === pageNum
							   ? 'bg-indigo-600 text-white'
							   : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}"
				>
					{pageNum}
				</button>
			{/each}

			<!-- Page suivante -->
			<button
				onclick={() => goToPage(currentPage + 1)}
				disabled={currentPage === totalPages}
				class="w-9 h-9 bg-gray-800 text-gray-400 hover:text-white hover:bg-indigo-600
					   disabled:opacity-30 disabled:cursor-not-allowed transition-all
					   flex items-center justify-center"
			>
				<svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
				</svg>
			</button>
		</div>

		<!-- Sélecteur d'éléments par page -->
		<div class="flex items-center gap-2 order-3">
			<span class="text-xs text-gray-600 hidden sm:inline">{tFn('forum.display')}</span>
			<select
				bind:value={itemsPerPage}
				onchange={() => goToPage(1)}
				class="bg-gray-800 border border-gray-700 px-3 py-1.5 text-sm text-gray-300
					   focus:outline-none focus:border-indigo-500 cursor-pointer"
			>
				<option value="10">10 par page</option>
				<option value="20">20 par page</option>
				<option value="50">50 par page</option>
				<option value="100">100 par page</option>
			</select>
		</div>
	</div>
{/if}