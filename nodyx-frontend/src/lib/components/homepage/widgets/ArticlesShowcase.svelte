<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { t, locale } from '$lib/i18n'

	const tFn = $derived($t)
	const loc = $derived($locale)

	interface Article {
		id:              string
		slug:            string | null
		title:           string
		views:           number
		is_pinned:       boolean
		is_locked:       boolean
		created_at:      string
		category_id:     string
		category_slug:   string | null
		category_name:   string
		author_username: string
		author_avatar:   string | null
		post_count:      number
		cover_url:       string | null
		excerpt:         string
	}

	interface Props {
		config:    Record<string, unknown>
		instance?: Record<string, unknown>
		user?:     Record<string, unknown> | null
		title?:    string | null
	}

	let { config }: Props = $props()

	// ── Config ──
	const layout        = $derived((config.layout        as string)  ?? 'magazine')
	const cols          = $derived(Math.min(4, Math.max(2, Number(config.cols ?? 3))))
	const source        = $derived((config.source        as string)  ?? 'recent')
	const categoryFilter= $derived((config.category      as string)  ?? '')
	const pinnedOnly    = $derived((config.pinned_only   as boolean) ?? false)
	const count         = $derived(Math.min(20, Math.max(1, Number(config.count ?? 6))))
	const heading       = $derived((config.heading       as string)  ?? '')
	const subheading    = $derived((config.subheading    as string)  ?? '')
	const showExcerpt   = $derived((config.show_excerpt  as boolean) ?? true)
	const showAuthor    = $derived((config.show_author   as boolean) ?? true)
	const showDate      = $derived((config.show_date     as boolean) ?? true)
	const showCategory  = $derived((config.show_category as boolean) ?? true)
	const showViews     = $derived((config.show_views    as boolean) ?? false)
	const ctaText       = $derived((config.cta_text      as string)  ?? tFn('widgets.read_more'))
	const accent        = $derived((config.accent_color  as string)  ?? '#a78bfa')
	const aspectRatio   = $derived((config.aspect_ratio  as string)  ?? '16:9')
	const sliderAuto    = $derived((config.slider_autoplay as boolean) ?? true)
	const sliderDelay   = $derived(Math.max(3, Number(config.slider_delay_sec ?? 6)))

	let articles = $state<Article[]>([])
	let loading  = $state(true)

	async function loadArticles() {
		try {
			const params = new URLSearchParams({
				limit: String(count),
				order: source,
			})
			if (categoryFilter) params.append('category', categoryFilter)
			if (pinnedOnly)     params.append('pinned_only', 'true')

			const res = await fetch(`/api/v1/instance/threads/showcase?${params.toString()}`)
			if (res.ok) {
				const { threads } = await res.json() as { threads: Article[] }
				articles = threads
			}
		} catch { /* silent */ }
		loading = false
	}

	onMount(() => { if (browser) loadArticles() })

	// ── Helpers ──
	function timeAgo(dateStr: string): string {
		const min = (new Date(dateStr).getTime() - Date.now()) / 60000 // négatif = passé
		const rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto' })
		if (Math.abs(min) < 60)      return rtf.format(Math.round(min), 'minute')
		const h = min / 60
		if (Math.abs(h) < 24)        return rtf.format(Math.round(h), 'hour')
		const d = h / 24
		if (Math.abs(d) < 30)        return rtf.format(Math.round(d), 'day')
		const mo = d / 30
		if (Math.abs(mo) < 12)       return rtf.format(Math.round(mo), 'month')
		return rtf.format(Math.round(mo / 12), 'year')
	}

	function articleUrl(a: Article): string {
		const cat = a.category_slug ?? a.category_id
		const th  = a.slug ?? a.id
		return `/forum/${cat}/${th}`
	}

	const aspectPercent = $derived.by(() => {
		switch (aspectRatio) {
			case '21:9': return '42.85%'
			case '4:3':  return '75%'
			case '1:1':  return '100%'
			case '16:9':
			default:     return '56.25%'
		}
	})

	// ── Slider state ──
	let sliderIdx = $state(0)
	let sliderTimer: ReturnType<typeof setInterval> | null = null

	function startSlider() {
		stopSlider()
		if (!sliderAuto || articles.length < 2) return
		sliderTimer = setInterval(() => {
			sliderIdx = (sliderIdx + 1) % articles.length
		}, sliderDelay * 1000)
	}
	function stopSlider() {
		if (sliderTimer) { clearInterval(sliderTimer); sliderTimer = null }
	}
	function sliderNext() { sliderIdx = (sliderIdx + 1) % articles.length; startSlider() }
	function sliderPrev() { sliderIdx = (sliderIdx - 1 + articles.length) % articles.length; startSlider() }

	$effect(() => {
		if (layout === 'slider' && articles.length > 1) startSlider()
		else stopSlider()
	})

	onDestroy(() => stopSlider())

	// ── Derived slices per layout ──
	const magazineHero   = $derived(articles[0] ?? null)
	const magazineRest   = $derived(articles.slice(1, 5))
