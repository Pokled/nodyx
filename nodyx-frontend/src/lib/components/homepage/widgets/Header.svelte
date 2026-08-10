<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { t } from '$lib/i18n'
	const tFn = $derived($t)

	interface OnlineMember {
		userId:            string
		username:          string
		avatar:            string | null
		nameColor:         string | null
		nameGlow:          string | null
		nameGlowIntensity: number | null
		grade:             { name: string; color: string } | null
		status:            { emoji: string; text: string } | null
	}

	interface Props {
		config:   Record<string, unknown>
		instance: Record<string, unknown>
		user:     Record<string, unknown> | null
		title?:   string | null
	}

	let { config, instance, user }: Props = $props()

	// ── Fond ──────────────────────────────────────────────────────────────────
	const showBackground = $derived((config.show_background as boolean) ?? true)
	const bgImageUrl      = $derived((config.background_image_url as string) || (instance.banner_url as string) || '')
	const bgOffsetX       = $derived((config.background_offset_x as number) ?? 50)
	const bgOffsetY       = $derived((config.background_offset_y as number) ?? 50)
	const bgScale         = $derived(Math.min(2.5, Math.max(0.4, Number(config.background_scale ?? 1))))
	const overlayOpacity  = $derived((config.background_overlay_opacity as number) ?? 0.45)
	const height          = $derived((config.height as string) || '420px')

	// ── Logo ──────────────────────────────────────────────────────────────────
	const showLogo    = $derived((config.show_logo as boolean) ?? true)
	const logoUrl     = $derived((config.logo_url as string) || (instance.logo_url as string) || '')
	const logoOffsetX = $derived((config.logo_offset_x as number) ?? 50)
	const logoOffsetY = $derived((config.logo_offset_y as number) ?? 50)
	const logoSize     = $derived(Math.min(480, Math.max(32, Number(config.logo_size ?? 56))))

	// ── Texte ─────────────────────────────────────────────────────────────────
	const name        = $derived((instance.name as string) ?? 'Nodyx')
	const description = $derived((instance.description as string) ?? '')
	const heroLetter  = $derived(name?.charAt(0).toUpperCase() ?? 'N')

	const showTitle    = $derived((config.show_title as boolean) ?? true)
	const showSubtitle = $derived((config.show_subtitle as boolean) ?? true)
	const titleText    = $derived((config.title_text as string) || name)
	const subtitleText = $derived((config.subtitle_text as string) || description)
	const textHAlign   = $derived((config.text_h_align as string) || 'left')
	const textVAlign   = $derived((config.text_v_align as string) || 'center')
	const titleColor   = $derived((config.title_color as string) || '')
	const subtitleColor = $derived((config.subtitle_color as string) || '')
	const textFont     = $derived((config.text_font as string) || '')

	const titleStyle = $derived([
		titleColor ? `color:${titleColor}` : '',
		textFont   ? `font-family:${textFont}` : '',
	].filter(Boolean).join(';'))
	const subtitleStyle = $derived([
		subtitleColor ? `color:${subtitleColor}` : '',
		textFont      ? `font-family:${textFont}` : '',
	].filter(Boolean).join(';'))

	// ── CTA — pas de repli vers des liens de nav : si désactivé, rien du tout ──
	const showCta  = $derived((config.show_cta as boolean) ?? false)
	const ctaText  = $derived((config.cta_text as string) || '')
	const ctaUrl   = $derived((config.cta_url as string) || '')
	const ctaVisible = $derived(showCta && !!ctaText && !!ctaUrl)

	// ── Docks (stats / membres en ligne) — mêmes clés que hero-banner ──────────
	const showStats  = $derived((config.show_stats as boolean) ?? true)
	const showLive   = $derived((config.show_live  as boolean) ?? true)
	const liveMax    = $derived(Math.min(16, Math.max(3, Number(config.live_max ?? 8))))
	const guestMode  = $derived((config.guest_mode as string) ?? 'blur')

	const rawMembers = $derived((instance.member_count as number) ?? 0)
	const rawOnline  = $derived((instance.online_count as number) ?? 0)
	const rawThreads = $derived((instance.thread_count as number) ?? 0)

	let dispMembers = $state(0)
	let dispOnline  = $state(0)
	let dispThreads = $state(0)

	function animateTo(get: () => number, set: (v: number) => void, target: number) {
		const start = get()
		const diff  = target - start
		if (!diff) return
		let step = 0
		const timer = setInterval(() => {
			step++
			set(Math.round(start + diff * Math.min(1, step / 40)))
			if (step >= 40) { set(target); clearInterval(timer) }
		}, 25)
	}

	let onlineMembers = $state<OnlineMember[]>([])

	const visibleMembers = $derived(onlineMembers.slice(0, liveMax))
	const overflow       = $derived(Math.max(0, onlineMembers.length - liveMax))
	const liveNames      = $derived(() => {
		const shown = onlineMembers.slice(0, 2).map(m => m.username)
		const rest  = onlineMembers.length - 2
		if (rest > 0) return shown.join(', ') + ` et ${rest} autre${rest > 1 ? 's' : ''}`
		return shown.join(', ')
	})

	let _unsub: (() => void) | undefined

	onMount(async () => {
		animateTo(() => dispMembers, v => dispMembers = v, rawMembers)
		animateTo(() => dispOnline,  v => dispOnline  = v, rawOnline)
		animateTo(() => dispThreads, v => dispThreads = v, rawThreads)

		const { onlineMembersStore } = await import('$lib/socket')
		_unsub = onlineMembersStore.subscribe(members => {
			onlineMembers = members
			if (members.length > 0) dispOnline = members.length
		})
	})

	onDestroy(() => _unsub?.())

	function glowStyle(m: OnlineMember): string {
		if (!m.nameGlow) return ''
		const intensity = m.nameGlowIntensity ?? 0.5
		return `box-shadow: 0 0 ${Math.round(6 + intensity * 10)}px ${m.nameGlow}; border-color: ${m.nameGlow};`
	}
