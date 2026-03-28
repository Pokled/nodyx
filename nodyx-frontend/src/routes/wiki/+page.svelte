<script lang="ts">
	import type { PageData } from './$types'
	import type { WikiPageSummary } from './+page.server'
	import { page } from '$app/stores'

	let { data }: { data: PageData } = $props()

	const isAdminOrMod = $derived(
		data.user?.role === 'admin' || data.user?.role === 'moderator'
	)

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
	}
</script>

<svelte:head>
	<title>Wiki — {data.communityName}</title>
</svelte:head>

<div class="flex flex-col gap-6 max-w-4xl mx-auto py-8 px-4">

	<!-- Header -->
	<div class="flex items-start justify-between gap-4">
		<div>
			<h1 class="text-2xl font-bold text-white flex items-center gap-2">
				<span>📖</span> Wiki
			</h1>
			<p class="text-sm text-gray-400 mt-1">Base de connaissances de la communauté.</p>
		</div>
		{#if isAdminOrMod}
			<a href="/wiki/new"
			   class="flex items-center gap-2 px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold transition-colors">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
				</svg>
				Nouvelle page
			</a>
		{/if}
	</div>

	<!-- Search + filters -->
	<div class="flex flex-wrap gap-3">
		<form method="GET" class="flex gap-2 flex-1 min-w-0">
			<input
				name="search"
				value={data.search}
				placeholder="Rechercher une page…"
				class="flex-1 min-w-0 bg-gray-900/60 border border-gray-700/60 rounded-xl px-4 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/60"
			/>
			{#if data.activeCategory}
				<input type="hidden" name="category" value={data.activeCategory} />
			{/if}
			<button type="submit"
			        class="px-4 py-2 rounded-xl bg-gray-800 text-gray-300 text-sm hover:bg-gray-700 transition-colors">
				Rechercher
			</button>
		</form>
	</div>

	<!-- Category pills -->
	{#if data.categories.length > 0}
		<div class="flex flex-wrap gap-2">
			<a href="/wiki"
			   class="text-xs px-3 py-1.5 rounded-full transition-colors
			          {!data.activeCategory ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}">
				Toutes
			</a>
			{#each data.categories as cat}
				<a href="/wiki?category={encodeURIComponent(cat)}"
				   class="text-xs px-3 py-1.5 rounded-full transition-colors
				          {data.activeCategory === cat ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white'}">
					{cat}
				</a>
			{/each}
		</div>
	{/if}

	<!-- Pages list -->
	{#if data.pages.length === 0}
		<div class="flex flex-col items-center justify-center py-20 text-center">
			<div class="text-5xl mb-4 opacity-30">📖</div>
			<p class="text-gray-500 text-sm">
				{data.search
					? `Aucune page ne correspond à « ${data.search} »`
					: 'Le wiki est encore vide.'}
			</p>
			{#if isAdminOrMod}
				<a href="/wiki/new" class="mt-4 text-violet-400 hover:text-violet-300 text-sm transition-colors">
					Créer la première page →
				</a>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			{#each data.pages as pg (pg.id)}
				<a href="/wiki/{pg.slug}"
				   class="group block bg-gray-900/50 border border-gray-800/60 rounded-xl p-4 hover:border-gray-700/80 hover:bg-gray-900/80 transition-all duration-150">

					<!-- Category badge -->
					{#if pg.category}
						<span class="text-[10px] font-semibold uppercase tracking-wider text-amber-500/80 mb-2 block">
							{pg.category}
						</span>
					{/if}

					<!-- Title -->
					<h2 class="text-sm font-semibold text-white group-hover:text-violet-300 transition-colors mb-1.5 leading-snug">
						{pg.title}
					</h2>

					<!-- Excerpt -->
					{#if pg.excerpt}
						<p class="text-xs text-gray-500 line-clamp-2 leading-relaxed mb-3">
							{pg.excerpt}
						</p>
					{/if}

					<!-- Meta -->
					<div class="flex items-center justify-between gap-2 text-[11px] text-gray-600">
						<div class="flex items-center gap-1.5">
							{#if pg.author_avatar}
								<img src={pg.author_avatar} alt="" class="w-4 h-4 rounded-full object-cover" />
							{:else}
								<div class="w-4 h-4 rounded-full bg-gray-700 flex items-center justify-center text-[8px] text-gray-400">
									{(pg.author_username ?? '?')[0].toUpperCase()}
								</div>
							{/if}
							<span>{pg.author_username ?? 'Inconnu'}</span>
						</div>
						<div class="flex items-center gap-2">
							<span>{formatDate(pg.updated_at)}</span>
							<span class="flex items-center gap-0.5">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
								</svg>
								{pg.views}
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>
