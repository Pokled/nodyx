<script lang="ts">
	import { enhance } from '$app/forms'
	import { goto } from '$app/navigation'
	import type { PageData, ActionData } from './$types'
	import { PROFILE_PRESETS, resolveTheme, themeToStyle, siteThemeStyle, isPersonalTheme, type ProfileThemeVars } from '$lib/profileThemes'
	import { FONT_PRESETS, ANIM_PRESETS, ensureFontLoaded, buildNameStyle, buildAnimClass } from '$lib/nameEffects'
	import { untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import { isDarkTheme, contrastSafeColor } from '$lib/theme'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()
	const profile = $derived(data.profile)
	const p = untrack(() => data.profile)

	let submitting = $state(false)
	let displayName = $state<string>(p.display_name ?? '')
	let nameColor = $state<string>(p.name_color ?? '#ffffff')
	let nameGlowEnabled   = $state<boolean>(!!p.name_glow)
	let nameGlow          = $state<string>(p.name_glow ?? '#6366f1')
	let nameGlowIntensity = $state<number>(p.name_glow_intensity ?? 10)
	let nameAnimation     = $state<string>(p.name_animation ?? '')
	let nameFontFamily    = $state<string>(p.name_font_family ?? '')
	let nameFontUrl       = $state<string | null>(p.name_font_url ?? null)
	let fontUploading     = $state(false)
	let fontError         = $state('')

	// Preview: computed inline style + anim class for the pseudo preview
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
			const { PUBLIC_API_URL } = await import('$app/env/public')
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
				throw new Error(j.error ?? tFn('pedit.upload_error'))
			}
			const { url, family } = await res.json()
			nameFontFamily = family
			const base = PUBLIC_API_URL.replace('/api/v1', '')
			nameFontUrl = url.startsWith('http') ? url : base + url
			if (nameFontUrl) ensureFontLoaded(nameFontFamily, nameFontUrl!)
		} catch (err: unknown) {
			fontError = err instanceof Error ? err.message : tFn('pedit.upload_error')
		} finally {
			fontUploading = false
		}
	}

	// ── Profile Theme ──────────────────────────────────────────────────────────
	let theme = $state<ProfileThemeVars>(resolveTheme(p.metadata?.theme))
	// « default » = suivre le thème du site (aucun thème perso). Un thème perso qui ne
	// correspond à aucun préréglage est « custom » : il s'affichait comme « Défaut ».
	let selectedPresetId = $state<string>(
		!isPersonalTheme(p.metadata?.theme)
			? 'default'
			: PROFILE_PRESETS.find(pr => pr.id !== 'default' && pr.vars.bg === theme.bg && pr.vars.accent === theme.accent)?.id ?? 'custom'
	)

	function applyPreset(preset: typeof PROFILE_PRESETS[0]) {
		theme = { ...preset.vars }
		selectedPresetId = preset.id
	}

	// Suivre le site = objet VIDE : la fusion côté cœur (metadata || ...) remplace
	// l'ancien thème, et le profil n'a plus de couleurs à lui.
	const followSite = $derived(selectedPresetId === 'default')
	const themeJson = $derived(followSite ? '{}' : JSON.stringify(theme))
	const previewStyle = $derived(followSite ? `${siteThemeStyle()};background:var(--nx-bg)` : themeToStyle(theme))
	// Couleur du pseudo telle que le profil l'affichera : brute sur un thème perso, ajustée
	// par contrastSafeColor quand le profil suit le site (même règle que /users/[username]).
	// Les aperçus sont posés sur previewStyle, le fond réel du profil.
	const shownNameColor = $derived(followSite ? contrastSafeColor(nameColor, 'var(--p-text)', $isDarkTheme) : nameColor)
	// Fond de l'aperçu = fond réel du profil (previewStyle) : sur le thème du site, la
	// couleur est ajustée au thème regardé ; sur un thème perso, comportement historique.
	const previewNameStyle = $derived(buildNameStyle({
		nameColor,
		nameGlow:          nameGlowEnabled ? nameGlow : null,
		nameGlowIntensity: nameGlowIntensity,
		nameFontFamily:    nameFontFamily || null,
	}, followSite ? 'var(--p-text)' : '#ffffff', followSite ? $isDarkTheme : true))

	const colorPickers: Array<{ key: keyof ProfileThemeVars; labelKey: string }> = [
		{ key: 'bg',         labelKey: 'pedit.color_bg' },
		{ key: 'cardBorder', labelKey: 'pedit.color_border' },
		{ key: 'accent',     labelKey: 'pedit.color_accent' },
		{ key: 'text',       labelKey: 'pedit.color_text' },
		{ key: 'textMuted',  labelKey: 'pedit.color_text_muted' },
	]

	// Links — dynamic list of {label, url} rows
	let links = $state<Array<{ label: string; url: string }>>(
		(p.links ?? []).map((l: { label: string; url: string }) => ({ ...l }))
	)

	function addLink() { links.push({ label: '', url: '' }) }
	function removeLink(i: number) { links.splice(i, 1) }

	// ── Avatar / Banner upload ─────────────────────────────────────────────────
	type UploadMode = 'url' | 'file'
	let avatarMode  = $state<UploadMode>('url')
	let bannerMode  = $state<UploadMode>('url')

	let avatarUrl     = $state<string>(p.avatar_url ?? '')
	let bannerUrl     = $state<string>(p.banner_url ?? '')
	// bannerPreview can also come from banner_asset_path (uploaded file via community_assets)
	const initialBannerPreview = p.banner_asset_path
		? `/uploads/${p.banner_asset_path}`
		: (p.banner_url ?? '')
	let avatarPreview = $state<string>(p.avatar_url ?? '')
	let bannerPreview = $state<string>(initialBannerPreview)

	let clearAvatar = $state(false)
	let clearBanner = $state(false)

	let avatarUploading = $state(false)
	let bannerUploading = $state(false)
	let avatarError     = $state('')
	let bannerError     = $state('')

	function deleteAvatar() {
		avatarUrl     = ''
		avatarPreview = ''
		clearAvatar   = true
	}
	function deleteBanner() {
		bannerUrl     = ''
		bannerPreview = ''
		clearBanner   = true
	}

	const initials = $derived((profile.display_name || profile.username || '?').charAt(0).toUpperCase())

	async function uploadFile(type: 'avatar' | 'banner', file: File) {
		const { PUBLIC_API_URL } = await import('$app/env/public')
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
			throw new Error(j.error ?? tFn('pedit.upload_error'))
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
		catch (err: unknown) { avatarError = err instanceof Error ? err.message : tFn('pedit.upload_error') }
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
		catch (err: unknown) { bannerError = err instanceof Error ? err.message : tFn('pedit.upload_error') }
		finally { bannerUploading = false }
	}
