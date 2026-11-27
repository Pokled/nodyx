<script lang="ts">
	// Choisir une image dans la médiathèque de l'instance (lot L1c, type de champ `media`) :
	// les images en vignettes, un clic choisit. On peut aussi en téléverser une sans quitter
	// l'éditeur : elle rejoint la médiathèque et se trouve choisie. Les fichiers restent sur
	// l'instance (/uploads/…), jamais une adresse extérieure collée à la main.
	import { onMount } from 'svelte'
	import { X, Upload } from 'lucide-svelte'
	import { assetUrl, assetThumb, type AssetRef } from '$lib/homepage/fields'

	let { t, token, onpick, onclose }: {
		t: (key: string, vars?: Record<string, string>) => string
		token: string
		onpick: (url: string) => void
		onclose: () => void
	} = $props()

	let assets = $state<AssetRef[]>([])
	let phase = $state<'loading' | 'ready' | 'error'>('loading')
	let uploading = $state(false)
	let uploadError = $state('')
	let fileEl = $state<HTMLInputElement | null>(null)
	let dialogEl = $state<HTMLDivElement | null>(null)

	async function load() {
		try {
			const res = await fetch('/api/v1/assets?type=image&limit=100')
			assets = res.ok ? ((await res.json()).assets ?? []) : []
			phase = res.ok ? 'ready' : 'error'
		} catch { phase = 'error' }
	}

	async function upload(file: File) {
		uploadError = ''
		if (!file.type.startsWith('image/')) { uploadError = t('hpe.media_not_image'); return }
		uploading = true
		try {
			const form = new FormData()
			form.append('name', file.name.replace(/\.[^.]+$/, ''))
			form.append('asset_type', 'image')
			form.append('file', file)
			const res = await fetch('/api/v1/assets', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
			const json = await res.json().catch(() => ({}))
			if (!res.ok || !json.asset) { uploadError = json.error ?? t('hpe.media_upload_error'); return }
			onpick(assetUrl(json.asset))
		} catch {
			uploadError = t('hpe.media_upload_error')
		} finally {
			uploading = false
		}
	}

	function onKey(e: KeyboardEvent) {
		// La fenêtre garde Échap pour elle : l'éditeur ne désélectionne pas le bloc en dessous
		if (e.key === 'Escape') { e.stopPropagation(); onclose() }
	}

	onMount(() => { load(); dialogEl?.focus() })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="mp-veil" onclick={onclose}>
	<div class="mp" role="dialog" aria-modal="true" aria-label={t('hpe.media_title')} tabindex="-1" bind:this={dialogEl} onclick={e => e.stopPropagation()} onkeydown={onKey}>
		<header class="mp-head">
			<h2>{t('hpe.media_title')}</h2>
			<button type="button" class="mp-x" onclick={onclose} aria-label={t('hpe.close')} title={t('hpe.close')}><X size={18} /></button>
		</header>

		<div class="mp-body">
			{#if phase === 'loading'}
				<p class="mp-note">{t('hpe.media_loading')}</p>
			{:else if phase === 'error'}
				<p class="mp-note mp-note--bad">{t('hpe.media_load_error')}</p>
			{:else if !assets.length}
				<p class="mp-note">{t('hpe.media_empty')}</p>
			{:else}
				<ul class="mp-grid">
					{#each assets as a (a.id)}
						<li>
							<button type="button" class="mp-tile" onclick={() => onpick(assetUrl(a))} title={a.name}>
								<img src={assetThumb(a)} alt={a.name} loading="lazy" />
								<span>{a.name}</span>
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<footer class="mp-foot">
			{#if uploadError}<p class="mp-note mp-note--bad" role="alert">{uploadError}</p>{/if}
			<input bind:this={fileEl} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onchange={e => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) upload(f) }} />
			<button type="button" class="mp-up" disabled={uploading} onclick={() => fileEl?.click()}>
				<Upload size={16} />{uploading ? t('hpe.media_uploading') : t('hpe.media_upload')}
			</button>
			<span class="mp-help">{t('hpe.media_upload_help')}</span>
		</footer>
	</div>
</div>

<style>
	.mp-veil { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgb(0 0 0 / .45); }
	.mp { width: min(760px, 100%); max-height: min(640px, 100%); display: flex; flex-direction: column; background: var(--nx-surface); color: var(--nx-text); border-radius: var(--nx-r-fenetre, 14px); box-shadow: 0 24px 60px rgb(0 0 0 / .3); outline: none; }
	.mp-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--nx-border); }
	.mp-head h2 { font-size: 16px; font-weight: 700; margin: 0; }
	.mp-x { display: inline-flex; width: 32px; height: 32px; align-items: center; justify-content: center; border-radius: var(--nx-r-controle, 6px); color: var(--nx-text-muted); }
	.mp-x:hover { background: var(--nx-bg); color: var(--nx-text); }
	.mp-body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px; }
	.mp-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; }
	.mp-tile { width: 100%; display: flex; flex-direction: column; gap: 6px; padding: 6px; border: 1px solid var(--nx-border); border-radius: var(--nx-r-panneau, 10px); background: var(--nx-surface); text-align: left; }
	.mp-tile:hover { border-color: var(--nx-header-accent); }
	.mp-tile img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--nx-r-controle, 6px); background: var(--nx-bg); }
	.mp-tile span { font-size: 12px; color: var(--nx-text-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.mp-note { color: var(--nx-text-muted); margin: 0; }
	.mp-note--bad { color: var(--nx-bad); }
	.mp-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 16px; border-top: 1px solid var(--nx-border); }
	.mp-foot .mp-note { width: 100%; }
	.mp-up { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 14px; border-radius: var(--nx-r-controle, 6px); background: var(--nx-header-accent); color: var(--nx-on-accent); font-weight: 600; }
	.mp-up:hover:not(:disabled) { background: var(--nx-header-accent-strong); }
	.mp-up:disabled { opacity: .6; }
	.mp-help { font-size: 12px; color: var(--nx-text-muted); }
	button { cursor: pointer; background: none; border: 0; font: inherit; color: inherit; }
	button:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
</style>
