<script lang="ts">
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);

	let { data }: { data: PageData } = $props();

	let copiedSlug = $state<string | null>(null);

	function trackCountLabel(n: number): string {
		return n === 1 ? tFn('music.track_count_one').replace('{{n}}', String(n))
		                : tFn('music.track_count_plural').replace('{{n}}', String(n));
	}

	async function copyCategoryLink(slug: string) {
		const url = `${location.origin}${location.pathname}#${slug}`;
		try {
			await navigator.clipboard.writeText(url);
			copiedSlug = slug;
			setTimeout(() => { if (copiedSlug === slug) copiedSlug = null; }, 1800);
		} catch { /* clipboard indisponible (contexte non sécurisé, permission) : rien d'affiché */ }
	}

	const firstImage = $derived(
		data.projects.flatMap((p) => p.categories)
			.map((c) => c.image)
			.find((img): img is string => !!img) ?? null
	);
</script>

<svelte:head>
	<title>{tFn('music.page_title')}</title>
	<meta name="description" content={tFn('music.meta_desc')} />
	<meta property="og:title" content={tFn('music.page_title')} />
	<meta property="og:description" content={tFn('music.meta_desc')} />
	{#if firstImage}
		<meta property="og:image" content={firstImage} />
	{/if}
</svelte:head>

<div class="mus-page">
	<header class="mus-hero">
		<h1 class="mus-hero-title">{tFn('music.title')}</h1>
		<p class="mus-hero-subtitle">{tFn('music.subtitle')}</p>
	</header>

	{#if data.projects.length === 0}
		<p class="mus-empty">{tFn('music.empty_project')}</p>
	{/if}

	{#each data.projects as project (project.slug)}
		<section class="mus-project">
			<div class="mus-project-head">
				<h2 class="mus-project-title">{project.title}</h2>
				{#if project.description}
					<p class="mus-project-desc">{project.description}</p>
				{/if}
			</div>

			<div class="mus-categories">
				{#each project.categories as category (category.slug)}
					<article class="mus-category" id={category.slug}>
						<div
							class="mus-category-cover"
							style={category.image ? `background-image:url('${category.image}')` : ''}
						>
							{#if !category.image}
								<span class="mus-category-cover-fallback">{category.title}</span>
							{/if}
						</div>

						<div class="mus-category-body">
							<div class="mus-category-head">
								<h3 class="mus-category-title">{category.title}</h3>
								<button
									class="mus-share-btn"
									type="button"
									onclick={() => copyCategoryLink(category.slug)}
									title={tFn('music.share_category')}
									aria-label={tFn('music.share_category')}
								>
									{copiedSlug === category.slug ? tFn('music.link_copied') : '🔗'}
								</button>
							</div>

							{#if category.description}
								<p class="mus-category-desc">{category.description}</p>
							{/if}

							<p class="mus-track-count">{trackCountLabel(category.tracks.length)}</p>

							{#if category.tracks.length === 0}
								<p class="mus-empty-category">{tFn('music.empty_category')}</p>
							{:else}
								<div class="mus-tracks">
									{#each category.tracks as track, i (track.audio)}
										<div class="mus-track">
											<nodyx-audio-player
												src={track.audio}
												track-title={track.title}
												cover={track.cover ?? category.image ?? undefined}
												download="1"
											></nodyx-audio-player>
											{#if track.description}
												<p class="mus-track-desc">{track.description}</p>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					</article>
				{/each}
			</div>
		</section>
	{/each}
</div>

<style>
	.mus-page {
		max-width: 960px;
		margin: 0 auto;
		padding: 20px 28px 64px;
	}

	/* ── Hero ─────────────────────────────────────────────────────────────── */
	.mus-hero {
		padding: 28px 0 8px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		margin-bottom: 32px;
	}

	.mus-hero-title {
		font-size: 1.75rem;
		font-weight: 700;
		margin: 0 0 6px;
		background: linear-gradient(90deg, var(--nx-accent-2-soft), var(--nx-cyan-soft));
		-webkit-background-clip: text;
		background-clip: text;
		color: transparent;
	}

	.mus-hero-subtitle {
		font-size: 0.875rem;
		color: rgba(255, 255, 255, 0.45);
		margin: 0 0 20px;
		max-width: 56ch;
	}

	.mus-empty {
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.875rem;
	}

	/* ── Project ──────────────────────────────────────────────────────────── */
	.mus-project + .mus-project {
		margin-top: 56px;
	}

	.mus-project-head {
		margin-bottom: 20px;
	}

	.mus-project-title {
		font-size: 1.25rem;
		font-weight: 600;
		color: #fff;
		margin: 0 0 4px;
	}

	.mus-project-desc {
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.4);
		margin: 0;
	}

	/* ── Categories ───────────────────────────────────────────────────────── */
	.mus-categories {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.mus-category {
		display: flex;
		gap: 18px;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.06);
		scroll-margin-top: 24px;
	}

	.mus-category-cover {
		flex: none;
		width: 128px;
		min-height: 128px;
		background-size: cover;
		background-position: center;
		background-color: rgba(139, 92, 246, 0.08);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mus-category-cover-fallback {
		font-size: 0.6875rem;
		font-weight: 600;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: var(--nx-accent-2-soft2);
		text-align: center;
		padding: 8px;
	}

	.mus-category-body {
		flex: 1;
		min-width: 0;
		padding: 16px 18px 16px 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.mus-category-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.mus-category-title {
		font-size: 1rem;
		font-weight: 600;
		color: #fff;
		margin: 0;
	}

	.mus-share-btn {
		flex: none;
		background: none;
		border: 1px solid rgba(255, 255, 255, 0.1);
		color: rgba(255, 255, 255, 0.5);
		font-size: 0.6875rem;
		padding: 4px 9px;
		cursor: pointer;
		white-space: nowrap;
		transition: color 0.15s, border-color 0.15s;
	}

	.mus-share-btn:hover {
		color: var(--nx-accent-2-soft2);
		border-color: rgba(139, 92, 246, 0.4);
	}

	.mus-category-desc {
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.45);
		margin: 0;
	}

	.mus-track-count {
		font-size: 0.6875rem;
		color: rgba(255, 255, 255, 0.3);
		margin: 2px 0 4px;
	}

	.mus-empty-category {
		font-size: 0.8125rem;
		font-style: italic;
		color: rgba(255, 255, 255, 0.25);
		margin: 4px 0 0;
	}

	.mus-tracks {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.mus-track-desc {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.4);
		margin: 4px 0 0;
	}

	@media (max-width: 640px) {
		.mus-page { padding: 16px 16px 48px; }
		.mus-category { flex-direction: column; }
		.mus-category-cover { width: 100%; min-height: 96px; }
		.mus-category-body { padding: 14px; }
	}
</style>
