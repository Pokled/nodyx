<script lang="ts">
	import type { PageData } from './$types';
	import { onMount, onDestroy } from 'svelte';
	import { fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { t } from '$lib/i18n';
	import WidgetZone from '$lib/components/homepage/WidgetZone.svelte';
	import GridRenderer from '$lib/components/homepage/GridRenderer.svelte';
	import type { HomepagePosition, GridLayout, GridTheme } from '$lib/types/homepage';
	const tFn = $derived($t)

	let { data }: { data: PageData } = $props();

	const instance     = $derived(data.instance);
	const threads      = $derived(data.threads);
	const articles     = $derived(data.articles);
	const publicEvents = $derived((data as any).publicEvents as any[] ?? []);
	const mods         = $derived((data as any).modules as Record<string, boolean> ?? {});
	const hpPositions      = $derived((data as any).homepagePositions as HomepagePosition[] ?? []);
	const user             = $derived((data as any).user ?? null);
	const installedWidgets = $derived((data as any).installedWidgets as Record<string, { entry: string }> ?? {});
	const gridLayout       = $derived((data as any).gridLayout as GridLayout | null ?? null);
	const gridTheme        = $derived((data as any).gridTheme as Partial<GridTheme> ?? {});
	const hasGrid          = $derived(gridLayout !== null && (gridLayout as GridLayout)?.rows?.length > 0);

	// Helper: get widgets for a position from homepage builder data
	function posWidgets(posId: string) {
		return hpPositions.find(p => p.id === posId)?.widgets ?? []
	}
	// Helper: is position active (has at least 1 enabled widget via the builder)
	function hasPos(posId: string): boolean {
		return posWidgets(posId).some(w => w.enabled)
	}

	// Helper: find a widget of a given type across ALL positions (DB-backed config)
	function findWidget<T = any>(type: string): T | null {
		for (const pos of hpPositions) {
			const w = pos.widgets?.find(w => w.widget_type === type && w.enabled)
			if (w) return (w.config ?? {}) as T
		}
		return null
	}

	// DB-backed Twitch config (from twitch-stream widget in homepage_widgets)
	const twitchConfig = $derived(findWidget<{ channel?: string; layout?: string; height?: number; show_header?: boolean }>('twitch-stream'))
	const twitchChannel = $derived(twitchConfig?.channel ?? null)

	// Wifi-signal level (1-4 bars) from a count — used for community stats
	function signalLevel(n: number): number {
		if (n <= 0)   return 0
		if (n < 10)   return 1
		if (n < 50)   return 2
		if (n < 200)  return 3
		return 4
	}

	function timeAgo(dateStr: string): string {
		if (!dateStr) return '';
		const diff = Date.now() - new Date(dateStr).getTime();
		const m = Math.floor(diff / 60000);
		const h = Math.floor(m / 60);
		const d = Math.floor(h / 24);
		if (m < 1)  return tFn('common.time.now');
		if (m < 60) return `${m}min`;
		if (h < 24) return `${h}h`;
		return `${d}${tFn('common.time.d')}`;
	}

	// ── Slideshow ──────────────────────────────────────────────────────────
	const slideArticles = $derived(articles.length > 0 ? articles : []);
	let slideIndex  = $state(0);
	let progressPct = $state(0);
	let slideTimer: ReturnType<typeof setInterval> | null = null;
	let progressTimer: ReturnType<typeof setInterval> | null = null;
	let isAnimating = $state(false);
	const SLIDE_MS = 6000;

	function slideTo(i: number) {
		if (isAnimating) return;
		isAnimating = true;
		slideIndex  = ((i % slideArticles.length) + slideArticles.length) % slideArticles.length;
		progressPct = 0;
		setTimeout(() => { isAnimating = false; }, 400);
	}
	function slideNext() { slideTo(slideIndex + 1); }
	function slidePrev() { slideTo(slideIndex - 1); }
	function startTimers() {
		if (slideArticles.length < 2) return;
		if (slideTimer)    clearInterval(slideTimer);
		if (progressTimer) clearInterval(progressTimer);
		progressPct = 0;
		slideTimer    = setInterval(slideNext, SLIDE_MS);
		progressTimer = setInterval(() => {
			progressPct = Math.min(progressPct + 100 / (SLIDE_MS / 100), 100);
		}, 100);
	}
	onMount(startTimers);
	onDestroy(() => {
		if (slideTimer)    clearInterval(slideTimer);
		if (progressTimer) clearInterval(progressTimer);
	});

	const recentThreads   = $derived(threads.slice(0, 5));
	const featuredThreads = $derived(threads.slice(0, 6));
	const heroArticle     = $derived(articles[0] ?? null);
	const restArticles    = $derived(articles.slice(1, 7));
	const heroLetter      = $derived(instance.name?.charAt(0).toUpperCase() ?? 'N');
const categories      = $derived((data as any).categories as any[] ?? []);

	// Social links (hardcoded platform set — consistent across all instances)
	const SOCIAL_LINKS = [
		{ type: "discord", color: "#5865f2", path: "M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" },
		{ type: "tiktok", color: "#e2e8f0", path: "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" },
		{ type: "mastodon", color: "#6364ff", path: "M23.268 5.313c-.35-2.578-2.617-4.61-5.304-5.004C17.51.242 15.792 0 11.813 0h-.03c-3.98 0-4.835.242-5.288.309C3.882.692 1.496 2.518.917 5.127.64 6.412.61 7.837.661 9.143c.074 1.874.088 3.745.26 5.611.118 1.24.325 2.47.62 3.68.55 2.237 2.777 4.098 4.96 4.857 2.336.792 4.849.923 7.256.38.265-.061.527-.132.786-.213.585-.184 1.27-.39 1.774-.753a.057.057 0 0 0 .023-.043v-1.809a.052.052 0 0 0-.02-.041.053.053 0 0 0-.046-.01 20.282 20.282 0 0 1-4.709.545c-2.73 0-3.463-1.284-3.674-1.818a5.593 5.593 0 0 1-.319-1.433.053.053 0 0 1 .066-.054c1.517.363 3.072.546 4.632.546.376 0 .75 0 1.125-.01 1.57-.044 3.224-.124 4.768-.422.038-.008.077-.015.11-.024 2.435-.464 4.753-1.92 4.989-5.604.008-.145.03-1.52.03-1.67.002-.512.167-3.63-.024-5.545zm-3.748 9.195h-2.561V8.29c0-1.309-.55-1.976-1.67-1.976-1.23 0-1.846.79-1.846 2.35v3.403h-2.546V8.663c0-1.56-.617-2.35-1.848-2.35-1.112 0-1.668.668-1.67 1.977v6.218H4.822V8.102c0-1.31.337-2.35 1.011-3.12.696-.77 1.608-1.164 2.74-1.164 1.311 0 2.302.5 2.962 1.498l.638 1.06.638-1.06c.66-.999 1.65-1.498 2.96-1.498 1.13 0 2.043.395 2.74 1.164.675.77 1.012 1.81 1.012 3.12z" },
		{ type: "github", color: "#e2e8f0", path: "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" },
		{ type: "steam", color: "#c2c2c2", path: "M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.497 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.252 0-2.265-1.014-2.265-2.265z" },
		{ type: "facebook", color: "#1877f2", path: "M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" },
		{ type: "bluesky", color: "#0085ff", path: "M12 10.8c-1.087-2.114-4.046-6.053-6.798-7.995C2.566.944 1.561 1.266.902 1.565.139 1.908 0 3.08 0 3.768c0 .69.378 5.65.624 6.479.815 2.736 3.713 3.66 6.383 3.364.136-.02.275-.039.415-.056-.138.022-.276.04-.415.056-3.912.58-7.387 2.005-2.83 7.078 5.013 5.19 6.87-1.113 7.823-4.308.953 3.195 2.05 9.271 7.733 4.308 4.267-4.308 1.172-6.498-2.74-7.078a8.741 8.741 0 0 1-.415-.056c.14.017.279.036.415.056 2.67.297 5.568-.628 6.383-3.364.246-.828.624-5.79.624-6.478 0-.69-.139-1.861-.902-2.204-.659-.3-1.664-.62-4.3 1.24C16.046 4.748 13.087 8.687 12 10.8z" },
		{ type: "twitter", color: "#e2e8f0", path: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.748l7.73-8.835L1.254 2.25H8.08l4.259 5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z" },
	];
</script>

<svelte:head>
	<title>{instance.name}</title>
	<meta name="description" content={instance.description} />
	<meta property="og:title" content={instance.name} />
	<meta property="og:description" content={instance.description} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;800&display=swap" rel="stylesheet" />
</svelte:head>

<style>
	:global(.hp-root) { font-family: 'Inter', sans-serif; }
	/* F1: Global :active press feedback for all interactive elements */
	:global(.hp-root) button:active,
	:global(.hp-root) a.nx-press:active {
		transform: scale(0.97);
		transition: transform 100ms ease-out;
	}

	/* ── Online pulse (used by twitch live dot) ── */
	@keyframes opulse {
		0%   { box-shadow: 0 0 0 0 rgba(74,222,128,.5); }
		100% { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
	}
	.opulse { animation: opulse 2s ease-out infinite; }

	/* ── Dot grid bg ── */
	.dotbg {
		background-color: #05050a;
		background-image:
			radial-gradient(circle at 15% 40%, rgb(var(--nx-accent-2-rgb) / .1) 0%, transparent 45%),
			radial-gradient(circle at 85% 15%, rgb(var(--nx-cyan-rgb) / .07) 0%, transparent 35%),
			radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px);
		background-size: 100%, 100%, 28px 28px;
	}

	/* ── Bento Dashboard (Linear/Vercel/Raycast aesthetic) ── */
	.nx-bento {
		display: grid;
		grid-template-columns: repeat(12, minmax(0, 1fr));
		grid-auto-rows: 100px;
	}
	@media (min-width: 640px) { .nx-bento { padding-left: 32px; padding-right: 32px; } }
	@media (max-width: 900px) { .nx-bento { grid-template-columns: repeat(6, 1fr); } }
	@media (max-width: 640px) { .nx-bento { grid-template-columns: 1fr; padding: 0 16px; gap: 10px; } }

	/* Featured article (magazine) tile — img hover scale + overlay gradient stay in CSS */
	.nx-bento-mag img { width: 100%; height: 100%; object-fit: cover; transition: transform .5s cubic-bezier(0.23, 1, 0.32, 1); }
	.nx-bento-mag:hover img { transform: scale(1.04); }
	.nx-bento-mag-overlay { position: absolute; inset: 0; background: linear-gradient(to top, rgba(4,4,10,.95) 5%, rgba(4,4,10,.3) 50%, transparent 80%); }

	/* Article grid tile — img hover scale needs parent selector (stays in CSS) */
	.nx-bento-card:hover .nx-bento-card-cover img { transform: scale(1.05); }

	/* Community tile — signal bars need nth-child (stays in CSS) */
	.nx-bento-signal { display: flex; align-items: flex-end; gap: 2px; shrink: 0; height: 16px; }
	.nx-bento-signal-bar {
		width: 3px; border-radius: 1px; background: rgba(255,255,255,.1);
		transition: background .2s cubic-bezier(0.23, 1, 0.32, 1);
	}
	.nx-bento-signal-bar:nth-child(1) { height: 25%; }
	.nx-bento-signal-bar:nth-child(2) { height: 50%; }
	.nx-bento-signal-bar:nth-child(3) { height: 75%; }
	.nx-bento-signal-bar:nth-child(4) { height: 100%; }
	.nx-bento-signal-bar.on { background: currentColor; }
	.nx-bento-community-thread-title { transition: color .2s cubic-bezier(0.23, 1, 0.32, 1); }
	.nx-bento-community-thread:hover .nx-bento-community-thread-title { color: var(--nx-accent-2-soft); }
	/* Ticker tile — animation + mask stay in CSS, rest in Tailwind */
	.nx-bento-ticker {
		height: 100%; overflow: hidden; position: relative;
		mask: linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%);
		-webkit-mask: linear-gradient(to bottom, transparent 0%, #000 8%, #000 92%, transparent 100%);
	}
	.nx-bento-ticker-track {
		display: flex; flex-direction: column;
		animation: nx-bento-tick 30s linear infinite;
	}
	.nx-bento-ticker:hover .nx-bento-ticker-track { animation-play-state: paused; }
	@keyframes nx-bento-tick { from { transform: translateY(0); } to { transform: translateY(-50%); } }

	/* Events tile — only hover effect stays in CSS */
	.nx-bento-event { transition: border-color .2s cubic-bezier(0.23, 1, 0.32, 1); }
	.nx-bento-event:hover { border-color: rgba(34,211,238,.25); }

	/* CTA + Social tile — only pseudo-element + custom prop + responsive (rest in Tailwind) */
	.nx-bento-cta-tile::before {
		content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
		background: linear-gradient(90deg, transparent, var(--nx-accent-2-strong), var(--nx-cyan), transparent);
		pointer-events: none;
	}
	.nx-cta-social-link { color: var(--ic, #9ca3af); }
	@media (max-width: 900px) {
		.nx-bento-cta-tile { flex-direction: column; }
		.nx-cta-hero { border-right: none; border-bottom: 1px solid rgba(255,255,255,.06); padding: 16px 20px; }
		.nx-cta-stats-bar { border-bottom: 1px solid rgba(255,255,255,.06); }
		.nx-cta-bottom { border-left: none; border-top: 1px solid rgba(255,255,255,.06); flex-wrap: wrap; }
	}
	@media (max-width: 900px) {
		.nx-bento-tile { grid-column: span 6 !important; }
	}
	@media (max-width: 640px) {
		.nx-bento-tile { grid-column: span 1 !important; grid-row: span 4 !important; }
	}

	/* ── Slideshow hero (bento) — keyframes + complex gradients stay in CSS ── */
	.nx-slideshow-overlay-l {
		position: absolute; inset: 0;
		background: linear-gradient(to right, rgba(4,4,10,.95) 0%, rgba(4,4,10,.6) 40%, transparent 70%);
	}
	.nx-slideshow-overlay-b {
		position: absolute; inset: 0;
		background: linear-gradient(to top, rgba(4,4,10,.95) 0%, transparent 50%);
	}
	.nx-slideshow-glow {
		position: absolute; top: -100px; right: -100px;
		width: 400px; height: 400px; border-radius: 50%;
		background: radial-gradient(circle, rgba(99,102,241,.15) 0%, transparent 70%);
		pointer-events: none;
	}
	.nx-slideshow-cat-line {
		width: 40px; height: 1px;
		background: linear-gradient(to right, var(--nx-accent-2-strong), var(--nx-cyan));
	}
	.nx-slideshow-progress {
		position: absolute; inset: 0; height: 100%;
		background: linear-gradient(to right, var(--nx-accent-2-strong), var(--nx-cyan));
		width: 0%; transition: width .1s cubic-bezier(0.16, 1, 0.3, 1);
	}

	/* ── Twitch widget (bento) — only animation + responsive grid stay in CSS ── */
	.nx-twitch {
		border: 1px solid rgba(255,255,255,.06); border-radius: 12px;
		overflow: hidden; background: #0a0a0f;
		transition: border-color .2s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.nx-twitch:hover { border-color: rgba(99,102,241,.2); }
	.nx-twitch-live-dot {
		width: 6px; height: 6px; border-radius: 50%; background: #4ade80;
		animation: opulse 2s ease-out infinite;
	}
	.nx-twitch-body {
		display: grid; grid-template-columns: 3fr 1fr;
		height: 400px;
	}
	@media (max-width: 768px) { .nx-twitch-body { grid-template-columns: 1fr; height: auto; } }
	@media (max-width: 768px) { .nx-twitch-chat { border-left: none; border-top: 1px solid rgba(255,255,255,.05); height: 300px; } }

	/* ── F6: Reduced motion — disable decorative animations ── */
	@media (prefers-reduced-motion: reduce) {
		.opulse,
		.nx-twitch-live-dot { animation: none; box-shadow: 0 0 0 3px rgba(74,222,128,.5); }
		.nx-bento-ticker-track { animation: none; transform: none; }
		.nx-bento-mag img,
		.nx-bento-card-cover img { transition: none; }
	}

</style>

<div class="dotbg min-h-full hp-root">

<!-- ═══════════════════════════════════════════════════════════════════
     GRID BUILDER v2 — remplace tout le contenu si un layout est publié
════════════════════════════════════════════════════════════════════════ -->
{#if hasGrid}
	<GridRenderer
		layout={gridLayout!}
		theme={gridTheme}
		{instance}
		{user}
		{installedWidgets}
	/>
{:else}

<!-- ═══════════════════════════════════════════════════════════════════
     FALLBACK — ancien système positions fixes (tant que pas de grid)
══════════════════════════════════════════════════════════════���═════════ -->

<!-- ═══════════════════════════════════════════════════════════════════
     BENTO DASHBOARD — Variant B from sketch 005 (Linear/Vercel/Raycast)
     Layout: Slideshow → Twitch → Bento (magazine + articles + ticker + community + video + CTA + social)
════════════════════════════════════════════════════════════════════════ -->

<!-- MAIN — position 'main' (WidgetZone) -->
{#if hasPos('main')}
	<WidgetZone widgets={posWidgets('main')} {instance} {user} layout="full" {installedWidgets} />
{/if}

<!-- ══ 1. Slideshow hero (50vh, full-width) ══ -->
{#if slideArticles.length > 0}
<section class="py-6 overflow-x-hidden" style="padding-top:24px;">
	<div class="nx-bento gap-3 mx-auto px-6 box-border" style="grid-auto-rows: auto;">
		<div style="grid-column: span 12;">
			<div class="relative w-full h-[50vh] min-h-100 overflow-hidden rounded-xl bg-[#0a0a0f]">
				{#key slideIndex}
				{#if slideArticles[slideIndex]?.imageUrl}
					<img src={slideArticles[slideIndex].imageUrl} alt="" class="absolute inset-0 w-full h-full object-cover opacity-50" transition:fade={{ duration: 400, easing: cubicOut }} />
				{:else}
					<div class="absolute inset-0 nx-bg-slide-empty" transition:fade={{ duration: 400, easing: cubicOut }}></div>
				{/if}
				{/key}
				<div class="nx-slideshow-overlay-l"></div>
				<div class="nx-slideshow-overlay-b"></div>
				<div class="nx-slideshow-glow"></div>
				<div class="relative z-2 flex flex-col justify-center h-full p-12 max-w-[700px]">
					<div class="flex items-center gap-3 mb-4">
						<span class="nx-slideshow-cat-line"></span>
						<span class="font-mono text-[11px] font-medium uppercase tracking-[0.14em]" style="color: var(--nx-accent-2-soft);">{slideArticles[slideIndex]?.categoryName || tFn('home.news')}</span>
					</div>
					<h2 class="font-['Space_Grotesk'] font-extrabold text-[clamp(1.5rem,3vw,2.4rem)] leading-tight text-white m-0 mb-4" style="text-shadow: 0 2px 30px rgba(0,0,0,.9);">{slideArticles[slideIndex]?.title}</h2>
					{#if slideArticles[slideIndex]?.excerpt}
						<p class="text-sm text-gray-400 leading-relaxed max-w-[500px] m-0 mb-6">{slideArticles[slideIndex].excerpt}</p>
					{/if}
					<div class="flex items-center gap-4 flex-wrap">
						<div class="flex items-center gap-2.5">
							<div class="w-8 h-8 rounded-full bg-indigo-500/30 border border-indigo-500/40 flex items-center justify-center text-xs font-bold text-white font-['Space_Grotesk']">{slideArticles[slideIndex]?.authorUsername?.charAt(0).toUpperCase() ?? '?'}</div>
							<span class="text-[13px] font-semibold" style="color: var(--nx-accent-2-soft);">{slideArticles[slideIndex]?.authorUsername}</span>
							<span class="text-xs text-gray-500 font-mono">{timeAgo(slideArticles[slideIndex]?.createdAt ?? '')}</span>
						</div>
						<a href="/forum/{slideArticles[slideIndex]?.categoryId}/{slideArticles[slideIndex]?.id}" class="nx-press inline-flex items-center gap-1.5 font-['Space_Grotesk'] text-xs font-bold uppercase tracking-[0.08em] text-white px-4 py-2.25 rounded-md no-underline whitespace-nowrap bg-white/[0.08] backdrop-blur-md border border-white/15 transition-all duration-200 hover:bg-white/15 hover:border-white/30">
							{tFn('common.read_article')}
							<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
						</a>
					</div>
				</div>
				{#if slideArticles.length > 1}
				<div class="absolute bottom-8 right-12 flex items-center gap-4 z-3">
					<div class="flex gap-2">
						{#each slideArticles as _, i}
						<button class="w-6 h-1 border-0 p-0 bg-white/20 cursor-pointer transition-colors duration-200 relative overflow-hidden {i === slideIndex ? 'bg-white/30' : ''}" onclick={() => slideTo(i)}>
							{#if i === slideIndex}<span class="nx-slideshow-progress" style="width:{progressPct}%"></span>{/if}
						</button>
						{/each}
					</div>
					<div class="flex gap-1">
						<button class="w-8 h-8 border border-white/15 bg-black/30 text-white cursor-pointer flex items-center justify-center transition-all duration-200 rounded-md hover:bg-indigo-500/30 hover:border-indigo-500/40" onclick={slidePrev} aria-label="Previous"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg></button>
						<button class="w-8 h-8 border border-white/15 bg-black/30 text-white cursor-pointer flex items-center justify-center transition-all duration-200 rounded-md hover:bg-indigo-500/30 hover:border-indigo-500/40" onclick={slideNext} aria-label="Next"><svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg></button>
					</div>
				</div>
				{/if}
			</div>
		</div>
	</div>
</section>
{/if}

<!-- ══ 2. Twitch widget (full-width) — DB-backed via twitch-stream widget config ══ -->
{#if twitchChannel}
<section class="py-6 overflow-x-hidden" style="padding-top:0;">
	<div class="nx-bento gap-3 mx-auto px-6 box-border" style="grid-auto-rows: auto;">
		<div style="grid-column: span 12;">
			<div class="nx-twitch">
				<div class="flex items-center gap-2.5 px-5 py-3 border-b border-white/[0.05]">
					<div class="w-6 h-6 flex items-center justify-center text-[#9146ff]"><svg class="w-5 h-5 fill-current" viewBox="0 0 24 24"><path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/></svg></div>
					<span class="font-['Space_Grotesk'] text-sm font-bold text-white">{twitchChannel}</span>
					<span class="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-green-400 bg-green-400/10 border border-green-400/20 px-2 py-0.5 rounded-full"><span class="nx-twitch-live-dot"></span>{tFn('home.live')}</span>
				</div>
				<div class="nx-twitch-body">
					<div class="relative bg-black overflow-hidden">
						<iframe class="absolute inset-0 w-full h-full border-0" src="https://player.twitch.tv/?channel={twitchChannel}&parent={typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&autoplay=true&muted=true" title="Twitch player — {twitchChannel}" allowfullscreen allow="autoplay; fullscreen; picture-in-picture"></iframe>
					</div>
					<div class="nx-twitch-chat relative bg-[#0a0a0f] border-l border-white/[0.05]">
						<iframe class="absolute inset-0 w-full h-full border-0" src="https://www.twitch.tv/embed/{twitchChannel}/chat?parent={typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&darkpopout" title="Twitch chat — {twitchChannel}"></iframe>
					</div>
				</div>
			</div>
		</div>
	</div>
</section>
{/if}

<!-- ══ 3. Bento grid (magazine + articles + ticker + community + video + CTA + social) ══ -->
<section class="py-6 overflow-x-hidden" style="padding-top:0;">
	<div class="nx-bento gap-3 mx-auto px-6 box-border">

		<!-- Magazine tile (4 cols × 4 rows) — heroArticle -->
		{#if heroArticle}
		<a href="/forum/{heroArticle.categoryId}/{heroArticle.id}" class="nx-bento-mag nx-bento-tile min-w-0 overflow-hidden relative bg-[#0a0a0f] border border-white/[0.06] rounded-xl flex flex-col transition-colors duration-200 hover:border-[rgba(167,139,250,.2)] block no-underline text-inherit" style="grid-column: span 4; grid-row: span 4;">
			{#if heroArticle.imageUrl}
				<img src={heroArticle.imageUrl} alt="" />
			{:else}
				<div class="absolute inset-0 nx-bg-slide-empty"></div>
			{/if}
			<div class="nx-bento-mag-overlay"></div>
			<div class="absolute left-0 right-0 bottom-0 p-6">
				<span class="inline-block mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.12em] px-2.5 py-1 rounded-full border" style="color: var(--nx-accent-2-soft); background: rgba(99,102,241,.12); border-color: rgba(167,139,250,.2);">{heroArticle.categoryName || tFn('home.news')}</span>
				<h2 class="font-['Space_Grotesk'] text-lg font-extrabold leading-snug text-white m-0 mb-2 line-clamp-3">{heroArticle.title}</h2>
				<p class="font-mono text-[10px] text-gray-400">{heroArticle.authorUsername} · {timeAgo(heroArticle.createdAt)}</p>
			</div>
		</a>
		{:else}
		<div class="min-w-0 overflow-hidden relative bg-white/[0.02] border border-white/[0.06] rounded-xl flex flex-col transition-colors duration-200 hover:border-[rgba(167,139,250,.2)]" style="grid-column: span 4; grid-row: span 4;">
			<div class="flex items-center gap-2 h-9 px-4 bg-black/20 border-b border-white/[0.05] font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400 shrink-0"><span class="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--nx-cyan)]"></span>{tFn('home.news')}</div>
			<div class="flex items-center justify-center h-full text-center p-8">
				<span style="font-family:'JetBrains Mono',monospace; font-size:12px; color:#374151; letter-spacing:.1em;">{tFn('common.no_article')}</span>
			</div>
		</div>
		{/if}

		<!-- Article grid tile (8 cols × 4 rows) — restArticles -->
		{#if restArticles.length > 0}
		<div class="min-w-0 overflow-hidden relative bg-white/[0.02] border border-white/[0.06] rounded-xl flex flex-col transition-colors duration-200 hover:border-[rgba(167,139,250,.2)]" style="grid-column: span 8; grid-row: span 4;">
			<div class="flex items-center gap-2 h-9 px-4 bg-black/20 border-b border-white/[0.05] font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400 shrink-0">
				<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--nx-accent-2-strong)]"></span>{tFn('home.articles')}
				<a href="/forum" class="ml-auto font-mono text-[9px] text-gray-600 no-underline">{tFn('common.view_all')} →</a>
			</div>
			<div class="flex-1 min-h-0 overflow-hidden">
				<div class="grid grid-cols-3 gap-2 p-2.5 h-full overflow-y-auto overflow-x-hidden max-[639px]:grid-cols-2">
					{#each restArticles as article}
					<a href="/forum/{article.categoryId}/{article.id}" class="nx-bento-card flex flex-col no-underline text-inherit rounded-lg overflow-hidden bg-white/[0.02] border border-white/[0.05] transition-all duration-200 hover:border-[rgba(167,139,250,.3)] hover:-translate-y-px">
						<div class="nx-bento-card-cover relative w-full h-20 overflow-hidden bg-[#0a0a0f]">
							{#if article.imageUrl}
								<img src={article.imageUrl} alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover transition-transform duration-300" />
							{:else}
								<div class="absolute inset-0 flex items-center justify-center bg-linear-to-br from-indigo-500/[0.08] to-cyan-500/[0.04] font-['Space_Grotesk'] text-[28px] font-black text-[rgba(167,139,250,.2)]">{heroLetter}</div>
							{/if}
						</div>
						<div class="flex-1 flex flex-col p-2 pb-2.5">
							<h4 class="font-['Space_Grotesk'] text-xs font-bold leading-snug text-white m-0 mb-1 line-clamp-2">{article.title}</h4>
							<div class="mt-auto font-mono text-[9px] text-gray-500">
								<span style="color: var(--nx-accent-2-soft);">{article.authorUsername}</span>
								<span> · </span>
								<span>{timeAgo(article.createdAt)}</span>
							</div>
						</div>
					</a>
					{/each}
				</div>
			</div>
		</div>
		{/if}

		<!-- Ticker tile (8 cols × 3 rows) — En continu -->
		{#if recentThreads.length > 0}
		<div class="min-w-0 overflow-hidden relative bg-white/[0.02] border border-white/[0.06] rounded-xl flex flex-col transition-colors duration-200 hover:border-[rgba(167,139,250,.2)]" style="grid-column: span 8; grid-row: span 3;">
			<div class="flex items-center gap-2 h-9 px-4 bg-black/20 border-b border-white/[0.05] font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400 shrink-0">
				<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-green-400"></span>{tFn('home.en_continu')}
			</div>
			<div class="flex-1 min-h-0 overflow-hidden">
				<div class="nx-bento-ticker">
					<div class="nx-bento-ticker-track">
						{#each [...recentThreads, ...recentThreads] as thread}
						<a href="/forum/{thread.category_id}/{thread.id}" class="flex items-center gap-2.5 px-3 py-2 no-underline text-inherit border-b border-white/[0.04] transition-colors duration-200 hover:bg-indigo-500/[0.06]">
							<div class="w-8 h-8 shrink-0 rounded-md bg-indigo-500/15 border border-indigo-500/20 flex items-center justify-center font-mono text-[11px] font-bold text-white">{thread.author_username?.charAt(0).toUpperCase() ?? '?'}</div>
							<div class="flex-1 min-w-0">
								<p class="text-[11px] font-medium text-slate-200 leading-tight m-0 line-clamp-1">{thread.title}</p>
								<div class="font-mono text-[8px] text-gray-500 flex items-center gap-1.5">
									<span class="uppercase tracking-[0.08em]" style="color: var(--nx-accent-2-soft);">{thread.category_name}</span>
									<span>·</span>
									<span>{timeAgo(thread.created_at)}</span>
									<span>·</span>
									<span>{thread.post_count ?? 0} {tFn('forum.replies_label')}</span>
								</div>
							</div>
						</a>
						{/each}
					</div>
				</div>
			</div>
		</div>
		{/if}

		<!-- Community tile (4 cols × 3 rows) -->
		<div class="min-w-0 overflow-hidden relative bg-white/[0.02] border border-white/[0.06] rounded-xl flex flex-col transition-colors duration-200 hover:border-[rgba(167,139,250,.2)]" style="grid-column: span 4; grid-row: span 3;">
			<div class="flex items-center gap-2 h-9 px-4 bg-black/20 border-b border-white/[0.05] font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400 shrink-0">
				<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--nx-accent-2-strong)]"></span>{tFn('home.community_title')}
			</div>
			<div class="flex-1 min-h-0 overflow-hidden">
				<div class="p-2.5 flex flex-col h-full overflow-hidden gap-1.5">
					<div class="flex flex-col">
						<div class="nx-bento-community-stat flex items-center justify-between py-1 border-b border-white/[0.05] last:border-b-0">
							<div class="flex items-baseline gap-2 min-w-0">
								<span class="font-['Space_Grotesk'] font-black text-base leading-none tabular-nums" style="color: var(--nx-accent-2-soft);">{instance.member_count.toLocaleString()}</span>
								<span class="font-mono text-[8px] uppercase tracking-[0.1em] text-gray-500">{tFn('common.members')}</span>
							</div>
							<div class="nx-bento-signal" style="color: var(--nx-accent-2-soft);">
								{#each Array(4) as _, i}
									<span class="nx-bento-signal-bar" class:on={i < signalLevel(instance.member_count)}></span>
								{/each}
							</div>
						</div>
						<div class="nx-bento-community-stat flex items-center justify-between py-1 border-b border-white/[0.05] last:border-b-0">
							<div class="flex items-baseline gap-2 min-w-0">
								<span class="font-['Space_Grotesk'] font-black text-base leading-none tabular-nums" style="color:#4ade80;">{instance.online_count}</span>
								<span class="font-mono text-[8px] uppercase tracking-[0.1em] text-gray-500">{tFn('common.online')}</span>
							</div>
							<div class="nx-bento-signal" style="color:#4ade80;">
								{#each Array(4) as _, i}
									<span class="nx-bento-signal-bar" class:on={i < signalLevel(instance.online_count)}></span>
								{/each}
							</div>
						</div>
						<div class="nx-bento-community-stat flex items-center justify-between py-1 border-b border-white/[0.05] last:border-b-0">
							<div class="flex items-baseline gap-2 min-w-0">
								<span class="font-['Space_Grotesk'] font-black text-base leading-none tabular-nums" style="color: var(--nx-cyan-soft);">{instance.thread_count.toLocaleString()}</span>
								<span class="font-mono text-[8px] uppercase tracking-[0.1em] text-gray-500">{tFn('common.topics')}</span>
							</div>
							<div class="nx-bento-signal" style="color: var(--nx-cyan-soft);">
								{#each Array(4) as _, i}
									<span class="nx-bento-signal-bar" class:on={i < signalLevel(instance.thread_count)}></span>
								{/each}
							</div>
						</div>
					</div>
					<div class="flex flex-col gap-0 flex-1 min-h-0 overflow-hidden">
						{#each recentThreads.slice(0, 3) as thread}
						<a href="/forum/{thread.category_id}/{thread.id}" class="nx-bento-community-thread flex flex-col gap-px py-1 no-underline text-inherit border-b border-white/[0.04] last:border-b-0">
							<span class="nx-bento-community-thread-title text-[11px] font-medium text-slate-200 leading-tight whitespace-nowrap overflow-hidden text-ellipsis transition-colors duration-200">{thread.title}</span>
							<span class="font-mono text-[8px] uppercase tracking-[0.08em]" style="color: var(--nx-accent-2-soft);">{thread.category_name}</span>
						</a>
						{:else}
							<span style="font-size:11px; color:#374151; padding:8px 0;">{tFn('common.no_activity')}</span>
						{/each}
					</div>
				</div>
			</div>
		</div>

		<!-- CTA + Social tile (full-width horizontal bar) -->
		<div class="nx-bento-cta-tile min-w-0 overflow-hidden relative bg-[#0a0a0f] border border-white/[0.08] rounded-xl flex flex-row items-stretch" style="grid-column: span 12; grid-row: span 1;">
			<!-- Left: hero identity -->
			<div class="nx-cta-hero relative z-2 flex items-center gap-3.5 px-6 shrink-0 border-r border-white/[0.06]">
				{#if instance.logo_url}
					<img src={instance.logo_url} alt={instance.name} class="w-11 h-11 shrink-0 rounded-2.5 object-cover" />
				{:else}
					<div class="w-11 h-11 shrink-0 rounded-2.5 flex items-center justify-center font-['Space_Grotesk'] font-black text-[22px] text-white bg-linear-to-br from-[var(--nx-accent-2-strong)] to-[var(--nx-cyan-deep)]">{heroLetter}</div>
				{/if}
				<div class="min-w-0">
					<h3 class="font-['Space_Grotesk'] text-base font-extrabold text-white m-0 leading-tight whitespace-nowrap">{instance.name}</h3>
					<p class="text-[10px] text-gray-500 mt-0.5 leading-tight whitespace-nowrap">{tFn('home.cta_sub')}</p>
				</div>
			</div>

			<!-- Middle: stats bar -->
			<div class="nx-cta-stats-bar relative z-2 flex flex-1 min-w-0">
				<div class="nx-cta-stat-cell flex-1 flex items-center justify-center gap-2.5 px-4 min-w-0">
					<div class="flex flex-col gap-px min-w-0">
						<span class="font-['Space_Grotesk'] font-black text-xl leading-none tabular-nums" style="color: var(--nx-accent-2-soft);">{instance.member_count.toLocaleString()}</span>
						<span class="font-mono text-[8px] uppercase tracking-[0.1em] text-gray-500">{tFn('common.members')}</span>
					</div>
					<div class="nx-bento-signal" style="color: var(--nx-accent-2-soft);">
						{#each Array(4) as _, i}<span class="nx-bento-signal-bar" class:on={i < signalLevel(instance.member_count)}></span>{/each}
					</div>
				</div>
				<div class="nx-cta-stat-cell flex-1 flex items-center justify-center gap-2.5 px-4 min-w-0 border-l border-white/[0.06]">
					<div class="flex flex-col gap-px min-w-0">
						<span class="font-['Space_Grotesk'] font-black text-xl leading-none tabular-nums" style="color:#4ade80;">{instance.online_count}</span>
						<span class="font-mono text-[8px] uppercase tracking-[0.1em] text-gray-500">{tFn('common.online')}</span>
					</div>
					<div class="nx-bento-signal" style="color:#4ade80;">
						{#each Array(4) as _, i}<span class="nx-bento-signal-bar" class:on={i < signalLevel(instance.online_count)}></span>{/each}
					</div>
				</div>
				<div class="nx-cta-stat-cell flex-1 flex items-center justify-center gap-2.5 px-4 min-w-0 border-l border-white/[0.06]">
					<div class="flex flex-col gap-px min-w-0">
						<span class="font-['Space_Grotesk'] font-black text-xl leading-none tabular-nums" style="color: var(--nx-cyan-soft);">{instance.thread_count.toLocaleString()}</span>
						<span class="font-mono text-[8px] uppercase tracking-[0.1em] text-gray-500">{tFn('common.topics')}</span>
					</div>
					<div class="nx-bento-signal" style="color: var(--nx-cyan-soft);">
						{#each Array(4) as _, i}<span class="nx-bento-signal-bar" class:on={i < signalLevel(instance.thread_count)}></span>{/each}
					</div>
				</div>
				<div class="nx-cta-stat-cell flex-1 flex items-center justify-center gap-2.5 px-4 min-w-0 border-l border-white/[0.06]">
					<div class="flex flex-col gap-px min-w-0">
						<span class="font-['Space_Grotesk'] font-black text-xl leading-none tabular-nums" style="color:#fbbf24;">{instance.post_count?.toLocaleString() ?? 0}</span>
						<span class="font-mono text-[8px] uppercase tracking-[0.1em] text-gray-500">{tFn('common.posts')}</span>
					</div>
					<div class="nx-bento-signal" style="color:#fbbf24;">
						{#each Array(4) as _, i}<span class="nx-bento-signal-bar" class:on={i < signalLevel(instance.post_count ?? 0)}></span>{/each}
					</div>
				</div>
			</div>

			<!-- Right: actions + social -->
			<div class="nx-cta-bottom relative z-2 flex items-center shrink-0 border-l border-white/[0.06]">
				<div class="flex items-center gap-2 px-5">
					{#if data.user}
						<a href="/chat" class="nx-press font-['Space_Grotesk'] font-bold text-xs uppercase tracking-[0.08em] no-underline px-[18px] py-2.25 rounded-md flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all duration-200 text-white bg-indigo-600 border border-indigo-600 hover:bg-indigo-700 hover:border-indigo-700">
							{tFn('home.join_chat')}
							<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
						</a>
					{:else}
						<a href="/auth/login" class="nx-press font-['Space_Grotesk'] font-bold text-xs uppercase tracking-[0.08em] no-underline px-[18px] py-2.25 rounded-md flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all duration-200 text-gray-400 bg-transparent border border-white/[0.12] hover:text-white hover:border-white/25">{tFn('common.login')}</a>
						<a href="/auth/register" class="nx-press font-['Space_Grotesk'] font-bold text-xs uppercase tracking-[0.08em] no-underline px-[18px] py-2.25 rounded-md flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer transition-all duration-200 text-white bg-indigo-600 border border-indigo-600 hover:bg-indigo-700 hover:border-indigo-700">
							{tFn('common.join')}
							<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
						</a>
					{/if}
				</div>
				<div class="flex items-center gap-1 px-4 border-l border-white/[0.06] h-full">
					{#each SOCIAL_LINKS as s}
					<a href="#" class="nx-press nx-cta-social-link flex items-center justify-center w-8 h-8 rounded-md no-underline transition-all duration-150 hover:bg-white/[0.06] hover:-translate-y-px" style="--ic: {s.color}" title={s.type}>
						<svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d={s.path}/></svg>
					</a>
					{/each}
				</div>
			</div>
		</div>

		<!-- Events tile (12 cols × 2 rows) — publicEvents -->
		{#if publicEvents.length > 0}
		<div class="min-w-0 overflow-hidden relative bg-white/[0.02] border border-white/[0.06] rounded-xl flex flex-col transition-colors duration-200 hover:border-[rgba(167,139,250,.2)]" style="grid-column: span 12; grid-row: span 2;">
			<div class="flex items-center gap-2 h-9 px-4 bg-black/20 border-b border-white/[0.05] font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-gray-400 shrink-0">
				<span class="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--nx-cyan)]"></span>{tFn('home.events')}
			</div>
			<div class="flex-1 min-h-0 overflow-hidden">
				<div class="flex flex-col gap-1.5 p-2.5 h-full overflow-y-auto overflow-x-hidden" style="flex-direction: row; flex-wrap: wrap; align-content: center;">
					{#each publicEvents.slice(0, 6) as ev}
					<a href="/calendar/{ev.id}" class="nx-bento-event flex items-center gap-2.5 px-2.5 py-2 no-underline text-inherit rounded-md bg-white/[0.02] border border-white/[0.05] transition-colors duration-200" style="flex: 1 1 200px; min-width: 200px;">
						<div class="flex flex-col items-center justify-center w-10 h-10 shrink-0 rounded-lg bg-linear-to-br from-cyan-600 to-[var(--nx-cyan)] font-['Space_Grotesk'] font-extrabold text-white">
							<span class="text-base leading-none">{new Date(ev.start_date).getDate()}</span>
							<span class="text-[8px] uppercase tracking-[0.1em] opacity-90">{new Date(ev.start_date).toLocaleDateString(undefined, { month: 'short' })}</span>
						</div>
						<div class="flex-1 min-w-0">
							<span class="text-xs font-semibold text-slate-200 leading-tight whitespace-nowrap overflow-hidden text-ellipsis block">{ev.title}</span>
							<span class="font-mono text-[9px]" style="color: var(--nx-cyan-soft);">{new Date(ev.start_date).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
						</div>
					</a>
					{/each}
				</div>
			</div>
		</div>
		{/if}

	</div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════
     WIDE-1 / WIDE-2 — positions (WidgetZone)
════════════════════════════════════════════════════════════════════════ -->
{#if hasPos('wide-1')}
	<section style="border-bottom:1px solid rgba(255,255,255,.05)">
		<WidgetZone widgets={posWidgets('wide-1')} {instance} {user} layout="full" {installedWidgets} />
	</section>
{/if}
{#if hasPos('half-1') || hasPos('half-2')}
	<div class="grid grid-cols-1 md:grid-cols-2 gap-0" style="border-bottom:1px solid rgba(255,255,255,.05)">
		{#if hasPos('half-1')}
			<div style="border-right:1px solid rgba(255,255,255,.05)">
				<WidgetZone widgets={posWidgets('half-1')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
		{#if hasPos('half-2')}
			<div>
				<WidgetZone widgets={posWidgets('half-2')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
	</div>
{/if}

{#if hasPos('wide-2')}
	<section style="border-bottom:1px solid rgba(255,255,255,.05)">
		<WidgetZone widgets={posWidgets('wide-2')} {instance} {user} layout="full" {installedWidgets} />
	</section>
{/if}

{#if hasPos('trio-1') || hasPos('trio-2') || hasPos('trio-3')}
	<div class="grid grid-cols-1 md:grid-cols-3 gap-0" style="border-bottom:1px solid rgba(255,255,255,.05)">
		{#if hasPos('trio-1')}
			<div style="border-right:1px solid rgba(255,255,255,.05)">
				<WidgetZone widgets={posWidgets('trio-1')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
		{#if hasPos('trio-2')}
			<div style="border-right:1px solid rgba(255,255,255,.05)">
				<WidgetZone widgets={posWidgets('trio-2')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
		{#if hasPos('trio-3')}
			<div>
				<WidgetZone widgets={posWidgets('trio-3')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
	</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════
     FOOTER POSITIONS — footer-1 / footer-2 / footer-3 / footer-bar
════════════════════════════════════════════════════════════════════════ -->
{#if hasPos('footer-1') || hasPos('footer-2') || hasPos('footer-3')}
	<div class="grid grid-cols-1 md:grid-cols-3 gap-0" style="border-top:1px solid rgba(255,255,255,.05)">
		{#if hasPos('footer-1')}
			<div style="border-right:1px solid rgba(255,255,255,.05)">
				<WidgetZone widgets={posWidgets('footer-1')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
		{#if hasPos('footer-2')}
			<div style="border-right:1px solid rgba(255,255,255,.05)">
				<WidgetZone widgets={posWidgets('footer-2')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
		{#if hasPos('footer-3')}
			<div>
				<WidgetZone widgets={posWidgets('footer-3')} {instance} {user} layout="full" {installedWidgets} />
			</div>
		{/if}
	</div>
{/if}
{#if hasPos('footer-bar')}
	<div style="border-top:1px solid rgba(255,255,255,.05)">
		<WidgetZone widgets={posWidgets('footer-bar')} {instance} {user} layout="full" {installedWidgets} />
	</div>
{/if}

<div class="h-8 lg:hidden"></div>

{/if}<!-- end {#if hasGrid} fallback -->
</div>
