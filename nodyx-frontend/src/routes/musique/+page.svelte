<script lang="ts">
	import { t } from '$lib/i18n';
	import type { PageData } from './$types';
	import { moodFor, sideLetter } from '$lib/music/mood';
	import MoodCanvas from '$lib/music/MoodCanvas.svelte';

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
		<p class="mus-eyebrow">{tFn('music.title')}</p>
		<h1 class="mus-hero-title">{tFn('music.subtitle')}</h1>
	</header>

	{#if categories.length === 0}
		<p class="mus-empty">{tFn('music.empty_project')}</p>
	{:else}
		<div class="mus-crate">
			{#each categories as category, i (category.id)}
				{@const mood = moodFor(category.title, i)}
				<a class="mus-sleeve" href={`/musique/${category.slug}`} style={`--mood: ${mood.accent}`}>
					<MoodCanvas seed={category.slug} wash={mood.wash} />
					<div class="mus-sleeve-side">{sideLetter(i)}</div>
					<div class="mus-sleeve-main">
						<div class="mus-sleeve-head">
							<h2 class="mus-sleeve-title">{category.title}</h2>
							{#if category.image_url}
								<span class="mus-label" style={`background-image:url('${category.image_url}')`}></span>
							{/if}
						</div>
						{#if category.description}
							<p class="mus-sleeve-desc">{category.description}</p>
						{/if}
						<p class="mus-sleeve-meta">
							{tFn('music.side_label')} {sideLetter(i)}
							<span class="mus-dot">·</span>
							{tFn(category.track_count === 1 ? 'music.track_count_one' : 'music.track_count_plural').replace('{{n}}', String(category.track_count))}
						</p>
					</div>
					<div class="mus-sleeve-arrow">→</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
	.mus-page {
		width: 100%;
		max-width: 1180px;
		margin: 0 auto;
		padding: 0 clamp(20px, 4vw, 48px) 96px;
		background: var(--mus-paper);
		color: var(--mus-ink);
	}

	/* ── Hero ─────────────────────────────────────────────────────────────── */
	.mus-hero {
		padding: 56px 0 44px;
	}

	.mus-eyebrow {
		font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
		font-size: 0.6875rem;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: var(--mus-ink-dim);
		margin: 0 0 14px;
	}

	.mus-hero-title {
		font-family: 'Fraunces', ui-serif, Georgia, serif;
		font-style: italic;
		font-weight: 900;
		font-size: clamp(2rem, 4.6vw, 3.4rem);
		line-height: 1.08;
		letter-spacing: -0.01em;
		max-width: 20ch;
		margin: 0;
		text-wrap: balance;
	}

	.mus-empty {
		color: var(--mus-ink-dim);
		font-size: 0.9rem;
		font-style: italic;
	}

	/* ── Crate ────────────────────────────────────────────────────────────── */
	.mus-crate {
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--mus-groove);
	}

	.mus-sleeve {
		position: relative;
		display: flex;
		align-items: center;
		gap: clamp(16px, 3vw, 40px);
		padding: clamp(28px, 4vw, 46px) 4px;
		border-bottom: 1px solid var(--mus-groove);
		text-decoration: none;
		color: var(--mus-ink);
		overflow: hidden;
		transition: padding-left 0.25s ease;
	}

	.mus-sleeve:hover {
		padding-left: 16px;
	}

	.mus-sleeve:hover .mus-sleeve-arrow {
		opacity: 1;
		transform: translateX(0);
	}

	.mus-sleeve-side {
		position: relative;
		flex: none;
		font-family: 'Fraunces', ui-serif, Georgia, serif;
		font-style: italic;
		font-weight: 900;
		font-size: clamp(3.2rem, 7vw, 5.5rem);
		line-height: 1;
		color: var(--mood, var(--mus-ink));
		opacity: 0.85;
		width: clamp(2.4ch, 6vw, 3.6ch);
		text-align: center;
	}

	.mus-sleeve-main {
		position: relative;
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.mus-sleeve-head {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.mus-sleeve-title {
		font-family: 'Fraunces', ui-serif, Georgia, serif;
		font-weight: 600;
		font-size: clamp(1.15rem, 2.2vw, 1.6rem);
		margin: 0;
		text-wrap: balance;
	}

	.mus-label {
		flex: none;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		background-size: cover;
		background-position: center;
		border: 1px solid var(--mus-groove);
		box-shadow: 0 0 0 3px var(--mus-paper);
	}

	.mus-sleeve-desc {
		font-size: 0.875rem;
		color: var(--mus-ink-dim);
		max-width: 62ch;
		margin: 0;
	}

	.mus-sleeve-meta {
		font-family: ui-monospace, 'JetBrains Mono', SFMono-Regular, Menlo, monospace;
		font-size: 0.6875rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--mood, var(--mus-ink-dim));
		opacity: 0.8;
		margin: 4px 0 0;
	}

	.mus-dot { color: var(--mus-groove); margin: 0 2px; }

	.mus-sleeve-arrow {
		position: relative;
		flex: none;
		font-size: 1.25rem;
		color: var(--mood, var(--mus-ink));
		opacity: 0;
		transform: translateX(-6px);
		transition: opacity 0.25s ease, transform 0.25s ease;
	}

	@media (max-width: 640px) {
		.mus-sleeve { gap: 14px; }
		.mus-sleeve-arrow { display: none; }
		.mus-label { display: none; }
	}
</style>
