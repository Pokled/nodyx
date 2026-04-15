<script lang="ts">
	import { enhance } from '$app/forms'
	import { apiFetch } from '$lib/api'
	import { PUBLIC_API_URL } from '$env/static/public'

	let { data }: { data: any } = $props()

	const baseUrl = PUBLIC_API_URL.replace('/api/v1', '')

	function imgUrl(asset: { file_path: string; thumbnail_path?: string }) {
		return `${baseUrl}/uploads/${asset.thumbnail_path ?? asset.file_path}`
	}

	function fullUrl(asset: { file_path: string }) {
		return `${baseUrl}/uploads/${asset.file_path}`
	}

	// ── Upload ────────────────────────────────────────────────────────────────
	let uploading   = $state(false)
	let uploadError = $state('')
	let uploadOk    = $state(false)
	let dragOver    = $state(false)
	let fileInput   = $state<HTMLInputElement | null>(null)

	async function handleUpload(files: FileList | null) {
		if (!files || files.length === 0) return
		const file = files[0]
		if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) {
			uploadError = 'Format non supporté. Utilisez JPG, PNG, WebP ou GIF.'
			return
		}

		uploading = true; uploadError = ''; uploadOk = false

		const form = new FormData()
		form.append('name', file.name.replace(/\.[^.]+$/, ''))
		form.append('asset_type', 'image')
		form.append('file', file)

		try {
			const res = await apiFetch(fetch, '/assets', {
				method: 'POST',
				headers: { Authorization: `Bearer ${data.token}` },
				body: form,
			})
			if (!res.ok) {
				const j = await res.json()
				uploadError = j.error ?? 'Erreur lors de l\'upload.'
			} else {
				uploadOk = true
				// Reload to show new image
				setTimeout(() => location.reload(), 800)
			}
		} catch {
			uploadError = 'Erreur réseau.'
		} finally {
			uploading = false
		}
	}

	// ── Copy URL ──────────────────────────────────────────────────────────────
	let copiedId = $state<string | null>(null)

	async function copyUrl(asset: { id: string; file_path: string }) {
		await navigator.clipboard.writeText(fullUrl(asset))
		copiedId = asset.id
		setTimeout(() => { copiedId = null }, 2000)
	}
</script>

<svelte:head><title>Admin — Médiathèque</title></svelte:head>

<div class="space-y-6">

	<!-- Header -->
	<div class="flex items-start justify-between">
		<div>
			<h1 class="text-xl font-bold text-white">Médiathèque</h1>
			<p class="text-sm text-gray-400 mt-0.5">
				Images hébergées — {data.images.length} fichier{data.images.length > 1 ? 's' : ''}
			</p>
		</div>
	</div>

	<!-- Zone d'upload -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer
		       {dragOver ? 'border-indigo-500 bg-indigo-950/30' : 'border-gray-700 hover:border-gray-600'}"
		role="button"
		tabindex="0"
		aria-label="Zone d'upload"
		onclick={() => fileInput?.click()}
		onkeydown={(e) => e.key === 'Enter' && fileInput?.click()}
		ondragover={(e) => { e.preventDefault(); dragOver = true }}
		ondragleave={() => dragOver = false}
		ondrop={(e) => { e.preventDefault(); dragOver = false; handleUpload(e.dataTransfer?.files ?? null) }}
	>
		<input
			bind:this={fileInput}
			type="file"
			accept="image/jpeg,image/png,image/webp,image/gif"
			class="hidden"
			onchange={(e) => handleUpload((e.target as HTMLInputElement).files)}
		/>

		{#if uploading}
			<div class="flex flex-col items-center gap-2 text-indigo-400">
				<svg class="w-6 h-6 animate-spin" fill="none" viewBox="0 0 24 24">
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
					<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
				</svg>
				<span class="text-sm font-medium">Upload en cours…</span>
			</div>
		{:else if uploadOk}
			<div class="flex flex-col items-center gap-2 text-green-400">
				<svg class="w-6 h-6" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
				</svg>
				<span class="text-sm font-medium">Image uploadée — rechargement…</span>
			</div>
		{:else}
			<div class="flex flex-col items-center gap-3 pointer-events-none">
				<svg class="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
				</svg>
				<div>
					<p class="text-sm font-medium text-gray-300">Glisser une image ici ou cliquer pour parcourir</p>
					<p class="text-xs text-gray-500 mt-1">JPG, PNG, WebP, GIF — max 12 Mo</p>
				</div>
			</div>
		{/if}

		{#if uploadError}
			<p class="mt-3 text-sm text-red-400 font-medium">{uploadError}</p>
		{/if}
	</div>

	<!-- Grille d'images -->
	{#if data.images.length === 0}
		<div class="text-center py-16 text-gray-600">
			<svg class="w-10 h-10 mx-auto mb-3 opacity-40" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M13.5 12h.008v.008H13.5V12zm0 0H9m4.06-7.19l-4.5-4.5A1.5 1.5 0 007 1.5H4.5A2.25 2.25 0 002.25 3.75v16.5A2.25 2.25 0 004.5 22.5h15a2.25 2.25 0 002.25-2.25V8.25a2.25 2.25 0 00-.44-1.34l-4.5-4.5z"/>
			</svg>
			<p class="text-sm">Aucune image hébergée pour l'instant.</p>
		</div>
	{:else}
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
			{#each data.images as asset (asset.id)}
				<div class="group relative rounded-xl overflow-hidden border border-gray-800 bg-gray-900/60 hover:border-gray-600 transition-all">
					<!-- Preview -->
					<div class="aspect-square overflow-hidden bg-gray-900">
						<img
							src={imgUrl(asset)}
							alt={asset.name}
							class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
						/>
					</div>

					<!-- Infos + actions -->
					<div class="p-2.5 space-y-2">
						<p class="text-xs text-gray-300 font-medium truncate" title={asset.name}>{asset.name}</p>
						<p class="text-[10px] text-gray-600">{Math.round(asset.file_size / 1024)} Ko</p>

						<div class="flex gap-1.5">
							<!-- Copier URL -->
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
									Copié
								{:else}
									<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
									</svg>
									URL
								{/if}
							</button>

							<!-- Supprimer -->
							<form method="POST" action="?/delete" use:enhance={({ cancel }) => {
								if (!confirm(`Supprimer "${asset.name}" ?`)) cancel()
							}}>
								<input type="hidden" name="id" value={asset.id} />
								<button
									type="submit"
									class="p-1.5 rounded-lg bg-gray-800 text-gray-600 hover:bg-red-900/40 hover:text-red-400 border border-gray-700/50 hover:border-red-700/50 transition-all"
									title="Supprimer"
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
