<script lang="ts">
	import { onMount, onDestroy } from 'svelte'

	export interface TwitchProfilePayload {
		user: {
			id:                string
			login:             string
			displayName:       string
			avatarUrl:         string
			profileBannerUrl:  string | null
			description:       string
			broadcasterType:   'partner' | 'affiliate' | ''
			accountCreatedAt:  string
			totalViewCount:    number | null
		}
		stream: {
			isLive:       boolean
			gameName:     string | null
			title:        string | null
			viewerCount:  number | null
			startedAt:    string | null
			thumbnailUrl: string | null
			language:     string | null
		}
		followers: {
			total: number | null
		}
		fetchedAt: string
	}

	interface Props {
		profile: TwitchProfilePayload
	}

	let { profile }: Props = $props()

	// Ticking live timer — updates every second so the streamer voit la durée
	// avancer en temps réel quand il est en live. Pas de RAF, 1s est largement
	// assez (et plus économe que requestAnimationFrame).
	let now = $state(Date.now())
	let liveTimer: ReturnType<typeof setInterval> | null = null

	onMount(() => {
		if (profile.stream.isLive) {
			liveTimer = setInterval(() => { now = Date.now() }, 1000)
		}
	})

	onDestroy(() => {
		if (liveTimer) clearInterval(liveTimer)
	})

	const liveDurationMs = $derived(
		profile.stream.isLive && profile.stream.startedAt
			? Math.max(0, now - new Date(profile.stream.startedAt).getTime())
			: 0,
	)

	function formatDuration(ms: number): string {
		const totalSec = Math.floor(ms / 1000)
		const h  = Math.floor(totalSec / 3600)
		const m  = Math.floor((totalSec % 3600) / 60)
		const s  = totalSec % 60
		if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`
		return `${m}m ${s.toString().padStart(2, '0')}s`
	}

	function formatNumber(n: number | null): string {
		if (n === null) return '—'
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
		if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
		return n.toString()
	}

	function accountAge(iso: string): string {
		const days = Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24))
		if (days < 30) return `${days} jour${days > 1 ? 's' : ''}`
		if (days < 365) return `${Math.floor(days / 30)} mois`
		const years = (days / 365).toFixed(1)
		return `${years} an${parseFloat(years) > 1 ? 's' : ''}`
	}

	const typeBadge = $derived(
		profile.user.broadcasterType === 'partner'   ? { label: 'Partner',   color: '#9146ff' } :
		profile.user.broadcasterType === 'affiliate' ? { label: 'Affiliate', color: '#10b981' } :
		null,
	)
</script>

<section
	class="relative rounded-2xl overflow-hidden border border-slate-700/60 bg-slate-900/40"
	class:is-live={profile.stream.isLive}
>
	<!-- Background : banner du streamer si dispo, sinon gradient Sovereign -->
	{#if profile.user.profileBannerUrl}
		<div
			class="absolute inset-0 bg-cover bg-center opacity-30"
			style="background-image: url('{profile.user.profileBannerUrl}')"
		></div>
		<div class="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/85 to-slate-950/40"></div>
	{:else}
		<div class="absolute inset-0 bg-gradient-to-br from-indigo-950/60 via-slate-950 to-cyan-950/40"></div>
	{/if}

	<!-- Subtle scan-line shimmer when live -->
	{#if profile.stream.isLive}
		<div class="shimmer absolute inset-0 pointer-events-none"></div>
	{/if}

	<div class="relative p-6 md:p-7 flex flex-col md:flex-row gap-6 md:items-center">
		<!-- Avatar : double anneau quand live (rose pulsant), simple quand offline -->
		<div class="relative shrink-0">
			{#if profile.stream.isLive}
				<span class="absolute inset-0 rounded-full bg-rose-500/40 animate-ping"></span>
			{/if}
			<img
				src={profile.user.avatarUrl}
				alt="Avatar Twitch de {profile.user.displayName}"
				class="relative w-20 h-20 md:w-24 md:h-24 rounded-full border-2 ring-4 ring-slate-950
				       {profile.stream.isLive ? 'border-rose-500' : 'border-cyan-500/60'}"
				loading="lazy"
			/>
		</div>

		<!-- Identité + meta -->
		<div class="flex-1 min-w-0">
			<div class="flex flex-wrap items-center gap-2 mb-1">
				<h2 class="text-2xl font-bold text-white truncate">{profile.user.displayName}</h2>
				{#if typeBadge}
					<span
						class="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md"
						style="background: {typeBadge.color}25; color: {typeBadge.color}; border: 1px solid {typeBadge.color}50"
					>{typeBadge.label}</span>
				{/if}
				{#if profile.stream.isLive}
					<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-rose-500 text-white flex items-center gap-1">
						<span class="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
						LIVE
					</span>
				{/if}
			</div>

			{#if profile.stream.isLive && profile.stream.title}
				<div class="text-sm text-slate-200 line-clamp-1 mb-1" title={profile.stream.title}>
					{profile.stream.title}
				</div>
				<div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
					{#if profile.stream.gameName}
						<span class="text-cyan-400 font-medium">{profile.stream.gameName}</span>
					{/if}
					{#if profile.stream.viewerCount !== null}
						<span>{formatNumber(profile.stream.viewerCount)} viewer{(profile.stream.viewerCount ?? 0) > 1 ? 's' : ''} actuellement</span>
					{/if}
					<span class="font-mono text-rose-300">{formatDuration(liveDurationMs)}</span>
				</div>
			{:else}
				<div class="text-xs text-slate-400">
					Hors ligne · chaine sur Twitch depuis {accountAge(profile.user.accountCreatedAt)}
				</div>
				{#if profile.user.description}
					<div class="text-xs text-slate-500 mt-1 line-clamp-2 max-w-2xl">{profile.user.description}</div>
				{/if}
			{/if}
		</div>

		<!-- Quick metrics -->
		<div class="flex md:flex-col gap-4 md:gap-2 shrink-0 md:items-end">
			<div class="text-right">
				<div class="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Followers</div>
				<div class="text-xl font-bold text-white tabular-nums">{formatNumber(profile.followers.total)}</div>
			</div>
			{#if profile.user.totalViewCount}
				<div class="text-right">
					<div class="text-[10px] uppercase tracking-widest text-slate-500 font-semibold">Vues totales</div>
					<div class="text-xl font-bold text-white tabular-nums">{formatNumber(profile.user.totalViewCount)}</div>
				</div>
			{/if}
			<a
				href="https://twitch.tv/{profile.user.login}"
				target="_blank"
				rel="noopener noreferrer"
				class="text-[11px] text-cyan-400 hover:text-cyan-300 underline decoration-cyan-500/40"
			>twitch.tv/{profile.user.login}</a>
		</div>
	</div>
</section>

<style>
	/* Subtle scan-line shimmer overlay quand live — diagonal slow sweep */
	.shimmer::before {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			115deg,
			transparent 30%,
			rgba(244, 63, 94, 0.06) 50%,
			transparent 70%
		);
		background-size: 200% 200%;
		animation: shimmer-sweep 8s linear infinite;
	}
	@keyframes shimmer-sweep {
		0%   { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}
</style>