</script>

<section class="hdr-root" aria-label={name}>

	<div class="hdr-canvas noise" style="height:{height}">

		{#if showBackground && bgImageUrl}
			<img src={bgImageUrl} alt="" class="hdr-bg"
				style="object-position:{bgOffsetX}% {bgOffsetY}%; transform-origin:{bgOffsetX}% {bgOffsetY}%; transform: scale({bgScale})" />
			<div class="hdr-overlay" style="opacity:{overlayOpacity}"></div>
		{/if}

		{#if showLogo}
			<div class="hdr-logo-wrap" style="left:{logoOffsetX}%; top:{logoOffsetY}%; width:{logoSize}px; height:{logoSize}px;">
				{#if logoUrl}
					<img src={logoUrl} alt={name} class="hdr-logo-img" />
				{:else}
					<div class="hdr-logo-fallback" style="font-size:{Math.round(logoSize * 0.42)}px">{heroLetter}</div>
				{/if}
			</div>
		{/if}

		<div class="hdr-body hdr-body--h-{textHAlign} hdr-body--v-{textVAlign}">
			{#if showTitle}
				<h1 class="hdr-title" class:hdr-title--gradient={!titleColor} style={titleStyle}>{titleText}</h1>
			{/if}
			{#if showSubtitle && subtitleText}
				<p class="hdr-subtitle" style={subtitleStyle}>{subtitleText}</p>
			{/if}
			{#if ctaVisible}
				<div class="hdr-cta-row">
					<a href={ctaUrl} class="hdr-btn hdr-btn--primary">{ctaText}</a>
				</div>
			{/if}
		</div>

	</div>

	<!-- ── Stats dock ─────────────────────────────────────────────────── -->
	{#if showStats}
		<div class="hdr-stats-dock">
			<div class="hdr-stat">
				<span class="hdr-stat-num hdr-stat--purple">{dispMembers.toLocaleString()}</span>
				<span class="hdr-stat-label">{tFn('common.members') || 'membres'}</span>
			</div>
			<div class="hdr-stat-sep" aria-hidden="true"></div>
			<div class="hdr-stat">
				<span class="hdr-stat-num hdr-stat--green">
					<span class="hdr-pulse-dot" aria-hidden="true"></span>
					{dispOnline.toLocaleString()}
				</span>
				<span class="hdr-stat-label">{tFn('common.online') || 'en ligne'}</span>
			</div>
			<div class="hdr-stat-sep" aria-hidden="true"></div>
			<div class="hdr-stat">
				<span class="hdr-stat-num hdr-stat--cyan">{dispThreads.toLocaleString()}</span>
				<span class="hdr-stat-label">{tFn('common.topics') || 'sujets'}</span>
			</div>
		</div>
	{/if}

	<!-- ── Live members dock ──────────────────────────────────────────── -->
	{#if showLive}
		<div class="hdr-live-dock">

			{#if onlineMembers.length > 0}
				<div class="hdr-avatars">
					{#each visibleMembers as m (m.userId)}
						<div class="hdr-avatar" style={glowStyle(m)}>
							{#if m.avatar}
								<img src={m.avatar} alt="" />
							{:else}
								<span class="hdr-avatar-letter">{m.username.charAt(0).toUpperCase()}</span>
							{/if}
							{#if m.status?.emoji}
								<span class="hdr-status-badge" aria-hidden="true">{m.status.emoji}</span>
							{/if}
							<div class="hdr-tip" role="tooltip">
								<span class="hdr-tip-name" style={m.nameColor ? `color:${m.nameColor}` : ''}>{m.username}</span>
								{#if m.grade}
									<span class="hdr-tip-grade" style="color:{m.grade.color}">{m.grade.name}</span>
								{/if}
								{#if m.status?.text}
									<span class="hdr-tip-status">{m.status.emoji} {m.status.text}</span>
								{/if}
							</div>
						</div>
					{/each}
					{#if overflow > 0}
						<div class="hdr-avatar hdr-avatar--overflow" aria-label={tFn('hero.overflow_aria', { n: overflow })}>
							+{overflow}
						</div>
					{/if}
				</div>
				<span class="hdr-live-names">
					<span class="hdr-live-pulse" aria-hidden="true"></span>
					{liveNames()}
				</span>

			{:else if !user && guestMode === 'blur'}
				<div class="hdr-avatars">
					{#each Array(Math.min(5, rawOnline || 4)) as _}
						<div class="hdr-avatar hdr-avatar--blur" aria-hidden="true"></div>
					{/each}
				</div>
				<a href="/auth/register" class="hdr-live-cta">
					{tFn('hero.join_to_see')}
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
					</svg>
				</a>

			{:else if rawOnline > 0}
				<span class="hdr-live-pulse" aria-hidden="true"></span>
				<span class="hdr-live-count">{rawOnline.toLocaleString()} en ligne maintenant</span>

			{:else}
				<span class="hdr-live-empty">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/>
					</svg>
					{tFn('hero.be_first_online')}
				</span>
			{/if}

		</div>
	{/if}

</section>

<style>
	/* ── Root ──────────────────────────────────────────────────────────────── */
	.hdr-root {
		position: relative;
		background: var(--nc, #0a0a0f);
		border-bottom: var(--nbw, 1px) solid var(--nborder, rgba(255,255,255,.05));
		border-radius: var(--nr, 0px);
		overflow: hidden;
	}

	.hdr-canvas {
		position: relative;
		overflow: hidden;
		background: var(--nc, #0a0a0f);
	}

	.noise::after {
		content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
		background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
		opacity: .4;
	}

	/* ── Fond ──────────────────────────────────────────────────────────────── */
	.hdr-bg {
		position: absolute; inset: 0;
		width: 100%; height: 100%;
		object-fit: cover;
	}
	.hdr-overlay {
		position: absolute; inset: 0;
		background: #000;
	}

	/* ── Logo ──────────────────────────────────────────────────────────────── */
	.hdr-logo-wrap {
		position: absolute;
		transform: translate(-50%, -50%);
		z-index: 12;
	}
	.hdr-logo-img {
		width: 100%; height: 100%;
		object-fit: cover;
	}
	.hdr-logo-fallback {
		width: 100%; height: 100%;
		display: flex; align-items: center; justify-content: center;
		font-family: var(--nfont, 'Space Grotesk', sans-serif); font-weight: 900;
		color: #fff;
		background: linear-gradient(135deg, rgb(var(--np-rgb) / .4), rgb(var(--na-rgb) / .15));
		border: 1px solid rgb(var(--np-rgb) / .3);
	}

	/* ── Corps texte ───────────────────────────────────────────────────────── */
	.hdr-body {
		position: relative; z-index: 10;
		height: 100%;
		padding: 1.5rem 2rem;
		display: flex; flex-direction: column; gap: .5rem;
	}
	.hdr-body--h-left   { align-items: flex-start; text-align: left; }
	.hdr-body--h-center { align-items: center; text-align: center; }
	.hdr-body--h-right  { align-items: flex-end; text-align: right; }
	.hdr-body--v-top    { justify-content: flex-start; }
	.hdr-body--v-center { justify-content: center; }
	.hdr-body--v-bottom { justify-content: flex-end; }

	.hdr-title {
		font-family: var(--nfont, 'Space Grotesk', sans-serif); font-weight: 800;
		font-size: clamp(1.25rem, 2.8vw, 2.1rem);
		line-height: 1.05; margin: 0;
		color: var(--nt, #e5e7eb);
	}
	.hdr-title--gradient {
		background: linear-gradient(135deg, var(--np) 0%, var(--na) 100%);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
	}

	.hdr-subtitle {
		font-size: .9rem; color: var(--ntm, #9ca3af);
		max-width: 560px; line-height: 1.5; margin: 0;
	}

	/* ── CTA ───────────────────────────────────────────────────────────────── */
	.hdr-cta-row { margin-top: .3rem; }
	.hdr-btn {
		display: inline-block;
		padding: .55rem 1.2rem;
		font-family: var(--nfont, 'Space Grotesk', sans-serif); font-weight: 700;
		font-size: .8rem; text-transform: uppercase; letter-spacing: .1em;
		text-decoration: none; transition: filter .15s, transform .1s;
		white-space: nowrap;
	}
	.hdr-btn:active { transform: scale(.97); }
	.hdr-btn--primary {
		background: linear-gradient(135deg, var(--np), var(--na));
		border: 1px solid rgb(var(--np-rgb) / .45); color: #fff;
	}
	.hdr-btn--primary:hover { filter: brightness(1.12); }

	/* ── Stats dock ────────────────────────────────────────────────────────── */
	.hdr-stats-dock {
		position: relative; z-index: 10;
		display: flex; align-items: center;
		padding: .6rem 2rem;
		border-top: var(--nbw, 1px) solid var(--nborder, rgba(255,255,255,.06));
		background: var(--nc, rgba(0,0,0,.25));
		gap: 0;
	}
	.hdr-stat {
		display: flex; align-items: baseline; gap: .45rem;
		flex: 1; justify-content: center;
	}
	.hdr-stat-num {
		font-family: var(--nfont, 'Space Grotesk', sans-serif); font-weight: 900;
		font-size: 1.15rem; line-height: 1;
		display: flex; align-items: center; gap: 5px;
		font-variant-numeric: tabular-nums;
	}
	.hdr-stat--purple { color: var(--np); }
	.hdr-stat--green  { color: #4ade80; }
	.hdr-stat--cyan   { color: var(--na); }
	.hdr-stat-label {
		font-size: .65rem; font-weight: 700;
		text-transform: uppercase; letter-spacing: .16em;
		color: var(--ntm, #374151);
	}
	.hdr-stat-sep {
		width: 1px; height: 28px; flex-shrink: 0;
		background: var(--nborder, rgba(255,255,255,.06));
	}
	.hdr-pulse-dot {
		display: inline-block;
		width: 7px; height: 7px; border-radius: 50%;
		background: #4ade80;
		animation: hdr-dotpulse 2s ease-out infinite;
	}
	@keyframes hdr-dotpulse {
		0%   { box-shadow: 0 0 0 0 rgba(74,222,128,.55); }
		100% { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
	}

	/* ── Live dock ─────────────────────────────────────────────────────────── */
	.hdr-live-dock {
		position: relative; z-index: 10;
		display: flex; align-items: center; gap: .75rem;
		padding: .55rem 2rem;
		border-top: var(--nbw, 1px) solid var(--nborder, rgba(255,255,255,.05));
		background: var(--nc, rgba(0,0,0,.18));
	}
	.hdr-live-names {
		font-size: 11px; color: var(--ntm, #6b7280);
		display: flex; align-items: center; gap: 6px;
		min-width: 0; overflow: hidden;
		text-overflow: ellipsis; white-space: nowrap;
	}
	.hdr-live-pulse {
		width: 6px; height: 6px; flex-shrink: 0;
		border-radius: 50%; background: #4ade80;
		animation: hdr-dotpulse 2s ease-out infinite;
	}
	.hdr-live-count {
		font-size: 11px; color: var(--ntm, #4b5563);
		display: flex; align-items: center; gap: 6px;
	}
	.hdr-live-empty {
		font-size: 11px; color: var(--ntm, #374151);
		display: flex; align-items: center; gap: 6px;
	}
	.hdr-live-empty svg { width: 13px; height: 13px; }
	.hdr-live-cta {
		font-size: 11px; font-weight: 600; color: var(--nl, var(--np));
		text-decoration: none;
		display: flex; align-items: center; gap: 4px;
		transition: color .15s;
	}
	.hdr-live-cta:hover { filter: brightness(1.15); }
	.hdr-live-cta svg { width: 11px; height: 11px; }

	/* ── Avatars ───────────────────────────────────────────────────────────── */
	.hdr-avatars { display: flex; align-items: center; flex-shrink: 0; }
	.hdr-avatar {
		position: relative;
		width: 28px; height: 28px;
		border-radius: 4px;
		border: 1.5px solid rgb(var(--np-rgb) / .25);
		overflow: visible;
		flex-shrink: 0;
		margin-right: -7px;
		transition: transform .15s, z-index 0s;
		cursor: default;
		background: rgb(var(--np-rgb) / .1);
	}
	.hdr-avatar img,
	.hdr-avatar .hdr-avatar-letter {
		width: 100%; height: 100%;
		object-fit: cover;
		border-radius: 3px;
		display: flex; align-items: center; justify-content: center;
		overflow: hidden;
	}
	.hdr-avatar-letter {
		font-size: 11px; font-weight: 800; color: var(--np);
		display: flex !important; align-items: center; justify-content: center;
	}
	.hdr-avatar:hover { transform: translateY(-3px) scale(1.1); z-index: 50; }
	.hdr-avatar--overflow {
		background: var(--nc, rgba(255,255,255,.07));
		border-color: var(--nborder, rgba(255,255,255,.12));
		display: flex; align-items: center; justify-content: center;
		font-size: 9px; font-weight: 800; color: var(--ntm, #6b7280);
		cursor: default;
		overflow: hidden;
	}
	.hdr-avatar--blur {
		background: rgb(var(--np-rgb) / .08);
		filter: blur(2px);
		cursor: default;
	}
	.hdr-avatars .hdr-avatar:last-child { margin-right: 0; }

	.hdr-status-badge {
		position: absolute;
		bottom: -4px; right: -4px;
		font-size: 9px; line-height: 1;
		background: var(--nc, #0a0a0f);
		border-radius: 50%;
		padding: 1px;
		pointer-events: none;
	}

	.hdr-tip {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--nc, #12121c);
		border: var(--nbw, 1px) solid var(--nborder, rgba(255,255,255,.1));
		padding: 6px 10px;
		border-radius: 5px;
		white-space: nowrap;
		display: flex; flex-direction: column; gap: 2px;
		font-size: 11px;
		pointer-events: none;
		opacity: 0;
		transition: opacity .12s;
		z-index: 100;
		min-width: 80px;
	}
	.hdr-tip::after {
		content: '';
		position: absolute; top: 100%; left: 50%;
		transform: translateX(-50%);
		border: 5px solid transparent;
		border-top-color: var(--nborder, rgba(255,255,255,.1));
	}
	.hdr-avatar:hover .hdr-tip { opacity: 1; }

	.hdr-tip-name   { font-weight: 700; color: var(--nt, #e2e8f0); }
	.hdr-tip-grade  { font-size: 10px; font-weight: 600; }
	.hdr-tip-status { font-size: 10px; color: var(--ntm, #6b7280); }

	/* ── Responsive ────────────────────────────────────────────────────────── */
	@media (max-width: 640px) {
		.hdr-body { padding: 1.1rem 1rem; }
		.hdr-stats-dock { padding: .5rem 1rem; gap: 0; }
		.hdr-stat-num { font-size: .95rem; }
		.hdr-live-dock { padding: .5rem 1rem; }
	}
</style>
