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

	// ── Hero config ───────────────────────────────────────────────────────────
	const style          = $derived((config.style as string) ?? 'centered')
	const overlayOpacity = $derived((config.overlay_opacity as number) ?? 0.5)
	const ctaText        = $derived((config.cta_text as string) ?? null)
	const ctaUrl         = $derived((config.cta_url as string) ?? null)
	const subtitle       = $derived((config.subtitle as string) ?? null)
	const bgImageUrl     = $derived((config.background_image_url as string) ?? (instance.banner_url as string) ?? null)

	const variant      = $derived((config._variant as string) ?? 'default')
	const featuredEvent = $derived((config._featured_event as Record<string,unknown>) ?? null)
	const isLive       = $derived(variant === 'live')
	const isEvent      = $derived(variant === 'event' && !!featuredEvent)

	const name        = $derived((instance.name as string) ?? 'Nodyx')
	const description = $derived((instance.description as string) ?? '')
	const logoUrl     = $derived((instance.logo_url as string) ?? null)
	const heroLetter  = $derived(name?.charAt(0).toUpperCase() ?? 'N')
	const eventTitle  = $derived(isEvent ? (featuredEvent?.title as string) : null)
	const eventCover  = $derived(isEvent ? (featuredEvent?.cover_url as string) : null)
	const effectiveBg = $derived(eventCover ?? bgImageUrl)

	// ── Docks config ─────────────────────────────────────────────────────────
	const showStats  = $derived((config.show_stats   as boolean) ?? true)
	const showLive   = $derived((config.show_live    as boolean) ?? true)
	const liveMax    = $derived(Math.min(16, Math.max(3, Number(config.live_max ?? 8))))
	const guestMode  = $derived((config.guest_mode   as string) ?? 'blur')

	// ── Stats ─────────────────────────────────────────────────────────────────
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

	// ── Live members ──────────────────────────────────────────────────────────
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

