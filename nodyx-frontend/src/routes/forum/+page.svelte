<script lang="ts">
	import type { PageData } from './$types';
	import { page } from '$app/state';
	import { t, locale } from '$lib/i18n';
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
	const totMembers = $derived((page.data as any).memberCount ?? 0);

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
			<h1 class="text-2xl font-black text-[var(--nx-text)] tracking-tight">{tFn('nav.forum')}</h1>
			<p class="text-sm text-[var(--nx-text-muted)] mt-0.5">{tFn('forum.subtitle')}</p>
		</div>
		{#if user && (categories[0]?.slug ?? categories[0]?.id)}
			<a href="/forum/{categories[0]?.slug ?? categories[0]?.id}/new"
			   class="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black uppercase tracking-widest transition-colors">
				{tFn('forum.new_topic')}
			</a>
		{/if}
	</div>

	<div class="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_260px] gap-6">

		<!-- ── Catégories ────────────────────────────────────────────── -->
		<!-- @container : les colonnes secondaires (compteurs, dernier message)
		     s'affichent selon la largeur RÉELLE de la liste, pas celle de la
		     fenêtre. Entre les barres latérales, à 1440 px de fenêtre, la liste
		     ne fait que ~550 px : avec `lg:`, le dernier message (224 px) et les
		     compteurs écrasaient le nom sur 3 lignes de 28 px (11/10/2026). -->
		<div class="space-y-2 @container">
			{#each topLevel as cat}
			<div class="border border-[color-mix(in_srgb,var(--nx-text)_6%,transparent)] hover:border-[color-mix(in_srgb,var(--nx-text)_10%,transparent)] transition-colors"
			     style="background: color-mix(in srgb, var(--nx-text) 2.5%, transparent)">

				<!-- Catégorie principale -->
				<a href="/forum/{cat.slug ?? cat.id}"
				   class="flex items-center gap-4 px-5 py-4 group">

					<!-- Icône / emoji -->
					<div class="w-10 h-10 shrink-0 flex items-center justify-center text-xl
					            bg-[rgb(var(--nx-accent-rgb)/0.16)] border border-indigo-500/15">
						{cat.name?.match(/^\p{Emoji}/u)?.[0] ?? '💬'}
					</div>

					<!-- Infos -->
					<div class="flex-1 min-w-0">
						<h2 class="text-sm font-bold text-[var(--nx-text)] group-hover:text-[var(--nx-text)] transition-colors">
							{cat.name?.replace(/^\p{Emoji}\s*/u, '') || cat.name}
						</h2>
						{#if cat.description}
							<p class="text-xs text-[var(--nx-text-muted)] mt-0.5 line-clamp-1">{cat.description}</p>
						{/if}
					</div>

					<!-- Compteurs : sujets ET messages, comme sur un vrai index de forum -->
					<div class="hidden @lg:flex shrink-0 items-center gap-5 text-right">
						<div class="flex flex-col items-end w-12">
							<span class="text-sm font-bold text-[var(--nx-text)] tabular-nums">{cat.thread_count ?? 0}</span>
							<span class="text-[10px] text-[var(--nx-text-muted)] uppercase tracking-wide">{tFn('common.topics')}</span>
						</div>
						<div class="flex flex-col items-end w-12">
							<span class="text-sm font-bold text-[var(--nx-text-muted)] tabular-nums">{cat.post_count ?? 0}</span>
							<span class="text-[10px] text-[var(--nx-text-muted)] uppercase tracking-wide">messages</span>
						</div>
					</div>

					<!-- Dernier message : c'est LUI qui montre que le forum est vivant.
					     Sans, on ne voit que des portes ; avec, on voit ce qu'il y a derrière. -->
					<div class="hidden @3xl:flex shrink-0 w-56 items-center gap-2.5 pl-5
					            border-l border-[color-mix(in_srgb,var(--nx-text)_6%,transparent)]">
						{#if cat.last_post}
							{#if cat.last_post.avatar}
								<img src={cat.last_post.avatar} alt=""
								     class="w-8 h-8 rounded-full object-cover shrink-0"/>
							{:else}
								<div class="w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-[10px] font-black text-[var(--nx-text)]"
								     style="background: linear-gradient(135deg, var(--nx-accent-2-strong), var(--nx-cyan-deep))">
									{cat.last_post.username?.[0]?.toUpperCase() ?? '?'}
								</div>
							{/if}
							<div class="min-w-0 flex-1">
								<p class="truncate text-[11px] font-semibold text-[var(--nx-text)] group-hover:text-[var(--nx-text)] transition-colors">
									{cat.last_post.thread_title}
								</p>
								<p class="truncate text-[10px] text-[var(--nx-text-muted)]">
									{cat.last_post.username} · {timeAgo(cat.last_post.created_at)}
								</p>
							</div>
						{:else}
							<span class="text-[11px] text-[var(--nx-text-muted)]">{tFn('forum.no_message')}</span>
						{/if}
					</div>

					<svg class="w-4 h-4 shrink-0 text-[var(--nx-text-muted)] group-hover:text-[var(--nx-header-accent)] transition-colors"
					     fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
					</svg>
				</a>

				<!-- Sous-catégories -->
				{#if cat.children?.length > 0}
					<div class="border-t border-[color-mix(in_srgb,var(--nx-text)_5%,transparent)] divide-y divide-[color-mix(in_srgb,var(--nx-text)_3%,transparent)]">
						{#each cat.children as sub}
						<a href="/forum/{sub.slug ?? sub.id}"
						   class="flex items-center gap-4 px-5 py-3 group
						          hover:bg-[color-mix(in_srgb,var(--nx-text)_2%,transparent)] transition-colors">
							<div class="w-6 shrink-0 flex justify-center">
								<svg class="w-3 h-3 text-[var(--nx-text-muted)]" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
								</svg>
							</div>
							<div class="w-8 h-8 shrink-0 flex items-center justify-center text-base text-[var(--nx-text-muted)]
							            bg-[var(--nx-surface)]/50 border border-[color-mix(in_srgb,var(--nx-text)_4%,transparent)]">
								{sub.name?.match(/^\p{Emoji}/u)?.[0] ?? '›'}
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-xs font-semibold text-[var(--nx-text-muted)] group-hover:text-[var(--nx-text)] transition-colors">
									{sub.name?.replace(/^\p{Emoji}\s*/u, '') || sub.name}
								</p>
								{#if sub.description}
									<p class="text-[11px] text-[var(--nx-text-muted)] mt-0.5 line-clamp-1">{sub.description}</p>
								{/if}
							</div>
							<!-- Compteurs compacts : le sous-forum reste secondaire -->
							<div class="hidden @lg:flex shrink-0 items-center gap-5 text-right">
								<span class="w-12 text-xs font-bold text-[var(--nx-text-muted)] tabular-nums">{sub.thread_count ?? 0}</span>
								<span class="w-12 text-xs font-bold text-[var(--nx-text-muted)] tabular-nums">{sub.post_count ?? 0}</span>
							</div>
							<!-- Dernier message, en plus discret que le forum parent -->
							<div class="hidden @3xl:flex shrink-0 w-56 items-center gap-2 pl-5 border-l border-[color-mix(in_srgb,var(--nx-text)_4%,transparent)]">
								{#if sub.last_post}
									{#if sub.last_post.avatar}
										<img src={sub.last_post.avatar} alt="" class="w-6 h-6 rounded-full object-cover shrink-0"/>
									{:else}
										<div class="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[9px] font-black text-[var(--nx-text)]"
										     style="background: linear-gradient(135deg, var(--nx-accent-2-strong), var(--nx-cyan-deep))">
											{sub.last_post.username?.[0]?.toUpperCase() ?? '?'}
										</div>
									{/if}
									<div class="min-w-0 flex-1">
										<p class="truncate text-[10px] font-medium text-[var(--nx-text-muted)]">{sub.last_post.thread_title}</p>
										<p class="truncate text-[9px] text-[var(--nx-text-muted)]">{timeAgo(sub.last_post.created_at)}</p>
									</div>
								{/if}
							</div>
							<!-- Cale : le forum parent se termine par un chevron. Tout étant aligné
							     depuis le bord droit, sans cette cale de même largeur les colonnes
							     du sous-forum se décalent de 32px et ne tombent plus en face. -->
							<div class="w-4 shrink-0" aria-hidden="true"></div>
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
			<div class="border border-[color-mix(in_srgb,var(--nx-text)_6%,transparent)]" style="background: color-mix(in srgb, var(--nx-text) 2.5%, transparent)">
				<div class="px-4 py-3 border-b border-[color-mix(in_srgb,var(--nx-text)_5%,transparent)]">
					<span class="text-[10px] font-black uppercase tracking-[.15em] text-[var(--nx-text-muted)]">{tFn('forum.stats_title')}</span>
				</div>
				<div class="px-4 py-3 space-y-2">
					<div class="flex items-baseline justify-between">
						<span class="text-[11px] text-[var(--nx-text-muted)]">{tFn('common.topics')}</span>
						<span class="text-xs font-bold text-[var(--nx-text)] tabular-nums">{totThreads.toLocaleString($locale)}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-[11px] text-[var(--nx-text-muted)]">{tFn('forum.stats_messages')}</span>
						<span class="text-xs font-bold text-[var(--nx-text)] tabular-nums">{totPosts.toLocaleString($locale)}</span>
					</div>
					<div class="flex items-baseline justify-between">
						<span class="text-[11px] text-[var(--nx-text-muted)]">{tFn('common.members')}</span>
						<span class="text-xs font-bold text-[var(--nx-text)] tabular-nums">{totMembers.toLocaleString($locale)}</span>
					</div>
					{#if lastPoster}
						<div class="flex items-center justify-between gap-2 pt-2 border-t border-[color-mix(in_srgb,var(--nx-text)_5%,transparent)]">
							<span class="shrink-0 text-[11px] text-[var(--nx-text-muted)]">{tFn('forum.stats_last_post')}</span>
							<span class="truncate text-[11px] font-semibold" style="color: var(--nx-header-accent)">
								{lastPoster.username}
							</span>
						</div>
					{/if}
				</div>
			</div>

			<div class="border border-[color-mix(in_srgb,var(--nx-text)_6%,transparent)]" style="background: color-mix(in srgb, var(--nx-text) 2.5%, transparent)">
				<div class="flex items-center justify-between px-4 py-3 border-b border-[color-mix(in_srgb,var(--nx-text)_5%,transparent)]">
					<span class="text-[10px] font-black uppercase tracking-[.15em] text-[var(--nx-text-muted)]">{tFn('forum.recent_activity')}</span>
				</div>
				<div class="divide-y divide-[color-mix(in_srgb,var(--nx-text)_4%,transparent)]">
					{#each recentThreads.slice(0, 8) as thread, i}
					<a href="/forum/{thread.category_id}/{thread.id}"
					   class="flex items-start gap-3 px-4 py-3 hover:bg-[color-mix(in_srgb,var(--nx-text)_3%,transparent)] transition-colors group">
						<span class="text-[10px] font-black tabular-nums mt-0.5 shrink-0
						             {i === 0 ? 'text-[var(--nx-header-accent)]' : i === 1 ? 'text-[var(--nx-header-accent)]/70' : 'text-[var(--nx-text-muted)]'}">
							{String(i + 1).padStart(2, '0')}
						</span>
						<div class="flex-1 min-w-0">
							<p class="text-xs font-semibold text-[var(--nx-text-muted)] group-hover:text-[var(--nx-text)] transition-colors line-clamp-2 leading-snug">
								{thread.title}
							</p>
							<div class="flex items-center gap-1.5 mt-1">
								<span class="text-[10px] text-[var(--nx-text-muted)]">{thread.author_username}</span>
								<span class="text-[color-mix(in_srgb,var(--nx-text)_25%,transparent)]">·</span>
								<span class="text-[10px] text-[var(--nx-text-muted)]">{timeAgo(thread.created_at)}</span>
							</div>
						</div>
					</a>
					{:else}
						<div class="px-4 py-6 text-xs text-[var(--nx-text-muted)] text-center">{tFn('forum.no_activity')}</div>
					{/each}
				</div>
			</div>
		</aside>
	</div>
</div>