</script>

<div class="as-root" style="--accent:{accent}; --aspect:{aspectPercent}">

	{#if heading}
		<div class="as-header">
			<div class="as-header-title">
				<span class="as-header-bar"></span>
				<h2>{heading}</h2>
			</div>
			{#if subheading}<p class="as-subheading">{subheading}</p>{/if}
		</div>
	{/if}

	{#if loading}
		<div class="as-loading as-layout-{layout}">
			{#each Array(Math.min(count, 6)) as _}
				<div class="as-skeleton"></div>
			{/each}
		</div>

	{:else if articles.length === 0}
		<div class="as-empty">{tFn('widgets.no_articles')}</div>

	{:else if layout === 'magazine'}
		<!-- ─────────── MAGAZINE : 1 hero + 2x2 grid ─────────── -->
		<div class="as-magazine">
			{#if magazineHero}
				<a class="as-hero" href={articleUrl(magazineHero)}>
					<div class="as-hero-cover">
						{#if magazineHero.cover_url}
							<img src={magazineHero.cover_url} alt="" loading="lazy" />
						{:else}
							<div class="as-cover-placeholder" style="--cat:{accent}"></div>
						{/if}
						<div class="as-hero-gradient"></div>
						{#if showCategory}
							<span class="as-cat-badge as-cat-badge--hero">{magazineHero.category_name}</span>
						{/if}
					</div>
					<div class="as-hero-body">
						<h3 class="as-hero-title">{magazineHero.title}</h3>
						{#if showExcerpt && magazineHero.excerpt}
							<p class="as-hero-excerpt">{magazineHero.excerpt}</p>
						{/if}
						<div class="as-meta">
							{#if showAuthor}
								<span class="as-meta-author">{tFn('widgets.by')} <strong>{magazineHero.author_username}</strong></span>
							{/if}
							{#if showDate}<span class="as-meta-dot">·</span><span>{timeAgo(magazineHero.created_at)}</span>{/if}
							{#if showViews}<span class="as-meta-dot">·</span><span>{magazineHero.views} {tFn('widgets.views')}</span>{/if}
						</div>
						<span class="as-cta">{ctaText}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></span>
					</div>
				</a>
			{/if}

			{#if magazineRest.length}
				<div class="as-mag-grid">
					{#each magazineRest as a}
						<a class="as-card as-card--sm" href={articleUrl(a)}>
							<div class="as-card-cover">
								{#if a.cover_url}<img src={a.cover_url} alt="" loading="lazy" />{:else}<div class="as-cover-placeholder"></div>{/if}
								{#if showCategory}<span class="as-cat-badge">{a.category_name}</span>{/if}
							</div>
							<div class="as-card-body">
								<h4 class="as-card-title">{a.title}</h4>
								<div class="as-meta as-meta--sm">
									{#if showDate}<span>{timeAgo(a.created_at)}</span>{/if}
								</div>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		</div>

	{:else if layout === 'grid'}
		<!-- ─────────── GRID (2/3/4 cols) ─────────── -->
		<div class="as-grid" style="--cols:{cols}">
			{#each articles as a}
				<a class="as-card" href={articleUrl(a)}>
					<div class="as-card-cover">
						{#if a.cover_url}<img src={a.cover_url} alt="" loading="lazy" />{:else}<div class="as-cover-placeholder"></div>{/if}
						{#if showCategory}<span class="as-cat-badge">{a.category_name}</span>{/if}
					</div>
					<div class="as-card-body">
						<h3 class="as-card-title">{a.title}</h3>
						{#if showExcerpt && a.excerpt}<p class="as-card-excerpt">{a.excerpt}</p>{/if}
						<div class="as-meta as-meta--sm">
							{#if showAuthor}<span>{a.author_username}</span>{/if}
							{#if showAuthor && showDate}<span class="as-meta-dot">·</span>{/if}
							{#if showDate}<span>{timeAgo(a.created_at)}</span>{/if}
						</div>
						<span class="as-cta as-cta--sm">{ctaText}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></span>
					</div>
				</a>
			{/each}
		</div>

	{:else if layout === 'horizontal'}
		<!-- ─────────── HORIZONTAL : image gauche + texte droite ─────────── -->
		<div class="as-horizontal">
			{#each articles as a}
				<a class="as-horiz-item" href={articleUrl(a)}>
					<div class="as-horiz-cover">
						{#if a.cover_url}<img src={a.cover_url} alt="" loading="lazy" />{:else}<div class="as-cover-placeholder"></div>{/if}
					</div>
					<div class="as-horiz-body">
						{#if showCategory}<span class="as-cat-inline">{a.category_name}</span>{/if}
						<h3 class="as-horiz-title">{a.title}</h3>
						{#if showExcerpt && a.excerpt}<p class="as-horiz-excerpt">{a.excerpt}</p>{/if}
						<div class="as-meta as-meta--sm">
							{#if showAuthor}<span><strong>{a.author_username}</strong></span>{/if}
							{#if showAuthor && showDate}<span class="as-meta-dot">·</span>{/if}
							{#if showDate}<span>{timeAgo(a.created_at)}</span>{/if}
							{#if showViews}<span class="as-meta-dot">·</span><span>{a.views} {tFn('widgets.views')}</span>{/if}
						</div>
					</div>
					<span class="as-horiz-arrow" aria-hidden="true">→</span>
				</a>
			{/each}
		</div>

	{:else if layout === 'slider'}
		<!-- ─────────── SLIDER ─────────── -->
		<div class="as-slider"
		     onmouseenter={stopSlider}
		     onmouseleave={() => { if (sliderAuto) startSlider() }}
		     role="region" aria-label="Slider articles"
		>
			{#each articles as a, i}
				{#if i === sliderIdx}
					<a class="as-slide" href={articleUrl(a)}>
						<div class="as-slide-cover">
							{#if a.cover_url}<img src={a.cover_url} alt="" />{:else}<div class="as-cover-placeholder"></div>{/if}
							<div class="as-hero-gradient"></div>
						</div>
						<div class="as-slide-body">
							{#if showCategory}<span class="as-cat-badge as-cat-badge--hero">{a.category_name}</span>{/if}
							<h3 class="as-hero-title">{a.title}</h3>
							{#if showExcerpt && a.excerpt}<p class="as-hero-excerpt">{a.excerpt}</p>{/if}
							<div class="as-meta">
								{#if showAuthor}<span>{tFn('widgets.by')} <strong>{a.author_username}</strong></span>{/if}
								{#if showDate}<span class="as-meta-dot">·</span><span>{timeAgo(a.created_at)}</span>{/if}
							</div>
							<span class="as-cta">{ctaText}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg></span>
						</div>
					</a>
				{/if}
			{/each}

			{#if articles.length > 1}
				<button class="as-slide-btn as-slide-btn--prev" onclick={sliderPrev} aria-label={tFn('common.previous')}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
				</button>
				<button class="as-slide-btn as-slide-btn--next" onclick={sliderNext} aria-label={tFn('common.next')}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
				</button>

				<div class="as-slide-dots">
					{#each articles as _, i}
						<button class="as-slide-dot" class:is-active={i === sliderIdx}
						        onclick={() => { sliderIdx = i; startSlider() }}
						        aria-label="Slide {i + 1}"></button>
					{/each}
				</div>
			{/if}
		</div>

	{:else if layout === 'ticker'}
		<!-- ─────────── TICKER : défilement vertical lent ─────────── -->
		<div class="as-ticker">
			<div class="as-ticker-track">
				{#each [...articles, ...articles] as a}
					<a class="as-ticker-item" href={articleUrl(a)}>
						{#if a.cover_url}
							<div class="as-ticker-cover"><img src={a.cover_url} alt="" loading="lazy" /></div>
						{/if}
						<div class="as-ticker-body">
							{#if showCategory}<span class="as-cat-inline">{a.category_name}</span>{/if}
							<p class="as-ticker-title">{a.title}</p>
							{#if showDate}<span class="as-ticker-date">{timeAgo(a.created_at)}</span>{/if}
						</div>
					</a>
				{/each}
			</div>
		</div>

	{:else if layout === 'headlines'}
		<!-- ─────────── HEADLINES : titre-only style journal ─────────── -->
		<ol class="as-headlines">
			{#each articles as a, i}
				<li>
					<a class="as-headline" href={articleUrl(a)}>
						<span class="as-headline-num">{String(i + 1).padStart(2, '0')}</span>
						<div class="as-headline-body">
							{#if showCategory}<span class="as-cat-inline">{a.category_name}</span>{/if}
							<p class="as-headline-title">{a.title}</p>
							<div class="as-meta as-meta--sm">
								{#if showAuthor}<span>{a.author_username}</span>{/if}
								{#if showDate}<span class="as-meta-dot">·</span><span>{timeAgo(a.created_at)}</span>{/if}
								{#if showViews}<span class="as-meta-dot">·</span><span>{a.views} {tFn('widgets.views')}</span>{/if}
							</div>
						</div>
					</a>
				</li>
			{/each}
		</ol>

	{/if}
</div>

<style>
	.as-root {
		width: 100%;
		font-family: Inter, system-ui, sans-serif;
		color: #e2e8f0;
	}

	/* ─── Header ────────────────────────────────────────────────────────────── */
	.as-header { margin-bottom: 1.5rem; padding: 0 .5rem; }
	.as-header-title { display: flex; align-items: center; gap: .75rem; }
	.as-header-bar {
		display: inline-block; width: 4px; height: 22px;
		background: var(--accent);
	}
	.as-header h2 {
		font-family: 'Space Grotesk', sans-serif;
		font-size: 1.25rem; font-weight: 800;
		letter-spacing: -.01em;
		color: #fff;
		margin: 0;
	}
	.as-subheading { font-size: 13px; color: #6b7280; margin: .4rem 0 0 calc(4px + .75rem); }

	/* ─── Loading ───────────────────────────────────────────────────────────── */
	.as-loading { display: flex; flex-direction: column; gap: .75rem; }
	.as-loading.as-layout-grid, .as-loading.as-layout-magazine {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: .75rem;
	}
	.as-skeleton {
		height: 160px;
		background: linear-gradient(90deg, rgba(255,255,255,.04) 25%, rgba(255,255,255,.07) 50%, rgba(255,255,255,.04) 75%);
		background-size: 200% 100%;
		animation: as-shimmer 1.4s infinite;
	}
	@keyframes as-shimmer { to { background-position: -200% 0; } }

	.as-empty {
		padding: 2rem; text-align: center;
		font-size: 13px; color: #4b5563;
		background: rgba(255,255,255,.02);
		border: 1px solid rgba(255,255,255,.06);
	}

	/* ─── Common cover placeholder + badges ────────────────────────────────── */
	.as-cover-placeholder {
		width: 100%; height: 100%;
		background: linear-gradient(135deg, rgb(var(--nx-accent-2-rgb) / .15), rgba(14,116,144,.12));
		position: relative;
	}
	.as-cover-placeholder::after {
		content: ''; position: absolute; inset: 0;
		background: radial-gradient(circle at 30% 40%, var(--accent) 0%, transparent 60%);
		opacity: .15;
	}

	.as-cat-badge {
		position: absolute;
		top: .625rem; left: .625rem;
		padding: .2rem .5rem;
		font-size: 10px; font-weight: 800;
		text-transform: uppercase;
		letter-spacing: .15em;
		font-family: 'Space Grotesk', sans-serif;
		color: #fff;
		background: rgba(0,0,0,.6);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255,255,255,.1);
	}
	.as-cat-badge--hero { top: auto; bottom: 1rem; left: 1rem; padding: .35rem .75rem; background: var(--accent); border: 0; }
	.as-cat-inline {
		display: inline-block;
		font-size: 10px; font-weight: 800; letter-spacing: .15em;
		text-transform: uppercase;
		font-family: 'Space Grotesk', sans-serif;
		color: var(--accent);
		margin-bottom: .35rem;
	}

	.as-meta {
		display: flex; align-items: center; gap: .4rem; flex-wrap: wrap;
		font-size: 12px; color: #6b7280; margin-top: .5rem;
	}
	.as-meta--sm { font-size: 11px; margin-top: .35rem; }
	.as-meta strong { color: #cbd5e1; font-weight: 600; }
	.as-meta-dot { color: #374151; }

	.as-cta {
		display: inline-flex; align-items: center; gap: .4rem;
		font-size: 12px; font-weight: 700;
		font-family: 'Space Grotesk', sans-serif;
		text-transform: uppercase; letter-spacing: .12em;
		color: var(--accent);
		margin-top: .75rem;
		transition: gap .2s ease;
	}
	.as-cta--sm { font-size: 11px; margin-top: .5rem; }
	.as-cta svg { width: 12px; height: 12px; }
	a:hover .as-cta { gap: .75rem; }

	/* ─── MAGAZINE ─────────────────────────────────────────────────────────── */
	.as-magazine {
		display: grid;
		grid-template-columns: 1.5fr 1fr;
		gap: .75rem;
	}
	@media (max-width: 899px) { .as-magazine { grid-template-columns: 1fr; } }

	.as-hero {
		display: flex; flex-direction: column;
		background: rgba(255,255,255,.03);
		border: 1px solid rgba(255,255,255,.07);
		overflow: hidden;
		text-decoration: none; color: inherit;
		transition: border-color .2s, transform .2s;
	}
	.as-hero:hover { border-color: rgba(167,139,250,.4); }
	.as-hero-cover {
		position: relative; width: 100%;
		padding-top: var(--aspect);
		overflow: hidden;
		background: #0d0d12;
	}
	.as-hero-cover img {
		position: absolute; inset: 0; width: 100%; height: 100%;
		object-fit: cover;
		transition: transform .6s ease;
	}
	.as-hero:hover .as-hero-cover img { transform: scale(1.04); }
	.as-hero-cover .as-cover-placeholder { position: absolute; inset: 0; }
	.as-hero-gradient {
		position: absolute; inset: 0;
		background: linear-gradient(to bottom, transparent 40%, rgba(0,0,0,.75) 100%);
	}
	.as-hero-body { padding: 1.25rem 1.25rem 1.5rem; }
	.as-hero-title {
		font-family: 'Space Grotesk', sans-serif;
		font-size: 1.35rem; font-weight: 800;
		line-height: 1.25;
		color: #fff;
		margin: 0 0 .5rem;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.as-hero-excerpt {
		font-size: 13px; line-height: 1.55;
		color: #94a3b8; margin: 0;
		display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3;
		-webkit-box-orient: vertical; overflow: hidden;
	}

	.as-mag-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		grid-auto-rows: 1fr;
		gap: .75rem;
	}
	@media (max-width: 899px) {
		.as-mag-grid { grid-template-columns: 1fr 1fr; }
	}
	@media (max-width: 499px) {
		.as-mag-grid { grid-template-columns: 1fr; }
	}

	/* ─── CARD générique ───────────────────────────────────────────────────── */
	.as-card {
		display: flex; flex-direction: column;
		background: rgba(255,255,255,.03);
		border: 1px solid rgba(255,255,255,.07);
		overflow: hidden;
		text-decoration: none; color: inherit;
		transition: border-color .2s;
	}
	.as-card:hover { border-color: rgba(167,139,250,.4); }

	.as-card-cover {
		position: relative; width: 100%;
		padding-top: var(--aspect);
		overflow: hidden;
		background: #0d0d12;
	}
	.as-card-cover img {
		position: absolute; inset: 0; width: 100%; height: 100%;
		object-fit: cover;
		transition: transform .6s ease;
	}
	.as-card:hover .as-card-cover img { transform: scale(1.04); }
	.as-card-cover .as-cover-placeholder { position: absolute; inset: 0; }

	.as-card-body { padding: .875rem 1rem 1rem; flex: 1; display: flex; flex-direction: column; }
	.as-card-title {
		font-family: 'Space Grotesk', sans-serif;
		font-size: 15px; font-weight: 700;
		line-height: 1.3;
		color: #fff; margin: 0 0 .35rem;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.as-card--sm .as-card-title { font-size: 13px; }
	.as-card--sm .as-card-body  { padding: .625rem .75rem .75rem; }

	.as-card-excerpt {
		font-size: 12px; line-height: 1.5;
		color: #94a3b8; margin: 0;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}

	/* ─── GRID ─────────────────────────────────────────────────────────────── */
	.as-grid { display: grid; gap: .75rem; grid-template-columns: repeat(var(--cols), 1fr); }
	@media (max-width: 899px) { .as-grid { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 499px) { .as-grid { grid-template-columns: 1fr; } }

	/* ─── HORIZONTAL ───────────────────────────────────────────────────────── */
	.as-horizontal { display: flex; flex-direction: column; gap: .5rem; }

	.as-horiz-item {
		display: grid; grid-template-columns: 180px 1fr auto;
		gap: 1rem; align-items: center;
		background: rgba(255,255,255,.025);
		border: 1px solid rgba(255,255,255,.06);
		padding: .75rem;
		text-decoration: none; color: inherit;
		transition: border-color .2s, background .2s;
	}
	.as-horiz-item:hover {
		border-color: rgba(167,139,250,.35);
		background: rgba(167,139,250,.04);
	}
	.as-horiz-cover {
		width: 180px; height: 110px;
		position: relative; overflow: hidden;
		background: #0d0d12;
	}
	.as-horiz-cover img { width: 100%; height: 100%; object-fit: cover; transition: transform .5s; }
	.as-horiz-item:hover .as-horiz-cover img { transform: scale(1.05); }
	.as-horiz-body { min-width: 0; }
	.as-horiz-title {
		font-family: 'Space Grotesk', sans-serif;
		font-size: 16px; font-weight: 700; line-height: 1.3;
		color: #fff; margin: 0 0 .3rem;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.as-horiz-excerpt {
		font-size: 12px; color: #94a3b8; margin: 0 0 .35rem;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.as-horiz-arrow {
		color: var(--accent); font-size: 22px; padding-right: .5rem;
		transition: transform .2s;
	}
	.as-horiz-item:hover .as-horiz-arrow { transform: translateX(4px); }

	@media (max-width: 639px) {
		.as-horiz-item { grid-template-columns: 100px 1fr; }
		.as-horiz-item .as-horiz-arrow { display: none; }
		.as-horiz-cover { width: 100px; height: 90px; }
	}

	/* ─── SLIDER ───────────────────────────────────────────────────────────── */
	.as-slider {
		position: relative;
		background: rgba(255,255,255,.03);
		border: 1px solid rgba(255,255,255,.07);
		overflow: hidden;
	}
	.as-slide { display: block; text-decoration: none; color: inherit; }
	.as-slide-cover {
		position: relative; width: 100%;
		padding-top: var(--aspect);
		background: #0d0d12; overflow: hidden;
	}
	.as-slide-cover img {
		position: absolute; inset: 0;
		width: 100%; height: 100%; object-fit: cover;
		animation: as-kenburns 12s ease-out forwards;
	}
	.as-slide-cover .as-cover-placeholder { position: absolute; inset: 0; }
	@keyframes as-kenburns {
		from { transform: scale(1);     }
		to   { transform: scale(1.08);  }
	}
	.as-slide-body {
		padding: 1.25rem 1.5rem 1.75rem;
		position: relative;
	}

	.as-slide-btn {
		position: absolute; top: 50%;
		transform: translateY(-50%);
		width: 40px; height: 40px;
		display: flex; align-items: center; justify-content: center;
		background: rgba(0,0,0,.55);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255,255,255,.12);
		color: #fff; cursor: pointer;
		transition: background .2s, border-color .2s;
	}
	.as-slide-btn:hover { background: var(--accent); border-color: var(--accent); }
	.as-slide-btn--prev { left: .75rem; }
	.as-slide-btn--next { right: .75rem; }
	.as-slide-btn svg { width: 18px; height: 18px; }

	.as-slide-dots {
		position: absolute; bottom: .75rem; left: 50%;
		transform: translateX(-50%);
		display: flex; gap: .35rem;
	}
	.as-slide-dot {
		width: 8px; height: 8px; border-radius: 50%;
		background: rgba(255,255,255,.25); border: 0;
		cursor: pointer; padding: 0;
		transition: background .2s, transform .2s;
	}
	.as-slide-dot.is-active { background: var(--accent); transform: scale(1.3); }

	/* ─── TICKER ───────────────────────────────────────────────────────────── */
	.as-ticker {
		height: 340px; overflow: hidden; position: relative;
		mask: linear-gradient(to bottom, transparent 0%, #000 10%, #000 90%, transparent 100%);
	}
	.as-ticker-track {
		display: flex; flex-direction: column;
		animation: as-scroll 30s linear infinite;
	}
	.as-ticker:hover .as-ticker-track { animation-play-state: paused; }

	@keyframes as-scroll {
		from { transform: translateY(0);      }
		to   { transform: translateY(-50%);   }
	}

	.as-ticker-item {
		display: flex; align-items: center; gap: .75rem;
		padding: .75rem 1rem;
		border-bottom: 1px solid rgba(255,255,255,.05);
		text-decoration: none; color: inherit;
		transition: background .15s;
	}
	.as-ticker-item:hover { background: rgba(167,139,250,.05); }
	.as-ticker-cover {
		width: 56px; height: 56px; flex-shrink: 0;
		overflow: hidden;
	}
	.as-ticker-cover img { width: 100%; height: 100%; object-fit: cover; }
	.as-ticker-body { flex: 1; min-width: 0; }
	.as-ticker-title {
		font-size: 13px; font-weight: 600; color: #fff;
		margin: 0 0 .15rem;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}
	.as-ticker-date { font-size: 10px; color: #6b7280; }

	/* ─── HEADLINES ────────────────────────────────────────────────────────── */
	.as-headlines {
		list-style: none; padding: 0; margin: 0;
		border-top: 1px solid rgba(255,255,255,.06);
	}
	.as-headlines li { border-bottom: 1px solid rgba(255,255,255,.06); }

	.as-headline {
		display: grid; grid-template-columns: auto 1fr;
		gap: 1rem; align-items: center;
		padding: .9rem 1rem;
		text-decoration: none; color: inherit;
		transition: background .15s;
	}
	.as-headline:hover { background: rgba(167,139,250,.04); }

	.as-headline-num {
		font-family: 'Space Grotesk', sans-serif;
		font-size: 1.75rem; font-weight: 800;
		line-height: 1;
		color: var(--accent); opacity: .4;
		min-width: 2.2rem; text-align: right;
		transition: opacity .2s;
	}
	.as-headline:hover .as-headline-num { opacity: 1; }

	.as-headline-body { min-width: 0; }
	.as-headline-title {
		font-family: 'Space Grotesk', sans-serif;
		font-size: 15px; font-weight: 700;
		color: #fff; margin: .1rem 0;
		display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2;
		-webkit-box-orient: vertical; overflow: hidden;
	}
</style>
