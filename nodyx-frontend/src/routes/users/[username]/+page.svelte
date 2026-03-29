<script lang="ts">
	import type { PageData } from './$types'
	import GitHubWidget from '$lib/components/widgets/GitHubWidget.svelte'
	import { page } from '$app/stores'
	import { resolveTheme, themeToStyle } from '$lib/profileThemes'
	import { socket } from '$lib/socket'

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
		new Date(profile.created_at).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
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
		{ label: 'Posts', value: Number(profile.post_count ?? 0).toLocaleString('fr-FR'), icon: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z', color: 'indigo' },
		{ label: 'Threads', value: Number(profile.thread_count ?? 0).toLocaleString('fr-FR'), icon: 'M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z', color: 'violet' },
		{ label: 'Points XP', value: Number(livePoints ?? 0).toLocaleString('fr-FR'), icon: 'M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z', color: 'yellow' },
		{ label: 'Jours actif', value: daysSince.toLocaleString('fr-FR'), icon: 'M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5', color: 'teal' },
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
			label: 'Site web',
			url: profile.website_url,
			handle: profile.website_url.replace(/^https?:\/\//, '').replace(/\/$/, ''),
		},
	].filter(Boolean) as { label: string; url: string; handle: string }[])

	const title = $derived(`${profile.display_name || profile.username} — Nodyx`)
	const description = $derived(
		profile.bio ? profile.bio.slice(0, 160) : `Profil de ${profile.display_name || profile.username} sur Nodyx.`
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

	// Level rank label
	const rankLabel = $derived(
		level >= 50 ? 'Légende' :
		level >= 30 ? 'Expert' :
		level >= 20 ? 'Vétéran' :
		level >= 10 ? 'Confirmé' :
		level >= 5  ? 'Actif' :
		level >= 2  ? 'Novice' :
		'Découvreur'
	)
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

		<!-- Aurora blobs — always rendered, even with a banner image -->
		<div class="profile-aurora-a" style="background: radial-gradient(ellipse 70% 90% at 20% 55%, {accent}cc, transparent 65%)"></div>
		<div class="profile-aurora-b" style="background: radial-gradient(ellipse 55% 75% at 78% 35%, {accent}77, transparent 65%)"></div>
		<div class="profile-aurora-c" style="background: radial-gradient(ellipse 45% 65% at 55% 85%, {accent}44, transparent 65%)"></div>

		<!-- User banner image — on top of the aurora -->
		{#if bannerSrc}
			<img
				src={bannerSrc}
				alt=""
				aria-hidden="true"
				class="absolute inset-0 w-full h-full object-cover"
				style="opacity: 0.55; mix-blend-mode: luminosity"
			/>
		{/if}

		<!-- Gradient overlays for text readability -->
		<div class="absolute inset-0" style="background: linear-gradient(to bottom, transparent 20%, {accent}0a 60%, var(--p-bg) 100%)"></div>
		<div class="absolute inset-0" style="background: linear-gradient(to right, var(--p-bg) 0%, transparent 40%)"></div>
	</div>

	<!-- Identity passport — anchored at banner bottom -->
	<div class="absolute bottom-0 inset-x-0 z-10">
		<div class="max-w-6xl mx-auto px-6 flex items-end gap-6 pb-6">

			<!-- Avatar with frame -->
			<div class="relative shrink-0 translate-y-10">
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
				      title="En ligne"></span>
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
						<span class="text-xs font-semibold rounded px-2 py-0.5 shrink-0"
						      style="background-color: {profile.grade_color}; color: {gradeTextColor(profile.grade_color)}">
							{profile.grade_name}
						</span>
					{/if}
					{#if badgeSrc}
						<img src={badgeSrc} alt={profile.badge_asset_name ?? 'Badge'}
						     title={profile.badge_asset_name ?? 'Badge'}
						     class="w-10 h-10 rounded object-contain drop-shadow" />
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
			</div>

			<!-- Action button — inside max-w-6xl, aligned bottom-right -->
			<div class="ml-auto pb-2 shrink-0">
				{#if isOwnProfile}
					<a href="/users/me/edit" class="profile-action-btn">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/>
						</svg>
						Modifier le profil
					</a>
				{:else if me}
					<a href="/chat" class="profile-action-btn"
					   style="background: color-mix(in srgb, var(--p-accent) 30%, rgba(0,0,0,0.5)); border-color: color-mix(in srgb, var(--p-accent) 50%, transparent)">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/>
						</svg>
						Envoyer un message
					</a>
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
	<div class="profile-xp-strip rounded-sm p-5" style="--accent: {accent}">
		<div class="flex items-center justify-between mb-3 gap-4 flex-wrap">
			<div class="flex items-center gap-3">
				<span class="text-4xl font-black tabular-nums leading-none profile-xp-level"
				      style="color: var(--p-accent)">{level}</span>
				<div>
					<p class="text-xs uppercase tracking-widest font-bold mb-0.5" style="color: var(--p-text-muted)">Niveau</p>
					<p class="text-sm font-semibold" style="color: var(--p-text)">{rankLabel}</p>
				</div>
			</div>
			<div class="text-right">
				<p class="text-sm font-bold tabular-nums" style="color: var(--p-text)">{livePoints.toLocaleString('fr-FR')} pts</p>
				<p class="text-xs" style="color: var(--p-text-muted)">
					{levelMax > livePoints
						? `Encore ${(levelMax - livePoints).toLocaleString('fr-FR')} pts pour le niveau ${level + 1}`
						: 'Niveau maximum atteint !'}
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
			<span class="text-[10px] tabular-nums" style="color: var(--p-text-muted)">{levelMin.toLocaleString('fr-FR')} pts</span>
			<span class="text-[10px] tabular-nums" style="color: var(--p-text-muted)">{levelMax.toLocaleString('fr-FR')} pts</span>
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
							<p class="text-xs" style="color: var(--p-text-muted)">Membre depuis</p>
							<p class="text-sm font-medium" style="color: var(--p-text)">{memberSinceFormatted}</p>
						</div>
					</div>
					<div class="flex items-center gap-2.5">
						<svg class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24" aria-hidden="true" style="color: var(--p-text-muted)">
							<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/>
						</svg>
						<div>
							<p class="text-xs" style="color: var(--p-text-muted)">Présence</p>
							<p class="text-sm font-medium" style="color: var(--p-text)">{daysSince.toLocaleString('fr-FR')} jours</p>
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
					<p class="text-xs uppercase tracking-widest font-medium mb-3" style="color: var(--p-text-muted)">Réseaux</p>
					<ul class="space-y-1.5">
						{#each socialLinks as social}
							<li>
								<a href={social.url} target="_blank" rel="noopener noreferrer"
								   class="flex items-center gap-3 py-1.5 px-2 rounded transition-all group hover:bg-white/5">
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
				<p class="text-xs uppercase tracking-widest font-medium mb-3" style="color: var(--p-text-muted)">Showcase</p>
				<div class="flex flex-wrap gap-2">
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
					<div class="w-10 h-10 flex items-center justify-center text-lg"
					     style="background: color-mix(in srgb, var(--p-accent) 8%, transparent); border: 1px dashed color-mix(in srgb, var(--p-accent) 20%, transparent)"
					     title="Bientôt disponible">
						🔒
					</div>
				</div>
				<p class="text-[10px] mt-2" style="color: var(--p-text-muted)">Badges & récompenses — bientôt</p>
			</div>

		</aside>

		<!-- ─── MAIN CONTENT ─────────────────────────────────────────── -->
		<main class="flex-1 min-w-0 space-y-4">

			<!-- Stats row -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
				{#each stats as stat}
					<div class="profile-stat-card p-4 text-center group"
					     style="background: var(--p-card-bg); border: 1px solid var(--p-card-border)">
						<div class="flex justify-center mb-2">
							<div class="w-8 h-8 rounded flex items-center justify-center transition-all group-hover:scale-110"
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
					<p class="text-xs uppercase tracking-widest font-medium mb-4" style="color: var(--p-text-muted)">À propos</p>
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
					<p class="text-xs uppercase tracking-widest font-medium mb-3" style="color: var(--p-text-muted)">Liens</p>
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

			<!-- Empty state -->
			{#if !profile.bio && !profile.github_username && !profile.links?.length}
				<div class="p-10 text-center"
				     style="background: color-mix(in srgb, var(--p-card-bg) 60%, transparent); border: 1px solid var(--p-card-border)">
					<p class="text-4xl mb-3">✨</p>
					<p class="text-sm font-medium" style="color: var(--p-text-muted)">Ce profil est encore vide.</p>
					{#if isOwnProfile}
						<a href="/users/me/edit" class="inline-block mt-3 text-sm font-semibold underline underline-offset-2"
						   style="color: var(--p-accent)">
							Donne-lui vie →
						</a>
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
		box-shadow: 0 0 0 2px color-mix(in srgb, var(--p-bg) 80%, transparent), 0 0 32px color-mix(in srgb, var(--accent) 40%, transparent);
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
</style>
