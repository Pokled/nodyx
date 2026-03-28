<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';

	let { data }: { data: PageData } = $props();

	const categories    = $derived((data as any).categories as any[] ?? []);
	const recentThreads = $derived((data as any).recentThreads as any[] ?? []);
	const user          = $derived((data as any).user as any);

	function timeAgo(dateStr: string): string {
		if (!dateStr) return '';
		const diff = Date.now() - new Date(dateStr).getTime();
		const m = Math.floor(diff / 60000);
		const h = Math.floor(m / 60);
		const d = Math.floor(h / 24);
		if (m < 1)  return 'maintenant';
		if (m < 60) return `${m}min`;
		if (h < 24) return `${h}h`;
		return `${d}j`;
	}

	// Toutes les catégories racines + leurs enfants à plat
	const topLevel = $derived(categories.filter((c: any) => !c.parent_id));
</script>

<svelte:head>
	<title>Forum</title>
</svelte:head>

<div class="max-w-5xl mx-auto px-4 sm:px-6 py-8">

	<!-- ── Header ──────────────────────────────────────────────────────── -->
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-2xl font-black text-white tracking-tight">Forum</h1>
			<p class="text-sm text-gray-500 mt-0.5">Discussions, guides et annonces de la communauté</p>
		</div>
		{#if user}
			<a href="/forum/{categories[0]?.slug ?? categories[0]?.id}/new"
			   class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-widest transition-colors">
				+ Nouveau sujet
			</a>
		{/if}
	</div>

	<div class="grid grid-cols-1 xl:grid-cols-[1fr_260px] gap-6">

		<!-- ── Catégories ────────────────────────────────────────────── -->
		<div class="space-y-2">
			{#each topLevel as cat}
			<div class="border border-white/[.06] hover:border-white/10 transition-colors"
			     style="background: rgba(255,255,255,.025)">

				<!-- Catégorie principale -->
				<a href="/forum/{cat.slug ?? cat.id}"
				   class="flex items-center gap-4 px-5 py-4 group">

					<!-- Icône / emoji -->
					<div class="w-10 h-10 shrink-0 flex items-center justify-center text-xl
					            bg-indigo-950/50 border border-indigo-500/15">
						{cat.name?.match(/^\p{Emoji}/u)?.[0] ?? '💬'}
					</div>

					<!-- Infos -->
					<div class="flex-1 min-w-0">
						<h2 class="text-sm font-bold text-gray-200 group-hover:text-white transition-colors">
							{cat.name?.replace(/^\p{Emoji}\s*/u, '') || cat.name}
						</h2>
						{#if cat.description}
							<p class="text-xs text-gray-600 mt-0.5 line-clamp-1">{cat.description}</p>
						{/if}
					</div>

					<!-- Stats -->
					<div class="flex items-center gap-6 shrink-0 text-right">
						<div class="hidden sm:flex flex-col items-end">
							<span class="text-sm font-bold text-gray-300 tabular-nums">{cat.thread_count ?? 0}</span>
							<span class="text-[10px] text-gray-600 uppercase tracking-wide">Sujets</span>
						</div>
						<svg class="w-4 h-4 text-gray-700 group-hover:text-indigo-400 transition-colors"
						     fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
						</svg>
					</div>
				</a>

				<!-- Sous-catégories -->
				{#if cat.children?.length > 0}
					<div class="border-t border-white/5 divide-y divide-white/[.03]">
						{#each cat.children as sub}
						<a href="/forum/{sub.slug ?? sub.id}"
						   class="flex items-center gap-4 px-5 py-3 group
						          hover:bg-white/[.02] transition-colors">
							<div class="w-6 shrink-0 flex justify-center">
								<svg class="w-3 h-3 text-gray-700" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
								</svg>
							</div>
							<div class="w-8 h-8 shrink-0 flex items-center justify-center text-base
							            bg-gray-900/50 border border-white/[.04]">
								{sub.name?.match(/^\p{Emoji}/u)?.[0] ?? '›'}
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-xs font-semibold text-gray-400 group-hover:text-gray-200 transition-colors">
									{sub.name?.replace(/^\p{Emoji}\s*/u, '') || sub.name}
								</p>
								{#if sub.description}
									<p class="text-[11px] text-gray-700 mt-0.5 line-clamp-1">{sub.description}</p>
								{/if}
							</div>
							<div class="shrink-0 text-right hidden sm:block">
								<span class="text-xs font-bold text-gray-500 tabular-nums">{sub.thread_count ?? 0}</span>
							</div>
						</a>
						{/each}
					</div>
				{/if}
			</div>
			{/each}
		</div>

		<!-- ── Sidebar : activité récente ────────────────────────────── -->
		<aside class="space-y-4">
			<div class="border border-white/[.06]" style="background: rgba(255,255,255,.025)">
				<div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
					<span class="text-[10px] font-black uppercase tracking-[.15em] text-gray-500">Activité récente</span>
				</div>
				<div class="divide-y divide-white/[.04]">
					{#each recentThreads.slice(0, 8) as thread, i}
					<a href="/forum/{thread.category_id}/{thread.id}"
					   class="flex items-start gap-3 px-4 py-3 hover:bg-white/[.03] transition-colors group">
						<span class="text-[10px] font-black tabular-nums mt-0.5 shrink-0
						             {i === 0 ? 'text-indigo-400' : i === 1 ? 'text-violet-400/60' : 'text-gray-700'}">
							{String(i + 1).padStart(2, '0')}
						</span>
						<div class="flex-1 min-w-0">
							<p class="text-xs font-semibold text-gray-400 group-hover:text-gray-200 transition-colors line-clamp-2 leading-snug">
								{thread.title}
							</p>
							<div class="flex items-center gap-1.5 mt-1">
								<span class="text-[10px] text-gray-600">{thread.author_username}</span>
								<span class="text-gray-800">·</span>
								<span class="text-[10px] text-gray-700">{timeAgo(thread.created_at)}</span>
							</div>
						</div>
					</a>
					{:else}
						<div class="px-4 py-6 text-xs text-gray-700 text-center">Aucune activité</div>
					{/each}
				</div>
			</div>
		</aside>
	</div>
</div>
