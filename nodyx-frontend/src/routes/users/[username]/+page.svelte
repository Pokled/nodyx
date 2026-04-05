<script lang="ts">
	import type { PageData } from './$types'
	import GitHubWidget from '$lib/components/widgets/GitHubWidget.svelte'
	import ReputationRings from '$lib/components/ReputationRings.svelte'
	import GenerativeBanner from '$lib/components/GenerativeBanner.svelte'
	import ActivityHeatmap from '$lib/components/ActivityHeatmap.svelte'
	import { page } from '$app/stores'
	import { resolveTheme, themeToStyle } from '$lib/profileThemes'
	import { socket } from '$lib/socket'
	import { apiFetch } from '$lib/api'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()
	const profile = $derived(data.profile)

	// Logged-in user — from parent layout
	const me = $derived(($page.data as any).user)
	const isOwnProfile = $derived(me?.username === profile.username)

	// Initials fallback
	const initials = $derived((profile.display_name || profile.username).trim().charAt(0).toUpperCase())

	// Live points — synced from server data, updated in real time via socket
	let livePoints = $state(profile.points)
	$effect(() => { livePoints = profile.points })

	$effect(() => {
		const sock = $socket
		if (!sock) return
		function onPointsUpdated(data: { points: number }) {
			livePoints = data.points
		}
		sock.on('user:points_updated', onPointsUpdated)
		return () => { sock.off('user:points_updated', onPointsUpdated) }
	})

	// Level from points — sqrt progression, +1 offset so level 1 starts at 0 pts
	// level 1: 0–9 pts, level 2: 10–39 pts, level 3: 40–89 pts…
	const level = $derived(Math.floor(Math.sqrt(Math.max(0, livePoints) / 10)) + 1)
	const levelMin = $derived((level - 1) * (level - 1) * 10)
	const levelMax = $derived(level * level * 10)
	const levelProgress = $derived(
		levelMax > levelMin
			? Math.min(100, Math.round(((livePoints - levelMin) / (levelMax - levelMin)) * 100))
			: 100
	)

	// Formatted dates
	const memberSinceFormatted = $derived(
		new Date(profile.created_at).toLocaleDateString([], { month: 'long', year: 'numeric' })
	)
	const daysSince = $derived(
		Math.floor((Date.now() - new Date(profile.created_at).getTime()) / (1000 * 60 * 60 * 24))
	)

	// Grade luminance for text color
	function gradeTextColor(hex: string): string {
		if (!hex || !hex.startsWith('#') || hex.length < 7) return '#ffffff'
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#111827' : '#ffffff'
	}

	// Stats cards
	const stats = $derived([
		{ label: tFn('user.stat_posts'), value: Number(profile.post_count ?? 0).toLocaleString(), icon: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z', color: 'indigo' },
		{ label: tFn('user.stat_threads'), value: Number(profile.thread_count ?? 0).toLocaleString(), icon: 'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z', color: 'violet' },
		{ label: tFn('user.stat_xp'), value: Number(livePoints ?? 0).toLocaleString(), icon: 'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z', color: 'yellow' },
		{ label: tFn('user.stat_active_days'), value: daysSince.toLocaleString(), icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5', color: 'teal' },
	])

	// Social links — only show those that are set
	const socialLinks = $derived([
		profile.github_username && {
			label: 'GitHub',
			url: `https://github.com/${profile.github_username}`,
			handle: profile.github_username,
		},
		profile.twitter_username && {
			label: 'Twitter / X',
			url: `https://twitter.com/${profile.twitter_username}`,
			handle: `@${profile.twitter_username}`,
		},
		profile.instagram_username && {
			label: 'Instagram',
			url: `https://instagram.com/${profile.instagram_username}`,
			handle: `@${profile.instagram_username}`,
		},
		profile.youtube_channel && {
			label: 'YouTube',
			url: profile.youtube_channel.startsWith('http') ? profile.youtube_channel : `https://youtube.com/${profile.youtube_channel}`,
			handle: profile.youtube_channel,
		},
		profile.website_url && {
			label: tFn('user.website'),
			url: profile.website_url,
			handle: profile.website_url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
		},
	].filter(Boolean) as { label: string; url: string; handle: string }[])

	const title = $derived(`${profile.display_name || profile.username} — Nodyx`)
	const description = $derived(
		profile.bio ? profile.bio.slice(0, 160) : `${profile.display_name || profile.username}`
	)

	// Equipped assets — build display URLs from relative file paths
	const bannerSrc  = $derived(
		profile.banner_asset_path ? `/uploads/${profile.banner_asset_path}` : profile.banner_url ?? null
	)
	const frameSrc   = $derived(profile.frame_asset_path ? `/uploads/${profile.frame_asset_path}` : null)
	const badgeSrc   = $derived(profile.badge_asset_path ? `/uploads/${profile.badge_asset_path}` : null)

	// Theme
	const theme = $derived(resolveTheme(profile.metadata?.theme))
	const scopeStyle = $derived(themeToStyle(theme))
	// Accent hex direct — used for inline gradient blobs (avoids CSS var chain issues)
	const accent = $derived(theme.accent ?? '#6366f1')

	// Reputation Rings — computed from existing data, no backend needed
	const ringLongevity  = $derived(Math.min(1, daysSince / 365))
	const ringQuality    = $derived(Math.min(1, livePoints / 500))
	const ringEngagement = $derived(
		(() => {
			const posts   = Number(profile.post_count   ?? 0)
			const threads = Number(profile.thread_count ?? 0)
			if (posts + threads === 0) return 0
			// Ratio threads / (posts + threads) — création vs réponse
			return Math.min(1, (threads * 2) / Math.max(1, posts + threads))
		})()
	)

	// ── Parallax ────────────────────────────────────────────────────
	let parallaxY = $state(0)
	$effect(() => {
		function onScroll() { parallaxY = window.scrollY }
		window.addEventListener('scroll', onScroll, { passive: true })
		return () => window.removeEventListener('scroll', onScroll)
	})

	// ── Timeline jalons ─────────────────────────────────────────────
	interface Milestone { label: string; detail: string; reached: boolean; accent?: boolean }
	const timeline = $derived((() => {
		const created = new Date(profile.created_at)
		const fmt = (d: Date) => d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
		const add = (days: number) => new Date(created.getTime() + days * 86_400_000)
		const posts   = Number(profile.post_count   ?? 0)
		const threads = Number(profile.thread_count ?? 0)

		const items: Milestone[] = [
			{ label: tFn('user.milestone_arrival'),         detail: fmt(created),    reached: true, accent: true },
			{ label: tFn('user.milestone_first_post'),      detail: tFn('user.milestone_broke_ice'), reached: posts >= 1 },
			{ label: tFn('user.milestone_first_thread'),   detail: tFn('user.milestone_opened_thread'), reached: threads >= 1 },
			{ label: tFn('user.milestone_1_month'),        detail: fmt(add(30)),    reached: daysSince >= 30 },
			{ label: tFn('user.milestone_level5'),         detail: '160 XP',        reached: level >= 5 },
			{ label: tFn('user.milestone_10_posts'),       detail: tFn('user.milestone_contributor'), reached: posts >= 10 },
			{ label: tFn('user.milestone_3_months'),       detail: fmt(add(90)),    reached: daysSince >= 90 },
			{ label: tFn('user.milestone_level10'),        detail: '810 XP',        reached: level >= 10 },
			{ label: tFn('user.milestone_50_posts'),       detail: tFn('user.milestone_regular'), reached: posts >= 50 },
			{ label: tFn('user.milestone_6_months'),       detail: fmt(add(180)),   reached: daysSince >= 180 },
			{ label: tFn('user.milestone_level20'),        detail: '3 610 XP',      reached: level >= 20 },
			{ label: tFn('user.milestone_1_year'),         detail: fmt(add(365)),   reached: daysSince >= 365, accent: true },
			{ label: tFn('user.milestone_level30'),        detail: '8 910 XP',      reached: level >= 30 },
			{ label: tFn('user.milestone_2_years'),        detail: fmt(add(730)),   reached: daysSince >= 730, accent: true },
		]
		return items
	})())

	// Level rank label
	const rankLabel = $derived(
		level >= 50 ? tFn('user.rank_legend') :
		level >= 30 ? tFn('user.rank_expert') :
		level >= 20 ? tFn('user.rank_veteran') :
		level >= 10 ? tFn('user.rank_confirmed') :
		level >= 5  ? tFn('user.rank_active') :
		level >= 2  ? tFn('user.rank_novice') :
		tFn('user.rank_explorer')
	)

	// ── Follow system ──────────────────────────────────────────────
	const token = $derived(($page.data as any).token as string | null)

	let following      = $state(data.isFollowing ?? false)
	let followersCount = $state(Number(profile.followers_count ?? 0))
	let followLoading  = $state(false)
	const followingCount = $derived(Number(profile.following_count ?? 0))

	async function toggleFollow() {
		if (!me || followLoading) return
		followLoading = true
		const wasFollowing = following
		following      = !wasFollowing
		followersCount += wasFollowing ? -1 : 1
		try {
			const res = await apiFetch(fetch, `/social/${profile.username}/follow`, {
				method:  wasFollowing ? 'DELETE' : 'POST',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (!res.ok) {
				following      = wasFollowing
				followersCount -= wasFollowing ? -1 : 1
			}
		} catch {
			following      = wasFollowing
			followersCount -= wasFollowing ? -1 : 1
		} finally {
			followLoading = false
		}
	}

	// ── Posts tab ──────────────────────────────────────────────────
	let activeTab    = $state<'about' | 'posts'>('about')
	let userPosts    = $state<any[]>(data.posts ?? [])
	let postsLoading = $state(false)
	let postsHasMore = $state((data.posts?.length ?? 0) === 10)

	function fmt(n: number): string {
		return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
	}
	function timeAgo(iso: string): string {
		const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
		if (s <    60) return `${s}s`
		if (s <  3600) return `${Math.floor(s / 60)}min`
		if (s < 86400) return `${Math.floor(s / 3600)}h`
		return `${Math.floor(s / 86400)}j`
	}

	async function loadMorePosts() {
		if (postsLoading || !postsHasMore) return
		postsLoading = true
		const last = userPosts[userPosts.length - 1]
		try {
			const res = await apiFetch(fetch, `/social/${profile.username}/posts?limit=10&before=${last.created_at}`)
			if (res.ok) {
				const more = (await res.json()).posts ?? []
				userPosts    = [...userPosts, ...more]
				postsHasMore = more.length === 10
			}
		} finally { postsLoading = false }
	}

	async function togglePostLike(post: any) {
		const wasLiked = post.liked_by_me
		const delta    = wasLiked ? -1 : 1
		userPosts = userPosts.map(p => p.id === post.id
			? { ...p, liked_by_me: !wasLiked, likes_count: (p.likes_count ?? 0) + delta }
			: p
		)
		await apiFetch(fetch, `/social/status/${post.id}/like`, {
			method:  wasLiked ? 'DELETE' : 'POST',
			headers: { Authorization: `Bearer ${token}` },
		})
	}
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	<meta property="og:title" content={title} />
	<meta property="og:description" content={description} />
	{#if profile.avatar_url}
		<meta property="og:image" content={profile.avatar_url} />
	{/if}
	<meta property="og:type" content="profile" />
</svelte:head>

<div class="profile-scope min-h-full -mx-4 sm:-mx-6 px-0" style={scopeStyle}>

<!-- ═══════════════════════════════════════════════════════════════
     HERO — Banner + identity passport
     ═══════════════════════════════════════════════════════════════ -->
<div class="relative w-full" style="height: 320px">

	<!-- Banner layers -->
	<div class="absolute inset-0 overflow-hidden" style="background: var(--p-bg)">

		<!-- Parallax wrapper — moves at 35% of scroll speed -->
		<div class="absolute inset-0 will-change-transform"
		     style="transform: translateY({Math.min(parallaxY * 0.35, 60)}px)">
			{#if bannerSrc}
				<img src={bannerSrc} alt="" aria-hidden="true"
				     class="absolute inset-0 w-full h-full object-cover"
				     style="opacity: 0.55; mix-blend-mode: luminosity"/>
				<div class="profile-aurora-a" style="background: radial-gradient(ellipse 70% 90% at 20% 55%, {accent}cc, transparent 65%)"></div>
				<div class="profile-aurora-b" style="background: radial-gradient(ellipse 55% 75% at 78% 35%, {accent}77, transparent 65%)"></div>
				<div class="profile-aurora-c" style="background: radial-gradient(ellipse 45% 65% at 55% 85%, {accent}44, transparent 65%)"></div>
			{:else}
				<GenerativeBanner username={profile.username} />
			{/if}
		</div>

		<!-- Gradient overlays for text readability -->
		<div class="absolute inset-0" style="background: linear-gradient(to bottom, transparent 20%, {accent}0a 60%, var(--p-bg) 100%)"></div>
		<div class="absolute inset-0" style="background: linear-gradient(to right, var(--p-bg) 0%, transparent 40%)"></div>
	</div>

	<!-- Identity passport — anchored at banner bottom -->
	<div class="absolute bottom-0 inset-x-0 z-10">
		<div class="max-w-6xl mx-auto px-6 flex items-end gap-6 pb-6">

			<!-- Avatar with frame -->
			<div class="relative shrink-0 translate-y-10" style="width:128px;height:128px;overflow:visible">
				<!-- Spinning arcs (SVG-native animateTransform) -->
				<svg class="absolute pointer-events-none select-none"
				     style="inset:-14px;width:calc(100% + 28px);height:calc(100% + 28px);z-index:20"
				     viewBox="0 0 156 156" aria-hidden="true">
					<!-- Arc 1 — clockwise, 3.5s -->
					<circle cx="78" cy="78" r="73" fill="none" stroke={accent} stroke-width="2.5"
					        stroke-linecap="round" stroke-dasharray="55 403" opacity="0.85">
						<animateTransform attributeName="transform" type="rotate"
						  from="0 78 78" to="360 78 78" dur="3.5s" repeatCount="indefinite"/>
					</circle>
					<!-- Arc 2 — counter-clockwise, 7s -->
					<circle cx="78" cy="78" r="73" fill="none" stroke={accent} stroke-width="1.5"
					        stroke-linecap="round" stroke-dasharray="22 436" stroke-dashoffset="-200" opacity="0.45">
						<animateTransform attributeName="transform" type="rotate"
						  from="0 78 78" to="-360 78 78" dur="7s" repeatCount="indefinite"/>
					</circle>
					<!-- Dot — fast clockwise, 2s -->
					<circle cx="78" cy="78" r="73" fill="none" stroke={accent} stroke-width="3.5"
					        stroke-linecap="round" stroke-dasharray="6 452" opacity="0.9">
						<animateTransform attributeName="transform" type="rotate"
						  from="90 78 78" to="450 78 78" dur="2s" repeatCount="indefinite"/>
					</circle>
				</svg>

				<div class="profile-avatar-ring w-32 h-32" style="--accent: {accent}">
					<div class="w-full h-full rounded-full overflow-hidden"
					     style="background: var(--p-accent)">
						{#if profile.avatar_url}
							<img src={profile.avatar_url} alt="Avatar de {profile.display_name || profile.username}" class="w-full h-full object-cover" />
						{:else}
							<div class="w-full h-full flex items-center justify-center text-white text-5xl font-black select-none"
							     aria-hidden="true">{initials}</div>
						{/if}
					</div>
				</div>
				{#if frameSrc}
					<img src={frameSrc} alt="" aria-hidden="true"
					     class="absolute inset-[-4px] w-[calc(100%+8px)] h-[calc(100%+8px)] pointer-events-none select-none" />
				{/if}
				<!-- Online dot -->
				<span class="absolute bottom-1 right-1 w-4 h-4 rounded-full border-2 profile-online-dot"
				      style="border-color: var(--p-bg); background: #22c55e"
				      title={tFn('common.online')}></span>
			</div>

			<!-- Name + meta -->
			<div class="pb-1 min-w-0 flex-1">
				<div class="flex flex-wrap items-center gap-2 mb-1">
					<h1 class="text-3xl font-black leading-tight drop-shadow-lg truncate"
					    style="color: {profile.name_color || '#ffffff'}">
						{profile.display_name || profile.username}
					</h1>
					<!-- Level badge — prominent -->
					<span class="profile-level-badge shrink-0" style="--accent: {accent}">
						LVL {level}
					</span>
				</div>

				<div class="flex flex-wrap items-center gap-2">
					<span class="text-sm font-medium drop-shadow" style="color: rgba(255,255,255,0.6)">
						@{profile.username}
					</span>
					{#if profile.grade_name && profile.grade_color}
						<span class="text-xs font-semibold px-2 py-0.5 shrink-0"
						      style="background-color: {profile.grade_color}; color: {gradeTextColor(profile.grade_color)}">
							{profile.grade_name}
						</span>
					{/if}
					{#if badgeSrc}
						<img src={badgeSrc} alt={profile.badge_asset_name ?? 'Badge'}
						     title={profile.badge_asset_name ?? 'Badge'}
						     class="w-10 h-10 object-contain drop-shadow" />
					{/if}
					<span class="text-xs px-2 py-0.5 rounded-full font-medium"
					      style="background: color-mix(in srgb, var(--p-accent) 15%, transparent); color: var(--p-accent); border: 1px solid color-mix(in srgb, var(--p-accent) 30%, transparent)">
						{rankLabel}
					</span>
				</div>

				{#if profile.status}
					<p class="mt-1.5 text-sm drop-shadow" style="color: rgba(255,255,255,0.55)">
						{profile.status}
					</p>
				{/if}

				<!-- Followers / following -->
				<div class="flex items-center gap-3 mt-1.5">
					<a href="/users/{profile.username}/followers" class="profile-follow-count">
						<span class="profile-follow-count-num">{fmt(followersCount)}</span>
						<span class="profile-follow-count-label">{tFn('user.followers')}</span>
					</a>
					<span class="profile-follow-sep"></span>
					<a href="/users/{profile.username}/following" class="profile-follow-count">
						<span class="profile-follow-count-num">{fmt(followingCount)}</span>
						<span class="profile-follow-count-label">{tFn('user.following_count')}</span>
					</a>
				</div>
			</div>

			<!-- Action button — inside max-w-6xl, aligned bottom-right -->
			<div class="ml-auto pb-2 shrink-0">
				{#if isOwnProfile}
					<div class="flex items-center gap-2">
						<a href="/users/{profile.username}/card" target="_blank" class="profile-action-btn"
						   style="background: rgba(99,102,241,0.12); border-color: rgba(99,102,241,0.3)"
						   title={tFn('user.share_card')}>
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
							</svg>
							Carte
						</a>
						<a href="/users/me/edit" class="profile-action-btn">
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/>
							</svg>
							{tFn('user.edit_btn')}
						</a>
					</div>
				{:else if me}
					<div class="flex items-center gap-2">
						<button
							onclick={toggleFollow}
							disabled={followLoading}
							class="profile-action-btn profile-follow-btn"
							class:profile-follow-btn--following={following}
							style={following
								? 'background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.5); color: #818cf8'
								: 'background: #6366f1; border-color: #6366f1; color: white'}
						>
							{#if followLoading}
								<span class="profile-follow-dot"></span>
							{:else if following}
								<svg class="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
									<path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"/>
								</svg>
								Suivi
							{:else}
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM4 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 0110.374 21c-2.331 0-4.512-.645-6.374-1.766z"/>
								</svg>
								Suivre
							{/if}
						</button>
						<a href="/chat" class="profile-action-btn">
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/>
							</svg>
							{tFn('user.message_btn')}
						</a>
					</div>
				{/if}
			</div>

		</div>
	</div>
</div>

<!-- Spacer = avatar overflow -->
<div class="h-12" style="background: var(--p-bg)"></div>

<!-- ═══════════════════════════════════════════════════════════════
     XP STRIP — full width, cinematic
     ═══════════════════════════════════════════════════════════════ -->
<div class="max-w-6xl mx-auto px-6 mb-6">
	<div class="profile-xp-strip p-5" style="--accent: {accent}">
		<div class="flex items-center justify-between mb-3 gap-4 flex-wrap">
			<div class="flex items-center gap-3">
				<span class="text-4xl font-black tabular-nums leading-none profile-xp-level"
				      style="color: var(--p-accent)">{level}</span>
				<div>
					<p class="text-xs uppercase tracking-widest font-bold mb-0.5" style="color: var(--p-text-muted)">{tFn('user.level')}</p>
					<p class="text-sm font-semibold" style="color: var(--p-text)">{rankLabel}</p>
				</div>
			</div>
			<div class="text-right">
				<p class="text-sm font-bold tabular-nums" style="color: var(--p-text)">{livePoints.toLocaleString()} pts</p>
				<p class="text-xs" style="color: var(--p-text-muted)">
					{levelMax > livePoints
						? tFn('user.xp_remaining', { n: (levelMax - livePoints).toLocaleString(), next: String(level + 1) })
						: tFn('user.max_level')}
				</p>
			</div>
		</div>

		<!-- XP bar with shimmer -->
		<div class="relative h-3 rounded-full overflow-hidden" style="background: color-mix(in srgb, var(--p-accent) 12%, rgba(0,0,0,0.3))">
			<div
				class="profile-xp-bar h-full rounded-full"
				style="width: {levelProgress}%; background: linear-gradient(90deg, color-mix(in srgb, var(--p-accent) 70%, #8b5cf6), var(--p-accent))"
			></div>
		</div>

		<!-- XP milestones -->
		<div class="flex justify-between mt-1.5">
			<span class="text-[10px] tabular-nums" style="color: var(--p-text-muted)">{levelMin.toLocaleString()} pts</span>
			<span class="text-[10px] tabular-nums" style="color: var(--p-text-muted)">{levelMax.toLocaleString()} pts</span>
		</div>
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     MAIN — 2-column layout
     ═══════════════════════════════════════════════════════════════ -->
<div class="max-w-6xl mx-auto px-6 pb-16">
	<div class="flex flex-col sm:flex-row gap-5 items-start">

		<!-- ─── LEFT SIDEBAR ─────────────────────────────────────────── -->
		<aside class="w-full sm:w-64 sm:shrink-0 space-y-3">

			<!-- Identity card: location + since -->
			{#if profile.location || true}
				<div class="p-4 space-y-3"
				     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
					{#if profile.location}
						<div class="flex items-center gap-2.5">
							<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--p-text-muted)">
								<path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/>
								<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/>
							</svg>
							<span class="text-sm" style="color: var(--p-text)">{profile.location}</span>
						</div>
					{/if}
					<div class="flex items-center gap-2.5">
						<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--p-text-muted)">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/>
						</svg>
						<div>
							<p class="text-xs" style="color: var(--p-text-muted)">{tFn('user.member_since')}</p>
							<p class="text-sm font-medium" style="color: var(--p-text)">{memberSinceFormatted}</p>
						</div>
					</div>
					<div class="flex items-center gap-2.5">
						<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--p-text-muted)">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
						</svg>
						<div>
							<p class="text-xs" style="color: var(--p-text-muted)">{tFn('user.presence')}</p>
							<p class="text-sm font-medium" style="color: var(--p-text)">{daysSince.toLocaleString()} {tFn('user.days')}</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Tags -->
			{#if profile.tags?.length > 0}
				<div class="p-4"
				     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
					<p class="text-xs uppercase tracking-widest font-medium mb-3" style="color: var(--p-text-muted)">Tags</p>
					<div class="flex flex-wrap gap-1.5">
						{#each profile.tags as tag}
							<span class="rounded-full px-2.5 py-0.5 text-xs font-medium"
							      style="background: color-mix(in srgb, var(--p-accent) 12%, transparent); border: 1px solid color-mix(in srgb, var(--p-accent) 25%, transparent); color: var(--p-accent)">
								#{tag}
							</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Social networks -->
			{#if socialLinks.length > 0}
				<div class="p-4"
				     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
					<p class="text-xs uppercase tracking-widest font-medium mb-3" style="color: var(--p-text-muted)">{tFn('user.networks')}</p>
					<ul class="space-y-1.5">
						{#each socialLinks as social}
							<li>
								<a href={social.url} target="_blank" rel="noopener noreferrer"
								   class="flex items-center gap-3 py-1.5 px-2 transition-all group hover:bg-white/5">
									<span class="w-4 h-4 shrink-0" style="color: var(--p-text-muted)">
										{#if social.label === 'GitHub'}
											<svg viewBox="0 0 16 16" class="w-4 h-4 fill-current" aria-hidden="true">
												<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
											</svg>
										{:else if social.label === 'Twitter / X'}
											<svg viewBox="0 0 24 24" class="w-4 h-4 fill-current" aria-hidden="true">
												<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
											</svg>
										{:else if social.label === 'Instagram'}
											<svg viewBox="0 0 24 24" class="w-4 h-4 fill-current" aria-hidden="true">
												<path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
											</svg>
										{:else if social.label === 'YouTube'}
											<svg viewBox="0 0 24 24" class="w-4 h-4 fill-current" aria-hidden="true">
												<path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
											</svg>
										{:else}
											<svg viewBox="0 0 24 24" class="w-4 h-4 fill-none stroke-current stroke-2" aria-hidden="true">
												<path stroke-linecap="round" stroke-linejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418"/>
											</svg>
										{/if}
									</span>
									<div class="min-w-0">
										<p class="text-[10px] uppercase tracking-wide leading-none mb-0.5" style="color: var(--p-text-muted)">{social.label}</p>
										<p class="text-xs truncate font-medium group-hover:underline" style="color: var(--p-accent)">{social.handle}</p>
									</div>
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Showcase placeholder — future home of badges, karma, achievements -->
			<div class="p-4"
			     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
				<p class="text-xs uppercase tracking-widest font-medium mb-3" style="color: var(--p-text-muted)">{tFn('user.showcase')}</p>
				<div class="flex flex-wrap gap-2">
					<div class="w-10 h-10 flex items-center justify-center text-lg"
					     style="background: color-mix(in srgb, var(--p-accent) 8%, transparent); border: 1px dashed color-mix(in srgb, var(--p-accent) 20%, transparent)"
					     title={tFn('user.coming_soon')}>
						🔒
					</div>
					<div class="w-10 h-10 flex items-center justify-center text-lg"
					     style="background: color-mix(in srgb, var(--p-accent) 8%, transparent); border: 1px dashed color-mix(in srgb, var(--p-accent) 20%, transparent)"
					     title="Bientôt disponible">
						🔒
					</div>
					<div class="w-10 h-10 flex items-center justify-center text-lg"
					     style="background: color-mix(in srgb, var(--p-accent) 8%, transparent); border: 1px dashed color-mix(in srgb, var(--p-accent) 20%, transparent)"
					     title="Bientôt disponible">
						🔒
					</div>
				</div>
				<p class="text-[10px] mt-2" style="color: var(--p-text-muted)">{tFn('user.badges_soon')}</p>
			</div>

		</aside>

		<!-- ─── MAIN CONTENT ─────────────────────────────────────────── -->
		<main class="flex-1 min-w-0">

			<!-- Tab switcher -->
			<div class="profile-tabs">
				<button
					onclick={() => activeTab = 'about'}
					class="profile-tab"
					class:profile-tab--active={activeTab === 'about'}
				>{tFn('user.tab_about')}</button>
				<button
					onclick={() => activeTab = 'posts'}
					class="profile-tab"
					class:profile-tab--active={activeTab === 'posts'}
				>
					Posts
					{#if userPosts.length > 0}
						<span class="profile-tab-badge">{fmt(Number(profile.post_count ?? 0) + Number(profile.thread_count ?? 0))}</span>
					{/if}
				</button>
			</div>

			{#if activeTab === 'about'}
			<div class="space-y-4 mt-4">

			<!-- Reputation Rings -->
			<ReputationRings
				longevity={ringLongevity}
				quality={ringQuality}
				engagement={ringEngagement}
				accent={accent}
			/>

			<!-- Stats row -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				{#each stats as stat}
					<div class="profile-stat-card p-4 text-center group"
					     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
						<div class="flex justify-center mb-2">
							<div class="w-8 h-8 flex items-center justify-center transition-all group-hover:scale-110"
							     style="background: color-mix(in srgb, var(--p-accent) 15%, transparent)">
								<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--p-accent)">
									<path stroke-linecap="round" stroke-linejoin="round" d={stat.icon}/>
								</svg>
							</div>
						</div>
						<p class="text-2xl font-black tabular-nums leading-none" style="color: var(--p-text)">{stat.value}</p>
						<p class="text-xs mt-1.5 font-medium" style="color: var(--p-text-muted)">{stat.label}</p>
					</div>
				{/each}
			</div>

			<!-- Bio -->
			{#if profile.bio}
				<div class="p-5"
				     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
					<p class="text-xs uppercase tracking-widest font-medium mb-4" style="color: var(--p-text-muted)">{tFn('user.about_section')}</p>
					<div class="flex gap-4">
						<div class="w-0.5 rounded-full shrink-0 self-stretch" style="background: var(--p-accent); opacity: 0.4"></div>
						<p class="whitespace-pre-line text-sm leading-relaxed" style="color: var(--p-text)">{profile.bio}</p>
					</div>
				</div>
			{/if}

			<!-- GitHub widget -->
			{#if profile.github_username}
				<div>
					<p class="text-xs uppercase tracking-widest font-medium mb-3 px-1" style="color: var(--p-text-muted)">GitHub</p>
					<GitHubWidget nodyxUsername={profile.username} />
				</div>
			{/if}

			<!-- Custom links -->
			{#if profile.links?.length > 0}
				<div class="p-5"
				     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
					<p class="text-xs uppercase tracking-widest font-medium mb-3" style="color: var(--p-text-muted)">{tFn('user.links_section')}</p>
					<div class="grid grid-cols-2 gap-2">
						{#each profile.links as link}
							<a href={link.url} target="_blank" rel="noopener noreferrer"
							   class="flex items-center justify-between gap-3 p-3 transition-all group hover:scale-[1.02]"
							   style="background: color-mix(in srgb, var(--p-card-border) 40%, transparent); border: 1px solid var(--p-card-border)">
								<span class="text-sm font-medium truncate" style="color: var(--p-accent)">{link.label}</span>
								<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--p-text-muted)">
									<path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
								</svg>
							</a>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Activity Heatmap -->
			<div class="p-5" style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
				<ActivityHeatmap username={profile.username} accent={accent} />
			</div>

			<!-- Timeline parcours -->
			<div class="p-5" style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
				<p class="text-xs uppercase tracking-widest font-medium mb-4" style="color: var(--p-text-muted)">{tFn('user.journey')}</p>
				<div class="relative">
					<div class="absolute left-[7px] top-2 bottom-2 w-px" style="background: var(--p-card-border)"></div>
					<ol class="space-y-3 pl-6">
						{#each timeline as item}
							<li class="relative flex items-start gap-3 {item.reached ? '' : 'opacity-35'}">
								<div class="absolute -left-6 mt-0.5 w-3.5 h-3.5 rounded-full border-2 shrink-0 transition-colors"
								     style="background: {item.reached ? (item.accent ? accent : 'var(--p-card-bg)') : 'var(--p-card-bg)'}; border-color: {item.reached ? accent : 'var(--p-card-border)'}; {item.accent && item.reached ? `box-shadow: 0 0 8px ${accent}88` : ''}">
								</div>
								<div class="min-w-0">
									<span class="text-xs font-semibold" style="color: {item.reached && item.accent ? accent : item.reached ? 'var(--p-text)' : 'var(--p-text-muted)'}">{item.label}</span>
									<span class="text-[10px] ml-2" style="color: var(--p-text-muted)">{item.detail}</span>
								</div>
							</li>
						{/each}
					</ol>
				</div>
			</div>

			<!-- Empty state -->
			{#if !profile.bio && !profile.github_username && !profile.links?.length}
				<div class="p-10 text-center"
				     style="background: color-mix(in srgb, var(--p-card-bg) 60%, transparent); border: 1px solid var(--p-card-border)">
					<p class="text-4xl mb-3">✨</p>
					<p class="text-sm font-medium" style="color: var(--p-text-muted)">{tFn('user.empty_profile')}</p>
					{#if isOwnProfile}
						<a href="/users/me/edit" class="inline-block mt-3 text-sm font-semibold underline underline-offset-2"
						   style="color: var(--p-accent)">
							Donne-lui vie →
						</a>
					{/if}
				</div>
			{/if}

			</div><!-- end about tab -->
			{/if}

			<!-- ── Posts tab ────────────────────────────────────────── -->
			{#if activeTab === 'posts'}
			<div class="mt-4">
				{#if userPosts.length === 0}
					<div class="p-10 text-center"
					     style="background: color-mix(in srgb, var(--p-card-bg) 60%, transparent); border: 1px solid var(--p-card-border)">
						<p class="text-sm font-medium" style="color: var(--p-text-muted)">{tFn('user.no_posts')}</p>
						{#if isOwnProfile}
							<a href="/feed" class="inline-block mt-3 text-sm font-semibold underline underline-offset-2"
							   style="color: var(--p-accent)">{tFn('user.publish_post_cta')}</a>
						{/if}
					</div>
				{:else}
					{#each userPosts as post (post.id)}
						<article class="profile-post-card">
							<p class="profile-post-text">{post.content}</p>
							<div class="profile-post-meta">
								<time>{timeAgo(post.created_at)}</time>
								<button
									onclick={() => togglePostLike(post)}
									class="profile-post-like"
									class:profile-post-like--active={post.liked_by_me}
								>
									{#if post.liked_by_me}
										<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
											<path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z"/>
										</svg>
									{:else}
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"/>
										</svg>
									{/if}
									{#if post.likes_count > 0}<span>{fmt(post.likes_count)}</span>{/if}
								</button>
								{#if post.replies_count > 0}
									<span class="profile-post-replies">
										<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"/>
										</svg>
										{fmt(post.replies_count)}
									</span>
								{/if}
							</div>
						</article>
					{/each}

					{#if postsHasMore}
						<button onclick={loadMorePosts} disabled={postsLoading}
						        class="w-full py-3 text-sm font-medium transition-colors"
						        style="color: var(--p-text-muted); border: 1px solid var(--p-card-border); background: var(--p-card-bg)">
							{postsLoading ? tFn('common.loading') : tFn('user.see_more')}
						</button>
					{/if}
				{/if}
			</div>
			{/if}

		</main>
	</div>
</div>

</div><!-- end .profile-scope -->

<style>
	/* ── Aurora banner blobs ─────────────────────────────────────── */
	.profile-aurora-a,
	.profile-aurora-b,
	.profile-aurora-c {
		position: absolute;
		inset: 0;
	}
	.profile-aurora-a {
		animation: aurora-breathe-a 6s ease-in-out infinite;
		transform-origin: 20% 55%;
	}
	.profile-aurora-b {
		animation: aurora-breathe-b 9s ease-in-out infinite;
		transform-origin: 78% 35%;
	}
	.profile-aurora-c {
		animation: aurora-breathe-c 12s ease-in-out infinite;
		transform-origin: 55% 85%;
	}
	/* Scale + opacity uniquement — pas de translate pour éviter les bordures vides */
	@keyframes aurora-breathe-a {
		0%   { transform: scale(1);    opacity: 0.75; }
		50%  { transform: scale(1.18); opacity: 1;    }
		100% { transform: scale(1);    opacity: 0.75; }
	}
	@keyframes aurora-breathe-b {
		0%   { transform: scale(1);    opacity: 0.55; }
		50%  { transform: scale(1.12); opacity: 0.85; }
		100% { transform: scale(1);    opacity: 0.55; }
	}
	@keyframes aurora-breathe-c {
		0%   { transform: scale(1);    opacity: 0.35; }
		50%  { transform: scale(1.25); opacity: 0.6;  }
		100% { transform: scale(1);    opacity: 0.35; }
	}

	/* ── Avatar ring ──────────────────────────────────────────────── */
	.profile-avatar-ring {
		position: relative;
		border-radius: 9999px;
		padding: 3px;
		background: linear-gradient(135deg, var(--accent), color-mix(in srgb, var(--accent) 40%, transparent));
		animation: avatar-glow-breathe 3s ease-in-out infinite;
	}
	@keyframes avatar-glow-breathe {
		0%, 100% { box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-bg) 80%, transparent), 0 0 18px color-mix(in srgb, var(--accent) 35%, transparent); }
		50%       { box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-bg) 80%, transparent), 0 0 48px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 80px color-mix(in srgb, var(--accent) 25%, transparent); }
	}

	/* ── Online dot pulse ─────────────────────────────────────────── */
	.profile-online-dot {
		animation: profile-pulse 2.5s cubic-bezier(0.4, 0, 0.6, 1) infinite;
	}
	@keyframes profile-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
		50%       { box-shadow: 0 0 0 5px rgba(34, 197, 94, 0); }
	}

	/* ── Level badge — flat, cohérent avec le shell ──────────────── */
	.profile-level-badge {
		display: inline-flex;
		align-items: center;
		padding: 3px 10px;
		border-radius: 2px;
		font-size: 0.75rem;
		font-weight: 900;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
		background: color-mix(in srgb, var(--accent) 15%, rgba(0,0,0,0.6));
		border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent);
	}

	/* ── XP strip — flat, pas de blur ────────────────────────────── */
	.profile-xp-strip {
		background: var(--p-card-bg, #111827);
		border: 1px solid var(--p-card-border, #1f2937);
	}

	/* ── XP bar shimmer ───────────────────────────────────────────── */
	.profile-xp-bar {
		position: relative;
		overflow: hidden;
		transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
	}
	.profile-xp-bar::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
		animation: profile-shimmer 2.5s infinite;
		transform: translateX(-100%);
	}
	@keyframes profile-shimmer {
		100% { transform: translateX(200%); }
	}

	/* ── XP level number glow ─────────────────────────────────────── */
	.profile-xp-level {
		text-shadow: 0 0 20px color-mix(in srgb, var(--p-accent) 60%, transparent);
	}

	/* ── Stat cards hover ─────────────────────────────────────────── */
	.profile-stat-card {
		transition: transform 0.15s, border-color 0.15s;
	}
	.profile-stat-card:hover {
		transform: translateY(-2px);
		border-color: color-mix(in srgb, var(--p-accent) 30%, transparent);
	}

	/* ── Action button ────────────────────────────────────────────── */
	.profile-action-btn {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 14px;
		border-radius: 3px;
		background: rgba(0,0,0,0.5);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255,255,255,0.12);
		font-size: 0.75rem;
		font-weight: 500;
		color: #e2e8f0;
		transition: all 0.15s;
		text-decoration: none;
	}
	.profile-action-btn:hover {
		background: rgba(0,0,0,0.7);
		border-color: rgba(255,255,255,0.22);
		color: #fff;
	}

	/* ── Follow counts ───────────────────────────────────────────── */
	.profile-follow-count {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		transition: opacity 0.15s;
	}
	.profile-follow-count:hover { opacity: 0.75; }
	.profile-follow-count-num {
		font-size: 0.875rem;
		font-weight: 800;
		color: rgba(255,255,255,0.85);
		drop-shadow: 0 1px 2px rgba(0,0,0,0.5);
	}
	.profile-follow-count-label {
		font-size: 0.7rem;
		color: rgba(255,255,255,0.4);
		font-weight: 500;
	}
	.profile-follow-sep {
		width: 1px;
		height: 12px;
		background: rgba(255,255,255,0.15);
	}

	/* ── Follow button ───────────────────────────────────────────── */
	.profile-follow-btn {
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.2px;
		transition: all 0.2s;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 1rem;
		border-width: 1px;
		border-style: solid;
	}
	.profile-follow-btn:hover:not(:disabled) { filter: brightness(1.1); }
	.profile-follow-dot {
		width: 6px; height: 6px; border-radius: 50%;
		background: currentColor; opacity: 0.6;
		animation: follow-pulse 0.8s ease-in-out infinite;
	}
	@keyframes follow-pulse {
		0%, 100% { transform: scale(0.8); opacity: 0.4; }
		50%       { transform: scale(1.2); opacity: 1; }
	}

	/* ── Profile tabs ────────────────────────────────────────────── */
	.profile-tabs {
		display: flex;
		border-bottom: 1px solid var(--p-card-border);
		margin-top: 0;
	}
	.profile-tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.875rem 1.25rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--p-text-muted);
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
		transition: color 0.15s, border-color 0.15s;
		letter-spacing: 0.2px;
	}
	.profile-tab:hover { color: var(--p-text); }
	.profile-tab--active {
		color: var(--p-accent);
		border-bottom-color: var(--p-accent);
	}
	.profile-tab-badge {
		font-size: 0.65rem;
		font-weight: 700;
		padding: 0.1rem 0.375rem;
		background: color-mix(in srgb, var(--p-accent) 15%, transparent);
		color: var(--p-accent);
		border: 1px solid color-mix(in srgb, var(--p-accent) 30%, transparent);
	}

	/* ── Profile post cards ──────────────────────────────────────── */
	.profile-post-card {
		padding: 1rem;
		border: 1px solid var(--p-card-border);
		border-top: none;
		background: var(--p-card-bg);
		transition: background 0.15s;
	}
	.profile-post-card:first-child { border-top: 1px solid var(--p-card-border); }
	.profile-post-card:hover { background: color-mix(in srgb, var(--p-card-bg) 80%, var(--p-accent) 5%); }

	.profile-post-text {
		font-size: 0.9rem;
		color: var(--p-text);
		line-height: 1.65;
		white-space: pre-wrap;
		word-break: break-word;
		margin-bottom: 0.625rem;
	}
	.profile-post-meta {
		display: flex;
		align-items: center;
		gap: 1rem;
		font-size: 0.75rem;
		color: var(--p-text-muted);
	}
	.profile-post-like {
		display: flex; align-items: center; gap: 0.3rem;
		color: var(--p-text-muted);
		transition: color 0.15s;
	}
	.profile-post-like:hover { color: #f43f5e; }
	.profile-post-like--active { color: #f43f5e; }
	.profile-post-replies {
		display: flex; align-items: center; gap: 0.3rem;
	}
</style>