<section class="hb-root noise" aria-label={name}>

	<!-- Background -->
	{#if effectiveBg}
		<img src={effectiveBg} alt="" class="hb-bg" style="opacity:{overlayOpacity * 0.13}" />
	{/if}

	<!-- Decorative orbs -->
	<div class="hb-orb hb-orb--tl" aria-hidden="true"></div>
	<div class="hb-orb hb-orb--br" aria-hidden="true"></div>

	<!-- Decorative letter -->
	<div class="hb-deco-letter" aria-hidden="true">{heroLetter}</div>

	<!-- Live badge -->
	{#if isLive}
		<div class="hb-live-badge" aria-label="Stream en direct">
			<span class="hb-live-dot"></span>
			<span>Live</span>
		</div>
	{/if}

	<!-- ── Main content ────────────────────────────────────────────────── -->
	<div class="hb-body" class:hb-body--center={style === 'centered'}>

		{#if isEvent && eventTitle}
			<div class="hb-event-eyebrow">
				<span class="hb-eyebrow-line"></span>
				<span>Événement à venir</span>
			</div>
			<h1 class="hb-title hb-title--event">{eventTitle}</h1>

		{:else}
			<div class="hb-identity">
				{#if logoUrl}
					<img src={logoUrl} alt={name} class="hb-logo" />
				{:else}
					<div class="hb-logo-fallback">{heroLetter}</div>
				{/if}
				<div>
					<h1 class="hb-title">{name}</h1>
					{#if subtitle || description}
						<p class="hb-subtitle">{subtitle || description}</p>
					{/if}
				</div>
			</div>
		{/if}

		<!-- CTA row -->
		<div class="hb-cta-row">
			{#if ctaText && ctaUrl && !user}
				<a href={ctaUrl} class="hb-btn hb-btn--primary">{ctaText}</a>
			{:else if user}
				<a href="/forum" class="hb-btn hb-btn--primary">{tFn('nav.forum')}</a>
				<a href="/chat"  class="hb-btn hb-btn--ghost">{tFn('nav.chat')}</a>
			{:else}
				<a href="/auth/login"    class="hb-btn hb-btn--ghost">{tFn('common.login')}</a>
				<a href="/auth/register" class="hb-btn hb-btn--primary">{tFn('common.join')}</a>
			{/if}
		</div>
	</div>

	<!-- ── Stats dock ─────────────────────────────────────────────────── -->
	{#if showStats}
		<div class="hb-stats-dock">
			<div class="hb-stat">
				<span class="hb-stat-num hb-stat--purple">{dispMembers.toLocaleString()}</span>
				<span class="hb-stat-label">{tFn('common.members') || 'membres'}</span>
			</div>
			<div class="hb-stat-sep" aria-hidden="true"></div>
			<div class="hb-stat">
				<span class="hb-stat-num hb-stat--green">
					<span class="hb-pulse-dot" aria-hidden="true"></span>
					{dispOnline.toLocaleString()}
				</span>
				<span class="hb-stat-label">{tFn('common.online') || 'en ligne'}</span>
			</div>
			<div class="hb-stat-sep" aria-hidden="true"></div>
			<div class="hb-stat">
				<span class="hb-stat-num hb-stat--cyan">{dispThreads.toLocaleString()}</span>
				<span class="hb-stat-label">{tFn('common.topics') || 'sujets'}</span>
			</div>
		</div>
	{/if}

	<!-- ── Live members dock ──────────────────────────────────────────── -->
	{#if showLive}
		<div class="hb-live-dock">

			{#if onlineMembers.length > 0}
				<!-- Connected members visible -->
				<div class="hb-avatars">
					{#each visibleMembers as m (m.userId)}
						<div class="hb-avatar" style={glowStyle(m)}>
							{#if m.avatar}
								<img src={m.avatar} alt="" />
							{:else}
								<span class="hb-avatar-letter">{m.username.charAt(0).toUpperCase()}</span>
							{/if}
							{#if m.status?.emoji}
								<span class="hb-status-badge" aria-hidden="true">{m.status.emoji}</span>
							{/if}
							<!-- Tooltip -->
							<div class="hb-tip" role="tooltip">
								<span class="hb-tip-name" style={m.nameColor ? `color:${m.nameColor}` : ''}>{m.username}</span>
								{#if m.grade}
									<span class="hb-tip-grade" style="color:{m.grade.color}">{m.grade.name}</span>
								{/if}
								{#if m.status?.text}
									<span class="hb-tip-status">{m.status.emoji} {m.status.text}</span>
								{/if}
							</div>
						</div>
					{/each}
					{#if overflow > 0}
						<div class="hb-avatar hb-avatar--overflow" aria-label="{overflow} autres membres en ligne">
							+{overflow}
						</div>
					{/if}
				</div>
				<span class="hb-live-names">
					<span class="hb-live-pulse" aria-hidden="true"></span>
					{liveNames()}
				</span>

			{:else if !user && guestMode === 'blur'}
				<!-- Guest — blur mode -->
				<div class="hb-avatars">
					{#each Array(Math.min(5, rawOnline || 4)) as _}
						<div class="hb-avatar hb-avatar--blur" aria-hidden="true"></div>
					{/each}
				</div>
				<a href="/auth/register" class="hb-live-cta">
					Rejoindre pour voir qui est là
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
					</svg>
				</a>

			{:else if rawOnline > 0}
				<!-- Guest — count or full mode, or members with empty store -->
				<span class="hb-live-pulse" aria-hidden="true"></span>
				<span class="hb-live-count">{rawOnline.toLocaleString()} en ligne maintenant</span>

			{:else}
				<span class="hb-live-empty">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z"/>
					</svg>
					Sois le premier en ligne ce soir
				</span>
			{/if}

		</div>
	{/if}

</section>

<style>
	/* ── Root ──────────────────────────────────────────────────────────────── */
	.hb-root {
		position: relative;
		overflow: hidden;
		background: #0a0a0f;
		border-bottom: 1px solid rgba(255,255,255,.05);
	}

	.noise::after {
		content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 1;
		background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
		opacity: .4;
	}

	/* ── Background / Deco ─────────────────────────────────────────────────── */
	.hb-bg {
		position: absolute; inset: 0;
		width: 100%; height: 100%;
		object-fit: cover;
		transition: opacity .7s;
	}
	.hb-orb {
		position: absolute;
		border-radius: 50%;
		pointer-events: none;
	}
	.hb-orb--tl {
		top: -160px; left: -80px;
		width: 500px; height: 500px;
		background: radial-gradient(circle, rgba(124,58,237,.16) 0%, transparent 65%);
	}
	.hb-orb--br {
		bottom: -80px; right: 0;
		width: 380px; height: 380px;
		background: radial-gradient(circle, rgba(6,182,212,.09) 0%, transparent 65%);
	}
	.hb-deco-letter {
		position: absolute; right: 6%; top: 50%; transform: translateY(-50%);
		font-family: 'Space Grotesk', sans-serif; font-weight: 800;
		font-size: clamp(120px, 18vw, 260px);
		line-height: 1;
		background: linear-gradient(135deg, rgba(124,58,237,.45) 0%, rgba(6,182,212,.18) 50%, transparent 80%);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
		user-select: none; pointer-events: none; opacity: .7;
	}

	/* ── Live badge ────────────────────────────────────────────────────────── */
	.hb-live-badge {
		position: absolute; top: 14px; left: 14px; z-index: 20;
		display: flex; align-items: center; gap: 7px;
		padding: 4px 12px;
		background: rgba(239,68,68,.13);
		border: 1px solid rgba(239,68,68,.4);
		font-size: 11px; font-weight: 900; text-transform: uppercase;
		letter-spacing: .18em; color: #ef4444;
		font-family: 'Space Grotesk', sans-serif;
	}
	.hb-live-dot {
		width: 7px; height: 7px;
		border-radius: 50%;
		background: #ef4444;
		animation: livepulse 1.2s ease-in-out infinite;
	}
	@keyframes livepulse {
		0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(239,68,68,.6); }
		50%       { opacity: .7; box-shadow: 0 0 0 5px rgba(239,68,68,0); }
	}

	/* ── Main body ─────────────────────────────────────────────────────────── */
	.hb-body {
		position: relative; z-index: 10;
		padding: 1.5rem 2rem 1.25rem;
		display: flex; flex-direction: column; gap: 1rem;
	}
	.hb-body--center { align-items: center; text-align: center; }

	.hb-event-eyebrow {
		display: flex; align-items: center; gap: .6rem;
		font-size: 10px; font-weight: 800; text-transform: uppercase;
		letter-spacing: .22em; color: var(--nx-accent-2-soft);
		font-family: 'Space Grotesk', sans-serif;
	}
	.hb-eyebrow-line {
		height: 1px; width: 40px;
		background: linear-gradient(to right, var(--nx-accent-2-strong), #06b6d4);
	}

	.hb-identity {
		display: flex; align-items: center; gap: 1.1rem;
	}

	.hb-logo {
		width: 48px; height: 48px;
		object-fit: cover; flex-shrink: 0;
		outline: 2px solid rgba(124,58,237,.45);
		outline-offset: 2px;
	}
	.hb-logo-fallback {
		width: 48px; height: 48px; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center;
		font-family: 'Space Grotesk', sans-serif; font-weight: 900;
		font-size: 1.3rem; color: #fff;
		background: linear-gradient(135deg, rgba(124,58,237,.4), rgba(6,182,212,.15));
		border: 1px solid rgba(124,58,237,.3);
	}

	.hb-title {
		font-family: 'Space Grotesk', sans-serif; font-weight: 800;
		font-size: clamp(1.25rem, 2.4vw, 1.85rem);
		line-height: 1.05; margin: 0 0 .2rem;
		background: linear-gradient(135deg, var(--nx-accent-2-soft) 0%, #06b6d4 100%);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
	}
	.hb-title--event {
		font-size: clamp(1.4rem, 2.8vw, 2.2rem); margin: 0;
	}

	.hb-subtitle {
		font-size: .875rem; color: #6b7280;
		max-width: 480px; line-height: 1.5; margin: 0;
	}

	/* ── CTA row ───────────────────────────────────────────────────────────── */
	.hb-cta-row {
		display: flex; align-items: center; gap: .5rem; flex-wrap: wrap;
	}
	.hb-btn {
		padding: .55rem 1.2rem;
		font-family: 'Space Grotesk', sans-serif; font-weight: 700;
		font-size: .8rem; text-transform: uppercase; letter-spacing: .1em;
		text-decoration: none; transition: filter .15s, transform .1s;
		white-space: nowrap;
	}
	.hb-btn:active { transform: scale(.97); }
	.hb-btn--primary {
		background: linear-gradient(135deg, var(--nx-accent-2-strong), #0e7490);
		border: 1px solid rgba(124,58,237,.45); color: #fff;
	}
	.hb-btn--primary:hover { filter: brightness(1.12); }
	.hb-btn--ghost {
		border: 1px solid rgba(255,255,255,.12); color: #9ca3af;
	}
	.hb-btn--ghost:hover { border-color: rgba(167,139,250,.4); color: var(--nx-accent-2-soft2); }

	/* ── Stats dock ────────────────────────────────────────────────────────── */
	.hb-stats-dock {
		position: relative; z-index: 10;
		display: flex; align-items: center;
		padding: .6rem 2rem;
		border-top: 1px solid rgba(255,255,255,.06);
		background: rgba(0,0,0,.25);
		gap: 0;
	}
	.hb-stat {
		display: flex; align-items: baseline; gap: .45rem;
		flex: 1; justify-content: center;
	}
	.hb-stat-num {
		font-family: 'Space Grotesk', sans-serif; font-weight: 900;
		font-size: 1.15rem; line-height: 1;
		display: flex; align-items: center; gap: 5px;
		font-variant-numeric: tabular-nums;
	}
	.hb-stat--purple { color: var(--nx-accent-2-soft); animation: numglow 4s ease-in-out infinite; }
	.hb-stat--green  { color: #4ade80; }
	.hb-stat--cyan   { color: #67e8f9; }
	.hb-stat-label {
		font-size: .65rem; font-weight: 700;
		text-transform: uppercase; letter-spacing: .16em;
		color: #374151;
	}
	.hb-stat-sep {
		width: 1px; height: 28px; flex-shrink: 0;
		background: rgba(255,255,255,.06);
	}
	.hb-pulse-dot {
		display: inline-block;
		width: 7px; height: 7px; border-radius: 50%;
		background: #4ade80;
		animation: dotpulse 2s ease-out infinite;
	}
	@keyframes numglow {
		0%, 100% { text-shadow: 0 0 0 rgba(167,139,250,0); }
		50%       { text-shadow: 0 0 18px rgba(167,139,250,.45); }
	}
	@keyframes dotpulse {
		0%   { box-shadow: 0 0 0 0 rgba(74,222,128,.55); }
		100% { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
	}

	/* ── Live dock ─────────────────────────────────────────────────────────── */
	.hb-live-dock {
		position: relative; z-index: 10;
		display: flex; align-items: center; gap: .75rem;
		padding: .55rem 2rem;
		border-top: 1px solid rgba(255,255,255,.05);
		background: rgba(0,0,0,.18);
	}
	.hb-live-names {
		font-size: 11px; color: #6b7280;
		display: flex; align-items: center; gap: 6px;
		min-width: 0; overflow: hidden;
		text-overflow: ellipsis; white-space: nowrap;
	}
	.hb-live-pulse {
		width: 6px; height: 6px; flex-shrink: 0;
		border-radius: 50%; background: #4ade80;
		animation: dotpulse 2s ease-out infinite;
	}
	.hb-live-count {
		font-size: 11px; color: #4b5563;
		display: flex; align-items: center; gap: 6px;
	}
	.hb-live-empty {
		font-size: 11px; color: #374151;
		display: flex; align-items: center; gap: 6px;
	}
	.hb-live-empty svg { width: 13px; height: 13px; }
	.hb-live-cta {
		font-size: 11px; font-weight: 600; color: var(--nx-accent-2-soft);
		text-decoration: none;
		display: flex; align-items: center; gap: 4px;
		transition: color .15s;
	}
	.hb-live-cta:hover { color: var(--nx-accent-2-soft2); }
	.hb-live-cta svg { width: 11px; height: 11px; }

	/* ── Avatars ───────────────────────────────────────────────────────────── */
	.hb-avatars {
		display: flex; align-items: center;
		flex-shrink: 0;
	}
	.hb-avatar {
		position: relative;
		width: 28px; height: 28px;
		border-radius: 4px;
		border: 1.5px solid rgba(167,139,250,.25);
		overflow: visible;
		flex-shrink: 0;
		margin-right: -7px;
		transition: transform .15s, z-index 0s;
		cursor: default;
		background: rgba(167,139,250,.1);
	}
	/* Need inner clip for image without clipping tooltip */
	.hb-avatar img,
	.hb-avatar .hb-avatar-letter {
		width: 100%; height: 100%;
		object-fit: cover;
		border-radius: 3px;
		display: flex; align-items: center; justify-content: center;
		overflow: hidden;
	}
	.hb-avatar-letter {
		font-size: 11px; font-weight: 800; color: var(--nx-accent-2-soft);
		display: flex !important; align-items: center; justify-content: center;
	}
	.hb-avatar:hover {
		transform: translateY(-3px) scale(1.1);
		z-index: 50;
	}
	.hb-avatar--overflow {
		background: rgba(255,255,255,.07);
		border-color: rgba(255,255,255,.12);
		display: flex; align-items: center; justify-content: center;
		font-size: 9px; font-weight: 800; color: #6b7280;
		cursor: default;
		overflow: hidden;
	}
	.hb-avatar--blur {
		background: rgba(167,139,250,.08);
		filter: blur(2px);
		cursor: default;
	}
	.hb-avatars .hb-avatar:last-child { margin-right: 0; }

	/* Status badge */
	.hb-status-badge {
		position: absolute;
		bottom: -4px; right: -4px;
		font-size: 9px; line-height: 1;
		background: #0a0a0f;
		border-radius: 50%;
		padding: 1px;
		pointer-events: none;
	}

	/* Tooltip */
	.hb-tip {
		position: absolute;
		bottom: calc(100% + 8px);
		left: 50%;
		transform: translateX(-50%);
		background: #12121c;
		border: 1px solid rgba(255,255,255,.1);
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
	.hb-tip::after {
		content: '';
		position: absolute; top: 100%; left: 50%;
		transform: translateX(-50%);
		border: 5px solid transparent;
		border-top-color: rgba(255,255,255,.1);
	}
	.hb-avatar:hover .hb-tip { opacity: 1; }

	.hb-tip-name  { font-weight: 700; color: #e2e8f0; }
	.hb-tip-grade { font-size: 10px; font-weight: 600; }
	.hb-tip-status { font-size: 10px; color: #6b7280; }

	/* ── Responsive ────────────────────────────────────────────────────────── */
	@media (max-width: 640px) {
		.hb-body { padding: 1.1rem 1rem .9rem; }
		.hb-stats-dock { padding: .5rem 1rem; gap: 0; }
		.hb-stat-num { font-size: .95rem; }
		.hb-live-dock { padding: .5rem 1rem; }
		.hb-deco-letter { opacity: .3; }
	}
</style>
