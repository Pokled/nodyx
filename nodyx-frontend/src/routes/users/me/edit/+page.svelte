<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'
	import { PROFILE_PRESETS, resolveTheme, themeToStyle, type ProfileThemeVars } from '$lib/profileThemes'
	import { FONT_PRESETS, ANIM_PRESETS, ensureFontLoaded, buildNameStyle, buildAnimClass } from '$lib/nameEffects'

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const profile = $derived(data.profile)

	let submitting = $state(false)
	let nameColor = $state<string>(profile.name_color ?? '#ffffff')
	let nameGlowEnabled   = $state<boolean>(!!profile.name_glow)
	let nameGlow          = $state<string>(profile.name_glow ?? '#6366f1')
	let nameGlowIntensity = $state<number>(profile.name_glow_intensity ?? 10)
	let nameAnimation     = $state<string>(profile.name_animation ?? '')
	let nameFontFamily    = $state<string>(profile.name_font_family ?? '')
	let nameFontUrl       = $state<string | null>(profile.name_font_url ?? null)
	let fontUploading     = $state(false)
	let fontError         = $state('')

	// Preview: computed inline style + anim class for the pseudo preview
	const previewNameStyle = $derived(buildNameStyle({
		nameColor,
		nameGlow:          nameGlowEnabled ? nameGlow : null,
		nameGlowIntensity: nameGlowIntensity,
		nameFontFamily:    nameFontFamily || null,
	}, '#ffffff'))
	const previewAnimClass = $derived(buildAnimClass({ nameAnimation }))

	$effect(() => {
		const furl = nameFontUrl; if (furl) ensureFontLoaded(nameFontFamily, furl)
	})

	async function uploadFont(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		fontError    = ''
		fontUploading = true
		try {
			const { PUBLIC_API_URL } = await import('$env/static/public')
			const token = (data as Record<string, unknown>).token as string | null
			const fd = new FormData()
			fd.append('file', file)
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/me/upload?type=font`, {
				method: 'POST',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
				body: fd,
			})
			if (!res.ok) {
				const j = await res.json().catch(() => ({}))
				throw new Error(j.error ?? 'Erreur upload')
			}
			const { url, family } = await res.json()
			nameFontFamily = family
			const base = PUBLIC_API_URL.replace('/api/v1', '')
			nameFontUrl = url.startsWith('http') ? url : base + url
			if (nameFontUrl) ensureFontLoaded(nameFontFamily, nameFontUrl!)
		} catch (err: unknown) {
			fontError = err instanceof Error ? err.message : 'Erreur upload'
		} finally {
			fontUploading = false
		}
	}

	// ── Profile Theme ──────────────────────────────────────────────────────────
	let theme = $state<ProfileThemeVars>(resolveTheme(profile.metadata?.theme))
	let selectedPresetId = $state<string>(
		PROFILE_PRESETS.find(p => p.vars.bg === theme.bg && p.vars.accent === theme.accent)?.id ?? 'default'
	)

	function applyPreset(preset: typeof PROFILE_PRESETS[0]) {
		theme = { ...preset.vars }
		selectedPresetId = preset.id
	}

	const themeJson = $derived(JSON.stringify(theme))
	const previewStyle = $derived(themeToStyle(theme))

	const colorPickers: Array<{ key: keyof ProfileThemeVars; label: string }> = [
		{ key: 'bg',         label: 'Fond' },
		{ key: 'cardBorder', label: 'Bordure' },
		{ key: 'accent',     label: 'Accent' },
		{ key: 'text',       label: 'Texte' },
		{ key: 'textMuted',  label: 'Texte secondaire' },
	]

	// Links — dynamic list of {label, url} rows
	let links = $state<Array<{ label: string; url: string }>>(
		(profile.links ?? []).map((l: { label: string; url: string }) => ({ ...l }))
	)

	function addLink() { links.push({ label: '', url: '' }) }
	function removeLink(i: number) { links.splice(i, 1) }

	// ── Avatar / Banner upload ─────────────────────────────────────────────────
	type UploadMode = 'url' | 'file'
	let avatarMode  = $state<UploadMode>('url')
	let bannerMode  = $state<UploadMode>('url')

	let avatarUrl     = $state<string>(profile.avatar_url ?? '')
	let bannerUrl     = $state<string>(profile.banner_url ?? '')
	let avatarPreview = $state<string>(profile.avatar_url ?? '')
	let bannerPreview = $state<string>(profile.banner_url ?? '')

	let avatarUploading = $state(false)
	let bannerUploading = $state(false)
	let avatarError     = $state('')
	let bannerError     = $state('')

	const initials = $derived((profile.display_name || profile.username || '?').charAt(0).toUpperCase())

	async function uploadFile(type: 'avatar' | 'banner', file: File) {
		const { PUBLIC_API_URL } = await import('$env/static/public')
		const token = (data as Record<string, unknown>).token as string | null
		const fd = new FormData()
		fd.append('file', file)
		const res = await fetch(`${PUBLIC_API_URL}/api/v1/users/me/upload?type=${type}`, {
			method: 'POST',
			headers: token ? { Authorization: `Bearer ${token}` } : {},
			body: fd,
		})
		if (!res.ok) {
			const j = await res.json().catch(() => ({}))
			throw new Error(j.error ?? 'Erreur upload')
		}
		const { url } = await res.json()
		const base = PUBLIC_API_URL.replace('/api/v1', '')
		return url.startsWith('http') ? url : base + url
	}

	async function handleAvatarFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		avatarPreview  = URL.createObjectURL(file)
		avatarError    = ''
		avatarUploading = true
		try {
			avatarUrl  = await uploadFile('avatar', file)
			avatarMode = 'url'
		}
		catch (err: unknown) { avatarError = err instanceof Error ? err.message : 'Erreur upload' }
		finally { avatarUploading = false }
	}

	async function handleBannerFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0]
		if (!file) return
		bannerPreview  = URL.createObjectURL(file)
		bannerError    = ''
		bannerUploading = true
		try {
			bannerUrl  = await uploadFile('banner', file)
			bannerMode = 'url'
		}
		catch (err: unknown) { bannerError = err instanceof Error ? err.message : 'Erreur upload' }
		finally { bannerUploading = false }
	}
</script>

<svelte:head>
	<title>Modifier mon profil — Nodyx</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════
     MINI BANNER PREVIEW
     ═══════════════════════════════════════════════════════════════ -->
<!-- Outer wrapper: no overflow-hidden so the avatar can extend below -->
<div class="relative w-full h-32 bg-gradient-to-br from-gray-950 via-indigo-950/30 to-gray-950">
	<!-- Inner layer handles the image clipping -->
	<div class="absolute inset-0 overflow-hidden">
		{#if bannerPreview}
			<img src={bannerPreview} alt="Bannière actuelle" class="w-full h-full object-cover" />
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent"></div>
	</div>

	<!-- "Voir mon profil" pill button — top-right of the banner -->
	<a href="/users/{profile.username}"
	   class="absolute top-3 right-4 flex items-center gap-1.5 px-3 py-1.5 rounded-full
	          bg-gray-900/70 backdrop-blur-sm border border-gray-700/50
	          text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-800/90
	          transition-colors shadow-md">
		<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z"/>
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
		</svg>
		Voir mon profil
	</a>

	<!-- Avatar — overlapping the banner bottom edge, fully visible -->
	<div class="absolute bottom-0 left-6 translate-y-1/2 w-20 h-20 rounded-full border-4 border-gray-950 overflow-hidden bg-indigo-800 shadow-xl z-10">
		{#if avatarPreview}
			<img src={avatarPreview} alt="Avatar" class="w-full h-full object-cover" />
		{:else}
			<div class="w-full h-full flex items-center justify-center text-white text-2xl font-bold select-none">{initials}</div>
		{/if}
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE HEADER
     ═══════════════════════════════════════════════════════════════ -->
<div class="max-w-5xl mx-auto px-6 mt-14 mb-6">
	<h1 class="text-xl font-bold text-white">Modifier mon profil</h1>
	<p class="text-sm text-gray-500 mt-0.5">@{profile.username}</p>
</div>

{#if form?.error}
	<div class="max-w-5xl mx-auto px-6 mb-4">
		<p class="rounded-xl bg-red-900/30 border border-red-700/50 px-4 py-3 text-sm text-red-300">
			{form.error}
		</p>
	</div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════
     FORM
     ═══════════════════════════════════════════════════════════════ -->
<form
	method="POST"
	use:enhance={() => {
		submitting = true
		return async ({ update }) => { await update(); submitting = false }
	}}
	class="max-w-5xl mx-auto px-6 pb-16 space-y-4"
>
	<!-- Hidden inputs for upload URLs -->
	<input type="hidden" name="avatar_url" value={avatarUrl} />
	<input type="hidden" name="banner_url" value={bannerUrl} />
	<!-- Hidden inputs for name effects -->
	<input type="hidden" name="name_glow" value={nameGlowEnabled ? nameGlow : ''} />
	<input type="hidden" name="name_glow_intensity" value={nameGlowIntensity} />
	<input type="hidden" name="name_animation" value={nameAnimation} />
	<input type="hidden" name="name_font_family" value={nameFontFamily} />
	<input type="hidden" name="name_font_url" value={nameFontUrl ?? ''} />

	<!-- ─── ROW 1: Identité + Visuels ──────────────────────────────────── -->
	<div class="grid grid-cols-5 gap-4">

		<!-- Identité (3/5) -->
		<div class="col-span-3 bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-4">
			<h2 class="text-xs uppercase tracking-widest text-gray-500 font-semibold flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
				Identité
			</h2>
			<div>
				<label for="display_name" class="block text-xs text-gray-400 mb-1.5 font-medium">Nom affiché</label>
				<input id="display_name" name="display_name" type="text" maxlength="100"
					value={profile.display_name ?? ''}
					placeholder="Ton nom public"
					class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2.5 text-sm text-white
					       placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
			</div>
			<!-- Name color -->
			<div>
				<label for="name_color" class="block text-xs text-gray-400 mb-1.5 font-medium">
					Couleur du pseudo <span class="text-gray-600 font-normal">— visible sur la bannière</span>
				</label>
				<div class="flex items-center gap-3">
					<input id="name_color" name="name_color" type="color"
						bind:value={nameColor}
						class="w-10 h-10 rounded-lg border border-gray-700 bg-gray-800/70 cursor-pointer p-0.5
						       focus:outline-none focus:border-indigo-500 transition-colors shrink-0" />
					<div class="flex-1">
						<p class="text-sm font-semibold truncate drop-shadow"
						   style="color: {nameColor}">
							{profile.display_name || profile.username || 'Aperçu du pseudo'}
						</p>
						<p class="text-xs" style="color: {nameColor}b3">@{profile.username}</p>
					</div>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="status" class="block text-xs text-gray-400 mb-1.5 font-medium">Statut</label>
					<input id="status" name="status" type="text" maxlength="100"
						placeholder="En train de coder…"
						value={profile.status ?? ''}
						class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2.5 text-sm text-white
						       placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
				</div>
				<div>
					<label for="location" class="block text-xs text-gray-400 mb-1.5 font-medium">Localisation</label>
					<input id="location" name="location" type="text" maxlength="100"
						placeholder="Paris, France"
						value={profile.location ?? ''}
						class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2.5 text-sm text-white
						       placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
				</div>
			</div>
			<div>
				<label for="bio" class="block text-xs text-gray-400 mb-1.5 font-medium">
					Bio <span class="text-gray-600 font-normal">(max 2000 caractères)</span>
				</label>
				<textarea id="bio" name="bio" maxlength="2000" rows="5"
					placeholder="Présente-toi à la communauté…"
					class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2.5 text-sm text-white
					       placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 resize-none transition-colors"
				>{profile.bio ?? ''}</textarea>
			</div>
		</div>

		<!-- Visuels (2/5) -->
		<div class="col-span-2 bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-5">
			<h2 class="text-xs uppercase tracking-widest text-gray-500 font-semibold flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>
				Visuels
			</h2>

			<!-- Avatar -->
			<div>
				<p class="text-xs text-gray-400 font-medium mb-2">Avatar</p>
				<div class="flex items-center gap-3 mb-3">
					<div class="w-14 h-14 rounded-full overflow-hidden bg-indigo-800 border-2 border-gray-700 shrink-0">
						{#if avatarPreview}
							<img src={avatarPreview} alt="Avatar" class="w-full h-full object-cover" />
						{:else}
							<div class="w-full h-full flex items-center justify-center text-white text-xl font-bold select-none">{initials}</div>
						{/if}
					</div>
					<div class="flex gap-1">
						<button type="button" onclick={() => { avatarMode = 'url' }}
							class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors {avatarMode === 'url' ? 'bg-indigo-600 text-white' : 'bg-gray-700/80 text-gray-400 hover:text-white'}">
							URL
						</button>
						<button type="button" onclick={() => { avatarMode = 'file' }}
							class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors {avatarMode === 'file' ? 'bg-indigo-600 text-white' : 'bg-gray-700/80 text-gray-400 hover:text-white'}">
							Fichier
						</button>
					</div>
				</div>
				{#if avatarMode === 'url'}
					<input type="url" maxlength="500" placeholder="https://…"
						bind:value={avatarUrl} oninput={() => { avatarPreview = avatarUrl }}
						class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2 text-white text-sm
						       placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors" />
				{:else}
					<label class="flex items-center gap-2 cursor-pointer">
						<span class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 transition-colors">
							{avatarUploading ? 'Envoi…' : 'Choisir un fichier'}
						</span>
						<span class="text-[11px] text-gray-600">JPEG · PNG · WebP · GIF · 5 Mo max</span>
						<input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
							class="sr-only" disabled={avatarUploading} onchange={handleAvatarFile} />
					</label>
					{#if avatarError}<p class="text-xs text-red-400 mt-1">{avatarError}</p>{/if}
				{/if}
			</div>

			<!-- Bannière -->
			<div>
				<p class="text-xs text-gray-400 font-medium mb-2">Bannière de profil</p>
				{#if bannerPreview}
					<img src={bannerPreview} alt="Aperçu bannière" class="w-full h-16 object-cover rounded-lg mb-2 border border-gray-700" />
				{:else}
					<div class="w-full h-16 rounded-lg bg-gray-800/50 border border-gray-700 flex items-center justify-center text-gray-600 text-xs mb-2">
						Aucune bannière
					</div>
				{/if}
				<div class="flex gap-1 mb-2">
					<button type="button" onclick={() => { bannerMode = 'url' }}
						class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors {bannerMode === 'url' ? 'bg-indigo-600 text-white' : 'bg-gray-700/80 text-gray-400 hover:text-white'}">
						URL
					</button>
					<button type="button" onclick={() => { bannerMode = 'file' }}
						class="px-2.5 py-1 rounded-md text-xs font-medium transition-colors {bannerMode === 'file' ? 'bg-indigo-600 text-white' : 'bg-gray-700/80 text-gray-400 hover:text-white'}">
						Fichier
					</button>
				</div>
				{#if bannerMode === 'url'}
					<input type="url" maxlength="500" placeholder="https://…"
						bind:value={bannerUrl} oninput={() => { bannerPreview = bannerUrl }}
						class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2 text-white text-sm
						       placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors" />
				{:else}
					<label class="flex items-center gap-2 cursor-pointer">
						<span class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 transition-colors">
							{bannerUploading ? 'Envoi…' : 'Choisir un fichier'}
						</span>
						<span class="text-[11px] text-gray-600">5 Mo max</span>
						<input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
							class="sr-only" disabled={bannerUploading} onchange={handleBannerFile} />
					</label>
					{#if bannerError}<p class="text-xs text-red-400 mt-1">{bannerError}</p>{/if}
				{/if}
			</div>
		</div>
	</div>

	<!-- ─── ROW 1.5: Thème du profil ──────────────────────────────────────── -->
	<div class="bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-5">
		<h2 class="text-xs uppercase tracking-widest text-gray-500 font-semibold flex items-center gap-2">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z"/></svg>
			Thème du profil
		</h2>

		<div class="grid lg:grid-cols-3 gap-6">
			<!-- Preset grid -->
			<div class="lg:col-span-2 space-y-3">
				<p class="text-xs text-gray-400 font-medium">Choisir un preset</p>
				<div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
					{#each PROFILE_PRESETS as preset}
						<button type="button" onclick={() => applyPreset(preset)}
							class="flex flex-col gap-1.5 p-2 rounded-xl border transition-all
							       {selectedPresetId === preset.id
							         ? 'border-indigo-500 bg-indigo-950/40'
							         : 'border-gray-700 hover:border-gray-500 bg-gray-800/40'}"
						>
							<!-- Mini preview card -->
							<div class="w-full rounded-lg overflow-hidden" style="background:{preset.vars.bg}; aspect-ratio:16/9;">
								<div class="h-2/3 w-full p-1 space-y-0.5"
								     style="background:{preset.vars.cardBg}; border-bottom:1px solid {preset.vars.cardBorder};">
									<div class="h-1 rounded-sm w-3/4" style="background:{preset.vars.accent}"></div>
									<div class="h-1 rounded-sm w-1/2" style="background:{preset.vars.textMuted}"></div>
								</div>
							</div>
							<p class="text-[10px] text-center truncate leading-tight"
							   style="color:{selectedPresetId === preset.id ? preset.vars.accent : '#9ca3af'}">
								{preset.emoji} {preset.name}
							</p>
						</button>
					{/each}
				</div>
			</div>

			<!-- Color fine-tuning -->
			<div class="space-y-3">
				<p class="text-xs text-gray-400 font-medium">Personnaliser</p>
				<div class="space-y-2">
					{#each colorPickers as picker}
						<div class="flex items-center gap-2.5">
							<input type="color"
								value={theme[picker.key] as string}
								oninput={(e) => {
									(theme as unknown as Record<string, unknown>)[picker.key] = (e.target as HTMLInputElement).value
									selectedPresetId = 'custom'
								}}
								class="w-8 h-8 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer p-0.5 shrink-0
								       focus:outline-none focus:border-indigo-500 transition-colors" />
							<span class="text-xs text-gray-400 flex-1">{picker.label}</span>
							<span class="text-[10px] text-gray-600 font-mono">{theme[picker.key]}</span>
						</div>
					{/each}
				</div>
				<p class="text-[11px] text-gray-600">Le fond semi-transparent des cartes suit le preset.</p>
			</div>
		</div>

		<!-- Live preview strip -->
		<div>
			<p class="text-xs text-gray-400 font-medium mb-2">Aperçu</p>
			<div class="rounded-xl overflow-hidden h-20 flex items-center gap-4 px-5 transition-all duration-300"
			     style={previewStyle}>
				<div class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold"
				     style="background:{theme.accent}; color:{theme.bg}">{initials}</div>
				<div>
					<p class="text-sm font-bold leading-tight" style="color:{theme.text}">{profile.display_name || profile.username}</p>
					<p class="text-xs" style="color:{theme.textMuted}">@{profile.username}</p>
				</div>
				<div class="ml-auto flex flex-col gap-1">
					<div class="h-1.5 w-20 rounded-full" style="background:{theme.accent}"></div>
					<div class="h-1.5 w-14 rounded-full" style="background:{theme.cardBorder}"></div>
					<div class="h-1.5 w-16 rounded-full" style="background:{theme.textMuted}; opacity:.5"></div>
				</div>
			</div>
		</div>

		<!-- Hidden serialised theme -->
		<input type="hidden" name="metadata_theme" value={themeJson} />
	</div>

	<!-- ─── ROW 1.7: Effets du pseudo ─────────────────────────────────────── -->
	<div class="bg-gray-900/80 border border-gray-800 rounded-xl p-5 space-y-6">
		<h2 class="text-xs uppercase tracking-widest text-gray-500 font-semibold flex items-center gap-2">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"/></svg>
			Effets du pseudo
		</h2>

		<!-- Live preview -->
		<div class="flex items-center gap-3 px-4 py-3 bg-gray-800/50 rounded-xl border border-gray-700/60">
			<span class="text-xs text-gray-500 shrink-0">Aperçu</span>
			<span class="text-sm font-bold {previewAnimClass}" style={previewNameStyle}>
				{profile.display_name || profile.username || 'MonPseudo'}
			</span>
		</div>

		<div class="grid lg:grid-cols-3 gap-6">

			<!-- Police -->
			<div class="space-y-3">
				<p class="text-xs text-gray-400 font-medium">Police du pseudo</p>
				<div class="grid grid-cols-3 gap-1.5">
					{#each FONT_PRESETS as preset}
						<button
							type="button"
							onclick={() => { nameFontFamily = preset.family; nameFontUrl = null }}
							class="px-2 py-1.5 rounded-lg text-xs border transition-all text-center
							       {nameFontFamily === preset.family
									 ? 'border-indigo-500 bg-indigo-950/50 text-white'
									 : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-500 hover:text-white'}"
							style={preset.family ? `font-family: '${preset.family}', sans-serif` : ''}
						>
							{preset.family ? preset.preview : 'Défaut'}
						</button>
					{/each}
				</div>
				<!-- Custom font upload -->
				<div class="pt-1">
					<label class="flex items-center gap-2 cursor-pointer">
						<span class="px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-gray-200 transition-colors shrink-0">
							{fontUploading ? 'Envoi…' : 'Importer une police'}
						</span>
						<span class="text-[10px] text-gray-600">.ttf · .otf · .woff · .woff2</span>
						<input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
							class="sr-only" disabled={fontUploading} onchange={uploadFont} />
					</label>
					{#if nameFontUrl}
						<p class="text-[10px] text-green-500 mt-1">Police personnalisée chargée : {nameFontFamily}</p>
					{/if}
					{#if fontError}<p class="text-[10px] text-red-400 mt-1">{fontError}</p>{/if}
				</div>
			</div>

			<!-- Halo lumineux -->
			<div class="space-y-3">
				<p class="text-xs text-gray-400 font-medium">Halo lumineux</p>
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input type="checkbox" bind:checked={nameGlowEnabled}
						class="w-4 h-4 rounded border-gray-600 bg-gray-800 accent-indigo-500 cursor-pointer" />
					<span class="text-xs text-gray-300">Activer le halo</span>
				</label>
				{#if nameGlowEnabled}
					<div class="space-y-2">
						<div class="flex items-center gap-3">
							<input type="color" bind:value={nameGlow}
								class="w-9 h-9 rounded-lg border border-gray-700 bg-gray-800 cursor-pointer p-0.5 focus:outline-none focus:border-indigo-500 shrink-0" />
							<div class="flex-1 space-y-1">
								<div class="flex justify-between text-[10px] text-gray-500">
									<span>Intensité</span>
									<span>{nameGlowIntensity}px</span>
								</div>
								<input type="range" min="5" max="40" step="1"
									bind:value={nameGlowIntensity}
									class="w-full accent-indigo-500 cursor-pointer" />
							</div>
						</div>
					</div>
				{/if}
			</div>

			<!-- Animations -->
			<div class="space-y-3">
				<p class="text-xs text-gray-400 font-medium">Animation</p>
				<div class="grid grid-cols-2 gap-1.5">
					{#each ANIM_PRESETS as preset}
						<button
							type="button"
							onclick={() => { nameAnimation = preset.key }}
							class="px-2.5 py-1.5 rounded-lg text-xs border transition-all text-left
							       {nameAnimation === preset.key
									 ? 'border-indigo-500 bg-indigo-950/50 text-white'
									 : 'border-gray-700 bg-gray-800/40 text-gray-400 hover:border-gray-500 hover:text-white'}"
						>
							{preset.label}
							{#if preset.always}
								<span class="text-[9px] text-indigo-500 ml-1">∞</span>
							{/if}
						</button>
					{/each}
				</div>
				<p class="text-[10px] text-gray-600">∞ = animation permanente · autres = au survol</p>
			</div>
		</div>
	</div>

	<!-- ─── ROW 2: Réseaux sociaux ─────────────────────────────────────────── -->
	<div class="bg-gray-900/80 border border-gray-800 rounded-xl p-5">
		<h2 class="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-4 flex items-center gap-2">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>
			Réseaux sociaux
		</h2>
		<div class="grid grid-cols-2 gap-4">
			<div>
				<label for="github_username" class="block text-xs text-gray-400 mb-1.5 font-medium">
					GitHub <span class="text-gray-600 font-normal">— ex: monusername</span>
				</label>
				<div class="flex items-center rounded-lg bg-gray-800/70 border border-gray-700 overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-gray-500 text-sm border-r border-gray-700 bg-gray-800/50 shrink-0">github.com/</span>
					<input id="github_username" name="github_username" type="text" maxlength="39"
						placeholder="monusername" pattern="[a-zA-Z0-9-]+"
						value={profile.github_username ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none" />
				</div>
			</div>
			<div>
				<label for="twitter_username" class="block text-xs text-gray-400 mb-1.5 font-medium">
					Twitter / X <span class="text-gray-600 font-normal">— ex: monpseudo</span>
				</label>
				<div class="flex items-center rounded-lg bg-gray-800/70 border border-gray-700 overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-gray-500 text-sm border-r border-gray-700 bg-gray-800/50 shrink-0">@</span>
					<input id="twitter_username" name="twitter_username" type="text" maxlength="100"
						placeholder="monpseudo"
						value={profile.twitter_username ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none" />
				</div>
			</div>
			<div>
				<label for="instagram_username" class="block text-xs text-gray-400 mb-1.5 font-medium">
					Instagram <span class="text-gray-600 font-normal">— ex: monpseudo</span>
				</label>
				<div class="flex items-center rounded-lg bg-gray-800/70 border border-gray-700 overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-gray-500 text-sm border-r border-gray-700 bg-gray-800/50 shrink-0">@</span>
					<input id="instagram_username" name="instagram_username" type="text" maxlength="100"
						placeholder="monpseudo"
						value={profile.instagram_username ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none" />
				</div>
			</div>
			<div>
				<label for="youtube_channel" class="block text-xs text-gray-400 mb-1.5 font-medium">
					YouTube <span class="text-gray-600 font-normal">— ex: @machaîne</span>
				</label>
				<div class="flex items-center rounded-lg bg-gray-800/70 border border-gray-700 overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-gray-500 text-sm border-r border-gray-700 bg-gray-800/50 shrink-0">youtube.com/</span>
					<input id="youtube_channel" name="youtube_channel" type="text" maxlength="200"
						placeholder="@machaîne"
						value={profile.youtube_channel ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none" />
				</div>
			</div>
			<div class="col-span-2">
				<label for="website_url" class="block text-xs text-gray-400 mb-1.5 font-medium">
					Site web <span class="text-gray-600 font-normal">— URL complète</span>
				</label>
				<input id="website_url" name="website_url" type="url" maxlength="500"
					placeholder="https://monsite.com"
					value={profile.website_url ?? ''}
					class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2.5 text-sm text-white
					       placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
			</div>
		</div>
	</div>

	<!-- ─── ROW 3: Tags + Liens personnalisés ──────────────────────────────── -->
	<div class="grid grid-cols-2 gap-4">

		<!-- Tags -->
		<div class="bg-gray-900/80 border border-gray-800 rounded-xl p-5">
			<h2 class="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-4 flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z"/></svg>
				Tags
			</h2>
			<label for="tags" class="block text-xs text-gray-400 mb-1.5 font-medium">
				Séparés par des virgules <span class="text-gray-600">(max 10)</span>
			</label>
			<input id="tags" name="tags" type="text"
				placeholder="linux, photo, gaming, musique"
				value={profile.tags?.join(', ') ?? ''}
				class="w-full rounded-lg bg-gray-800/70 border border-gray-700 px-3 py-2.5 text-sm text-white
				       placeholder-gray-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
			<p class="text-[11px] text-gray-600 mt-2">Tes centres d'intérêt — affichés sur ton profil public</p>
		</div>

		<!-- Liens personnalisés -->
		<div class="bg-gray-900/80 border border-gray-800 rounded-xl p-5">
			<h2 class="text-xs uppercase tracking-widest text-gray-500 font-semibold mb-4 flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
				Liens personnalisés
			</h2>
			<div class="space-y-2 mb-3">
				{#each links as link, i}
					<div class="flex gap-2 items-center">
						<input name="link_label_{i}" type="text" maxlength="50"
							placeholder="Label"
							bind:value={link.label}
							class="w-28 shrink-0 rounded-lg bg-gray-800/70 border border-gray-700 px-2.5 py-2 text-white text-xs
							       placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors" />
						<input name="link_url_{i}" type="url" maxlength="500"
							placeholder="https://…"
							bind:value={link.url}
							class="flex-1 rounded-lg bg-gray-800/70 border border-gray-700 px-2.5 py-2 text-white text-xs
							       placeholder-gray-600 focus:outline-none focus:border-indigo-500 transition-colors" />
						<button type="button" onclick={() => removeLink(i)}
							class="w-7 h-7 flex items-center justify-center rounded-lg bg-red-900/30 hover:bg-red-900/60 text-red-400 hover:text-red-300 transition-colors shrink-0"
							aria-label="Supprimer">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
						</button>
					</div>
				{/each}
				{#if links.length === 0}
					<p class="text-xs text-gray-600 py-2">Aucun lien — ajoutes-en un !</p>
				{/if}
			</div>
			<button type="button" onclick={addLink}
				class="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-medium">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
				Ajouter un lien
			</button>
		</div>
	</div>

	<!-- ─── SUBMIT BAR ──────────────────────────────────────────────────────── -->
	<div class="flex items-center justify-between pt-2 pb-4 border-t border-gray-800">
		<a href="/users/{profile.username}"
		   class="text-sm text-gray-500 hover:text-gray-300 transition-colors">
			← Annuler
		</a>
		<button type="submit" disabled={submitting}
			class="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500
			       disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white
			       transition-colors shadow-lg shadow-indigo-900/30">
			{#if submitting}
				<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
				Enregistrement…
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
				Enregistrer les modifications
			{/if}
		</button>
	</div>
</form>
