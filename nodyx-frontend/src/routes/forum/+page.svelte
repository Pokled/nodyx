<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/stores';
	import { t } from '$lib/i18n';
	const tFn = $derived($t)

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
		if (m < 1)  return tFn('common.time.now');
		if (m < 60) return `${m}min`;
		if (h < 24) return `${h}h`;
		return `${d}${tFn('common.time.d')}`;
	}

	// Toutes les catégories racines + leurs enfants à plat
	const topLevel = $derived(categories.filter((c: any) => !c.parent_id));

	// ── Statistiques du forum ────────────────────────────────────────────────
	// Les totaux se déduisent des catégories DÉJÀ chargées (racines + enfants) :
	// aucun appel réseau supplémentaire. Le nombre de membres vient du layout,
	// qui interroge déjà /instance/info pour toute l'application.
	const allCats  = $derived([...topLevel, ...topLevel.flatMap((c: any) => c.children ?? [])]);
	const totThreads = $derived(allCats.reduce((n: number, c: any) => n + (c.thread_count ?? 0), 0));
	const totPosts   = $derived(allCats.reduce((n: number, c: any) => n + (c.post_count ?? 0), 0));
	const totMembers = $derived(($page.data as any).memberCount ?? 0);

	// Le membre le plus récemment actif sur le forum : c'est l'auteur du dernier
	// message toutes catégories confondues.
	const lastPoster = $derived(
		allCats
			.map((c: any) => c.last_post)
			.filter(Boolean)
			.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null
	);
</script>

<svelte:head>
	<title>Forum</title>
</svelte:head>

<div>

	<!-- ── Header ──────────────────────────────────────────────────────── -->
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-2xl font-black text-white tracking-tight">{tFn('nav.forum')}</h1>
			<p class="text-sm text-gray-500 mt-0.5">{tFn('forum.subtitle')}</p>
		</div>
		{#if user && (categories[0]?.slug ?? categories[0]?.id)}
			<a href="/forum/{categories[0]?.slug ?? categories[0]?.id}/new"
			   class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-widest transition-colors">
				{tFn('forum.new_topic')}
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

					<!-- Compteurs : sujets ET messages, comme sur un vrai index de forum -->
					<div class="hidden sm:flex shrink-0 items-center gap-5 text-right">
						<div class="flex flex-col items-end w-12">
							<span class="text-sm font-bold text-gray-300 tabular-nums">{cat.thread_count ?? 0}</span>
							<span class="text-[10px] text-gray-600 uppercase tracking-wide">{tFn('common.topics')}</span>
						</div>
						<div class="flex flex-col items-end w-12">
							<span class="text-sm font-bold text-gray-400 tabular-nums">{cat.post_count ?? 0}</span>
							<span class="text-[10px] text-gray-600 uppercase tracking-wide">messages</span>
						</div>
					</div>

					<!-- Dernier message : c'est LUI qui montre que le forum est vivant.
					     Sans, on ne voit que des portes ; avec, on voit ce qu'il y a derrière. -->
					<div class="hidden lg:flex shrink-0 w-56 items-center gap-2.5 pl-5
					            border-l border-white/[.06]">
						{#if cat.last_post}
							{#if cat.last_post.avatar}
								<img src={cat.last_post.avatar} alt=""
								     class="w-8 h-8 rounded-full object-cover shrink-0"/>
							{:else}
								<div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black text-white"
								     style="background: linear-gradient(135deg, var(--nx-accent-2-strong), var(--nx-cyan-deep))">
									{cat.last_post.username?.[0]?.toUpperCase() ?? '?'}
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-[11px] font-semibold text-gray-300 group-hover:text-white transition-colors">
									{cat.last_post.thread_title}
								</p>
								<p class="truncate text-[10px] text-gray-600">
									{cat.last_post.username} · {timeAgo(cat.last_post.created_at)}
								</p>
							</div>
						{:else}
							<span class="text-[11px] text-gray-700">Aucun message</span>
						{/if}
					</div>

					<svg class="w-4 h-4 shrink-0 text-gray-700 group-hover:text-indigo-400 transition-colors"
					     fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
					</svg>
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
							<!-- Compteurs compacts : le sous-forum reste secondaire -->
							<div class="hidden sm:flex shrink-0 items-center gap-5 text-right">
								<span class="w-12 text-xs font-bold text-gray-500 tabular-nums">{sub.thread_count ?? 0}</span>
								<span class="w-12 text-xs font-bold text-gray-600 tabular-nums">{sub.post_count ?? 0}</span>
							</div>
							<!-- Dernier message, en plus discret que le forum parent -->
							<div class="hidden lg:flex shrink-0 w-56 items-center gap-2 pl-5 border-l border-white/[.04]">
								{#if sub.last_post}
									{#if sub.last_post.avatar}
										<img src={sub.last_post.avatar} alt="" class="w-6 h-6 rounded-full object-cover shrink-0"/>
									{:else}
										<div class="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[9px] font-black text-white"
										     style="background: linear-gradient(135deg, var(--nx-accent-2-strong), var(--nx-cyan-deep))">
											{sub.last_post.username?.[0]?.toUpperCase() ?? '?'}
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<p class="truncate text-[10px] font-medium text-gray-500">{sub.last_post.thread_title}</p>
										<p class="truncate text-[9px] text-gray-700">{timeAgo(sub.last_post.created_at)}</p>
									</div>
								{/if}
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

			<!-- Statistiques : la carte d'identité du forum en un coup d'oeil.
			     Calculées depuis les données déjà chargées, aucun appel en plus. -->
			<div class="border border-white/[.06]" style="background: rgba(255,255,255,.025)">
				<div class="px-4 py-3 border-b border-white/5">
					<span class="text-[10px] font-black uppercase tracking-[.15em] text-gray-500">Statistiques</span>
				</div>
				<div class="px-4 py-3 space-y-2">
					<div class="flex items-baseline justify-between">
						<span class="text-[11px] text-gray-600">{tFn('common.topics')}</span>
						<span class="text-xs font-bold text-gray-300 tabular-nums">{totThreads.toLocaleString('fr-FR')}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-[11px] text-gray-600">Messages</span>
						<span class="text-xs font-bold text-gray-300 tabular-nums">{totPosts.toLocaleString('fr-FR')}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-[11px] text-gray-600">Membres</span>
						<span class="text-xs font-bold text-gray-300 tabular-nums">{totMembers.toLocaleString('fr-FR')}</span>
					</div>
					{#if lastPoster}
						<div class="flex items-center justify-between gap-2 pt-2 border-t border-white/[.05]">
							<span class="shrink-0 text-[11px] text-gray-600">Dernier message</span>
							<span class="truncate text-[11px] font-semibold" style="color: var(--nx-accent-2-soft)">
								{lastPoster.username}
							</span>
						</div>
					{/if}
				</div>
			</div>

			<div class="border border-white/[.06]" style="background: rgba(255,255,255,.025)">
				<div class="flex items-center justify-between px-4 py-3 border-b border-white/5">
					<span class="text-[10px] font-black uppercase tracking-[.15em] text-gray-500">{tFn('forum.recent_activity')}</span>
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
						<div class="px-4 py-6 text-xs text-gray-700 text-center">{tFn('forum.no_activity')}</div>
					{/each}
				</div>
			</div>
		</aside>
	</div>
</div>
