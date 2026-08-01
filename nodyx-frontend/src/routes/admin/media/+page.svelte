<script lang="ts">
	import { enhance } from '$app/forms'
	import { apiFetch } from '$lib/api'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	type AssetRow = {
		id:              string
		name:            string
		file_path:       string
		thumbnail_path?: string | null
		mime_type:       string
		file_size:       number
	}
	type PageData = {
		token:  string
		images: AssetRow[]
		videos: AssetRow[]
		audios: AssetRow[]
	}

	let { data }: { data: PageData } = $props()

	const baseUrl = PUBLIC_API_URL.replace('/api/v1', '')

	// ── Tabs ─────────────────────────────────────────────────────────────────
	type TabId = 'images' | 'videos' | 'audios'
	type TabMeta = {
		labelKey:     string
		assetType:    'image' | 'video' | 'sound'
		accept:       string
		descKey:      string
		mimePrefixes: string[]
	}
	const TABS: Record<TabId, TabMeta> = {
		images: {
			labelKey:     'amedia.tab_images',
			assetType:    'image',
			accept:       'image/jpeg,image/png,image/webp,image/gif',
			descKey:      'amedia.desc_images',
			mimePrefixes: ['image/'],
		},
		videos: {
			labelKey:     'amedia.tab_videos',
			assetType:    'video',
			accept:       'video/mp4,video/webm,video/ogg,video/quicktime,video/x-matroska',
			descKey:      'amedia.desc_videos',
			mimePrefixes: ['video/'],
		},
		audios: {
			labelKey:     'amedia.tab_audios',
			assetType:    'sound',
			accept:       'audio/mpeg,audio/ogg,audio/wav,audio/webm,audio/mp4,audio/flac',
			descKey:      'amedia.desc_audios',
			mimePrefixes: ['audio/'],
		},
	}

	let activeTab = $state<TabId>('images')

	const currentAssets = $derived<AssetRow[]>(
		activeTab === 'images' ? data.images
		: activeTab === 'videos' ? data.videos
		: data.audios,
	)

	function fullUrl(asset: AssetRow) {
		return `${baseUrl}/uploads/${asset.file_path}`
	}
	function thumbUrl(asset: AssetRow) {
		return `${baseUrl}/uploads/${asset.thumbnail_path ?? asset.file_path}`
	}

	// ── Upload ───────────────────────────────────────────────────────────────
	let uploading   = $state(false)
	let uploadError = $state('')
	let uploadOk    = $state(false)
	let dragOver    = $state(false)
	let fileInput   = $state<HTMLInputElement | null>(null)

	async function handleUpload(files: FileList | null) {
		if (!files || files.length === 0) return
		const file = files[0]
		const meta = TABS[activeTab]
		if (!meta.mimePrefixes.some(p => file.type.startsWith(p))) {
			uploadError = tFn('amedia.err_format', { desc: tFn(meta.descKey) })
			return
		}

		uploading = true; uploadError = ''; uploadOk = false

		const form = new FormData()
		form.append('name', file.name.replace(/\.[^.]+$/, ''))
		form.append('asset_type', meta.assetType)
		form.append('file', file)

		try {
			const res = await apiFetch(fetch, '/assets', {
				method: 'POST',
				headers: { Authorization: `Bearer ${data.token}` },
				body: form,
			})
			if (!res.ok) {
				const j = await res.json()
				uploadError = j.error ?? tFn('amedia.err_upload')
			} else {
				uploadOk = true
				// Reload to show the new file
				setTimeout(() => location.reload(), 800)
			}
		} catch {
			uploadError = tFn('amedia.err_network')
		} finally {
			uploading = false
		}
	}

	// ── Copy URL ─────────────────────────────────────────────────────────────
	let copiedId = $state<string | null>(null)

	async function copyUrl(asset: AssetRow) {
		await navigator.clipboard.writeText(fullUrl(asset))
		copiedId = asset.id
		setTimeout(() => { copiedId = null }, 2000)
	}

	function fmtSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} o`
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
		return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
	}

	const tabCounts = $derived({
		images: data.images.length,
		videos: data.videos.length,
		audios: data.audios.length,
	})
</script>

<svelte:head><title>{tFn('amedia.page_title')}</title></svelte:head>

<div class="space-y-6">

	<!-- Header -->
	<div class="flex items-start justify-between gap-4 flex-wrap">
		<div>
			<h1 class="text-xl font-bold text-white">{tFn('amedia.title')}</h1>
			<p class="text-sm text-gray-400 mt-0.5">
				{tFn('amedia.subtitle')}
			</p>
		</div>
	</div>

	<!-- Tabs -->
	<nav class="flex gap-1 border-b border-gray-800/60">
		{#each Object.entries(TABS) as [k, m] (k)}
			{@const isActive = activeTab === k}
			<button type="button" onclick={() => activeTab = k as TabId}
				class="px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px
					{isActive
						? 'border-indigo-500 text-white'
						: 'border-transparent text-gray-400 hover:text-gray-200'}">
				{tFn(m.labelKey)}
				<span class="ml-1.5 text-[10px] font-mono text-gray-500">{tabCounts[k as TabId]}</span>
			</button>
		{/each}
	</nav>

	<!-- Zone d'upload pour l'onglet courant -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
		       {dragOver ? 'border-indigo-500 bg-indigo-950/30' : 'border-gray-700 hover:border-gray-600'}"
		role="button"
		tabindex="0"
		aria-label={tFn('amedia.upload_zone_aria')}
		onclick={() => fileInput?.click()}
		onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
		ondragover={(e) => { e.preventDefault(); dragOver = true }}
		ondragleave={() => dragOver = false}
		ondrop={(e) => { e.preventDefault(); dragOver = false; handleUpload(e.dataTransfer?.files ?? null) }}
	>
		<input
			bind:this={fileInput}
			type="file"
			accept={TABS[activeTab].accept}
			class="hidden"
			onchange={(e) => handleUpload((e.target as HTMLInputElement).files)}
		/>

		{#if uploading}
			<div class="flex flex-col items-center gap-2 text-indigo-400">
				<svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
				</svg>
				<span class="text-sm font-medium">{tFn('amedia.uploading')}</span>
			</div>
		{:else if uploadOk}
			<div class="flex flex-col items-center gap-2 text-green-400">
				<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
				</svg>
				<span class="text-sm font-medium">{tFn('amedia.uploaded')}</span>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-3 pointer-events-none">
				<svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
				</svg>
				<div>
					<p class="text-sm font-medium text-gray-300">{tFn('amedia.drop_hint')}</p>
					<p class="text-xs text-gray-500 mt-1">{tFn(TABS[activeTab].descKey)}</p>
				</div>
			</div>
		{/if}

		{#if uploadError}
			<p class="mt-3 text-sm text-red-400 font-medium">{uploadError}</p>
		{/if}
	</div>

	<!-- Grille de médias -->
	{#if currentAssets.length === 0}
		<div class="text-center py-16 text-gray-600">
			<p class="text-sm">{tFn('amedia.empty', { tab: tFn(TABS[activeTab].labelKey).toLowerCase() })}</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
			{#each currentAssets as asset (asset.id)}
				<div class="group relative rounded-xl overflow-hidden border border-gray-800 bg-gray-900/60 hover:border-gray-600 transition-all flex flex-col">
					<!-- Preview adaptatif au type -->
					<div class="aspect-square overflow-hidden bg-gray-900 flex items-center justify-center">
						{#if activeTab === 'images'}
							<img src={thumbUrl(asset)} alt={asset.name}
								class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"/>
						{:else if activeTab === 'videos'}
							<!-- svelte-ignore a11y_media_has_caption -->
							<video src={fullUrl(asset)} controls preload="metadata"
								class="w-full h-full object-cover"></video>
						{:else}
							<div class="w-full h-full flex flex-col items-center justify-center p-3 gap-2">
								<svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" d="M9 19V6l12-3v13M9 19c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3zm12-3c0 1.657-1.343 3-3 3s-3-1.343-3-3 1.343-3 3-3 3 1.343 3 3z"/>
								</svg>
								<audio src={fullUrl(asset)} controls preload="metadata" class="w-full"></audio>
							</div>
						{/if}
					</div>

					<!-- Infos + actions -->
					<div class="p-2.5 space-y-2 flex-1 flex flex-col">
						<div class="flex-1">
							<p class="text-xs text-gray-300 font-medium truncate" title={asset.name}>{asset.name}</p>
							<p class="text-[10px] text-gray-600">{fmtSize(asset.file_size)}</p>
						</div>

						<div class="flex gap-1.5">
							<button
								type="button"
								onclick={() => copyUrl(asset)}
								class="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all
								       {copiedId === asset.id
								         ? 'bg-green-900/50 text-green-400 border border-green-700/50'
								         : 'bg-gray-800 text-gray-400 hover:bg-indigo-900/40 hover:text-indigo-300 border border-gray-700/50 hover:border-indigo-700/50'}"
							>
								{#if copiedId === asset.id}
									<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
									</svg>
									{tFn('amedia.copied')}
								{:else}
									<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
									</svg>
									URL
								{/if}
							</button>

							<form method="POST" action="?/delete" use:enhance={({ cancel }) => {
								if (!confirm(tFn('amedia.confirm_delete', { name: asset.name }))) cancel()
							}}>
								<input type="hidden" name="id" value={asset.id} />
								<button
									type="submit"
									class="p-1.5 rounded-lg bg-gray-800 text-gray-600 hover:bg-red-900/40 hover:text-red-400 border border-gray-700/50 hover:border-red-700/50 transition-all"
									title={tFn('amedia.delete_title')}
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
								</svg>
								</button>
							</form>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

</div>
