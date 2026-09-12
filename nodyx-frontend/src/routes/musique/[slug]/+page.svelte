<script lang="ts">
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';

	const tFn = $derived($t);

	let { data }: { data: PageData } = $props();

	interface Category { id: string; slug: string; title: string; description: string | null; license_note: string | null; image_url: string | null }
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

<div class="mus-header">
	<a class="mus-back" href="/musique">← {tFn('music.title')}</a>
</div>

<div class="mus-body">
	<div class="mus-banner">
		{#if category.image_url}
			<img src={category.image_url} alt="" class="mus-banner-img" />
		{:else}
			<div class="mus-banner-fallback">
				<svg class="mus-banner-icon" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2z" />
				</svg>
			</div>
		{/if}
		<div class="mus-banner-text">
			<h1 class="mus-title">{category.title}</h1>
			{#if category.description}
				<p class="mus-desc">{category.description}</p>
			{/if}
			<span class="mus-badge">
				{tFn(tracks.length === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(tracks.length))}
			</span>
		</div>
	</div>

	{#if tracks.length === 0}
		<p class="mus-empty">{tFn('music.empty_category')}</p>
	{:else}
		<div class="mus-tracklist">
			{#each tracks as track, i (track.id)}
				<article class="mus-track" id={track.id}>
					<span class="mus-track-num">{i + 1}</span>
					{#if track.image_url ?? category.image_url}
						<img src={track.image_url ?? category.image_url} alt="" class="mus-track-thumb" />
					{/if}
					<div class="mus-track-main">
						<div class="mus-track-head">
							<p class="mus-track-title">{track.title}</p>
							<span class="mus-track-actions">
								{#if category.license_note}
									<a class="mus-share-btn" href={`/api/v1/music/categories/${category.id}/license.pdf`}>
										<svg class="mus-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 20h16" />
										</svg>
										{tFn('music.download_license')}
									</a>
								{/if}
								<button type="button" class="mus-share-btn" onclick={() => copyTrackLink(track.id)}>
									<svg class="mus-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										{#if copiedId === track.id}
											<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
										{:else}
											<path stroke-linecap="round" stroke-linejoin="round" d="M8.684 13.342a4 4 0 000-2.684m0 2.684a4 4 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a4 4 0 105.368-5.368 4 4 0 00-5.368 5.368zm0 6.684a4 4 0 105.368 5.368 4 4 0 00-5.368-5.368z" />
										{/if}
									</svg>
									{copiedId === track.id ? tFn('music.link_copied') : tFn('music.share_track')}
								</button>
							</span>
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
	.mus-header {
		position: sticky;
		top: 0;
		z-index: 20;
		background: rgba(9, 9, 15, 0.92);
		backdrop-filter: blur(16px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		padding: 16px 28px;
	}

	.mus-back {
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.45);
		text-decoration: none;
		transition: color 0.15s;
	}
	.mus-back:hover { color: var(--nx-accent-2-soft2); }

	.mus-body {
		padding: 24px 28px 48px;
	}

	/* ── Banner ───────────────────────────────────────────────────────────── */
	.mus-banner {
		display: flex;
		align-items: center;
		gap: 20px;
		padding-bottom: 24px;
		margin-bottom: 8px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}

	.mus-banner-img {
		flex: none;
		width: 96px;
		height: 96px;
		border-radius: 8px;
		object-fit: cover;
	}

	.mus-banner-fallback {
		flex: none;
		width: 96px;
		height: 96px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.03);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.mus-banner-icon {
		width: 32px;
		height: 32px;
		color: rgba(255, 255, 255, 0.15);
	}

	.mus-banner-text {
		min-width: 0;
	}

	.mus-title {
		font-size: 1.375rem;
		font-weight: 700;
		color: #fff;
		margin: 0 0 4px;
		letter-spacing: -0.01em;
	}

	.mus-desc {
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.4);
		max-width: 60ch;
		margin: 0 0 8px;
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

	.mus-empty {
		color: rgba(255, 255, 255, 0.4);
		font-size: 0.8125rem;
		font-style: italic;
	}

	/* ── Tracklist ────────────────────────────────────────────────────────── */
	.mus-tracklist {
		display: flex;
		flex-direction: column;
	}

	.mus-track {
		display: flex;
		align-items: flex-start;
		gap: 14px;
		padding: 14px 12px;
		margin: 0 -12px;
		border-radius: 10px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
		transition: background 0.15s;
	}
	.mus-track:hover {
		background: rgba(255, 255, 255, 0.025);
	}

	.mus-track-num {
		flex: none;
		width: 2ch;
		padding-top: 2px;
		font-size: 0.75rem;
		color: rgba(255, 255, 255, 0.3);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.mus-track-thumb {
		flex: none;
		width: 44px;
		height: 44px;
		border-radius: 6px;
		object-fit: cover;
	}

	.mus-track-main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.mus-track-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.mus-track-title {
		font-size: 0.9375rem;
		font-weight: 600;
		color: #fff;
		margin: 0;
	}

	.mus-track-actions {
		flex: none;
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.mus-share-btn {
		flex: none;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 20px;
		padding: 4px 10px 4px 8px;
		text-decoration: none;
		font-size: 0.6875rem;
		color: rgba(255, 255, 255, 0.45);
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.mus-share-btn:hover {
		color: var(--nx-accent-2-soft2);
		border-color: rgba(139, 92, 246, 0.4);
		background: rgba(139, 92, 246, 0.08);
	}

	.mus-icon {
		width: 12px;
		height: 12px;
		flex: none;
	}

	.mus-track-desc {
		font-size: 0.8125rem;
		color: rgba(255, 255, 255, 0.4);
		margin: 0;
	}

	@media (max-width: 560px) {
		.mus-banner { flex-direction: column; align-items: flex-start; }
		.mus-track-thumb { display: none; }
	}
</style>
