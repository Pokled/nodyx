<script lang="ts">
	import type { PageData } from './$types'
	import { goto } from '$app/navigation'
	import { page } from '$app/stores'
	import { PUBLIC_API_URL } from '$env/static/public'

	let { data }: { data: PageData } = $props()

	// Token from layout data (HttpOnly cookie — not readable via document.cookie)
	const token = $derived(($page.data as any).token as string | null)

	const ASSET_TYPES = [
		{ value: '', label: 'Tous' },
		{ value: 'frame',   label: 'Cadres' },
		{ value: 'banner',  label: 'Bannières' },
		{ value: 'badge',   label: 'Badges' },
		{ value: 'sticker', label: 'Stickers' },
		{ value: 'font',    label: 'Polices' },
		{ value: 'theme',   label: 'Thèmes' },
		{ value: 'emoji',   label: 'Emojis' },
		{ value: 'sound',   label: 'Sons' },
	]

	const TYPE_ICONS: Record<string, string> = {
		frame: '🖼️', banner: '🎨', badge: '🏅', sticker: '⭐',
		font: '🔤', theme: '🎭', emoji: '😀', sound: '🔊',
	}

	let searchInput = $state(data.q)
	let uploading   = $state(false)
	let uploadError = $state('')
	let showUpload  = $state(false)

	// Upload form state
	let uploadName        = $state('')
	let uploadDescription = $state('')
	let uploadType        = $state('sticker')
	let uploadTags        = $state('')
	let uploadFile        = $state<File | null>(null)
	let uploadPreview     = $state<string | null>(null)

	const isCommunityTab = $derived(data.tab === 'community')

	// For local assets — thumbnail from /uploads/
	function localAssetUrl(asset: { file_path: string; thumbnail_path?: string }) {
		const base = PUBLIC_API_URL.replace('/api/v1', '')
		return `${base}/uploads/${asset.thumbnail_path ?? asset.file_path}`
	}

	// For federated assets — thumbnail_url is an absolute remote URL
	function remoteAssetThumb(asset: { thumbnail_url?: string; file_url: string }) {
		return asset.thumbnail_url ?? asset.file_url
	}

	function switchTab(tab: 'local' | 'community') {
		const u = new URL($page.url)
		u.searchParams.set('tab', tab)
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	function applyFilter(type: string) {
		const u = new URL($page.url)
		if (type) u.searchParams.set('type', type)
		else u.searchParams.delete('type')
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	function submitSearch(e: Event) {
		e.preventDefault()
		const u = new URL($page.url)
		if (searchInput.trim()) u.searchParams.set('q', searchInput.trim())
		else u.searchParams.delete('q')
		u.searchParams.delete('offset')
		goto(u.toString())
	}

	function onFileChange(e: Event) {
		const input = e.currentTarget as HTMLInputElement
		const file  = input.files?.[0] ?? null
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
		uploading   = true
		uploadError = ''

		const form = new FormData()
		form.append('name',        uploadName)
		form.append('description', uploadDescription)
		form.append('asset_type',  uploadType)
		form.append('tags',        uploadTags)
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
			goto($page.url.pathname, { invalidateAll: true })
		} else {
			const json  = await res.json()
			uploadError = json.error ?? 'Erreur lors de l\'upload.'
		}
	}
</script>

<svelte:head>
	<title>Bibliothèque — Nexus</title>
</svelte:head>

<div class="max-w-6xl mx-auto px-4 py-8">

	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl font-bold text-white">Bibliothèque</h1>
			<p class="text-sm text-gray-400 mt-0.5">Assets créés par la communauté — cadres, badges, stickers et plus</p>
		</div>
		{#if !isCommunityTab && token}
			<button
				onclick={() => showUpload = !showUpload}
				class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm font-semibold text-white transition-colors"
			>
				+ Partager un asset
			</button>
		{/if}
	</div>

	<!-- Tab switcher -->
	<div class="flex gap-1 mb-6 p-1 bg-gray-900 rounded-xl border border-gray-800 w-fit">
		<button
			onclick={() => switchTab('local')}
			class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {!isCommunityTab ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}"
		>
			🏠 Ma communauté
		</button>
		<button
			onclick={() => switchTab('community')}
			class="px-4 py-2 rounded-lg text-sm font-medium transition-colors {isCommunityTab ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'}"
		>
			🌐 Toutes les instances
		</button>
	</div>

	<!-- Upload panel (local only) -->
	{#if showUpload && !isCommunityTab}
		<div class="mb-6 p-5 rounded-xl border border-gray-700 bg-gray-900">
			<h2 class="text-base font-semibold text-white mb-4">Partager un asset</h2>
			{#if uploadError}
				<p class="mb-3 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">{uploadError}</p>
			{/if}
			<form onsubmit={submitUpload} class="grid grid-cols-1 sm:grid-cols-2 gap-4">
				<div class="sm:col-span-2 flex gap-4 items-start">
					<label class="flex-1">
						<span class="block text-xs font-medium text-gray-400 mb-1">Fichier *</span>
						<input type="file" onchange={onFileChange} accept="image/*,audio/*" required
							class="block w-full text-sm text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:bg-gray-700 file:text-gray-200 hover:file:bg-gray-600" />
					</label>
					{#if uploadPreview}
						<img src={uploadPreview} alt="preview" class="w-20 h-20 rounded-lg object-cover border border-gray-700 shrink-0" />
					{/if}
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Nom *</label>
					<input bind:value={uploadName} required maxlength="100" placeholder="Ex: Cadre doré"
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
				</div>
				<div>
					<label class="block text-xs font-medium text-gray-400 mb-1">Type *</label>
					<select bind:value={uploadType}
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white focus:outline-none focus:border-indigo-500">
						{#each ASSET_TYPES.slice(1) as t}
							<option value={t.value}>{t.label}</option>
						{/each}
					</select>
				</div>
				<div class="sm:col-span-2">
					<label class="block text-xs font-medium text-gray-400 mb-1">Description</label>
					<textarea bind:value={uploadDescription} rows="2" placeholder="Décris ton asset..."
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 resize-none"></textarea>
				</div>
				<div class="sm:col-span-2">
					<label class="block text-xs font-medium text-gray-400 mb-1">Tags (séparés par des virgules)</label>
					<input bind:value={uploadTags} placeholder="pixel-art, doré, frame"
						class="w-full px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500" />
				</div>
				<div class="sm:col-span-2 flex gap-3">
					<button type="submit" disabled={uploading}
						class="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-sm font-semibold text-white transition-colors">
						{uploading ? 'Upload en cours…' : 'Partager'}
					</button>
					<button type="button" onclick={() => showUpload = false}
						class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-300 transition-colors">
						Annuler
					</button>
				</div>
			</form>
		</div>
	{/if}

	<!-- Filters + Search -->
	<div class="flex flex-col sm:flex-row gap-3 mb-6">
		<form onsubmit={submitSearch} class="flex gap-2 flex-1">
			<input
				bind:value={searchInput}
				placeholder={isCommunityTab ? 'Rechercher dans toutes les instances…' : 'Rechercher un asset…'}
				class="flex-1 px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
			/>
			<button type="submit" class="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors">
				Rechercher
			</button>
		</form>
		<div class="flex gap-1.5 flex-wrap">
			{#each ASSET_TYPES as t}
				<button
					onclick={() => applyFilter(t.value)}
					class="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors {data.type === t.value ? 'bg-indigo-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white hover:bg-gray-700'}"
				>
					{t.value ? TYPE_ICONS[t.value] + ' ' : ''}{t.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Assets grid -->
	{#if data.assets.length === 0}
		<div class="text-center py-16 text-gray-500">
			<p class="text-4xl mb-3">{isCommunityTab ? '🌐' : '📭'}</p>
			<p class="font-medium">{isCommunityTab ? 'Aucun asset fédéré pour le moment' : 'Aucun asset trouvé'}</p>
			<p class="text-sm mt-1">
				{#if isCommunityTab}
					Les assets apparaissent ici quand d'autres instances les partagent.
				{:else}
					Sois le premier à partager quelque chose !
				{/if}
			</p>
		</div>
	{:else}
		{#if isCommunityTab}
			<!-- Federated grid — links open directly on the remote instance -->
			<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
				{#each data.assets as asset}
					<a
						href={asset.file_url}
						target="_blank"
						rel="noopener noreferrer"
						class="group rounded-xl border border-gray-800 bg-gray-900 hover:border-gray-600 transition-all overflow-hidden"
					>
						{#if asset.thumbnail_url || asset.file_url}
							<div class="aspect-square overflow-hidden bg-gray-800">
								<img src={remoteAssetThumb(asset)} alt={asset.name}
									class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
									onerror={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
							</div>
						{:else}
							<div class="aspect-square flex items-center justify-center bg-gray-800 text-3xl">
								{TYPE_ICONS[asset.asset_type] ?? '📦'}
							</div>
						{/if}
						<div class="p-2">
							<p class="text-xs font-medium text-white truncate">{asset.name}</p>
							<p class="text-[10px] text-gray-500 mt-0.5 truncate">
								{TYPE_ICONS[asset.asset_type] ?? ''} {asset.asset_type}
								&nbsp;·&nbsp;
								<span class="text-indigo-400">{asset.instance_slug}</span>
							</p>
						</div>
					</a>
				{/each}
			</div>
		{:else}
			<!-- Local grid -->
			<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
				{#each data.assets as asset}
					<a href="/library/{asset.id}" class="group rounded-xl border border-gray-800 bg-gray-900 hover:border-gray-600 transition-all overflow-hidden">
						{#if asset.thumbnail_path || asset.mime_type?.startsWith('image/')}
							<div class="aspect-square overflow-hidden bg-gray-800">
								<img src={localAssetUrl(asset)} alt={asset.name}
									class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
							</div>
						{:else}
							<div class="aspect-square flex items-center justify-center bg-gray-800 text-3xl">
								{TYPE_ICONS[asset.asset_type] ?? '📦'}
							</div>
						{/if}
						<div class="p-2">
							<p class="text-xs font-medium text-white truncate">{asset.name}</p>
							<p class="text-[10px] text-gray-500 mt-0.5">{TYPE_ICONS[asset.asset_type] ?? ''} {asset.asset_type} · {asset.downloads} dl</p>
						</div>
					</a>
				{/each}
			</div>
		{/if}

		<!-- Pagination -->
		{#if data.assets.length === 24}
			<div class="flex justify-center mt-8">
				<a
					href="?{new URLSearchParams({ tab: data.tab, q: data.q, type: data.type, offset: String(data.offset + 24) })}"
					class="px-5 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm text-gray-200 transition-colors"
				>
					Page suivante →
				</a>
			</div>
		{/if}
	{/if}
</div>
