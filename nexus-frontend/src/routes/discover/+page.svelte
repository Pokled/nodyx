<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let query    = $state(data.q ?? '');
	let type     = $state(data.type ?? 'all');
	let upcoming = $state(data.upcoming === 'true');
	let searching = $state(false);

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			day: '2-digit', month: 'short', year: 'numeric'
		});
	}
	function formatTime(iso: string) {
		return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
	}

	function threadUrl(r: any): string {
		const base     = r.instance_url.replace(/\/$/, '');
		const category = r.category_slug ?? r.category_id ?? '';
		const thread   = r.thread_slug ?? r.thread_id;
		return category ? `${base}/forum/${category}/${thread}` : `${base}/forum/${thread}`;
	}

	function eventUrl(r: any): string {
		return `${r.instance_url.replace(/\/$/, '')}/calendar/${r.content_id ?? r.thread_id}`;
	}

	function contentUrl(r: any): string {
		return r.content_type === 'event' ? eventUrl(r) : threadUrl(r);
	}

	function instanceDisplayUrl(url: string): string {
		try { return new URL(url).hostname; } catch { return url; }
	}

	async function search(e?: Event) {
		e?.preventDefault();
		searching = true;
		const params = new URLSearchParams();
		if (query)    params.set('q', query);
		if (type !== 'all') params.set('type', type);
		if (upcoming) params.set('upcoming', 'true');
		await goto(`/discover?${params}`, { keepFocus: true });
		searching = false;
	}

	// Filtres rapides pour les onglets
	const TABS = [
		{ id: 'all',    label: 'Tout' },
		{ id: 'thread', label: 'Discussions' },
		{ id: 'event',  label: 'Événements' },
	] as const;
</script>

<svelte:head>
	<title>Découvrir le réseau Nexus</title>
	<meta name="description" content="Recherchez du contenu sur toutes les instances du réseau Nexus." />
</svelte:head>

