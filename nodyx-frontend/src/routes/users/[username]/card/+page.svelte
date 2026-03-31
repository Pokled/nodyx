<script lang="ts">
	import { onMount } from 'svelte'
	import { browser } from '$app/environment'
	import GenerativeBanner from '$lib/components/GenerativeBanner.svelte'

	const { data } = $props()
	const profile  = $derived(data.profile)
	const activity = $derived(data.activity as Record<string, number>)
	const origin   = $derived(data.origin as string)

	// ── Computed ───────────────────────────────────────────────────────────────
	const displayName = $derived(profile.display_name || profile.username)
	const initials    = $derived(displayName.trim().charAt(0).toUpperCase())
	const pts         = $derived(Number(profile.points ?? 0))
	const level       = $derived(Math.floor(Math.sqrt(Math.max(0, pts) / 10)) + 1)
	const levelMin    = $derived((level - 1) * (level - 1) * 10)
	const levelMax    = $derived(level * level * 10)
	const levelPct    = $derived(levelMax > levelMin ? Math.min(100, Math.round(((pts - levelMin) / (levelMax - levelMin)) * 100)) : 100)

	const bannerSrc = $derived(
		profile.banner_asset_path ? `/uploads/${profile.banner_asset_path}` : profile.banner_url ?? null
	)
	const useGenerativeBanner = $derived(!bannerSrc)

	// Grade color contrast
	function gradeTextColor(hex: string): string {
		if (!hex?.startsWith('#') || hex.length < 7) return '#fff'
		const r = parseInt(hex.slice(1,3), 16)
		const g = parseInt(hex.slice(3,5), 16)
		const b = parseInt(hex.slice(5,7), 16)
		return (0.299*r + 0.587*g + 0.114*b) / 255 > 0.5 ? '#111' : '#fff'
	}

	// ── Heatmap (12 weeks × 7 days = 84 cells) ────────────────────────────────
	const heatCells = $derived((() => {
		const today  = new Date()
		const cells: { date: string; count: number }[] = []
		// 84 days back
		for (let i = 83; i >= 0; i--) {
			const d = new Date(today)
			d.setDate(d.getDate() - i)
			const key = d.toISOString().slice(0, 10)
			cells.push({ date: key, count: activity[key] ?? 0 })
		}
		return cells
	})())

	const maxActivity = $derived(Math.max(1, ...heatCells.map(c => c.count)))

	function cellColor(count: number): string {
		if (count === 0) return 'rgba(255,255,255,0.04)'
		const t = count / maxActivity
		if (t < 0.25) return 'rgba(99,102,241,0.3)'
		if (t < 0.5)  return 'rgba(99,102,241,0.55)'
		if (t < 0.75) return 'rgba(99,102,241,0.8)'
		return '#818cf8'
	}

	// ── Share / copy ───────────────────────────────────────────────────────────
	let copied  = $state(false)
	let canvasEl = $state<HTMLCanvasElement | null>(null)

	function copyLink() {
		const url = `${origin}/users/${profile.username}/card`
		navigator.clipboard.writeText(url).then(() => {
			copied = true
			setTimeout(() => { copied = false }, 2200)
		})
	}

	// ── Particle system on banner ──────────────────────────────────────────────
	onMount(() => {
		if (!canvasEl) return
		const canvas = canvasEl
		const ctx    = canvas.getContext('2d')!
		let raf = 0, t = 0

		function resize() {
			canvas.width  = canvas.offsetWidth
			canvas.height = canvas.offsetHeight
		}
		resize()
		window.addEventListener('resize', resize)

		const N = 18
		const particles = Array.from({ length: N }, () => ({
			x:    Math.random(),
			y:    Math.random(),
			r:    1 + Math.random() * 1.5,
			vx:   (Math.random() - 0.5) * 0.0003,
			vy:  -0.0001 - Math.random() * 0.0002,
			o:    0.2 + Math.random() * 0.5,
		}))

		function tick() {
			t += 0.016
			const W = canvas.width, H = canvas.height
			ctx.clearRect(0, 0, W, H)
			for (const p of particles) {
				p.x += p.vx
				p.y += p.vy
				if (p.y < -0.05) { p.y = 1.05; p.x = Math.random() }
				if (p.x < -0.05 || p.x > 1.05) { p.x = Math.random(); p.y = 1 }
				ctx.beginPath()
				ctx.arc(p.x * W, p.y * H, p.r, 0, Math.PI * 2)
				ctx.fillStyle = `rgba(180,160,255,${p.o * (0.6 + 0.4 * Math.sin(t + p.x * 10))})`
				ctx.fill()
			}
			raf = requestAnimationFrame(tick)
		}
		tick()

		return () => {
			cancelAnimationFrame(raf)
			window.removeEventListener('resize', resize)
		}
	})

	// ── OG image URL ───────────────────────────────────────────────────────────
	const ogImageUrl = $derived(`${origin}/users/${profile.username}/card.png`)
	const cardUrl    = $derived(`${origin}/users/${profile.username}/card`)
	const profileUrl = $derived(`${origin}/users/${profile.username}`)
