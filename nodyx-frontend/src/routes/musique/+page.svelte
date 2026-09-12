<script lang="ts">
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);

	let { data }: { data: PageData } = $props();

	interface Category {
		id: string; slug: string; title: string; description: string | null;
		image_url: string | null; track_count: number;
	}
	const categories = $derived(data.categories as Category[]);
</script>

<svelte:head>
	<title>{tFn('music.page_title')}</title>
	<meta name="description" content={tFn('music.meta_desc')} />
	<meta property="og:title" content={tFn('music.page_title')} />
	<meta property="og:description" content={tFn('music.meta_desc')} />
	{#if categories[0]?.image_url}
		<meta property="og:image" content={categories[0].image_url} />
	{/if}
</svelte:head>

<div class="mus-page">
	<header class="mus-hero">
		<h1 class="mus-hero-title">{tFn('music.title')}</h1>
		<p class="mus-hero-subtitle">{tFn('music.subtitle')}</p>
	</header>

	{#if categories.length === 0}
		<p class="mus-empty">{tFn('music.empty_project')}</p>
	{:else}
		<div class="mus-grid">
			{#each categories as category (category.id)}
				<a class="mus-card" href={`/musique/${category.slug}`}>
					<div
						class="mus-card-cover"
						style={category.image_url ? `background-image:url('${category.image_url}')` : ''}
					>
						{#if !category.image_url}
							<span class="mus-card-cover-fallback">{category.title}</span>
						{/if}
						<span class="mus-card-count">{tFn(category.track_count === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(category.track_count))}</span>
					</div>
					<div class="mus-card-body">
						<h2 class="mus-card-title">{category.title}</h2>
						{#if category.description}
							<p class="mus-card-desc">{category.description}</p>
						{/if}
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.mus-page {
		width: 100%;
		max-width: 1440px;
		margin: 0 auto;
		padding: 32px clamp(20px, 4vw, 56px) 72px;
	}

	/* ── Hero ─────────────────────────────────────────────────────────────── */
	.mus-hero {
		padding: 12px 0 32px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		margin-bottom: 32px;
	}

	.mus-hero-title {
		font-size: clamp(2rem, 3.2vw, 2.75rem);
		font-weight: 800;
		letter-spacing: -0.01em;
		margin: 0 0 8px;
		background: linear-gradient(90deg, #fff, var(--nx-accent-2-soft2));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.mus-hero-subtitle {
		font-size: 0.95rem;
		color: rgba(255, 255, 255, 0.45);
		margin: 0;
		max-width: 60ch;
	}

	.mus-empty {
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.9rem;
	}

	/* ── Grid ─────────────────────────────────────────────────────────────── */
	.mus-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
		gap: 22px;
	}

	.mus-card {
		display: flex;
		flex-direction: column;
		text-decoration: none;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.07);
		border-radius: 10px;
		overflow: hidden;
		transition: border-color 0.15s, transform 0.15s;
	}

	.mus-card:hover {
		border-color: rgba(139, 92, 246, 0.45);
		transform: translateY(-2px);
	}

	.mus-card-cover {
		position: relative;
		aspect-ratio: 1 / 1;
		background-size: cover;
		background-position: center;
		background-color: rgba(139, 92, 246, 0.1);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mus-card-cover-fallback {
		font-size: 0.8125rem;
		font-weight: 700;
		letter-spacing: 0.03em;
		color: var(--nx-accent-2-soft2);
		text-align: center;
		padding: 16px;
	}

	.mus-card-count {
		position: absolute;
		bottom: 8px;
		right: 8px;
		font-size: 0.6875rem;
		font-weight: 600;
		color: #fff;
		background: rgba(0, 0, 0, 0.55);
		backdrop-filter: blur(4px);
		padding: 3px 8px;
		border-radius: 20px;
	}

	.mus-card-body {
		padding: 14px 16px 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.mus-card-title {
		font-size: 1rem;
		font-weight: 700;
		color: #fff;
		margin: 0;
	}

	.mus-card-desc {
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.4);
		margin: 0;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
