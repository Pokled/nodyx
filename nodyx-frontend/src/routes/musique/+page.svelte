<script lang="ts">
	import { page } from '$app/state';
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);

	let { data }: { data: PageData } = $props();

	interface Category {
		id: string; slug: string; title: string; description: string | null;
		image_url: string | null; track_count: number; views: number;
	}
	interface Settings { title: string | null; subtitle: string | null; banner_url: string | null; }

	const categories = $derived(data.categories as Category[]);
	const settings   = $derived(data.settings as Settings | null);

	// Playlists YouTube (liens curés a la main, hors du pipeline d'upload) :
	// donnee statique par choix assume, cf SPECS/NODYX_MUSIQUE_PLAYLISTS_CDC.md.
	// Ajouter une playlist ici quand une nouvelle page existe sous
	// /musique/playlists/<slug>, sans toucher au backend.
	interface Playlist { slug: string; title: string; trackCount: number; heroYt: string; }
	const playlists: Playlist[] = [
		{ slug: 'rock-alternatif-2000s', title: 'Rock / Alternative - 2000s', trackCount: 50, heroYt: '5abamRO41fE' },
	];

	const pageTitle    = $derived(settings?.title    || tFn('music.title'));
	const pageSubtitle = $derived(settings?.subtitle || tFn('music.subtitle'));
	const totalTracks  = $derived(categories.reduce((sum, c) => sum + c.track_count, 0) + playlists.reduce((sum, p) => sum + p.trackCount, 0));

	// Discord/Twitter/Facebook exigent une URL absolue et n'exécutent aucun JS :
	// on résout ici, cote SSR, jamais via window.
	function absolutize(url: string | null | undefined, origin: string): string | null {
		if (!url) return null;
		if (/^https?:\/\//.test(url)) return url;
		return origin + url;
	}

	// Bannière de page → couverture de la première catégorie → bannière/logo de
	// la communauté → image par défaut du site. Toujours une seule og:image.
	const shareImage = $derived(
		absolutize(
			settings?.banner_url ?? categories[0]?.image_url ?? (page.data as any).communityBannerUrl ?? (page.data as any).communityLogoUrl,
			page.url.origin,
		) ?? `${page.url.origin}/og-image.jpg`,
	);

	const richDescription = $derived(
		categories.length > 0
			? `${pageSubtitle} · ${tFn(categories.length === 1 ? 'music.category_count_one' : 'music.category_count_plural').replace('{{n}}', String(categories.length))} · ${tFn(totalTracks === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(totalTracks))}`
			: pageSubtitle
	);
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={richDescription} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={richDescription} />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={page.url.href} />
	<meta property="og:image" content={shareImage} />
	<meta name="twitter:image" content={shareImage} />
	<meta property="og:site_name" content={(page.data as any).communityName ?? 'Nodyx'} />
</svelte:head>

{#if settings?.banner_url}
	<div class="mus-banner"><img src={settings.banner_url} alt="" class="mus-banner-img" /></div>
{/if}

<div class="mus-header">
	<div class="mus-header-row">
		<div>
			<h1 class="mus-title">{pageTitle}</h1>
			<p class="mus-subtitle">{pageSubtitle}</p>
		</div>
	</div>
</div>

<div class="mus-body">
	{#if playlists.length > 0}
		<section class="mus-section">
			<h2 class="mus-section-title">{tFn('music.section_playlists')}</h2>
			<div class="mus-grid mus-grid--compact">
				{#each playlists as playlist (playlist.slug)}
					<a class="mus-card" href={`/musique/playlists/${playlist.slug}`}>
						<div class="mus-card-thumb">
							<img src={`https://img.youtube.com/vi/${playlist.heroYt}/hqdefault.jpg`} alt="" class="mus-card-img" loading="lazy" />
							<span class="mus-card-play">
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
							</span>
						</div>
						<div class="mus-card-info">
							<p class="mus-card-name">{playlist.title}</p>
							<div class="mus-card-meta">
								<span class="mus-badge">
									{tFn(playlist.trackCount === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(playlist.trackCount))}
								</span>
							</div>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if categories.length > 0}
		<section class="mus-section">
			{#if playlists.length > 0}<h2 class="mus-section-title">{tFn('music.section_categories')}</h2>{/if}
			<div class="mus-grid">
				{#each categories as category (category.id)}
					<a class="mus-card" href={`/musique/${category.slug}`}>
						<div class="mus-card-thumb" class:mus-card-thumb--icon={!category.image_url}>
							{#if category.image_url}
								<img src={category.image_url} alt="" class="mus-card-img" loading="lazy" />
							{:else}
								<svg class="mus-card-fallback-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
								</svg>
							{/if}
							<span class="mus-card-play">
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
							</span>
						</div>
						<div class="mus-card-info">
							<p class="mus-card-name">{category.title}</p>
							{#if category.description}
								<p class="mus-card-desc">{category.description}</p>
							{/if}
							<div class="mus-card-meta">
								<span class="mus-badge">
									{tFn(category.track_count === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(category.track_count))}
								</span>
								{#if category.views > 0}
									<span class="mus-views">{tFn(category.views === 1 ? 'music.views_one' : 'music.views_plural').replace('{{n}}', String(category.views))}</span>
								{/if}
							</div>
						</div>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if categories.length === 0 && playlists.length === 0}
		<p class="mus-empty">{tFn('music.empty_project')}</p>
	{/if}
</div>

<style>
	.mus-banner {
		width: 100%;
		max-height: 280px;
		overflow: hidden;
	}
	.mus-banner-img {
		width: 100%;
		height: 100%;
		max-height: 280px;
		object-fit: cover;
		display: block;
	}

	.mus-header {
		position: sticky;
		top: 0;
		z-index: 20;
		background: rgba(9, 9, 15, 0.92);
		backdrop-filter: blur(16px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		padding: 20px 28px;
	}

	.mus-header-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.mus-title {
		font-size: 1.125rem;
		font-weight: 700;
		color: #fff;
		margin: 0 0 2px;
		letter-spacing: -0.01em;
	}

	.mus-subtitle {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.35);
		margin: 0;
	}

	.mus-body {
		padding: 24px 28px 48px;
	}

	.mus-empty {
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.8125rem;
	}

	.mus-section { margin-bottom: 32px; }
	.mus-section-title {
		font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: .06em;
		color: rgba(255, 255, 255, 0.4); margin: 0 0 12px;
	}

	/* ── Grid ─────────────────────────────────────────────────────────────── */
	.mus-grid {
		display: grid;
		/* auto-fit (pas auto-fill) : avec peu de catégories, les cartes
		   s'étirent pour occuper toute la largeur au lieu de laisser des
		   colonnes vides sur la droite. */
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
		gap: 1px;
		background: rgba(255, 255, 255, 0.04);
	}
	/* Section playlists : peu d'entrées prevues au depart (une seule au 19/09),
	   un etirement plein ecran d'une seule carte a l'air casse plutot que sobre.
	   auto-fill (pas auto-fit) + largeur plafonnee : la carte garde une taille
	   raisonnable, les colonnes vides restent juste invisibles. */
	.mus-grid--compact {
		grid-template-columns: repeat(auto-fill, minmax(220px, 320px));
	}

	.mus-card {
		display: block;
		background: rgba(9, 9, 15, 1);
		text-decoration: none;
		transition: background 0.15s;
		overflow: hidden;
	}

	.mus-card:hover {
		background: rgba(255, 255, 255, 0.03);
	}

	.mus-card:hover .mus-card-img {
		transform: scale(1.04);
	}

	.mus-card:hover .mus-card-play {
		opacity: 1;
		transform: scale(1);
	}

	.mus-card-thumb {
		/* 16/9 plutôt que carré : avec peu de catégories, une carte étirée par
		   auto-fit reste une belle bannière au lieu d'un carré démesuré. */
		position: relative;
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.03);
	}

	.mus-card-play {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.35);
		opacity: 0;
		transform: scale(0.85);
		transition: opacity 0.15s, transform 0.15s;
	}
	.mus-card-play svg {
		width: 40px;
		height: 40px;
		color: #fff;
		filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.5));
	}

	.mus-card-thumb--icon {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mus-card-fallback-icon {
		width: 28%;
		height: 28%;
		color: rgba(255, 255, 255, 0.15);
	}

	.mus-card-img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		transition: transform 0.2s;
	}

	.mus-card-info {
		padding: 10px 12px 12px;
	}

	.mus-card-name {
		font-size: 0.8125rem;
		font-weight: 600;
		color: #fff;
		margin: 0 0 3px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mus-card-desc {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.4);
		margin: 0 0 8px;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.mus-card-meta {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.mus-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 7px;
		font-size: 0.6875rem;
		font-weight: 500;
		border: 1px solid rgba(139, 92, 246, 0.25);
		background: rgba(139, 92, 246, 0.1);
		color: var(--nx-accent-2-soft2);
	}

	.mus-views {
		font-size: 0.6875rem;
		color: rgba(255, 255, 255, 0.3);
	}

</style>
