<script lang="ts">
	import { buildNameStyle, buildAnimClass, ensureFontLoaded } from '$lib/nameEffects'

	export interface ProfileCardProps {
		username: string
		displayName?: string
		avatarUrl?: string
		nameColor?: string | null
		nameGlow?: string | null
		nameGlowIntensity?: number | null
		nameAnimation?: string | null
		nameFontFamily?: string | null
		nameFontUrl?: string | null
		points: number
		tags: string[]
		memberSince: string // ISO date string
		grade?: { name: string; color: string } | null
		// Variants: 'forum' and 'full' are implemented.
		// 'chat' and 'vocal' are reserved for Phase 2 (chat & vocal rooms).
		variant: 'forum' | 'full' | 'chat' | 'vocal'
	}

	let {
		username,
		displayName,
		avatarUrl,
		nameColor = null,
		nameGlow = null,
		nameGlowIntensity = null,
		nameAnimation = null,
		nameFontFamily = null,
		nameFontUrl = null,
		points,
		tags,
		memberSince,
		grade = null,
		variant = 'forum',
	}: ProfileCardProps = $props()

	$effect(() => ensureFontLoaded(nameFontFamily, nameFontUrl))

	// Initials fallback (first letter of displayName or username)
	const initials = $derived(
		(displayName || username).trim().charAt(0).toUpperCase()
	)

	// Format "Membre depuis mois année"
	const memberSinceFormatted = $derived(() => {
		const d = new Date(memberSince)
		return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
	})

	// Show at most 3 tags per spec
	const visibleTags = $derived(tags.slice(0, 3))

	// Level calculation — same formula as MiniProfileCard and profile page
	const level       = $derived(Math.floor(Math.sqrt(Math.max(0, points) / 10)) + 1)
	const levelMin    = $derived((level - 1) * (level - 1) * 10)
	const levelMax    = $derived(level * level * 10)
	const levelProgress = $derived(
		levelMax > levelMin
			? Math.min(100, Math.round(((points - levelMin) / (levelMax - levelMin)) * 100))
			: 100
	)

	/**
	 * Determine whether to use white or black text on the grade badge
	 * based on the perceived luminance of the hex color.
	 */
	function gradeTextColor(hex: string): string {
		const r = parseInt(hex.slice(1, 3), 16)
		const g = parseInt(hex.slice(3, 5), 16)
		const b = parseInt(hex.slice(5, 7), 16)
		// Perceived luminance (ITU-R BT.601)
		const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
		return luminance > 0.5 ? '#111827' : '#ffffff'
	}
</script>

{#if variant === 'forum'}
	<!--
		Forum variant: displayed to the left of each post in a thread.
		Fixed width, does not expand.
	-->
	<aside class="flex flex-col items-center gap-2 w-28 shrink-0 text-center">
		<!-- Avatar -->
		<a href="/users/{username}" class="block" aria-label="Profil de {displayName || username}">
			{#if avatarUrl}
				<img
					src={avatarUrl}
					alt="Avatar de {displayName || username}"
					class="w-16 h-16 rounded-full object-cover border border-gray-700"
				/>
			{:else}
				<div
					class="w-16 h-16 rounded-full bg-indigo-700 flex items-center justify-center text-white text-2xl font-bold border border-gray-700 select-none"
					aria-hidden="true"
				>
					{initials}
				</div>
			{/if}
		</a>

		<!-- Username -->
		<a
			href="/users/{username}"
			class="text-sm font-semibold truncate max-w-full hover:brightness-125 transition-colors {buildAnimClass({ nameAnimation })}"
			style={buildNameStyle({ nameColor, nameGlow, nameGlowIntensity, nameFontFamily }, '#a5b4fc')}
		>
			{displayName || username}
		</a>

		<!-- Grade badge -->
		{#if grade}
			<span
				class="text-xs font-medium rounded px-1.5 py-0.5 truncate max-w-full"
				style="background-color: {grade.color}; color: {gradeTextColor(grade.color)}"
			>
				{grade.name}
			</span>
		{/if}

		<!-- Points + Level -->
		<span class="text-xs text-yellow-400">{points} pts</span>
		<div class="w-full px-1">
			<div class="flex items-center justify-between mb-0.5">
				<span class="text-[9px] text-gray-500 uppercase tracking-widest">Niv.</span>
				<span class="text-[10px] font-black text-indigo-400">{level}</span>
			</div>
			<div class="h-1 rounded-full bg-gray-800 overflow-hidden">
				<div class="h-full rounded-full bg-indigo-500" style="width: {levelProgress}%"></div>
			</div>
		</div>

		<!-- Tags (max 3) -->
		{#if visibleTags.length > 0}
			<ul class="flex flex-wrap justify-center gap-1" aria-label="Tags">
				{#each visibleTags as tag}
					<li class="text-xs bg-gray-800 text-gray-400 rounded px-1.5 py-0.5">#{tag}</li>
				{/each}
			</ul>
		{/if}

		<!-- Member since -->
		<span class="text-xs text-gray-500">
			Membre depuis<br />{memberSinceFormatted()}
		</span>
	</aside>

{:else if variant === 'full'}
	<!--
		Full variant: used on the /users/[username] profile page.
		Renders a summary card (avatar, username, points, tags, member since).
		The page itself handles the banner and extended fields.
	-->
	<div class="flex items-center gap-4">
		<!-- Avatar -->
		{#if avatarUrl}
			<img
				src={avatarUrl}
				alt="Avatar de {displayName || username}"
				class="w-20 h-20 rounded-full object-cover border-2 border-gray-600"
			/>
		{:else}
			<div
				class="w-20 h-20 rounded-full bg-indigo-700 flex items-center justify-center text-white text-3xl font-bold border-2 border-gray-600 select-none"
				aria-hidden="true"
			>
				{initials}
			</div>
		{/if}

		<div class="flex flex-col gap-1">
			<span class="text-lg font-bold {buildAnimClass({ nameAnimation })}" style={buildNameStyle({ nameColor, nameGlow, nameGlowIntensity, nameFontFamily }, '#ffffff')}>{displayName || username}</span>
			<span class="text-sm text-gray-400">@{username}</span>

			<!-- Grade badge -->
			{#if grade}
				<span
					class="self-start text-xs font-medium rounded px-2 py-0.5"
					style="background-color: {grade.color}; color: {gradeTextColor(grade.color)}"
				>
					{grade.name}
				</span>
			{/if}

			<span class="text-sm text-yellow-400">{points} pts</span>
			<div class="flex items-center gap-2 mt-0.5">
				<span class="text-xs font-black text-indigo-400">Niv. {level}</span>
				<div class="flex-1 h-1.5 rounded-full bg-gray-800 overflow-hidden">
					<div class="h-full rounded-full bg-indigo-500" style="width: {levelProgress}%"></div>
				</div>
			</div>

			{#if visibleTags.length > 0}
				<ul class="flex flex-wrap gap-1.5 mt-1" aria-label="Tags">
					{#each visibleTags as tag}
						<li class="text-xs bg-gray-800 text-gray-400 rounded px-2 py-0.5">#{tag}</li>
					{/each}
				</ul>
			{/if}

			<span class="text-xs text-gray-500 mt-1">Membre depuis {memberSinceFormatted()}</span>
		</div>
	</div>
{/if}

<!--
	Phase 2 stubs — not implemented yet.
	'chat':  inline message avatar (small, left of message text)
	'vocal': participant list entry (medium avatar + username + mic icon)
-->
