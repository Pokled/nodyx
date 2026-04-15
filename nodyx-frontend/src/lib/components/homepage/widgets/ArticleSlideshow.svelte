<script lang="ts">
	import { onMount, onDestroy } from 'svelte'

	// ── Types ────────────────────────────────────────────────────────────────
	type SourceArticles = {
		type:        'articles'
		limit?:      number
		category_id?: string
	}
	type SourceVideo = {
		type:      'video'
		title:     string
		url:       string
		excerpt?:  string
		thumbnail?: string
		cta_url?:  string
		cta_text?: string
		label?:    string
	}
	type SourceCustom = {
		type:           'custom'
		title:          string
		image_url?:     string
		excerpt?:       string
		category_label?: string
		cta_url?:       string
		cta_text?:      string
	}
	type Source = SourceArticles | SourceVideo | SourceCustom

	interface Slide {
		title:          string
		imageUrl?:      string
		excerpt?:       string
		categoryLabel?: string
		authorUsername?: string
		authorAvatar?:  string
		createdAt?:     string
		href?:          string
		isVideo?:       boolean
		videoId?:       string
	}

	interface Props {
		config:    Record<string, unknown>
		instance?: Record<string, unknown>
		user?:     Record<string, unknown> | null
		title?:    string
	}

	let { config }: Props = $props()

	// ── Config parsing ───────────────────────────────────────────────────────
	const sources   = $derived((config.sources as Source[] | undefined) ?? ([{ type: 'articles', limit: 5 }] as Source[]))
	const slideMs   = $derived((config.slide_ms  as number | undefined)  ?? 6000)
	const height    = $derived((config.height    as string | undefined)  ?? '420px')
	const showExcerpt = $derived((config.show_excerpt as boolean | undefined) ?? true)

	// ── State ────────────────────────────────────────────────────────────────
	let slides      = $state<Slide[]>([])
	let loading     = $state(true)
	let slideIndex  = $state(0)
	let progressPct = $state(0)
	let slideTimer: ReturnType<typeof setInterval> | null = null
	let progressTimer: ReturnType<typeof setInterval> | null = null

	// ── YouTube helpers ──────────────────────────────────────────────────────
	function extractYoutubeId(url: string): string | null {
		const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/)
		return m?.[1] ?? null
	}
	function youtubeThumbnail(id: string): string {
		return `https://img.youtube.com/vi/${id}/maxresdefault.jpg`
	}

	// ── Fetch sources ────────────────────────────────────────────────────────
	async function fetchSlides() {
		loading = true
		const all: Slide[] = []

		for (const src of sources) {
			if (src.type === 'articles') {
				try {
					const limit = src.limit ?? 5
					const catParam = src.category_id ? `&category_id=${encodeURIComponent(src.category_id)}` : ''
					const res  = await fetch(`/api/v1/instance/threads/featured?limit=${limit}${catParam}`)
					if (res.ok) {
						const { articles } = await res.json() as { articles: any[] }
						for (const a of articles) {
							all.push({
								title:          a.title,
								imageUrl:        a.imageUrl   ?? undefined,
								excerpt:         a.excerpt    ?? undefined,
								categoryLabel:   a.categoryName ?? undefined,
								authorUsername:  a.authorUsername ?? undefined,
								authorAvatar:    a.authorAvatar   ?? undefined,
								createdAt:       a.createdAt  ?? undefined,
								href:            a.categoryId && a.id ? `/forum/${a.categoryId}/${a.id}` : undefined,
							})
						}
					}
				} catch { /* skip */ }

			} else if (src.type === 'video') {
				const videoId = extractYoutubeId(src.url)
				all.push({
					title:         src.title,
					imageUrl:      src.thumbnail || (videoId ? youtubeThumbnail(videoId) : undefined),
					excerpt:       src.excerpt,
					categoryLabel: src.label ?? 'Vidéo',
					isVideo:       true,
					videoId:       videoId ?? undefined,
					href:          src.cta_url || src.url,
				})

			} else if (src.type === 'custom') {
				all.push({
					title:         src.title,
					imageUrl:      src.image_url,
					excerpt:       src.excerpt,
					categoryLabel: src.category_label,
					href:          src.cta_url,
				})
			}
		}

		slides      = all
		slideIndex  = 0
		progressPct = 0
		loading     = false
		startTimers()
	}

	// ── Slideshow logic ──────────────────────────────────────────────────────
	function slideTo(i: number) {
		slideIndex  = ((i % slides.length) + slides.length) % slides.length
		progressPct = 0
	}
	function slideNext() { slideTo(slideIndex + 1) }
	function slidePrev() { slideTo(slideIndex - 1) }

	function startTimers() {
		if (slides.length < 2) return
		if (slideTimer)    clearInterval(slideTimer)
		if (progressTimer) clearInterval(progressTimer)
		progressPct    = 0
		slideTimer     = setInterval(slideNext, slideMs)
		progressTimer  = setInterval(() => {
			progressPct = Math.min(progressPct + 100 / (slideMs / 100), 100)
		}, 100)
	}

	// ── Lifecycle ────────────────────────────────────────────────────────────
	onMount(fetchSlides)
	onDestroy(() => {
		if (slideTimer)    clearInterval(slideTimer)
		if (progressTimer) clearInterval(progressTimer)
	})

	// ── Time helper ──────────────────────────────────────────────────────────
	function timeAgo(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime()
		const m = Math.floor(diff / 60000)
		if (m < 60)  return `${m}min`
		const h = Math.floor(m / 60)
		if (h < 24)  return `${h}h`
		return `${Math.floor(h / 24)}j`
	}