<!-- ── En-tête ─────────────────────────────────────────────────────────────── -->
<div class="relative mb-6 overflow-hidden rounded-2xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-900 to-violet-950/30 p-8 shadow-xl">
	<div class="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-violet-500/50 to-transparent"></div>
	<div class="absolute -top-20 -right-20 w-80 h-80 bg-violet-600/10 rounded-full blur-3xl"></div>

	<div class="relative">
		<div class="flex items-center gap-3 mb-3">
			<div class="w-9 h-9 rounded-lg bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-lg">🔭</div>
			<h1 class="text-2xl font-bold text-white">Découvrir le réseau</h1>
		</div>
		<p class="text-gray-400 text-sm mb-5">Recherchez du contenu sur toutes les instances Nexus connectées au réseau.</p>

		<!-- Barre de recherche -->
		<form onsubmit={search} class="flex gap-3 mb-5">
			<input
				type="text"
				bind:value={query}
				placeholder="Godot 4, audio Linux, Rust async..."
				class="flex-1 bg-gray-800/80 border border-gray-700 rounded-xl px-4 py-3 text-white placeholder-gray-500
				       text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/40 transition-colors"
				autofocus
			/>
			<button
				type="submit"
				disabled={searching}
				class="px-5 py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50
				       text-white text-sm font-semibold transition-colors flex items-center gap-2"
			>
				{#if searching}
					<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{:else}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
					</svg>
				{/if}
				Rechercher
			</button>
		</form>

		<!-- Onglets type de contenu -->
		<div class="flex items-center gap-1 flex-wrap">
			{#each TABS as tab}
				<a href="/discover?{new URLSearchParams({ ...(query ? { q: query } : {}), type: tab.id, ...(upcoming && tab.id === 'event' ? { upcoming: 'true' } : {}) })}"
				   class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
				          {data.type === tab.id || (tab.id === 'all' && !data.type)
				            ? 'bg-violet-600/30 text-violet-300 border border-violet-600/40'
				            : 'text-gray-400 hover:text-white hover:bg-gray-800 border border-transparent'}">
					{tab.label}
				</a>
			{/each}

			{#if data.type === 'event'}
				<!-- Filtre événements à venir -->
				<a href="/discover?{new URLSearchParams({ ...(query ? { q: query } : {}), type: 'event', ...(!upcoming ? { upcoming: 'true' } : {}) })}"
				   class="ml-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border
				          {upcoming
				            ? 'bg-emerald-600/20 text-emerald-300 border-emerald-600/40'
				            : 'text-gray-500 hover:text-white hover:bg-gray-800 border-gray-700'}">
					📅 À venir uniquement
				</a>
			{/if}
		</div>
	</div>
</div>

<!-- ── Erreur ──────────────────────────────────────────────────────────────── -->
{#if data.error}
	<div class="rounded-xl border border-red-800/50 bg-red-950/30 px-5 py-4 text-red-300 text-sm mb-6">
		{data.error}
	</div>
{/if}

<!-- ── Résultats ───────────────────────────────────────────────────────────── -->
{#if data.results.length > 0}
	<div class="mb-4 flex items-center justify-between">
		<p class="text-sm text-gray-500">
			{#if data.q}
				<span class="text-gray-300 font-medium">{data.results.length}</span> résultat{data.results.length > 1 ? 's' : ''} pour <span class="text-violet-400">« {data.q} »</span>
			{:else if data.type === 'event'}
				Événements du réseau
			{:else}
				Derniers threads publiés sur le réseau
			{/if}
		</p>
	</div>

	<div class="space-y-3">
		{#each data.results as result}
			<a
				href={contentUrl(result)}
				target="_blank"
				rel="noopener noreferrer"
				class="group flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900/50
				       px-5 py-4 hover:border-violet-700/50 hover:bg-gray-900/80
				       hover:shadow-lg hover:shadow-violet-600/5 transition-all"
			>
				<!-- Badges instance + type -->
				<div class="flex items-center gap-2 flex-wrap">
					<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium
					            bg-violet-950/60 border border-violet-800/40 text-violet-300">
						<svg class="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>
						{instanceDisplayUrl(result.instance_url)}
					</span>

					{#if result.content_type === 'event'}
						<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-950/60 border border-emerald-800/40 text-emerald-300">
							📅 Événement
						</span>
					{/if}

					{#if result.reply_count > 0 && result.content_type !== 'event'}
						<span class="text-xs text-gray-600">{result.reply_count} réponse{result.reply_count > 1 ? 's' : ''}</span>
					{/if}

					<span class="text-xs text-gray-700 ml-auto">
						{#if result.content_type === 'event' && result.starts_at}
							{formatDate(result.starts_at)}{#if !result.is_all_day} à {formatTime(result.starts_at)}{/if}
						{:else}
							{formatDate(result.updated_at)}
						{/if}
					</span>
				</div>

				<!-- Titre -->
				<h2 class="text-white font-semibold text-sm leading-snug group-hover:text-violet-200 transition-colors line-clamp-2 {result.is_cancelled ? 'line-through opacity-60' : ''}">
					{result.title}
				</h2>

				<!-- Lieu (events) -->
				{#if result.location}
					<p class="text-gray-600 text-xs flex items-center gap-1">
						<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
						</svg>
						{result.location}
					</p>
				{/if}

				<!-- Extrait -->
				{#if result.excerpt}
					<p class="text-gray-500 text-xs leading-relaxed line-clamp-2">{result.excerpt}</p>
				{/if}

				<!-- Tags -->
				{#if result.tags?.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each result.tags.slice(0, 5) as tag}
							<span class="px-2 py-0.5 rounded-full text-[11px] bg-gray-800 text-gray-400 border border-gray-700/50">{tag}</span>
						{/each}
					</div>
				{/if}
			</a>
		{/each}
	</div>

	<!-- Pagination -->
	{#if data.results.length === 20}
		<div class="mt-6 flex justify-center">
			<a
				href="/discover?{new URLSearchParams({
					...(data.q ? { q: data.q } : {}),
					...(data.type !== 'all' ? { type: data.type } : {}),
					...(data.upcoming ? { upcoming: data.upcoming } : {}),
					page: String(data.page + 1)
				})}"
				class="px-5 py-2.5 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-800
				       text-sm text-gray-300 hover:text-white transition-colors"
			>
				Page suivante →
			</a>
		</div>
	{/if}

{:else if !data.error}
	<div class="flex flex-col items-center justify-center py-20 text-center">
		<div class="w-16 h-16 rounded-2xl bg-gray-800/60 border border-gray-700/50 flex items-center justify-center text-3xl mb-4">
			{data.type === 'event' ? '📅' : '🔭'}
		</div>
		{#if data.q}
			<p class="text-gray-400 text-sm mb-1">Aucun résultat pour <span class="text-white">« {data.q} »</span></p>
			<p class="text-gray-600 text-xs">Essayez d'autres mots-clés ou attendez que plus d'instances rejoignent le réseau.</p>
		{:else}
			<p class="text-gray-400 text-sm mb-1">Aucun contenu indexé pour l'instant.</p>
			<p class="text-gray-600 text-xs">Les instances avec <code class="bg-gray-800 px-1 rounded">NEXUS_GLOBAL_INDEXING=true</code> apparaîtront ici.</p>
		{/if}
	</div>
{/if}