</script>

<svelte:head>
	<title>{tFn('pedit.meta_title')}</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════
     MINI BANNER PREVIEW
     ═══════════════════════════════════════════════════════════════ -->
<!-- Outer wrapper: no overflow-hidden so the avatar can extend below -->
<div class="relative w-full h-32 bg-gradient-to-br from-[var(--nx-surface-raised)] via-[rgb(var(--nx-accent-rgb)/0.12)] to-[var(--nx-surface-raised)]">
	<!-- Inner layer handles the image clipping -->
	<div class="absolute inset-0 overflow-hidden">
		{#if bannerPreview}
			<img src={bannerPreview} alt={tFn('pedit.banner')} class="w-full h-full object-cover" />
		{/if}
		<div class="absolute inset-0 bg-gradient-to-t from-[var(--nx-bg)] via-[var(--nx-bg)]/50 to-transparent"></div>
	</div>

	<!-- "Voir mon profil" pill button — top-right of the banner -->
	<a href="/users/{profile.username}"
	   class="absolute top-3 right-4 flex items-center gap-1.5 px-3 py-1.5 max-sm:py-2.5 rounded-full
	          bg-[var(--nx-surface)]/70 backdrop-blur-sm border border-[var(--nx-border)]/50
	          text-xs font-medium text-[var(--nx-text)] hover:text-[var(--nx-text)] hover:bg-[var(--nx-surface-raised)]/90
	          transition-colors shadow-md">
		<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
			<path stroke-linecap="round" stroke-linejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.964-7.178z"/>
			<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
		</svg>
		{tFn('pedit.view_profile')}
	</a>

	<!-- Avatar — overlapping the banner bottom edge, fully visible -->
	<div class="absolute bottom-0 left-6 translate-y-1/2 w-20 h-20 rounded-full border-4 border-[var(--nx-border)] overflow-hidden bg-indigo-800 shadow-xl z-10">
		{#if avatarPreview}
			<img src={avatarPreview} alt={tFn('pedit.avatar_alt')} class="w-full h-full object-cover" />
		{:else}
			<div class="w-full h-full flex items-center justify-center text-white text-2xl font-bold select-none">{initials}</div>
		{/if}
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════════
     PAGE HEADER
     ═══════════════════════════════════════════════════════════════ -->
<div class="max-w-5xl mx-auto px-6 mt-14 mb-6">
	<h1 class="text-xl font-bold text-[var(--nx-text)]">{tFn('pedit.title')}</h1>
	<p class="text-sm text-[var(--nx-text-muted)] mt-0.5">@{profile.username}</p>
</div>

{#if form?.error}
	<div class="max-w-5xl mx-auto px-6 mb-4">
		<p class="rounded-xl bg-[color-mix(in_srgb,var(--nx-bad)_12%,transparent)] border border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] px-4 py-3 text-sm text-[var(--nx-bad)]">
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
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true })
			} else {
				await update()
			}
			submitting = false
		}
	}}
	class="max-w-5xl mx-auto px-6 pb-16 space-y-4"
