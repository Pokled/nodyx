<script lang="ts">
	import type { PageData } from './$types';
	import CategoryTree from '$lib/components/CategoryTree.svelte';

	let { data }: { data: PageData } = $props();

	const instance = $derived(data.instance);
	const categories = $derived(data.categories);
	const threads = $derived(data.threads);
	const articles = $derived(data.articles);

	// Language flag emoji from ISO code
	function flag(country: string): string {
		if (!country || country.length !== 2) return '🌐';
		return country
			.toUpperCase()
			.split('')
			.map(c => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
			.join('');
	}

	function timeAgo(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime();
		const m = Math.floor(diff / 60000);
		const h = Math.floor(m / 60);
		const d = Math.floor(h / 24);
		if (m < 1)  return 'à l\'instant';
		if (m < 60) return `il y a ${m} min`;
		if (h < 24) return `il y a ${h}h`;
		return `il y a ${d}j`;
	}

	function initials(username: string): string {
		return username.charAt(0).toUpperCase();
	}
</script>

<svelte:head>
	<title>{instance.name}</title>
	<meta name="description" content={instance.description} />
	<meta property="og:title"       content={instance.name} />
	<meta property="og:description" content={instance.description} />
	<meta property="og:type"        content="website" />
	<link rel="alternate" type="application/rss+xml" title="{instance.name} RSS" href="/rss.xml" />
	{@html `<script type="application/ld+json">${JSON.stringify({
		"@context": "https://schema.org",
		"@type": "WebSite",
		"name": instance.name,
		"description": instance.description,
		"inLanguage": instance.language,
	})}</script>`}
</svelte:head>

<!-- ── Hero ──────────────────────────────────────────────────────────────── -->
<section class="relative -mx-4 -mt-8 mb-10 px-6 py-12 overflow-hidden
                bg-gradient-to-br from-gray-900 via-gray-900 to-indigo-950
                border-b border-gray-800">

	<!-- Background pattern -->
	<div class="absolute inset-0 opacity-5"
	     style="background-image: radial-gradient(circle at 1px 1px, rgb(99 102 241) 1px, transparent 0); background-size: 32px 32px;"></div>

	<div class="relative max-w-5xl mx-auto">
		<!-- Community badges -->
		<div class="flex flex-wrap items-center gap-2 mb-4">
			<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
			             bg-indigo-900/60 text-indigo-300 border border-indigo-800/60">
				<span class="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
				Instance Nexus
			</span>
			{#if instance.language}
				<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium
				             bg-gray-800 text-gray-400 border border-gray-700">
					{flag(instance.country)} {instance.language.toUpperCase()}
					{#if instance.country} · {instance.country}{/if}
				</span>
			{/if}
		</div>

		<!-- Name + description -->
		<h1 class="text-4xl sm:text-5xl font-bold text-white tracking-tight leading-tight mb-3">
			{instance.name}
		</h1>
		{#if instance.description}
			<p class="text-lg text-gray-400 max-w-2xl leading-relaxed mb-8">
				{instance.description}
			</p>
		{/if}

		<!-- Stats row -->
		<div class="flex flex-wrap items-center gap-6 mb-8">
			<div class="flex items-center gap-2">
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
					      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0"/>
				</svg>
				<span class="text-sm text-gray-400">
					<span class="font-semibold text-white">{instance.member_count.toLocaleString('fr-FR')}</span>
					{instance.member_count > 1 ? 'membres' : 'membre'}
				</span>
			</div>

			<div class="flex items-center gap-2">
				<span class="w-2 h-2 rounded-full bg-green-400"></span>
				<span class="text-sm text-gray-400">
					<span class="font-semibold text-green-400">{instance.online_count}</span>
					en ligne
				</span>
			</div>

			<div class="flex items-center gap-2">
				<svg class="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
					      d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
				</svg>
				<span class="text-sm text-gray-400">
					<span class="font-semibold text-white">{instance.thread_count.toLocaleString('fr-FR')}</span>
					fils · <span class="font-semibold text-white">{instance.post_count.toLocaleString('fr-FR')}</span> messages
				</span>
			</div>
		</div>

		<!-- CTA buttons -->
		<div class="flex flex-wrap gap-3">
			{#if data.user}
				<a href="/users/{data.user.username}"
				   class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500
				          text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-900/30">
					Voir mon profil
				</a>
			{:else}
				<a href="/auth/register"
				   class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500
				          text-sm font-semibold text-white transition-colors shadow-lg shadow-indigo-900/30">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>
					</svg>
					Rejoindre la communauté
				</a>
				<a href="/auth/login"
				   class="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700
				          border border-gray-700 text-sm font-semibold text-gray-200 transition-colors">
					Se connecter
				</a>
			{/if}
		</div>
	</div>
</section>

<!-- ── Articles mis en avant ──────────────────────────────────────────────── -->
{#if articles.length > 0}
<section class="mb-10">
	<div class="flex items-center justify-between mb-5">
		<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
			Articles mis en avant
		</h2>
		<span class="text-xs text-gray-600">{articles.length} article{articles.length > 1 ? 's' : ''}</span>
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
		{#each articles as article}
			<a
				href="/forum/{article.categoryId}/{article.id}"
				class="group flex flex-col rounded-xl border border-gray-800 bg-gray-900/50
				       hover:border-indigo-800/60 hover:bg-gray-900/80 transition-all overflow-hidden"
			>
				<!-- Thumbnail -->
				<div class="relative h-40 w-full overflow-hidden bg-gray-800 shrink-0">
					{#if article.imageUrl}
						<img
							src={article.imageUrl}
							alt={article.title}
							class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
						/>
					{:else}
						<div class="w-full h-full bg-gradient-to-br from-indigo-900/60 to-purple-900/60
						            flex items-center justify-center">
							<svg class="w-10 h-10 text-indigo-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
								      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
							</svg>
						</div>
					{/if}
				</div>

				<!-- Content -->
				<div class="flex flex-col flex-1 p-4">
					<!-- Category badge -->
					<span class="mb-2 self-start text-xs font-medium px-2 py-0.5 rounded-full
					             bg-indigo-900/40 text-indigo-400 border border-indigo-800/50">
						{article.categoryName}
					</span>

					<!-- Title -->
					<h3 class="text-sm font-semibold text-gray-100 group-hover:text-white
					           line-clamp-2 leading-snug mb-2 transition-colors">
						{article.title}
					</h3>

					<!-- Excerpt -->
					<p class="text-xs text-gray-500 line-clamp-3 leading-relaxed flex-1">
						{article.excerpt}
					</p>

					<!-- Footer: author + date + CTA -->
					<div class="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 min-w-0">
							<div class="shrink-0 w-5 h-5 rounded-full bg-indigo-800 flex items-center
							            justify-center text-[10px] font-bold text-indigo-200">
								{initials(article.authorUsername)}
							</div>
							<span class="text-xs text-gray-500 truncate">
								{article.authorUsername} · {timeAgo(article.createdAt)}
							</span>
						</div>
						<span class="shrink-0 text-xs text-indigo-400 group-hover:text-indigo-300 font-medium
						             whitespace-nowrap transition-colors">
							Lire →
						</span>
					</div>
				</div>
			</a>
		{/each}
	</div>
</section>
{/if}

<!-- ── Main content ───────────────────────────────────────────────────────── -->
<div class="grid grid-cols-1 lg:grid-cols-5 gap-8">

	<!-- ── Left: Categories ──────────────────────────────────────────────── -->
	<div class="lg:col-span-3">
		<div class="flex items-center justify-between mb-4">
			<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
				Catégories
			</h2>
			<span class="text-xs text-gray-600">{categories.length} racine{categories.length > 1 ? 's' : ''}</span>
		</div>

		{#if categories.length === 0}
			<div class="rounded-lg border border-dashed border-gray-800 p-8 text-center">
				<p class="text-sm text-gray-600">Aucune catégorie pour le moment.</p>
			</div>
		{:else}
			<div class="rounded-xl border border-gray-800 bg-gray-900/50 divide-y divide-gray-800/60">
				{#each categories as cat, i}
					<div class="px-4 {i === 0 ? 'pt-2' : ''} {i === categories.length - 1 ? 'pb-2' : ''}">
						<CategoryTree categories={[cat]} depth={0} />
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- ── Right: Recent activity ─────────────────────────────────────────── -->
	<div class="lg:col-span-2 space-y-6">

		<!-- Recent threads -->
		<div>
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
					Activité récente
				</h2>
			</div>

			{#if threads.length === 0}
				<div class="rounded-lg border border-dashed border-gray-800 p-6 text-center">
					<p class="text-sm text-gray-600">Aucun fil pour le moment.</p>
				</div>
			{:else}
				<div class="space-y-2">
					{#each threads as thread}
						<a
							href="/forum/{thread.category_id}/{thread.id}"
							class="flex items-start gap-3 p-3 rounded-lg border border-gray-800/60 bg-gray-900/40
							       hover:border-indigo-800/60 hover:bg-gray-900/80 transition-all group"
						>
							<!-- Author avatar -->
							<div class="shrink-0 w-7 h-7 rounded-full bg-indigo-800 flex items-center justify-center
							            text-xs font-bold text-indigo-200 mt-0.5">
								{initials(thread.author_username)}
							</div>

							<!-- Content -->
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-gray-200 group-hover:text-white transition-colors
								          line-clamp-1 leading-snug">
									{thread.title}
								</p>
								<div class="flex items-center gap-2 mt-1">
									<span class="text-xs text-gray-600 px-1.5 py-0.5 rounded bg-gray-800/60">
										{thread.category_name}
									</span>
									<span class="text-xs text-gray-600">·</span>
									<span class="text-xs text-gray-600">
										{thread.post_count} msg
									</span>
									<span class="text-xs text-gray-600">·</span>
									<span class="text-xs text-gray-600">
										{timeAgo(thread.last_post_at ?? thread.created_at)}
									</span>
								</div>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Instance info card -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/30 p-4">
			<h3 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
				Cette instance
			</h3>
			<div class="space-y-2 text-xs text-gray-500">
				<div class="flex items-center justify-between">
					<span>Logiciel</span>
					<span class="text-gray-400 font-medium">Nexus</span>
				</div>
				<div class="flex items-center justify-between">
					<span>Réseau</span>
					<span class="text-indigo-400 font-medium">P2P Phase 1</span>
				</div>
				<div class="flex items-center justify-between">
					<span>Licence</span>
					<span class="text-gray-400 font-medium">AGPL-3.0</span>
				</div>
				{#if instance.slug}
					<div class="flex items-center justify-between">
						<span>Identifiant</span>
						<span class="text-gray-400 font-mono">{instance.slug}</span>
					</div>
				{/if}
			</div>
			<div class="mt-4 pt-3 border-t border-gray-800">
				<a href="https://github.com/Pokled/Nexus" target="_blank" rel="noopener"
				   class="text-xs text-gray-600 hover:text-indigo-400 transition-colors flex items-center gap-1.5">
					<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
						<path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
					</svg>
					Code source — AGPL-3.0
				</a>
			</div>
		</div>

	</div>
</div>