</script>

<div class="as-root" style="height: {height}">
	{#if loading}
		<div class="as-loading">
			<span class="as-spinner"></span>
		</div>

	{:else if slides.length === 0}
		<div class="as-empty">Aucun contenu à afficher</div>

	{:else}
		{@const slide = slides[slideIndex]}

		<!-- Background image -->
		{#key slideIndex}
			{#if slide.imageUrl}
				<img src={slide.imageUrl} alt="" class="as-bg sfade" />
			{:else}
				<div class="as-bg-fallback sfade"></div>
			{/if}
		{/key}

		<!-- Overlays -->
		<div class="as-overlay-l"></div>
		<div class="as-overlay-b"></div>
		<div class="as-glow"></div>

		<!-- Video play badge -->
		{#if slide.isVideo}
			<a
				href={slide.href}
				target="_blank"
				rel="noopener noreferrer"
				class="as-play"
				aria-label="Regarder la vidéo"
			>
				<svg viewBox="0 0 24 24" fill="currentColor">
					<path d="M8 5v14l11-7z"/>
				</svg>
			</a>
		{/if}

		<!-- Content -->
		<div class="as-content">
			{#if slide.categoryLabel}
				<div class="as-category">
					<span class="as-cat-line"></span>
					<span class="as-cat-text">{slide.categoryLabel}</span>
					{#if slide.isVideo}
						<span class="as-cat-badge">▶ Vidéo</span>
					{/if}
				</div>
			{/if}

			<h2 class="as-title">
				{#if slide.href && !slide.isVideo}
					<a href={slide.href}>{slide.title}</a>
				{:else}
					{slide.title}
				{/if}
			</h2>

			{#if showExcerpt && slide.excerpt}
				<p class="as-excerpt">{slide.excerpt}</p>
			{/if}

			<div class="as-meta">
				{#if slide.authorUsername}
					<div class="as-author">
						<div class="as-avatar">
							{#if slide.authorAvatar}
								<img src={slide.authorAvatar} alt="" />
							{:else}
								<span>{slide.authorUsername.charAt(0).toUpperCase()}</span>
							{/if}
						</div>
						<span class="as-author-name">{slide.authorUsername}</span>
						{#if slide.createdAt}
							<span class="as-dot">·</span>
							<span class="as-date">{timeAgo(slide.createdAt)}</span>
						{/if}
					</div>
				{/if}

				{#if slide.href}
					<a
						href={slide.href}
						target={slide.isVideo ? '_blank' : undefined}
						rel={slide.isVideo ? 'noopener noreferrer' : undefined}
						class="as-cta"
					>
						{slide.isVideo ? '▶ Regarder' : 'Lire'}
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
						</svg>
					</a>
				{/if}
			</div>

			<!-- Progress + nav -->
			{#if slides.length > 1}
				<div class="as-nav">
					<div class="as-dots">
						{#each slides as _, i}
							<button
								class="as-dot-btn"
								class:as-dot-btn--active={i === slideIndex}
								onclick={() => { slideTo(i); startTimers() }}
								aria-label="Slide {i+1}"
							>
								{#if i === slideIndex}
									<span class="as-progress" style="width:{progressPct}%"></span>
								{/if}
							</button>
						{/each}
					</div>
					<div class="as-arrows">
						<button class="as-arrow" onclick={() => { slidePrev(); startTimers() }} aria-label="Précédent">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/>
							</svg>
						</button>
						<button class="as-arrow" onclick={() => { slideNext(); startTimers() }} aria-label="Suivant">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
							</svg>
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* ── Root ──────────────────────────────────────────────────────────────── */
	.as-root {
		position: relative;
		width: 100%;
		overflow: hidden;
		background: #06060d;
	}

	/* ── Background ─────────────────────────────────────────────────────────── */
	.as-bg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: cover;
		opacity: .48;
	}
	.as-bg-fallback {
		position: absolute;
		inset: 0;
		background: linear-gradient(135deg, #12012c 0%, #020c1b 100%);
	}

	/* ── Overlays ───────────────────────────────────────────────────────────── */
	.as-overlay-l {
		position: absolute;
		inset: 0;
		background: linear-gradient(105deg, rgba(4,4,10,.96) 28%, rgba(4,4,10,.45) 65%, transparent 100%);
		pointer-events: none;
	}
	.as-overlay-b {
		position: absolute;
		inset: 0;
		background: linear-gradient(to top, rgba(4,4,10,.92) 12%, transparent 55%);
		pointer-events: none;
	}
	.as-glow {
		position: absolute;
		bottom: 0; left: 0;
		width: 320px; height: 200px;
		background: radial-gradient(ellipse at bottom left, rgba(124,58,237,.18), transparent 70%);
		pointer-events: none;
	}

	/* ── Loading / Empty ────────────────────────────────────────────────────── */
	.as-loading,
	.as-empty {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #374151;
		font-size: 13px;
	}
	.as-spinner {
		width: 24px; height: 24px;
		border: 2px solid rgba(167,139,250,.2);
		border-top-color: #a78bfa;
		border-radius: 50%;
		animation: spin .7s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg) } }

	/* ── Video play button ──────────────────────────────────────────────────── */
	.as-play {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 4;
	}
	.as-play svg {
		width: 64px; height: 64px;
		color: rgba(255,255,255,.85);
		background: rgba(124,58,237,.35);
		border-radius: 50%;
		padding: 14px;
		border: 2px solid rgba(124,58,237,.5);
		transition: transform .15s, background .15s;
		filter: drop-shadow(0 4px 24px rgba(124,58,237,.4));
	}
	.as-play:hover svg {
		transform: scale(1.08);
		background: rgba(124,58,237,.55);
	}

	/* ── Content ────────────────────────────────────────────────────────────── */
	.as-content {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		padding: 2rem 2rem 2.25rem;
		z-index: 5;
	}

	/* ── Category ───────────────────────────────────────────────────────────── */
	.as-category {
		display: flex;
		align-items: center;
		gap: .75rem;
		margin-bottom: .75rem;
	}
	.as-cat-line {
		height: 1px;
		width: 2.5rem;
		background: linear-gradient(to right, #7c3aed, #06b6d4);
		flex-shrink: 0;
	}
	.as-cat-text {
		font-size: 10px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: .22em;
		color: #a78bfa;
	}
	.as-cat-badge {
		font-size: 10px;
		font-weight: 700;
		color: #06b6d4;
		background: rgba(6,182,212,.12);
		border: 1px solid rgba(6,182,212,.25);
		padding: 1px 7px;
		border-radius: 3px;
	}

	/* ── Title ──────────────────────────────────────────────────────────────── */
	.as-title {
		font-size: clamp(1.25rem, 2.2vw, 1.85rem);
		font-weight: 800;
		color: #fff;
		line-height: 1.25;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		max-width: 680px;
		margin-bottom: .6rem;
		text-shadow: 0 2px 30px rgba(0,0,0,.9);
	}
	.as-title a {
		color: inherit;
		text-decoration: none;
		transition: color .15s;
	}
	.as-title a:hover { color: #c4b5fd; }

	/* ── Excerpt ────────────────────────────────────────────────────────────── */
	.as-excerpt {
		font-size: 13px;
		color: #6b7280;
		line-height: 1.6;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		overflow: hidden;
		max-width: 560px;
		margin-bottom: 1.1rem;
	}

	/* ── Meta row ───────────────────────────────────────────────────────────── */
	.as-meta {
		display: flex;
		align-items: center;
		gap: 1.25rem;
	}
	.as-author {
		display: flex;
		align-items: center;
		gap: .6rem;
	}
	.as-avatar {
		width: 28px; height: 28px;
		overflow: hidden;
		background: rgba(124,58,237,.3);
		outline: 1.5px solid rgba(124,58,237,.4);
		outline-offset: 1px;
		border-radius: 2px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.as-avatar img { width: 100%; height: 100%; object-fit: cover; }
	.as-avatar span { font-size: 11px; font-weight: 700; color: #fff; }
	.as-author-name { font-size: 13px; color: #9ca3af; }
	.as-dot { color: #374151; }
	.as-date { font-size: 13px; color: #6b7280; }

	.as-cta {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: .5rem;
		padding: .5rem 1.25rem;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: .1em;
		color: #fff;
		text-decoration: none;
		background: linear-gradient(135deg, rgba(124,58,237,.55), rgba(6,182,212,.25));
		border: 1px solid rgba(124,58,237,.45);
		transition: background .15s, border-color .15s;
		white-space: nowrap;
	}
	.as-cta:hover {
		background: linear-gradient(135deg, rgba(124,58,237,.75), rgba(6,182,212,.4));
		border-color: rgba(124,58,237,.7);
	}
	.as-cta svg { width: 14px; height: 14px; transition: transform .15s; }
	.as-cta:hover svg { transform: translateX(3px); }

	/* ── Navigation ─────────────────────────────────────────────────────────── */
	.as-nav {
		display: flex;
		align-items: center;
		gap: .75rem;
		margin-top: 1.5rem;
	}
	.as-dots {
		display: flex;
		align-items: center;
		gap: .5rem;
	}
	.as-dot-btn {
		position: relative;
		height: 2px;
		background: rgba(255,255,255,.15);
		border: none;
		padding: 0;
		cursor: pointer;
		transition: width .3s, opacity .3s;
		width: 16px;
		opacity: .3;
	}
	.as-dot-btn--active {
		width: 56px;
		opacity: 1;
	}
	.as-progress {
		position: absolute;
		top: -1px;
		left: 0;
		height: 4px;
		background: linear-gradient(to right, #7c3aed, #06b6d4);
		transition: none;
	}
	.as-arrows {
		margin-left: auto;
		display: flex;
		gap: 4px;
	}
	.as-arrow {
		width: 32px; height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border: 1px solid rgba(255,255,255,.08);
		background: transparent;
		color: #6b7280;
		cursor: pointer;
		transition: border-color .15s, color .15s;
		border-radius: 2px;
	}
	.as-arrow:hover {
		border-color: rgba(124,58,237,.5);
		color: #a78bfa;
	}
	.as-arrow svg { width: 14px; height: 14px; }

	/* ── Fade animation ─────────────────────────────────────────────────────── */
	:global(.sfade) {
		animation: sfade .45s ease;
	}
	@keyframes sfade {
		from { opacity: 0; }
		to   { opacity: 1; }
	}

	/* ── Responsive ─────────────────────────────────────────────────────────── */
	@media (max-width: 639px) {
		.as-content { padding: 1.25rem 1.25rem 1.5rem; }
		.as-cta { display: none; }
		.as-excerpt { display: none; }
	}
</style>