</script>

<svelte:head>
	<title>{displayName} — Carte Nodyx</title>
	<meta name="description" content="Profil de {displayName} sur Nodyx — Niveau {level}, {Number(profile.post_count??0).toLocaleString('fr-FR')} posts, {Number(pts).toLocaleString('fr-FR')} XP" />

	<!-- Prevent indexing (cards are supplements, not canonical) -->
	<meta name="robots" content="noindex, follow" />
	<link rel="canonical" href={profileUrl} />

	<!-- Open Graph -->
	<meta property="og:type"        content="profile" />
	<meta property="og:title"       content="{displayName} — Nodyx" />
	<meta property="og:description" content="Niveau {level} · {Number(profile.post_count??0).toLocaleString('fr-FR')} posts · {Number(pts).toLocaleString('fr-FR')} XP{profile.grade ? ` · ${profile.grade.name}` : ''}" />
	<meta property="og:url"         content={cardUrl} />
	<meta property="og:image"       content={ogImageUrl} />
	<meta property="og:image:width" content="600" />
	<meta property="og:image:height" content="315" />
	<meta property="og:site_name"   content="Nodyx" />

	<!-- Twitter/X -->
	<meta name="twitter:card"        content="summary_large_image" />
	<meta name="twitter:title"       content="{displayName} — Nodyx" />
	<meta name="twitter:description" content="Niveau {level} · {Number(profile.post_count??0).toLocaleString('fr-FR')} posts · {Number(pts).toLocaleString('fr-FR')} XP" />
	<meta name="twitter:image"       content={ogImageUrl} />
</svelte:head>