>
	<!-- Hidden inputs for upload URLs -->
	<input type="hidden" name="avatar_url" value={avatarUrl} />
	<input type="hidden" name="banner_url" value={bannerUrl} />
	<!-- Explicit delete flags — send '1' to clear asset_id too -->
	<input type="hidden" name="clear_avatar" value={clearAvatar ? '1' : ''} />
	<input type="hidden" name="clear_banner" value={clearBanner ? '1' : ''} />
	<!-- Hidden inputs for name effects -->
	<input type="hidden" name="name_glow" value={nameGlowEnabled ? nameGlow : ''} />
	<input type="hidden" name="name_glow_intensity" value={nameGlowIntensity} />
	<input type="hidden" name="name_animation" value={nameAnimation} />
	<input type="hidden" name="name_font_family" value={nameFontFamily} />
	<input type="hidden" name="name_font_url" value={nameFontUrl ?? ''} />

	<!-- ─── ROW 1: Identité + Visuels ──────────────────────────────────── -->
	<!-- Empile sous `md`. A 502px les deux colonnes cote a cote laissaient 260px
	     et 150px : « Status » et « Location » tronquaient, la bio etait coupee. -->
	<div class="grid grid-cols-1 md:grid-cols-5 gap-4">

		<!-- Identité (3/5) -->
		<div class="md:col-span-3 bg-[var(--nx-surface)]/80 border border-[var(--nx-border)] rounded-xl p-5 space-y-4">
			<h2 class="text-xs uppercase tracking-widest text-[var(--nx-text-muted)] font-semibold flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"/></svg>
				{tFn('pedit.section_identity')}
			</h2>
			<div>
				<label for="display_name" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">{tFn('pedit.display_name')}</label>
				<input id="display_name" name="display_name" type="text" maxlength="100"
					bind:value={displayName}
					placeholder={tFn('pedit.display_name_ph')}
					class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2.5 text-sm text-[var(--nx-text)]
					       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
			</div>
			<!-- Name color -->
			<div>
				<label for="name_color" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
					{tFn('pedit.name_color')} <span class="text-[var(--nx-text-muted)] font-normal">{tFn('pedit.name_color_sub')}</span>
				</label>
				<div class="flex items-center gap-3">
					<input id="name_color" name="name_color" type="color"
						bind:value={nameColor}
						class="w-10 h-10 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/70 cursor-pointer p-0.5
						       focus:outline-none focus:border-indigo-500 transition-colors shrink-0" />
					<div class="flex-1 min-w-0 rounded-lg px-3 py-1.5" style={previewStyle}>
						<p class="text-sm font-semibold truncate drop-shadow"
						   style="color: {shownNameColor}">
							{displayName || profile.username || tFn('pedit.name_preview')}
						</p>
						<p class="text-xs" style="color: color-mix(in srgb, {shownNameColor} 70%, transparent)">@{profile.username}</p>
					</div>
				</div>
			</div>

			<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
				<div>
					<label for="status" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">{tFn('pedit.status')}</label>
					<input id="status" name="status" type="text" maxlength="100"
						placeholder={tFn('pedit.status_ph')}
						value={profile.status ?? ''}
						class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2.5 text-sm text-[var(--nx-text)]
						       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
				</div>
				<div>
					<label for="location" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">{tFn('pedit.location')}</label>
					<input id="location" name="location" type="text" maxlength="100"
						placeholder={tFn('pedit.location_ph')}
						value={profile.location ?? ''}
						class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2.5 text-sm text-[var(--nx-text)]
						       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
				</div>
			</div>
			<div>
				<label for="bio" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
					{tFn('pedit.bio')} <span class="text-[var(--nx-text-muted)] font-normal">{tFn('pedit.bio_max')}</span>
				</label>
				<textarea id="bio" name="bio" maxlength="2000" rows="5"
					placeholder={tFn('pedit.bio_ph')}
					class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2.5 text-sm text-[var(--nx-text)]
					       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 resize-none transition-colors"
				>{profile.bio ?? ''}</textarea>
			</div>
		</div>

		<!-- Visuels (2/5) -->
		<div class="md:col-span-2 bg-[var(--nx-surface)]/80 border border-[var(--nx-border)] rounded-xl p-5 space-y-5">
			<h2 class="text-xs uppercase tracking-widest text-[var(--nx-text-muted)] font-semibold flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"/></svg>
				{tFn('pedit.section_visuals')}
			</h2>

			<!-- Avatar -->
			<div>
				<div class="flex items-center justify-between mb-2">
					<p class="text-xs text-[var(--nx-text-muted)] font-medium">{tFn('pedit.avatar_section')}</p>
					{#if avatarPreview}
						<button type="button" onclick={deleteAvatar}
							class="text-[11px] text-[var(--nx-bad)] hover:text-[var(--nx-bad)] transition-colors flex items-center gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
							</svg>
							{tFn('common.delete')}
						</button>
					{/if}
				</div>
				<div class="flex items-center gap-3 mb-3">
					<div class="w-14 h-14 rounded-full overflow-hidden bg-indigo-800 border-2 border-[var(--nx-border)] shrink-0">
						{#if avatarPreview}
							<img src={avatarPreview} alt={tFn('pedit.avatar_alt')} class="w-full h-full object-cover" />
						{:else}
							<div class="w-full h-full flex items-center justify-center text-white text-xl font-bold select-none">{initials}</div>
						{/if}
					</div>
					<div class="flex gap-1">
						<button type="button" onclick={() => { avatarMode = 'url' }}
							class="px-2.5 max-sm:py-2.5 py-1 rounded-md text-xs font-medium transition-colors {avatarMode === 'url' ? 'bg-indigo-600 text-white' : 'bg-[var(--nx-border)]/80 text-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}">
							URL
						</button>
						<button type="button" onclick={() => { avatarMode = 'file' }}
							class="px-2.5 max-sm:py-2.5 py-1 rounded-md text-xs font-medium transition-colors {avatarMode === 'file' ? 'bg-indigo-600 text-white' : 'bg-[var(--nx-border)]/80 text-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}">
							{tFn('pedit.file')}
						</button>
					</div>
				</div>
				{#if avatarMode === 'url'}
					<input type="url" maxlength="500" placeholder={tFn('pedit.url_ph')}
						bind:value={avatarUrl} oninput={() => { avatarPreview = avatarUrl }}
						class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2 text-[var(--nx-text)] text-sm
						       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 transition-colors" />
				{:else}
					<label class="relative flex items-center gap-2 cursor-pointer">
						<span class="px-3 py-1.5 rounded-lg bg-[var(--nx-border)] hover:bg-[var(--nx-border)] text-xs text-[var(--nx-text)] transition-colors">
							{avatarUploading ? tFn('pedit.uploading') : tFn('pedit.choose_file')}
						</span>
						<span class="text-[11px] text-[var(--nx-text-muted)]">{tFn('pedit.avatar_formats')}</span>
						<input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
							class="sr-only" disabled={avatarUploading} onchange={handleAvatarFile} />
					</label>
					{#if avatarError}<p class="text-xs text-[var(--nx-bad)] mt-1">{avatarError}</p>{/if}
				{/if}
			</div>

			<!-- Bannière -->
			<div>
				<div class="flex items-center justify-between mb-2">
					<p class="text-xs text-[var(--nx-text-muted)] font-medium">{tFn('pedit.banner')}</p>
					{#if bannerPreview}
						<button type="button" onclick={deleteBanner}
							class="text-[11px] text-[var(--nx-bad)] hover:text-[var(--nx-bad)] transition-colors flex items-center gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true">
								<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
							</svg>
							{tFn('common.delete')}
						</button>
					{/if}
				</div>
				{#if bannerPreview}
					<img src={bannerPreview} alt={tFn('pedit.banner_preview_alt')} class="w-full h-16 object-cover rounded-lg mb-2 border border-[var(--nx-border)]" />
				{:else}
					<div class="w-full h-16 rounded-lg bg-[var(--nx-surface-raised)]/50 border border-[var(--nx-border)] flex items-center justify-center text-[var(--nx-text-muted)] text-xs mb-2">
						{tFn('pedit.generative_banner')}
					</div>
				{/if}
				<div class="flex gap-1 mb-2">
					<button type="button" onclick={() => { bannerMode = 'url' }}
						class="px-2.5 max-sm:py-2.5 py-1 rounded-md text-xs font-medium transition-colors {bannerMode === 'url' ? 'bg-indigo-600 text-white' : 'bg-[var(--nx-border)]/80 text-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}">
						URL
					</button>
					<button type="button" onclick={() => { bannerMode = 'file' }}
						class="px-2.5 max-sm:py-2.5 py-1 rounded-md text-xs font-medium transition-colors {bannerMode === 'file' ? 'bg-indigo-600 text-white' : 'bg-[var(--nx-border)]/80 text-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}">
						{tFn('pedit.file')}
					</button>
				</div>
				{#if bannerMode === 'url'}
					<input type="url" maxlength="500" placeholder={tFn('pedit.url_ph')}
						bind:value={bannerUrl} oninput={() => { bannerPreview = bannerUrl }}
						class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2 text-[var(--nx-text)] text-sm
						       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 transition-colors" />
				{:else}
					<label class="relative flex items-center gap-2 cursor-pointer">
						<span class="px-3 py-1.5 rounded-lg bg-[var(--nx-border)] hover:bg-[var(--nx-border)] text-xs text-[var(--nx-text)] transition-colors">
							{bannerUploading ? tFn('pedit.uploading') : tFn('pedit.choose_file')}
						</span>
						<span class="text-[11px] text-[var(--nx-text-muted)]">{tFn('pedit.size_5mb')}</span>
						<input type="file" accept="image/jpeg,image/png,image/webp,image/gif"
							class="sr-only" disabled={bannerUploading} onchange={handleBannerFile} />
					</label>
					{#if bannerError}<p class="text-xs text-[var(--nx-bad)] mt-1">{bannerError}</p>{/if}
				{/if}
			</div>
		</div>
	</div>

	<!-- ─── ROW 1.5: Thème du profil ──────────────────────────────────────── -->
	<div class="bg-[var(--nx-surface)]/80 border border-[var(--nx-border)] rounded-xl p-5 space-y-5">
		<h2 class="text-xs uppercase tracking-widest text-[var(--nx-text-muted)] font-semibold flex items-center gap-2">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.098 19.902a3.75 3.75 0 0 0 5.304 0l6.401-6.402M6.75 21A3.75 3.75 0 0 1 3 17.25V4.125C3 3.504 3.504 3 4.125 3h5.25c.621 0 1.125.504 1.125 1.125v4.072M6.75 21a3.75 3.75 0 0 0 3.75-3.75V8.197M6.75 21h13.125c.621 0 1.125-.504 1.125-1.125v-5.25c0-.621-.504-1.125-1.125-1.125h-4.072M10.5 8.197l2.88-2.88c.438-.439 1.15-.439 1.59 0l3.712 3.713c.44.44.44 1.152 0 1.59l-2.879 2.88M6.75 17.25h.008v.008H6.75v-.008Z"/></svg>
			{tFn('pedit.section_theme')}
		</h2>

		<div class="grid lg:grid-cols-3 gap-6">
			<!-- Preset grid -->
			<div class="lg:col-span-2 space-y-3">
				<p class="text-xs text-[var(--nx-text-muted)] font-medium">{tFn('pedit.choose_preset')}</p>
				<div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
					{#each PROFILE_PRESETS as preset}
						<button type="button" onclick={() => applyPreset(preset)}
							class="flex flex-col gap-1.5 p-2 rounded-xl border transition-all
							       {selectedPresetId === preset.id
							         ? 'border-indigo-500 bg-[rgb(var(--nx-accent-rgb)/0.14)]'
							         : 'border-[var(--nx-border)] hover:border-[var(--nx-text-muted)] bg-[var(--nx-surface-raised)]/40'}"
						>
							<!-- Mini preview card -->
							{#if preset.id === 'default'}
							<div class="w-full rounded-lg overflow-hidden" aria-hidden="true"
							     style="background: linear-gradient(135deg, #f3f4f6 50%, #030712 50%); aspect-ratio:16/9;"></div>
							{:else}
							<div class="w-full rounded-lg overflow-hidden" style="background:{preset.vars.bg}; aspect-ratio:16/9;">
								<div class="h-2/3 w-full p-1 space-y-0.5"
								     style="background:{preset.vars.cardBg}; border-bottom:1px solid {preset.vars.cardBorder};">
									<div class="h-1 rounded-sm w-3/4" style="background:{preset.vars.accent}"></div>
									<div class="h-1 rounded-sm w-1/2" style="background:{preset.vars.textMuted}"></div>
								</div>
							</div>
							{/if}
							<p class="text-[10px] text-center truncate leading-tight"
							   style="color:{selectedPresetId === preset.id ? 'var(--nx-header-accent)' : 'var(--nx-text-muted)'}">
								{preset.id === 'default' ? tFn('pedit.preset_follow_site') : `${preset.emoji} ${tFn(preset.nameKey)}`}
							</p>
						</button>
					{/each}
				</div>
			</div>

			<!-- Color fine-tuning -->
			<div class="space-y-3">
				<p class="text-xs text-[var(--nx-text-muted)] font-medium">{tFn('pedit.customize')}</p>
				<div class="space-y-2">
					{#each colorPickers as picker}
						<div class="flex items-center gap-2.5">
							<input type="color"
								value={theme[picker.key] as string}
								oninput={(e) => {
									(theme as unknown as Record<string, unknown>)[picker.key] = (e.target as HTMLInputElement).value
									selectedPresetId = 'custom'
								}}
								class="w-8 h-8 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface-raised)] cursor-pointer p-0.5 shrink-0
								       focus:outline-none focus:border-indigo-500 transition-colors" />
							<span class="text-xs text-[var(--nx-text-muted)] flex-1">{tFn(picker.labelKey)}</span>
							<span class="text-[10px] text-[var(--nx-text-muted)] font-mono">{theme[picker.key]}</span>
						</div>
					{/each}
				</div>
				<p class="text-[11px] text-[var(--nx-text-muted)]">{tFn('pedit.theme_hint')}</p>
			</div>
		</div>

		<!-- Live preview strip -->
		<div>
			<p class="text-xs text-[var(--nx-text-muted)] font-medium mb-2">{tFn('common.preview')}</p>
			<div class="rounded-xl overflow-hidden h-20 flex items-center gap-4 px-5 transition-all duration-300"
			     style={previewStyle}>
				<div class="w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-sm font-bold"
				     style="background:var(--p-accent); color:var(--p-bg)">{initials}</div>
				<div>
					<p class="text-sm font-bold leading-tight" style="color:var(--p-text)">{profile.display_name || profile.username}</p>
					<p class="text-xs" style="color:var(--p-text-muted)">@{profile.username}</p>
				</div>
				<div class="ml-auto flex flex-col gap-1">
					<div class="h-1.5 w-20 rounded-full" style="background:var(--p-accent)"></div>
					<div class="h-1.5 w-14 rounded-full" style="background:var(--p-card-border)"></div>
					<div class="h-1.5 w-16 rounded-full" style="background:var(--p-text-muted); opacity:.5"></div>
				</div>
			</div>
		</div>

		<!-- Hidden serialised theme -->
		<input type="hidden" name="metadata_theme" value={themeJson} />
	</div>

	<!-- ─── ROW 1.7: Effets du pseudo ─────────────────────────────────────── -->
	<div class="bg-[var(--nx-surface)]/80 border border-[var(--nx-border)] rounded-xl p-5 space-y-6">
		<h2 class="text-xs uppercase tracking-widest text-[var(--nx-text-muted)] font-semibold flex items-center gap-2">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z"/></svg>
			{tFn('pedit.section_effects')}
		</h2>

		<!-- Live preview -->
		<div class="flex items-center gap-3 px-4 py-3 rounded-xl border border-[var(--nx-border)]/60" style={previewStyle}>
			<span class="text-xs shrink-0" style="color: var(--p-text-muted)">{tFn('common.preview')}</span>
			<span class="text-sm font-bold {previewAnimClass}" style={previewNameStyle}>
				{profile.display_name || profile.username || tFn('pedit.name_sample')}
			</span>
		</div>

		<div class="grid lg:grid-cols-3 gap-6">

			<!-- Police -->
			<div class="space-y-3">
				<p class="text-xs text-[var(--nx-text-muted)] font-medium">{tFn('pedit.font')}</p>
				<div class="grid grid-cols-3 gap-1.5">
					{#each FONT_PRESETS as preset}
						<button
							type="button"
							onclick={() => { nameFontFamily = preset.family; nameFontUrl = null }}
							class="px-2 py-1.5 rounded-lg text-xs border transition-all text-center
							       {nameFontFamily === preset.family
									 ? 'border-indigo-500 bg-[rgb(var(--nx-accent-rgb)/0.16)] text-[var(--nx-text)]'
									 : 'border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/40 text-[var(--nx-text-muted)] hover:border-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}"
							style={preset.family ? `font-family: '${preset.family}', sans-serif` : ''}
						>
							{preset.family ? preset.preview : tFn('pedit.default')}
						</button>
					{/each}
				</div>
				<!-- Custom font upload -->
				<div class="pt-1">
					<label class="relative flex items-center gap-2 cursor-pointer">
						<span class="px-3 py-1.5 rounded-lg bg-[var(--nx-border)] hover:bg-[var(--nx-border)] text-xs text-[var(--nx-text)] transition-colors shrink-0">
							{fontUploading ? tFn('pedit.uploading') : tFn('pedit.import_font')}
						</span>
						<span class="text-[10px] text-[var(--nx-text-muted)]">.ttf · .otf · .woff · .woff2</span>
						<input type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2"
							class="sr-only" disabled={fontUploading} onchange={uploadFont} />
					</label>
					{#if nameFontUrl}
						<p class="text-[10px] text-green-500 mt-1">{tFn('pedit.font_loaded')} {nameFontFamily}</p>
					{/if}
					{#if fontError}<p class="text-[10px] text-[var(--nx-bad)] mt-1">{fontError}</p>{/if}
				</div>
			</div>

			<!-- Halo lumineux -->
			<div class="space-y-3">
				<p class="text-xs text-[var(--nx-text-muted)] font-medium">{tFn('pedit.glow')}</p>
				<label class="flex items-center gap-2 cursor-pointer select-none">
					<input type="checkbox" bind:checked={nameGlowEnabled}
						class="w-4 h-4 rounded border-[var(--nx-border)] bg-[var(--nx-surface-raised)] accent-indigo-500 cursor-pointer" />
					<span class="text-xs text-[var(--nx-text)]">{tFn('pedit.enable_glow')}</span>
				</label>
				{#if nameGlowEnabled}
					<div class="space-y-2">
						<div class="flex items-center gap-3">
							<input type="color" bind:value={nameGlow}
								class="w-9 h-9 rounded-lg border border-[var(--nx-border)] bg-[var(--nx-surface-raised)] cursor-pointer p-0.5 focus:outline-none focus:border-indigo-500 shrink-0" />
							<div class="flex-1 space-y-1">
								<div class="flex justify-between text-[10px] text-[var(--nx-text-muted)]">
									<span>{tFn('pedit.intensity')}</span>
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
				<p class="text-xs text-[var(--nx-text-muted)] font-medium">{tFn('pedit.animation')}</p>
				<div class="grid grid-cols-2 gap-1.5">
					{#each ANIM_PRESETS as preset}
						<button
							type="button"
							onclick={() => { nameAnimation = preset.key }}
							class="px-2.5 py-1.5 rounded-lg text-xs border transition-all text-left
							       {nameAnimation === preset.key
									 ? 'border-indigo-500 bg-[rgb(var(--nx-accent-rgb)/0.16)] text-[var(--nx-text)]'
									 : 'border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/40 text-[var(--nx-text-muted)] hover:border-[var(--nx-text-muted)] hover:text-[var(--nx-text)]'}"
						>
							{tFn(preset.labelKey)}
							{#if preset.always}
								<span class="text-[9px] text-indigo-500 ml-1">∞</span>
							{/if}
						</button>
					{/each}
				</div>
				<p class="text-[10px] text-[var(--nx-text-muted)]">{tFn('pedit.anim_hint')}</p>
			</div>
		</div>
	</div>

	<!-- ─── ROW 2: Réseaux sociaux ─────────────────────────────────────────── -->
	<div class="bg-[var(--nx-surface)]/80 border border-[var(--nx-border)] rounded-xl p-5">
		<h2 class="text-xs uppercase tracking-widest text-[var(--nx-text-muted)] font-semibold mb-4 flex items-center gap-2">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244"/></svg>
			{tFn('pedit.section_social')}
		</h2>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			<div>
				<label for="github_username" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
					GitHub <span class="text-[var(--nx-text-muted)] font-normal">{tFn('pedit.eg_username')}</span>
				</label>
				<div class="flex items-center rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-[var(--nx-text-muted)] text-sm border-r border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/50 shrink-0">github.com/</span>
					<input id="github_username" name="github_username" type="text" maxlength="39"
						placeholder={tFn('pedit.username_ph')} pattern="[a-zA-Z0-9-]+"
						value={profile.github_username ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-[var(--nx-text)] placeholder-[var(--nx-text-muted)] focus:outline-none" />
				</div>
			</div>
			<div>
				<label for="twitter_username" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
					Twitter / X <span class="text-[var(--nx-text-muted)] font-normal">{tFn('pedit.eg_handle')}</span>
				</label>
				<div class="flex items-center rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-[var(--nx-text-muted)] text-sm border-r border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/50 shrink-0">@</span>
					<input id="twitter_username" name="twitter_username" type="text" maxlength="100"
						placeholder={tFn('pedit.handle_ph')}
						value={profile.twitter_username ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-[var(--nx-text)] placeholder-[var(--nx-text-muted)] focus:outline-none" />
				</div>
			</div>
			<div>
				<label for="instagram_username" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
					Instagram <span class="text-[var(--nx-text-muted)] font-normal">{tFn('pedit.eg_handle')}</span>
				</label>
				<div class="flex items-center rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-[var(--nx-text-muted)] text-sm border-r border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/50 shrink-0">@</span>
					<input id="instagram_username" name="instagram_username" type="text" maxlength="100"
						placeholder={tFn('pedit.handle_ph')}
						value={profile.instagram_username ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-[var(--nx-text)] placeholder-[var(--nx-text-muted)] focus:outline-none" />
				</div>
			</div>
			<div>
				<label for="youtube_channel" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
					YouTube <span class="text-[var(--nx-text-muted)] font-normal">{tFn('pedit.eg_youtube')}</span>
				</label>
				<div class="flex items-center rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] overflow-hidden focus-within:border-indigo-500 transition-colors">
					<span class="px-3 py-2.5 text-[var(--nx-text-muted)] text-sm border-r border-[var(--nx-border)] bg-[var(--nx-surface-raised)]/50 shrink-0">youtube.com/</span>
					<input id="youtube_channel" name="youtube_channel" type="text" maxlength="200"
						placeholder={tFn('pedit.youtube_ph')}
						value={profile.youtube_channel ?? ''}
						class="flex-1 bg-transparent px-3 py-2.5 text-sm text-[var(--nx-text)] placeholder-[var(--nx-text-muted)] focus:outline-none" />
				</div>
			</div>
			<div class="col-span-2">
				<label for="website_url" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
					{tFn('pedit.website')} <span class="text-[var(--nx-text-muted)] font-normal">{tFn('pedit.full_url')}</span>
				</label>
				<input id="website_url" name="website_url" type="url" maxlength="500"
					placeholder={tFn('pedit.website_ph')}
					value={profile.website_url ?? ''}
					class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2.5 text-sm text-[var(--nx-text)]
					       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
			</div>
		</div>
	</div>

	<!-- ─── ROW 3: Tags + Liens personnalisés ──────────────────────────────── -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">

		<!-- Tags -->
		<div class="bg-[var(--nx-surface)]/80 border border-[var(--nx-border)] rounded-xl p-5">
			<h2 class="text-xs uppercase tracking-widest text-[var(--nx-text-muted)] font-semibold mb-4 flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z"/><path stroke-linecap="round" stroke-linejoin="round" d="M6 6h.008v.008H6V6z"/></svg>
				Tags
			</h2>
			<label for="tags" class="block text-xs text-[var(--nx-text-muted)] mb-1.5 font-medium">
				{tFn('pedit.comma_separated')} <span class="text-[var(--nx-text-muted)]">(max 10)</span>
			</label>
			<input id="tags" name="tags" type="text"
				placeholder={tFn('pedit.tags_ph')}
				value={profile.tags?.join(', ') ?? ''}
				class="w-full rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-3 py-2.5 text-sm text-[var(--nx-text)]
				       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/30 transition-colors" />
			<p class="text-[11px] text-[var(--nx-text-muted)] mt-2">{tFn('pedit.interests_hint')}</p>
		</div>

		<!-- Liens personnalisés -->
		<div class="bg-[var(--nx-surface)]/80 border border-[var(--nx-border)] rounded-xl p-5">
			<h2 class="text-xs uppercase tracking-widest text-[var(--nx-text-muted)] font-semibold mb-4 flex items-center gap-2">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/></svg>
				{tFn('pedit.custom_links')}
			</h2>
			<div class="space-y-2 mb-3">
				{#each links as link, i}
					<div class="flex gap-2 items-center">
						<input name="link_label_{i}" type="text" maxlength="50"
							placeholder={tFn('pedit.label_ph')}
							bind:value={link.label}
							class="w-28 shrink-0 rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-2.5 py-2 text-[var(--nx-text)] text-xs
							       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 transition-colors" />
						<input name="link_url_{i}" type="url" maxlength="500"
							placeholder={tFn('pedit.url_ph')}
							bind:value={link.url}
							class="flex-1 rounded-lg bg-[var(--nx-surface-raised)]/70 border border-[var(--nx-border)] px-2.5 py-2 text-[var(--nx-text)] text-xs
							       placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500 transition-colors" />
						<button type="button" onclick={() => removeLink(i)}
							class="w-7 h-7 flex items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--nx-bad)_12%,transparent)] hover:bg-[color-mix(in_srgb,var(--nx-bad)_18%,transparent)] text-[var(--nx-bad)] hover:text-[var(--nx-bad)] transition-colors shrink-0"
							aria-label={tFn('common.delete')}>
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
						</button>
					</div>
				{/each}
				{#if links.length === 0}
					<p class="text-xs text-[var(--nx-text-muted)] py-2">{tFn('pedit.no_links')}</p>
				{/if}
			</div>
			<button type="button" onclick={addLink}
				class="flex items-center gap-1.5 text-xs text-[var(--nx-header-accent)] hover:text-[var(--nx-header-accent)] transition-colors font-medium">
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15"/></svg>
				{tFn('pedit.add_link')}
			</button>
		</div>
	</div>

	<!-- ─── SUBMIT BAR ──────────────────────────────────────────────────────── -->
	<div class="flex items-center justify-between pt-2 pb-4 border-t border-[var(--nx-border)]">
		<a href="/users/{profile.username}"
		   class="text-sm text-[var(--nx-text-muted)] hover:text-[var(--nx-text)] transition-colors">
			← {tFn('common.cancel')}
		</a>
		<button type="submit" disabled={submitting}
			class="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500
			       disabled:opacity-50 disabled:cursor-not-allowed text-sm font-semibold text-white
			       transition-colors shadow-lg shadow-indigo-900/30">
			{#if submitting}
				<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
				{tFn('pedit.saving')}
			{:else}
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
				{tFn('pedit.save')}
			{/if}
		</button>
	</div>
</form>
