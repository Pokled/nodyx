<script lang="ts">
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);

	let { data }: { data: PageData } = $props();

	interface Category {
		id: string; slug: string; title: string; description: string | null;
		image_url: string | null; track_count: number;
	}
	interface Settings { title: string | null; subtitle: string | null; banner_url: string | null; }

	const categories = $derived(data.categories as Category[]);
	const settings   = $derived(data.settings as Settings | null);

	const pageTitle    = $derived(settings?.title    || tFn('music.title'));
	const pageSubtitle = $derived(settings?.subtitle || tFn('music.subtitle'));
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageSubtitle} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageSubtitle} />
	{#if settings?.banner_url ?? categories[0]?.image_url}
		<meta property="og:image" content={settings?.banner_url ?? categories[0].image_url} />
	{/if}
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
	{#if categories.length === 0}
		<p class="mus-empty">{tFn('music.empty_project')}</p>
	{:else}
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
					</div>
					<div class="mus-card-info">
						<p class="mus-card-name">{category.title}</p>
						{#if category.description}
							<p class="mus-card-desc">{category.description}</p>
						{/if}
						<span class="mus-badge">
							{tFn(category.track_count === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(category.track_count))}
						</span>
					</div>
				</a>
			{/each}
		</div>
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

	/* ── Grid ─────────────────────────────────────────────────────────────── */
	.mus-grid {
		display: grid;
		/* auto-fit (pas auto-fill) : avec peu de catégories, les cartes
		   s'étirent pour occuper toute la largeur au lieu de laisser des
		   colonnes vides sur la droite. */
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 1px;
		background: rgba(255, 255, 255, 0.04);
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

	.mus-card-thumb {
		/* 16/9 plutôt que carré : avec peu de catégories, une carte étirée par
		   auto-fit reste une belle bannière au lieu d'un carré démesuré. */
		aspect-ratio: 16 / 9;
		overflow: hidden;
		background: rgba(255, 255, 255, 0.03);
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
</style>
