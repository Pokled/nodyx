<script lang="ts">
	import { onMount } from 'svelte'
	import { browser } from '$app/environment'
	import { buildNameStyle, buildAnimClass, ensureFontLoaded } from '$lib/nameEffects'

	interface Props {
		username: string
		anchorEl?: HTMLElement | null
		onclose: () => void
	}

	let { username, anchorEl = null, onclose }: Props = $props()

	type Profile = {
		username:           string
		display_name:       string | null
		avatar_url:         string | null
		name_color:         string | null
		name_glow:          string | null
		name_glow_intensity: number | null
		name_animation:     string | null
		name_font_family:   string | null
		name_font_url:      string | null
		bio:                string | null
		status:             string | null
		location:           string | null
		points:             number
		grade_name:         string | null
		grade_color:        string | null
		created_at:         string
		tags:               string[]
	}

	let profile = $state<Profile | null>(null)
	let loading  = $state(true)
	let cardEl   = $state<HTMLDivElement | null>(null)

	// Level calculation — same formula as profile page
	const level       = $derived(profile ? Math.floor(Math.sqrt(Math.max(0, profile.points) / 10)) + 1 : 1)
	const levelMin    = $derived((level - 1) * (level - 1) * 10)
	const levelMax    = $derived(level * level * 10)
	const levelProgress = $derived(
		profile && levelMax > levelMin
			? Math.min(100, Math.round(((profile.points - levelMin) / (levelMax - levelMin)) * 100))
			: 0
	)

	function gradeTextColor(hex: string): string {
		if (!hex || !hex.startsWith('#') || hex.length < 7) return '#ffffff'
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#111827' : '#ffffff'
	}

	// Position the card near the anchor element (or center of viewport)
	let cardStyle = $state('top:50%;left:50%;transform:translate(-50%,-50%)')

	function computePosition() {
		if (!browser || !cardEl) return
		if (!anchorEl) {
			cardStyle = 'top:50%;left:50%;transform:translate(-50%,-50%)'
			return
		}
		const rect = anchorEl.getBoundingClientRect()
		const vw   = window.innerWidth
		const vh   = window.innerHeight
		const CARD_W = 260
		const CARD_H = 340

		// Prefer right of anchor, fall back to left
		let left = rect.right + 8
		if (left + CARD_W > vw - 8) left = rect.left - CARD_W - 8
		if (left < 8) left = 8

		// Align top of card with top of anchor, clamp to viewport
		let top = rect.top
		if (top + CARD_H > vh - 8) top = vh - CARD_H - 8
		if (top < 8) top = 8

		cardStyle = `top:${top}px;left:${left}px`
	}

	onMount(async () => {
		if (!browser) return

		try {
			const { PUBLIC_API_URL } = await import('$env/static/public')
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/${username}/profile`)
			if (res.ok) {
				profile = await res.json()
				ensureFontLoaded(profile?.name_font_family ?? null, profile?.name_font_url ?? null)
			}
		} catch { /* ignore */ } finally {
			loading = false
		}

		// Reposition once card is rendered
		setTimeout(computePosition, 0)
	})

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') onclose()
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-[200]"
	role="button"
	tabindex="-1"
	aria-label="Fermer le profil"
	onclick={onclose}
></div>

<!-- Card -->
<div
	bind:this={cardEl}
	class="fixed z-[201] w-[260px] rounded-2xl border border-gray-700/80 bg-gray-900 shadow-2xl shadow-black/60 overflow-hidden"
	style={cardStyle}
	role="dialog"
	aria-modal="true"
	aria-label="Mini profil de {username}"
>
	{#if loading}
		<!-- Skeleton -->
		<div class="p-4 space-y-3 animate-pulse">
			<div class="w-14 h-14 rounded-full bg-gray-700"></div>
			<div class="h-3 bg-gray-700 rounded w-3/4"></div>
			<div class="h-2 bg-gray-800 rounded w-1/2"></div>
			<div class="h-2 bg-gray-800 rounded w-full"></div>
		</div>
	{:else if profile}
		<!-- Banner strip -->
		<div class="h-16 bg-gradient-to-br from-indigo-900/60 via-gray-900 to-gray-900 relative shrink-0">
			<!-- Avatar — overflows banner bottom -->
			<div class="absolute bottom-0 left-4 translate-y-1/2 w-14 h-14 rounded-full border-[3px] border-gray-900 overflow-hidden bg-indigo-700 shadow-xl">
				{#if profile.avatar_url}
					<img src={profile.avatar_url} alt="Avatar" class="w-full h-full object-cover" />
				{:else}
					<div class="w-full h-full flex items-center justify-center text-white text-xl font-bold select-none">
						{(profile.display_name || profile.username).charAt(0).toUpperCase()}
					</div>
				{/if}
			</div>

			<!-- Profile link — top right -->
			<a
				href="/users/{profile.username}"
				onclick={onclose}
				class="absolute top-2 right-2 text-[10px] text-gray-500 hover:text-gray-300 transition-colors px-2 py-1 rounded bg-black/30 hover:bg-black/50"
			>
				Voir le profil →
			</a>
		</div>

		<!-- Name area — push down to clear avatar overflow -->
		<div class="pt-10 px-4 pb-3">
			<!-- Name + grade -->
			<div class="flex items-start justify-between gap-2 min-w-0">
				<div class="min-w-0">
					<p class="text-sm font-bold leading-tight truncate {buildAnimClass(profile)}"
					   style={buildNameStyle(profile, '#ffffff')}>
						{profile.display_name || profile.username}
					</p>
					<p class="text-xs text-gray-500 leading-tight">@{profile.username}</p>
				</div>
				{#if profile.grade_name && profile.grade_color}
					<span class="shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 leading-tight"
					      style="background-color: {profile.grade_color}; color: {gradeTextColor(profile.grade_color)}">
						{profile.grade_name}
					</span>
				{/if}
			</div>

			<!-- Status -->
			{#if profile.status}
				<p class="mt-1.5 text-xs text-gray-400 leading-snug">💬 {profile.status}</p>
			{/if}

			<!-- Separator -->
			<div class="my-3 border-t border-gray-800"></div>

			<!-- Level + XP bar -->
			<div class="mb-2">
				<div class="flex items-center justify-between mb-1">
					<span class="text-[10px] text-gray-500 uppercase tracking-widest font-medium">Niveau</span>
					<span class="text-sm font-black text-indigo-400">{level}</span>
				</div>
				<div class="h-1.5 rounded-full bg-gray-800 overflow-hidden">
					<div class="h-full rounded-full bg-indigo-500 transition-all duration-500"
					     style="width: {levelProgress}%"></div>
				</div>
				<div class="flex justify-between mt-0.5">
					<span class="text-[9px] text-gray-600">{profile.points.toLocaleString('fr-FR')} pts</span>
					<span class="text-[9px] text-gray-600">{levelMax.toLocaleString('fr-FR')} pts</span>
				</div>
			</div>

			<!-- Tags (max 3) -->
			{#if profile.tags?.length > 0}
				<div class="flex flex-wrap gap-1 mt-2">
					{#each profile.tags.slice(0, 3) as tag}
						<span class="rounded-full px-2 py-0.5 text-[10px] font-medium bg-indigo-950/60 text-indigo-400 border border-indigo-900/50">
							#{tag}
						</span>
					{/each}
				</div>
			{/if}

			<!-- Bio snippet -->
			{#if profile.bio}
				<p class="mt-2 text-[11px] text-gray-500 leading-snug line-clamp-2">{profile.bio}</p>
			{/if}
		</div>
	{:else}
		<div class="p-6 text-center text-xs text-gray-600">Profil introuvable</div>
	{/if}
</div>