<!-- ── Fullscreen card ─────────────────────────────────────────────────────── -->
<div class="card-root-wrap">
<div class="card-root">

	<!-- ── Banner ─────────────────────────────────────────────────────────── -->
	<div class="banner-wrap">
		{#if bannerSrc}
			<img src={bannerSrc} alt="" class="banner-img" />
		{:else}
			<GenerativeBanner username={profile.username} />
		{/if}
		<!-- Particle canvas overlay -->
		<canvas bind:this={canvasEl} class="banner-particles" aria-hidden="true"></canvas>
		<!-- Gradient fade bottom -->
		<div class="banner-fade"></div>
	</div>

	<!-- ── Main content ───────────────────────────────────────────────────── -->
	<div class="card-body">

		<!-- Avatar + rings -->
		<div class="avatar-col">
			<div class="rings-wrap">
				<div class="ring ring-outer"></div>
				<div class="ring ring-mid"></div>
				<div class="avatar-shell">
					{#if profile.avatar_url ?? profile.avatar}
						<img src={profile.avatar_url ?? profile.avatar} alt={displayName} class="avatar-img" />
					{:else}
						<div class="avatar-fallback">{initials}</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- Identity column -->
		<div class="identity-col">
			<div class="identity-top">
				<h1 class="display-name"
					style={profile.profile?.name_color ? `color: ${profile.profile.name_color}` : ''}>
					{displayName}
				</h1>
				<span class="handle">@{profile.username}</span>
			</div>

			{#if profile.grade}
				<div class="grade-badge"
					style="background: {profile.grade.color}18; border-color: {profile.grade.color}44; color: {profile.grade.color}">
					{profile.grade.name}
				</div>
			{/if}

			<!-- XP progress -->
			<div class="xp-row">
				<span class="xp-label">Lv. {level}</span>
				<div class="xp-track">
					<div class="xp-fill" style="width: {levelPct}%"></div>
					<div class="xp-glow" style="left: {levelPct}%"></div>
				</div>
				<span class="xp-label">{levelPct}%</span>
			</div>
		</div>

		<!-- Level badge (far right) -->
		<div class="level-badge">
			<span class="level-num">{level}</span>
			<span class="level-lbl">LEVEL</span>
		</div>
	</div>

	<!-- ── Stats ──────────────────────────────────────────────────────────── -->
	<div class="stats-row">
		<div class="stat-item">
			<span class="stat-val">{Number(profile.post_count ?? 0).toLocaleString('fr-FR')}</span>
			<span class="stat-lbl">Posts</span>
		</div>
		<div class="stat-sep"></div>
		<div class="stat-item">
			<span class="stat-val">{Number(profile.thread_count ?? 0).toLocaleString('fr-FR')}</span>
			<span class="stat-lbl">Threads</span>
		</div>
		<div class="stat-sep"></div>
		<div class="stat-item">
			<span class="stat-val">{Number(pts).toLocaleString('fr-FR')}</span>
			<span class="stat-lbl">Points XP</span>
		</div>
		<div class="stat-sep"></div>
		<div class="stat-item">
			<span class="stat-val">{Math.floor((Date.now() - new Date(profile.created_at).getTime()) / 86400000).toLocaleString('fr-FR')}</span>
			<span class="stat-lbl">Jours</span>
		</div>
	</div>

	<!-- ── Activity heatmap ───────────────────────────────────────────────── -->
	<div class="heatmap-section">
		<div class="heatmap-header">
			<span class="heatmap-title">Activité — 12 dernières semaines</span>
			<span class="heatmap-total">
				{heatCells.reduce((a, c) => a + c.count, 0)} contributions
			</span>
		</div>
		<div class="heatmap-grid">
			{#each heatCells as cell}
				<div
					class="heatmap-cell"
					style="background: {cellColor(cell.count)}"
					title="{cell.date} · {cell.count} contribution{cell.count !== 1 ? 's' : ''}"
				></div>
			{/each}
		</div>
	</div>

	<!-- ── Footer actions ─────────────────────────────────────────────────── -->
	<div class="card-footer">
		<!-- Nodyx branding -->
		<a href="/" class="nodyx-brand" aria-label="Nodyx">
			<svg width="16" height="16" viewBox="0 0 32 32" fill="none" aria-hidden="true">
				<rect width="32" height="32" rx="4" fill="#6366f1" opacity="0.9"/>
				<circle cx="16" cy="16" r="5" fill="white" opacity="0.9"/>
				<circle cx="6"  cy="8"  r="2.5" fill="white" opacity="0.5"/>
				<circle cx="26" cy="8"  r="2.5" fill="white" opacity="0.5"/>
				<circle cx="6"  cy="24" r="2.5" fill="white" opacity="0.5"/>
				<circle cx="26" cy="24" r="2.5" fill="white" opacity="0.5"/>
				<line x1="6" y1="8" x2="16" y2="16" stroke="white" stroke-width="1" opacity="0.3"/>
				<line x1="26" y1="8" x2="16" y2="16" stroke="white" stroke-width="1" opacity="0.3"/>
				<line x1="6" y1="24" x2="16" y2="16" stroke="white" stroke-width="1" opacity="0.3"/>
				<line x1="26" y1="24" x2="16" y2="16" stroke="white" stroke-width="1" opacity="0.3"/>
			</svg>
			<span class="nodyx-brand-text">nodyx</span>
		</a>

		<div class="footer-actions">
			<!-- View full profile -->
			<a href={profileUrl} target="_blank" rel="noopener noreferrer" class="btn-ghost">
				<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
					<circle cx="12" cy="7" r="4"/>
				</svg>
				Profil complet
			</a>

			<!-- Copy link -->
			<button class="btn-copy" class:btn-copy--done={copied} onclick={copyLink} aria-label="Copier le lien">
				{#if copied}
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
						<polyline points="20 6 9 17 4 12"/>
					</svg>
					Copié !
				{:else}
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
						<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
						<path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
					</svg>
					Partager
				{/if}
			</button>
		</div>
	</div>

</div>
</div>

<style>
/* ── Full-screen takeover — covers parent layout chrome ───────────────────── */
:global(body) { overflow: hidden; }

:global(header),
:global(#galaxy-sidebar),
:global(#galaxy-bar),
:global(aside) {
	display: none !important;
}

:global(main) {
	padding: 0 !important;
	margin: 0 !important;
}

/* ── Root: center the card on the dark canvas ─────────────────────────────── */
.card-root-wrap {
	position: fixed;
	inset: 0;
	background: #06060c;
	display: flex;
	align-items: center;
	justify-content: center;
	z-index: 9999;
	font-family: 'Space Grotesk', ui-sans-serif, system-ui, sans-serif;
}

/* Subtle dot grid background */
.card-root-wrap::before {
	content: '';
	position: absolute;
	inset: 0;
	background-image: radial-gradient(rgba(99,102,241,0.08) 1px, transparent 1px);
	background-size: 28px 28px;
	pointer-events: none;
}

/* ── Card root ────────────────────────────────────────────────────────────── */
.card-root {
	width: min(520px, calc(100vw - 2rem));
	background: #0c0c14;
	border: 1px solid rgba(255, 255, 255, 0.07);
	box-shadow:
		0 0 0 1px rgba(99, 102, 241, 0.06),
		0 32px 80px rgba(0, 0, 0, 0.8),
		0 8px 24px rgba(0, 0, 0, 0.5);
	overflow: hidden;
	position: relative;
	animation: card-appear 0.35s cubic-bezier(0.16, 1, 0.3, 1) both;
}

@keyframes card-appear {
	from { opacity: 0; transform: translateY(20px) scale(0.97); }
	to   { opacity: 1; transform: translateY(0)    scale(1); }
}

* { box-sizing: border-box; }

/* ── Banner ───────────────────────────────────────────────────────────────── */
.banner-wrap {
	position: relative;
	height: 160px;
	overflow: hidden;
}

.banner-img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.banner-particles {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	pointer-events: none;
}

.banner-fade {
	position: absolute;
	bottom: 0;
	left: 0;
	right: 0;
	height: 80px;
	background: linear-gradient(to bottom, transparent, #0c0c14);
}

/* ── Card body (avatar + identity) ───────────────────────────────────────── */
.card-body {
	display: flex;
	align-items: flex-end;
	gap: 1rem;
	padding: 0 1.25rem 0;
	margin-top: -44px;
	position: relative;
}

/* Avatar */
.avatar-col { flex-shrink: 0; }

.rings-wrap {
	position: relative;
	width: 80px;
	height: 80px;
}

.ring {
	position: absolute;
	border-radius: 50%;
}

.ring-outer {
	inset: -5px;
	border: 1.5px solid rgba(99, 102, 241, 0.2);
	animation: ring-breathe 4s ease-in-out infinite;
}

.ring-mid {
	inset: -1px;
	border: 1.5px solid rgba(99, 102, 241, 0.55);
}

@keyframes ring-breathe {
	0%, 100% { opacity: 0.5; transform: scale(1); }
	50%       { opacity: 1;   transform: scale(1.03); }
}

.avatar-shell {
	position: absolute;
	inset: 0;
	border-radius: 50%;
	overflow: hidden;
	border: 2.5px solid #0c0c14;
	background: #1a1040;
}

.avatar-img {
	width: 100%;
	height: 100%;
	object-fit: cover;
}

.avatar-fallback {
	width: 100%;
	height: 100%;
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 1.75rem;
	font-weight: 800;
	color: rgba(255, 255, 255, 0.6);
	background: linear-gradient(135deg, #2d1b6e, #0e3a5c);
}

/* Identity */
.identity-col {
	flex: 1;
	min-width: 0;
	padding-bottom: 0.5rem;
}

.identity-top {
	display: flex;
	align-items: baseline;
	gap: 0.5rem;
	flex-wrap: wrap;
}

.display-name {
	margin: 0;
	font-size: 1.25rem;
	font-weight: 800;
	color: rgba(255, 255, 255, 0.92);
	letter-spacing: -0.03em;
	line-height: 1.2;
}

.handle {
	font-size: 0.72rem;
	color: rgba(255, 255, 255, 0.25);
	font-weight: 500;
}

.grade-badge {
	display: inline-block;
	margin-top: 0.35rem;
	padding: 0.15rem 0.5rem;
	font-size: 0.6rem;
	font-weight: 800;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	border: 1px solid;
}

/* XP */
.xp-row {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	margin-top: 0.5rem;
}

.xp-label {
	font-size: 0.6rem;
	font-weight: 700;
	color: rgba(255, 255, 255, 0.2);
	font-family: ui-monospace, monospace;
	white-space: nowrap;
}

.xp-track {
	flex: 1;
	height: 3px;
	background: rgba(255, 255, 255, 0.06);
	position: relative;
	overflow: visible;
}

.xp-fill {
	height: 100%;
	background: linear-gradient(90deg, #6366f1, #a855f7);
	position: relative;
	transition: width 0.8s cubic-bezier(0.16, 1, 0.3, 1);
}

.xp-glow {
	position: absolute;
	top: 50%;
	transform: translate(-50%, -50%);
	width: 6px;
	height: 6px;
	border-radius: 50%;
	background: #a855f7;
	box-shadow: 0 0 8px 3px rgba(168, 85, 247, 0.6);
	animation: glow-pulse 1.8s ease-in-out infinite;
}

@keyframes glow-pulse {
	0%, 100% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
	50%       { opacity: 0.5; transform: translate(-50%, -50%) scale(0.7); }
}

/* Level badge */
.level-badge {
	flex-shrink: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	padding-bottom: 0.5rem;
}

.level-num {
	font-size: 2.5rem;
	font-weight: 900;
	color: rgba(255, 255, 255, 0.08);
	line-height: 1;
	letter-spacing: -0.05em;
	font-variant-numeric: tabular-nums;
}

.level-lbl {
	font-size: 0.55rem;
	font-weight: 800;
	letter-spacing: 0.15em;
	color: rgba(255, 255, 255, 0.12);
	text-transform: uppercase;
	margin-top: -4px;
}

/* ── Stats ────────────────────────────────────────────────────────────────── */
.stats-row {
	display: flex;
	align-items: center;
	margin: 1rem 1.25rem 0;
	padding: 0.875rem 0;
	border-top: 1px solid rgba(255, 255, 255, 0.05);
	border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.stat-item {
	flex: 1;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 0.15rem;
}

.stat-val {
	font-size: 1rem;
	font-weight: 800;
	color: rgba(255, 255, 255, 0.8);
	letter-spacing: -0.03em;
	font-variant-numeric: tabular-nums;
}

.stat-lbl {
	font-size: 0.58rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: rgba(255, 255, 255, 0.2);
}

.stat-sep {
	width: 1px;
	height: 1.5rem;
	background: rgba(255, 255, 255, 0.06);
	flex-shrink: 0;
}

/* ── Heatmap ──────────────────────────────────────────────────────────────── */
.heatmap-section {
	padding: 0.875rem 1.25rem;
}

.heatmap-header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 0.5rem;
}

.heatmap-title {
	font-size: 0.62rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: rgba(255, 255, 255, 0.18);
}

.heatmap-total {
	font-size: 0.62rem;
	color: rgba(255, 255, 255, 0.2);
	font-family: ui-monospace, monospace;
}

.heatmap-grid {
	display: grid;
	grid-template-columns: repeat(12, 1fr);
	gap: 3px;
}

.heatmap-cell {
	aspect-ratio: 1;
	transition: opacity 0.1s;
}

.heatmap-cell:hover { opacity: 0.7; }

/* ── Footer ───────────────────────────────────────────────────────────────── */
.card-footer {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 0.625rem 1.25rem 0.875rem;
	border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.nodyx-brand {
	display: flex;
	align-items: center;
	gap: 0.4rem;
	text-decoration: none;
}

.nodyx-brand-text {
	font-size: 0.75rem;
	font-weight: 800;
	color: rgba(255, 255, 255, 0.18);
	letter-spacing: -0.02em;
}

.footer-actions {
	display: flex;
	align-items: center;
	gap: 0.5rem;
}

.btn-ghost {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.35rem 0.75rem;
	font-size: 0.72rem;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.4);
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.07);
	text-decoration: none;
	transition: color 0.12s, border-color 0.12s;
}

.btn-ghost:hover {
	color: rgba(255, 255, 255, 0.75);
	border-color: rgba(255, 255, 255, 0.15);
}

.btn-copy {
	display: inline-flex;
	align-items: center;
	gap: 0.3rem;
	padding: 0.35rem 0.75rem;
	font-size: 0.72rem;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.7);
	background: rgba(99, 102, 241, 0.12);
	border: 1px solid rgba(99, 102, 241, 0.3);
	cursor: pointer;
	font-family: inherit;
	transition: background 0.12s, border-color 0.12s, color 0.12s;
}

.btn-copy:hover {
	background: rgba(99, 102, 241, 0.2);
	border-color: rgba(99, 102, 241, 0.5);
	color: rgba(255, 255, 255, 0.9);
}

.btn-copy--done {
	background: rgba(74, 222, 128, 0.1);
	border-color: rgba(74, 222, 128, 0.3);
	color: #4ade80;
}
</style>
