<script lang="ts">
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);

	let { data }: { data: PageData } = $props();

	interface Category { id: string; slug: string; title: string; description: string | null; image_url: string | null }
	interface Track { id: string; title: string; description: string | null; audio_url: string; image_url: string | null }

	const category = $derived(data.category as Category);
	const tracks   = $derived(data.tracks as Track[]);

	let copiedId = $state<string | null>(null);

	async function copyTrackLink(id: string) {
		const url = `${location.origin}${location.pathname}#${id}`;
		try {
			await navigator.clipboard.writeText(url);
			copiedId = id;
			setTimeout(() => { if (copiedId === id) copiedId = null; }, 1800);
		} catch { /* clipboard indisponible : rien d'affiché */ }
	}
</script>

<svelte:head>
	<title>{category.title} · {tFn('music.title')}</title>
	<meta name="description" content={category.description ?? tFn('music.meta_desc')} />
	<meta property="og:title" content={category.title} />
	<meta property="og:description" content={category.description ?? tFn('music.meta_desc')} />
	{#if category.image_url}
		<meta property="og:image" content={category.image_url} />
	{/if}
</svelte:head>

<div class="mus-page">
	<a class="mus-back" href="/musique">← {tFn('music.title')}</a>

	<header
		class="mus-banner"
		style={category.image_url ? `background-image:linear-gradient(180deg, rgba(10,8,14,0.15), rgba(10,8,14,0.92)), url('${category.image_url}')` : ''}
	>
		<h1 class="mus-banner-title">{category.title}</h1>
		{#if category.description}
			<p class="mus-banner-desc">{category.description}</p>
		{/if}
	</header>

	{#if tracks.length === 0}
		<p class="mus-empty">{tFn('music.empty_category')}</p>
	{:else}
		<div class="mus-tracklist">
			{#each tracks as track (track.id)}
				<article class="mus-track" id={track.id}>
					<div
						class="mus-track-cover"
						style={(track.image_url ?? category.image_url) ? `background-image:url('${track.image_url ?? category.image_url}')` : ''}
					></div>
					<div class="mus-track-body">
						<div class="mus-track-head">
							<h3 class="mus-track-title">{track.title}</h3>
							<button
								class="mus-share-btn"
								type="button"
								onclick={() => copyTrackLink(track.id)}
								title={tFn('music.share_track')}
								aria-label={tFn('music.share_track')}
							>
								{copiedId === track.id ? tFn('music.link_copied') : '🔗'}
							</button>
						</div>
						{#if track.description}
							<p class="mus-track-desc">{track.description}</p>
						{/if}
						<nodyx-audio-player
							src={track.audio_url}
							track-title={track.title}
							cover={track.image_url ?? category.image_url ?? undefined}
							download="1"
						></nodyx-audio-player>
					</div>
				</article>
			{/each}
		</div>
	{/if}
</div>

<style>
	.mus-page {
		width: 100%;
		max-width: 1100px;
		margin: 0 auto;
		padding: 24px clamp(20px, 4vw, 56px) 72px;
	}

	.mus-back {
		display: inline-block;
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.45);
		text-decoration: none;
		margin-bottom: 20px;
		transition: color 0.15s;
	}
	.mus-back:hover { color: var(--nx-accent-2-soft2); }

	/* ── Banner ───────────────────────────────────────────────────────────── */
	.mus-banner {
		border-radius: 14px;
		padding: 48px 32px 32px;
		background-size: cover;
		background-position: center;
		background-color: rgba(139, 92, 246, 0.12);
		border: 1px solid rgba(255, 255, 255, 0.07);
		margin-bottom: 32px;
	}

	.mus-banner-title {
		font-size: clamp(1.75rem, 3vw, 2.5rem);
		font-weight: 800;
		color: #fff;
		margin: 0 0 8px;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
	}

	.mus-banner-desc {
		font-size: 0.9375rem;
		color: rgba(255, 255, 255, 0.7);
		max-width: 65ch;
		margin: 0;
	}

	.mus-empty {
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.9rem;
		font-style: italic;
	}

	/* ── Tracklist ────────────────────────────────────────────────────────── */
	.mus-tracklist {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.mus-track {
		display: flex;
		gap: 16px;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 10px;
		padding: 16px;
		scroll-margin-top: 24px;
	}

	.mus-track-cover {
		flex: none;
		width: 72px;
		height: 72px;
		border-radius: 8px;
		background-size: cover;
		background-position: center;
		background-color: rgba(139, 92, 246, 0.1);
	}

	.mus-track-body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.mus-track-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.mus-track-title {
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
	.mus-share-btn:hover { color: var(--nx-accent-2-soft2); border-color: rgba(139, 92, 246, 0.4); }

	.mus-track-desc {
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.45);
		margin: 0;
	}

	@media (max-width: 560px) {
		.mus-track { flex-direction: column; }
		.mus-track-cover { width: 100%; height: 140px; }
	}
</style>
