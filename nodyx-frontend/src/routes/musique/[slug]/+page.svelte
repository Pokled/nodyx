<script lang="ts">
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';
	import { moodFor, sideLetter } from '$lib/music/mood';
	import MoodCanvas from '$lib/music/MoodCanvas.svelte';

	const tFn = $derived($t);

	let { data }: { data: PageData } = $props();

	interface Category { id: string; slug: string; title: string; description: string | null; image_url: string | null }
	interface Track { id: string; title: string; description: string | null; audio_url: string; image_url: string | null }

	const category = $derived(data.category as Category);
	const tracks   = $derived(data.tracks as Track[]);
	const index    = $derived(data.index as number);
	const mood     = $derived(moodFor(category.title, index));
	const side     = $derived(sideLetter(index));

	let openTrack = $state<string | null>(null);
	let copiedId  = $state<string | null>(null);

	function trackCode(i: number): string { return `${side}${i + 1}`; }

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

<div class="mus-page" style={`--mood: ${mood.accent}`}>
	<a class="mus-back" href="/musique">← {tFn('music.title')}</a>

	<header class="mus-sleeve-hero">
		<MoodCanvas seed={category.slug} wash={mood.wash} />
		<div class="mus-sleeve-hero-inner">
			{#if category.image_url}
				<span class="mus-label" style={`background-image:url('${category.image_url}')`}></span>
			{/if}
			<h1 class="mus-title">{category.title}</h1>
			{#if category.description}
				<p class="mus-desc">{category.description}</p>
			{/if}
			<p class="mus-meta">
				{tFn('music.side_label')} {side}
				<span class="mus-dot">·</span>
				{tFn(tracks.length === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(tracks.length))}
			</p>
		</div>
	</header>

	{#if tracks.length === 0}
		<p class="mus-empty">{tFn('music.empty_category')}</p>
	{:else}
		<div class="mus-tracklist">
			{#each tracks as track, i (track.id)}
				{@const isOpen = openTrack === track.id}
				<article class="mus-track" id={track.id} class:mus-track--open={isOpen}>
					<button type="button" class="mus-track-row" onclick={() => { openTrack = isOpen ? null : track.id; }}>
						<span class="mus-track-code">{trackCode(i)}</span>
						{#if track.image_url}
							<span class="mus-track-thumb" style={`background-image:url('${track.image_url}')`}></span>
						{/if}
						<span class="mus-track-info">
							<span class="mus-track-title">{track.title}</span>
							{#if track.description}
								<span class="mus-track-desc">{track.description}</span>
							{/if}
						</span>
						<span class="mus-track-toggle">{isOpen ? '−' : '▶'}</span>
					</button>

					{#if isOpen}
						<div class="mus-track-player">
							<nodyx-audio-player
								src={track.audio_url}
								track-title={track.title}
								cover={track.image_url ?? category.image_url ?? undefined}
								download="1"
							></nodyx-audio-player>
							<button type="button" class="mus-share-btn" onclick={() => copyTrackLink(track.id)}>
								{copiedId === track.id ? tFn('music.link_copied') : tFn('music.share_track')}
							</button>
						</div>
					{/if}
				</article>
			{/each}
		</div>
	{/if}
</div>

<style>
	.mus-page {
		width: 100%;
		max-width: 900px;
		margin: 0 auto;
		padding: 28px clamp(20px, 4vw, 48px) 96px;
		background: var(--mus-paper);
		color: var(--mus-ink);
	}

	.mus-back {
		display: inline-block;
		font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
		font-size: 0.75rem;
		letter-spacing: 0.06em;
		color: var(--mus-ink-dim);
		text-decoration: none;
		margin-bottom: 24px;
		transition: color 0.15s;
	}
	.mus-back:hover { color: var(--mood); }

	/* ── Hero sleeve ──────────────────────────────────────────────────────── */
	.mus-sleeve-hero {
		position: relative;
		border: 1px solid var(--mus-groove);
		background: var(--mus-paper-raised);
		padding: clamp(40px, 7vw, 72px) clamp(24px, 5vw, 48px);
		margin-bottom: 40px;
		overflow: hidden;
	}

	.mus-sleeve-hero-inner {
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 14px;
	}

	.mus-label {
		width: 84px;
		height: 84px;
		border-radius: 50%;
		background-size: cover;
		background-position: center;
		border: 1px solid var(--mus-groove);
		box-shadow: 0 0 0 6px var(--mus-paper);
		margin-bottom: 6px;
	}

	.mus-title {
		font-family: 'Fraunces', ui-serif, Georgia, serif;
		font-style: italic;
		font-weight: 900;
		font-size: clamp(2rem, 5vw, 3.4rem);
		line-height: 1.05;
		margin: 0;
		text-wrap: balance;
		max-width: 22ch;
	}

	.mus-desc {
		font-size: 0.9375rem;
		color: var(--mus-ink-dim);
		max-width: 60ch;
		margin: 0;
	}

	.mus-meta {
		font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
		font-size: 0.6875rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--mood);
		margin: 4px 0 0;
	}

	.mus-dot { color: var(--mus-groove); margin: 0 2px; }

	.mus-empty {
		color: var(--mus-ink-dim);
		font-size: 0.9rem;
		font-style: italic;
	}

	/* ── Tracklist ────────────────────────────────────────────────────────── */
	.mus-tracklist {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--mus-groove);
	}

	.mus-track {
		border-bottom: 1px solid var(--mus-groove);
		scroll-margin-top: 24px;
	}

	.mus-track-row {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 16px 4px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--mus-ink);
	}

	.mus-track--open .mus-track-row { color: var(--mood); }

	.mus-track-code {
		flex: none;
		font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
		font-size: 0.8125rem;
		color: var(--mus-ink-dim);
		width: 2.6ch;
	}

	.mus-track-thumb {
		flex: none;
		width: 40px;
		height: 40px;
		border-radius: 6px;
		background-size: cover;
		background-position: center;
	}

	.mus-track-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.mus-track-title {
		font-family: 'Fraunces', ui-serif, Georgia, serif;
		font-weight: 600;
		font-size: 1rem;
	}

	.mus-track-desc {
		font-size: 0.8125rem;
		color: var(--mus-ink-dim);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mus-track-toggle {
		flex: none;
		font-size: 0.875rem;
		color: var(--mus-ink-dim);
		width: 1.5em;
		text-align: center;
	}

	.mus-track-player {
		padding: 0 4px 20px 4ch;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
	}

	.mus-share-btn {
		background: none;
		border: 1px solid var(--mus-groove);
		color: var(--mus-ink-dim);
		font-size: 0.75rem;
		padding: 5px 10px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.mus-share-btn:hover { color: var(--mood); border-color: var(--mood); }

	@media (max-width: 560px) {
		.mus-track-thumb { display: none; }
	}
</style>
