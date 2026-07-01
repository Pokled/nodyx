<script lang="ts">
	import type { PageData } from './$types'
	import { goto } from '$app/navigation'
	import { page } from '$app/state'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { t } from '$lib/i18n'

	let { data }: { data: PageData } = $props()

	const tFn = $derived($t)

	const token = $derived((page.data as any).token as string | null)

	const MAX_FILE_SIZE = 12 * 1024 * 1024 // 12 MB

	const ASSET_TYPES = [
		{ value: '', label: 'Tous', tip: null },
		{ value: 'frame',   label: 'Cadres',     tip: 'PNG carré avec fond transparent. Cercle transparent au centre touchant les bords (l\'avatar remplira ce cercle). Anneau décoratif à l\'extérieur. 500×500 px min.' },
		{ value: 'banner',  label: 'Bannières',  tip: 'PNG ou JPG, format paysage. Affiché en haut du profil. 1500×500 px recommandé.' },
		{ value: 'badge',   label: 'Badges',     tip: 'PNG carré avec fond transparent. S\'affiche à côté du pseudo. 256×256 px recommandé.' },
		{ value: 'sticker', label: 'Stickers',   tip: 'PNG ou GIF animé avec fond transparent. Utilisé dans le chat. 512×512 px recommandé.' },
		{ value: 'font',    label: 'Polices',    tip: 'Fichier de police (TTF, OTF, WOFF2). Sera proposée pour personnaliser l\'interface.' },
		{ value: 'theme',   label: 'Thèmes',     tip: 'Fichier JSON de thème couleurs. Format défini par la communauté.' },
		{ value: 'emoji',   label: 'Emojis',     tip: 'PNG ou GIF carré avec fond transparent. 128×128 px recommandé.' },
		{ value: 'sound',   label: 'Sons',       tip: 'MP3 ou OGG. Court extrait audio (notification, ambiance, etc.). 30s max recommandé.' },
	]

	const currentTypeTip = $derived(ASSET_TYPES.find(t => t.value === uploadType)?.tip ?? null)

	const TYPE_ICONS: Record<string, string> = {
		frame: '🖼️', banner: '🎨', badge: '🏅', sticker: '⭐',
		font: '🔤', theme: '🎭', emoji: '😀', sound: '🔊',
	}

	let searchInput = $state('')
	$effect(() => { searchInput = data.q ?? ''; })
	let uploading   = $state(false)
	let uploadError = $state('')
	let showUpload  = $state(false)

	let uploadName        = $state('')
	let uploadDescription = $state('')
	let uploadType        = $state('sticker')
	let uploadTags        = $state('')
	let uploadShortcode   = $state('')   // emoji : raccourci texte perso (:code:)
	let uploadFile        = $state<File | null>(null)
	let uploadPreview     = $state<string | null>(null)

	const isCommunityTab = $derived(data.tab === 'community')

	function localAssetUrl(asset: { file_path: string; thumbnail_path?: string }) {
		const base = PUBLIC_API_URL.replace('/api/v1', '')
		return `${base}/uploads/${asset.thumbnail_path ?? asset.file_path}`
	}

	function remoteAssetThumb(asset: { thumbnail_url?: string; file_url: string }) {
		return asset.thumbnail_url ?? asset.file_url
	}

	function switchTab(tab: 'local' | 'community') {
		const u = new URL(page.url)
		u.searchParams.set('tab', tab)
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	function applyFilter(type: string) {
		const u = new URL(page.url)
		if (type) u.searchParams.set('type', type)
		else u.searchParams.delete('type')
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	function submitSearch(e: Event) {
		e.preventDefault()
		const u = new URL(page.url)
		if (searchInput.trim()) u.searchParams.set('q', searchInput.trim())
		else u.searchParams.delete('q')
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const file  = input.files?.[0] ?? null
		uploadError = ''
		if (file && file.size > MAX_FILE_SIZE) {
			uploadError = `Fichier trop lourd : ${(file.size / 1024 / 1024).toFixed(1)} Mo (max 12 Mo).`
			uploadFile  = null
			uploadPreview = null
			input.value = ''
			return
		}
		uploadFile  = file
		if (file && file.type.startsWith('image/')) {
			const reader = new FileReader()
			reader.onload = ev => { uploadPreview = ev.target?.result as string }
			reader.readAsDataURL(file)
		} else {
			uploadPreview = null
		}
	}

	async function submitUpload(e: Event) {
		e.preventDefault()
		if (!uploadFile) { uploadError = 'Sélectionne un fichier.'; return }
		if (uploadFile.size > MAX_FILE_SIZE) { uploadError = 'Fichier trop lourd (max 12 Mo).'; return }
		uploading   = true
		uploadError = ''

		const form = new FormData()
		form.append('name',        uploadName)
		form.append('description', uploadDescription)
		form.append('asset_type',  uploadType)
		form.append('tags',        uploadTags)
		if (uploadType === 'emoji') form.append('shortcode', uploadShortcode)
		form.append('file',        uploadFile) // must be last — @fastify/multipart only sees fields before the file

		const res = await fetch(`${PUBLIC_API_URL}/api/v1/assets`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${token ?? ''}` },
			body:    form,
		})
		uploading = false
		if (res.ok) {
			showUpload    = false
			uploadFile    = null
			uploadPreview = null
			uploadName    = ''
			uploadDescription = ''
			uploadTags    = ''
			goto(page.url.pathname, { invalidateAll: true })
		} else {
			const json  = await res.json()
			uploadError = json.error ?? 'Erreur lors de l\'upload.'
		}
	}
</script>

<svelte:head>
	<title>Bibliothèque — Nodyx</title>
</svelte:head>

<!-- ── Header ──────────────────────────────────────────────────────────────── -->
<div class="lib-header">
	<div class="lib-header-row">
		<div class="lib-title-block">
			<h1 class="lib-title">Bibliothèque</h1>
			<p class="lib-subtitle">Assets créés par la communauté — cadres, badges, stickers et plus</p>
		</div>

		<div class="lib-header-actions">
			<form onsubmit={submitSearch} class="lib-search-form">
				<input
					bind:value={searchInput}
					placeholder={isCommunityTab ? 'Rechercher dans toutes les instances…' : 'Rechercher un asset…'}
					class="lib-search-input"
				/>
				<button type="submit" class="lib-search-btn" aria-label="Rechercher">
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
					</svg>
				</button>
			</form>
			{#if !isCommunityTab && token}
				<button onclick={() => showUpload = !showUpload} class="lib-upload-btn">
					+ Partager
				</button>
			{/if}
		</div>
	</div>

	<!-- Tabs -->
	<div class="lib-tabs">
		<button
			onclick={() => switchTab('local')}
			class="lib-tab {!isCommunityTab ? 'lib-tab--active' : ''}"
		>
			Ma communauté
		</button>
		<button
			onclick={() => switchTab('community')}
			class="lib-tab {isCommunityTab ? 'lib-tab--active' : ''}"
		>
			Toutes les instances
		</button>
	</div>
</div>

<!-- ── Upload panel ─────────────────────────────────────────────────────────── -->
{#if showUpload && !isCommunityTab}
	<div class="lib-upload-panel">
		<h2 class="lib-upload-title">Partager un asset</h2>
		{#if uploadError}
			<p class="lib-upload-error">{uploadError}</p>
		{/if}
		<form onsubmit={submitUpload} class="lib-upload-form">
			<div class="lib-upload-file-row">
				<label class="lib-field lib-field--grow">
					<span class="lib-label">Fichier *</span>
					<input type="file" onchange={onFileChange} accept="image/*,audio/*" required
						class="lib-file-input" />
				</label>
				{#if uploadPreview}
					<img src={uploadPreview} alt="preview" class="lib-preview-thumb" />
				{/if}
			</div>
			<div class="lib-upload-row2">
				<div class="lib-field">
					<label for="lib-name" class="lib-label">Nom *</label>
					<input id="lib-name" bind:value={uploadName} required maxlength="100" placeholder="Ex: Cadre doré"
						class="lib-input" />
				</div>
				<div class="lib-field">
					<label for="lib-type" class="lib-label">Type *</label>
					<select id="lib-type" bind:value={uploadType} class="lib-select">
						{#each ASSET_TYPES.slice(1) as t}
							<option value={t.value}>{t.label}</option>
						{/each}
					</select>
				</div>
			</div>
			<div class="lib-field lib-field--full">
				<label for="lib-desc" class="lib-label">Description</label>
				<textarea id="lib-desc" bind:value={uploadDescription} rows="2" placeholder="Décris ton asset…"
					class="lib-textarea"></textarea>
			</div>
			<div class="lib-field lib-field--full">
				<label for="lib-tags" class="lib-label">Tags (séparés par des virgules)</label>
				<input id="lib-tags" bind:value={uploadTags} placeholder="pixel-art, doré, frame"
					class="lib-input" />
			</div>
			{#if uploadType === 'emoji'}
					<div class="lib-field lib-field--full">
						<label for="lib-shortcode" class="lib-label">{tFn('library.emoji_shortcode')}</label>
						<input id="lib-shortcode" bind:value={uploadShortcode} maxlength="50"
							placeholder={tFn('library.emoji_shortcode_ph')} class="lib-input" />
					</div>
				{/if}
				{#if uploadType === 'emoji'}
					<div class="lib-tip lib-field--full">
						<span class="lib-tip-icon">😀</span>
						<div class="lib-tip-body">{tFn('library.emoji_help')}</div>
					</div>
				{/if}
				{#if currentTypeTip && uploadType !== 'emoji'}
				<div class="lib-tip lib-field--full">
					<span class="lib-tip-icon">💡</span>
					<div class="lib-tip-body">
						<span class="lib-tip-title">Conseils · </span>{currentTypeTip}
						<span class="lib-tip-size">Taille max : <strong>12 Mo</strong></span>
					</div>
				</div>
			{/if}
			<div class="lib-upload-actions lib-field--full">
				<button type="submit" disabled={uploading} class="lib-submit-btn">
					{uploading ? 'Upload en cours…' : 'Partager'}
				</button>
				<button type="button" onclick={() => showUpload = false} class="lib-cancel-btn">
					Annuler
				</button>
			</div>
		</form>
	</div>
{/if}

<!-- ── Type filter strip ─────────────────────────────────────────────────────── -->
<div class="lib-filters">
	{#each ASSET_TYPES as t}
		<button
			onclick={() => applyFilter(t.value)}
			class="lib-filter-btn {data.type === t.value ? 'lib-filter-btn--active' : ''}"
		>
			{t.value ? TYPE_ICONS[t.value] + ' ' : ''}{t.label}
		</button>
	{/each}
</div>

<!-- ── Assets grid ───────────────────────────────────────────────────────────── -->
<div class="lib-body">
	{#if data.assets.length === 0}
		<div class="lib-empty">
			<p class="lib-empty-icon">{isCommunityTab ? '🌐' : '📭'}</p>
			<p class="lib-empty-main">{isCommunityTab ? 'Aucun asset fédéré pour le moment' : 'Aucun asset trouvé'}</p>
			<p class="lib-empty-sub">
				{#if isCommunityTab}
					Les assets apparaissent ici quand d'autres instances les partagent.
				{:else}
					Sois le premier à partager quelque chose !
				{/if}
			</p>
		</div>
	{:else}
		{#if isCommunityTab}
			<div class="lib-grid">
				{#each data.assets as asset}
					<a href={asset.file_url} target="_blank" rel="noopener noreferrer" class="lib-card">
						{#if asset.thumbnail_url || asset.file_url}
							<div class="lib-card-thumb">
								<img src={remoteAssetThumb(asset)} alt={asset.name} class="lib-card-img"
									onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
							</div>
						{:else}
							<div class="lib-card-thumb lib-card-thumb--icon">
								{TYPE_ICONS[asset.asset_type] ?? '📦'}
							</div>
						{/if}
						<div class="lib-card-info">
							<p class="lib-card-name">{asset.name}</p>
							<p class="lib-card-meta">
								{TYPE_ICONS[asset.asset_type] ?? ''} {asset.asset_type}
								&nbsp;·&nbsp;
								<span class="lib-card-instance">{asset.instance_slug}</span>
							</p>
						</div>
					</a>
				{/each}
			</div>
		{:else}
			<div class="lib-grid">
				{#each data.assets as asset}
					<a href="/library/{asset.id}" class="lib-card">
						{#if asset.thumbnail_path || asset.mime_type?.startsWith('image/')}
							<div class="lib-card-thumb">
								<img src={localAssetUrl(asset)} alt={asset.name} class="lib-card-img" />
							</div>
						{:else}
							<div class="lib-card-thumb lib-card-thumb--icon">
								{TYPE_ICONS[asset.asset_type] ?? '📦'}
							</div>
						{/if}
						<div class="lib-card-info">
							<p class="lib-card-name">{asset.name}</p>
							<p class="lib-card-meta">{TYPE_ICONS[asset.asset_type] ?? ''} {asset.asset_type} · {asset.downloads} dl</p>
						</div>
					</a>
				{/each}
			</div>
		{/if}

		{#if data.assets.length === 24}
			<div class="lib-pagination">
				<a
					href="?{new URLSearchParams({ tab: data.tab, q: data.q, type: data.type, offset: String(data.offset + 24) })}"
					class="lib-next-btn"
				>
					Page suivante →
				</a>
			</div>
		{/if}
	{/if}
</div>

<style>
/* ── Header ─────────────────────────────────────────────────────────────────── */
.lib-header {
	position: sticky;
	top: 0;
	z-index: 20;
	background: rgba(9, 9, 15, 0.92);
	backdrop-filter: blur(16px);
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	padding: 20px 28px 0;
}

.lib-header-row {
	display: flex;
	align-items: center;
	gap: 16px;
	margin-bottom: 16px;
	flex-wrap: wrap;
}

.lib-title-block {
	flex: 0 0 auto;
}

.lib-title {
	font-size: 1.125rem;
	font-weight: 700;
	color: #fff;
	margin: 0 0 2px;
	letter-spacing: -0.01em;
}

.lib-subtitle {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.35);
	margin: 0;
}

.lib-header-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-left: auto;
}

/* ── Search ─────────────────────────────────────────────────────────────────── */
.lib-search-form {
	display: flex;
}

.lib-search-input {
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-right: none;
	padding: 7px 14px;
	color: #fff;
	font-size: 0.8125rem;
	outline: none;
	width: 240px;
	transition: border-color 0.15s;
}

.lib-search-input::placeholder {
	color: rgba(255, 255, 255, 0.25);
}

.lib-search-input:focus {
	border-color: rgb(var(--nx-accent-rgb) / 0.5);
}

.lib-search-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 7px 12px;
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.08);
	color: rgba(255, 255, 255, 0.5);
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
}

.lib-search-btn:hover {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}

.lib-upload-btn {
	padding: 7px 14px;
	background: rgb(var(--nx-accent-rgb) / 0.85);
	border: none;
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s;
	white-space: nowrap;
}

.lib-upload-btn:hover {
	background: rgb(99, 102, 241);
}

/* ── Tabs ───────────────────────────────────────────────────────────────────── */
.lib-tabs {
	display: flex;
	align-items: center;
}

.lib-tab {
	padding: 9px 18px;
	font-size: 0.75rem;
	font-weight: 500;
	color: rgba(255, 255, 255, 0.35);
	background: none;
	border: none;
	border-bottom: 2px solid transparent;
	cursor: pointer;
	transition: color 0.15s, border-color 0.15s;
	white-space: nowrap;
}

.lib-tab:hover {
	color: rgba(255, 255, 255, 0.7);
}

.lib-tab--active {
	color: #a5b4fc;
	border-bottom-color: #a5b4fc;
}

/* ── Filter strip ───────────────────────────────────────────────────────────── */
.lib-filters {
	display: flex;
	align-items: center;
	gap: 4px;
	flex-wrap: wrap;
	padding: 12px 28px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}

.lib-filter-btn {
	padding: 5px 12px;
	font-size: 0.75rem;
	font-weight: 500;
	background: rgba(255, 255, 255, 0.03);
	border: 1px solid rgba(255, 255, 255, 0.07);
	color: rgba(255, 255, 255, 0.35);
	cursor: pointer;
	transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.lib-filter-btn:hover {
	background: rgba(255, 255, 255, 0.07);
	color: rgba(255, 255, 255, 0.75);
}

.lib-filter-btn--active {
	background: rgb(var(--nx-accent-rgb) / 0.15);
	border-color: rgb(var(--nx-accent-rgb) / 0.35);
	color: #a5b4fc;
}

/* ── Upload panel ───────────────────────────────────────────────────────────── */
.lib-upload-panel {
	margin: 0;
	padding: 24px 28px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	background: rgba(255, 255, 255, 0.015);
}

.lib-upload-title {
	font-size: 0.9375rem;
	font-weight: 600;
	color: #fff;
	margin: 0 0 16px;
}

.lib-upload-error {
	font-size: 0.8125rem;
	color: #fca5a5;
	background: rgba(239, 68, 68, 0.08);
	border: 1px solid rgba(239, 68, 68, 0.2);
	padding: 8px 12px;
	margin-bottom: 14px;
}

.lib-upload-form {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 14px;
}

.lib-upload-file-row {
	grid-column: 1 / -1;
	display: flex;
	gap: 16px;
	align-items: flex-start;
}

.lib-upload-row2 {
	grid-column: 1 / -1;
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 14px;
}

.lib-field {
	display: flex;
	flex-direction: column;
	gap: 6px;
}

.lib-field--grow {
	flex: 1;
}

.lib-field--full {
	grid-column: 1 / -1;
}

.lib-label {
	font-size: 0.6875rem;
	font-weight: 600;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: rgba(255, 255, 255, 0.35);
}

.lib-input,
.lib-select,
.lib-textarea {
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.08);
	padding: 8px 12px;
	color: #fff;
	font-size: 0.8125rem;
	outline: none;
	transition: border-color 0.15s;
	width: 100%;
	box-sizing: border-box;
}

.lib-textarea {
	resize: none;
}

.lib-input::placeholder,
.lib-textarea::placeholder {
	color: rgba(255, 255, 255, 0.2);
}

.lib-input:focus,
.lib-select:focus,
.lib-textarea:focus {
	border-color: rgb(var(--nx-accent-rgb) / 0.5);
}

.lib-select {
	appearance: none;
}

.lib-file-input {
	font-size: 0.8125rem;
	color: rgba(255, 255, 255, 0.6);
}

.lib-preview-thumb {
	width: 72px;
	height: 72px;
	object-fit: cover;
	border: 1px solid rgba(255, 255, 255, 0.08);
	flex-shrink: 0;
}

.lib-tip {
	display: flex;
	gap: 10px;
	padding: 10px 14px;
	background: rgb(var(--nx-accent-rgb) / 0.06);
	border: 1px solid rgb(var(--nx-accent-rgb) / 0.15);
	font-size: 0.75rem;
	color: #a5b4fc;
}

.lib-tip-icon {
	font-size: 1rem;
	flex-shrink: 0;
	margin-top: 1px;
}

.lib-tip-body {
	line-height: 1.5;
}

.lib-tip-title {
	font-weight: 600;
	color: #c7d2fe;
}

.lib-tip-size {
	display: block;
	margin-top: 4px;
	color: rgba(165, 180, 252, 0.6);
}

.lib-upload-actions {
	display: flex;
	gap: 10px;
}

.lib-submit-btn {
	padding: 8px 18px;
	background: rgb(var(--nx-accent-rgb) / 0.85);
	border: none;
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s;
}

.lib-submit-btn:hover:not(:disabled) {
	background: rgb(99, 102, 241);
}

.lib-submit-btn:disabled {
	opacity: 0.5;
}

.lib-cancel-btn {
	padding: 8px 18px;
	background: rgba(255, 255, 255, 0.05);
	border: 1px solid rgba(255, 255, 255, 0.08);
	color: rgba(255, 255, 255, 0.5);
	font-size: 0.8125rem;
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
}

.lib-cancel-btn:hover {
	background: rgba(255, 255, 255, 0.09);
	color: rgba(255, 255, 255, 0.8);
}

/* ── Body ───────────────────────────────────────────────────────────────────── */
.lib-body {
	padding: 24px 28px 48px;
}

/* ── Grid ───────────────────────────────────────────────────────────────────── */
.lib-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
	gap: 1px;
	background: rgba(255, 255, 255, 0.04);
}

.lib-card {
	display: block;
	background: rgba(9, 9, 15, 1);
	text-decoration: none;
	transition: background 0.15s;
	overflow: hidden;
}

.lib-card:hover {
	background: rgba(255, 255, 255, 0.03);
}

.lib-card:hover .lib-card-img {
	transform: scale(1.04);
}

.lib-card-thumb {
	aspect-ratio: 1;
	overflow: hidden;
	background: rgba(255, 255, 255, 0.03);
}

.lib-card-thumb--icon {
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 2rem;
}

.lib-card-img {
	width: 100%;
	height: 100%;
	object-fit: cover;
	transition: transform 0.2s;
}

.lib-card-info {
	padding: 8px 10px;
}

.lib-card-name {
	font-size: 0.75rem;
	font-weight: 500;
	color: rgba(255, 255, 255, 0.8);
	margin: 0 0 3px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}

.lib-card-meta {
	font-size: 0.6875rem;
	color: rgba(255, 255, 255, 0.25);
	margin: 0;
}

.lib-card-instance {
	color: #a5b4fc;
}

/* ── Pagination ─────────────────────────────────────────────────────────────── */
.lib-pagination {
	display: flex;
	justify-content: center;
	margin-top: 32px;
}

.lib-next-btn {
	padding: 9px 22px;
	border: 1px solid rgba(255, 255, 255, 0.1);
	background: rgba(255, 255, 255, 0.03);
	color: rgba(255, 255, 255, 0.6);
	font-size: 0.8125rem;
	text-decoration: none;
	transition: background 0.15s, color 0.15s;
}

.lib-next-btn:hover {
	background: rgba(255, 255, 255, 0.06);
	color: #fff;
}

/* ── Empty state ────────────────────────────────────────────────────────────── */
.lib-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 80px 20px;
	text-align: center;
}

.lib-empty-icon {
	font-size: 2.5rem;
	margin: 0 0 14px;
	opacity: 0.25;
}

.lib-empty-main {
	font-size: 0.875rem;
	font-weight: 500;
	color: rgba(255, 255, 255, 0.4);
	margin: 0 0 6px;
}

.lib-empty-sub {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.2);
	margin: 0;
}
</style>
