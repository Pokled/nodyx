<script lang="ts">
	/**
	 * Onglet Identité de l'écran Apparence (SPECS/NODYX_APPARENCE_CDC.md) : le
	 * logo et la bannière, dans le MÊME brouillon que l'Ambiance (publiés
	 * ensemble). Chaque image est une carte : au survol, un stylo et une phrase
	 * disent ce qu'on peut faire et où l'image apparaît (demande de Jonathan,
	 * 29/09 : « il faudrait plus de détail qui explique que l'on peut éditer »).
	 */
	import { t } from '$lib/i18n'

	type Ident = { logo_url?: string | null; banner_url?: string | null }
	let { published, draft, token, onchange, only }: {
		published: { logo_url: string | null; banner_url: string | null } | null
		draft: Ident | null
		token: string | null
		onchange: (next: Ident | null) => void
		/** Une seule image (panneaux du stylo). Absent = les deux. */
		only?: 'logo' | 'banner'
	} = $props()

	const tFn = $derived($t)
	const current = (k: 'logo_url' | 'banner_url') => draft && draft[k] !== undefined ? draft[k] ?? null : published?.[k] ?? null
	const changed = (k: 'logo_url' | 'banner_url') => !!draft && draft[k] !== undefined && draft[k] !== (published?.[k] ?? null)

	function setField(k: 'logo_url' | 'banner_url', v: string | null | undefined) {
		const next: Ident = { ...(draft ?? {}) }
		if (v === undefined || v === (published?.[k] ?? null)) delete next[k]   // revenu à la version publiée
		else next[k] = v
		onchange(Object.keys(next).length ? next : null)
	}

	let busy = $state<'' | 'logo' | 'banner'>('')
	let error = $state('')
	async function upload(kind: 'logo' | 'banner', file: File) {
		if (!token) return
		busy = kind; error = ''
		try {
			const fd = new FormData()
			fd.append('file', file)
			const res = await fetch(`/api/v1/admin/branding/upload?type=${kind}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
			const json = await res.json().catch(() => ({}))
			if (!res.ok || !json.url) { error = json.error ?? tFn('appr.upload_error'); return }
			setField(kind === 'logo' ? 'logo_url' : 'banner_url', json.url)
		} catch {
			error = tFn('appr.upload_error')
		} finally {
			busy = ''
		}
	}

	const allCards = $derived([
		{ kind: 'logo' as const,   key: 'logo_url' as const,   title: tFn('appr.id_logo'),   where: tFn('appr.id_logo_where'),   action: tFn('appr.id_logo_change'),   hint: tFn('appr.id_logo_hint') },
		{ kind: 'banner' as const, key: 'banner_url' as const, title: tFn('appr.id_banner'), where: tFn('appr.id_banner_where'), action: tFn('appr.id_banner_change'), hint: tFn('appr.id_banner_hint') },
	])
	const cards = $derived(only ? allCards.filter(c => c.kind === only) : allCards)
</script>

<div class="idc">
	{#each cards as c (c.kind)}
		{@const url = current(c.key)}
		<section class="idc-item">
			<label class="idc-card idc-{c.kind}" class:empty={!url} aria-busy={busy === c.kind}>
				{#if url}
					<img src={url} alt="" />
				{:else}
					<span class="idc-empty">{tFn('appr.id_none')}</span>
				{/if}
				<!-- Le stylo : visible au survol et au focus clavier, jamais en permanence. -->
				<span class="idc-over" aria-hidden="true">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
					<strong>{busy === c.kind ? tFn('appr.uploading') : c.action}</strong>
					<small>{c.hint}</small>
				</span>
				<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only" disabled={!!busy}
				       aria-label={c.action}
				       onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) upload(c.kind, f); (e.currentTarget as HTMLInputElement).value = '' }} />
			</label>
			<div class="idc-meta">
				<h3>{c.title} {#if changed(c.key)}<span class="idc-badge">{tFn('appr.id_changed')}</span>{/if}</h3>
				<p>{c.where}</p>
				<div class="idc-actions">
					{#if url}<button type="button" onclick={() => setField(c.key, null)}>{tFn('appr.id_remove')}</button>{/if}
					{#if changed(c.key)}<button type="button" onclick={() => setField(c.key, undefined)}>{tFn('appr.id_undo')}</button>{/if}
				</div>
			</div>
		</section>
	{/each}
	{#if error}<p class="idc-error">{error}</p>{/if}
</div>

<style>
	.idc { display: flex; flex-direction: column; gap: 22px; }
	.idc-item { display: flex; gap: 18px; align-items: flex-start; }
	.idc-card {
		position: relative; flex-shrink: 0; overflow: hidden; cursor: pointer; border-radius: 14px;
		background: #111827; box-shadow: 0 0 0 1px #374151;
		display: flex; align-items: center; justify-content: center;
		transition: box-shadow .2s, transform .3s var(--ease-spring);
	}
	.idc-logo { width: 104px; height: 104px; }
	.idc-banner { width: 320px; height: 120px; }
	.idc-card img { width: 100%; height: 100%; object-fit: cover; transition: filter .25s, transform .4s var(--ease-out-soft); }
	.idc-card.empty { box-shadow: 0 0 0 1px #374151, inset 0 0 0 2px #1f2937; background-image: repeating-linear-gradient(135deg, #111827 0 8px, #0f1520 8px 16px); }
	.idc-empty { font-size: 12px; color: #6b7280; }

	/* Survol / focus : l'image recule, le stylo et la phrase apparaissent. */
	.idc-over {
		position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
		padding: 10px; text-align: center; color: #fff;
		background: rgb(10 10 14 / .62); backdrop-filter: blur(3px);
		opacity: 0; transition: opacity .2s var(--ease-out-soft);
	}
	.idc-over svg { width: 22px; height: 22px; margin-bottom: 2px; transform: translateY(4px); transition: transform .35s var(--ease-spring); }
	.idc-over strong { font-size: 13px; font-weight: 600; }
	.idc-over small { font-size: 11px; color: #d1d5db; line-height: 1.3; max-width: 260px; }
	.idc-logo .idc-over small { display: none; }
	.idc-card:hover .idc-over, .idc-card:focus-within .idc-over, .idc-card[aria-busy='true'] .idc-over { opacity: 1; }
	.idc-card:hover .idc-over svg, .idc-card:focus-within .idc-over svg { transform: none; }
	.idc-card:hover img { transform: scale(1.04); }
	.idc-card:hover, .idc-card:focus-within { box-shadow: 0 0 0 2px var(--nx-header-accent), 0 10px 30px -10px rgb(0 0 0 / .8); }

	.idc-meta h3 { font-size: 14px; font-weight: 600; color: #f3f4f6; display: flex; align-items: center; gap: 8px; }
	.idc-meta p { font-size: 13px; color: #9ca3af; margin-top: 2px; max-width: 360px; }
	.idc-badge { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 999px; background: color-mix(in srgb, var(--nx-header-accent) 20%, transparent); color: var(--nx-header-accent); }
	.idc-actions { display: flex; gap: 8px; margin-top: 10px; }
	.idc-actions button { font-size: 12px; padding: 5px 10px; border-radius: 7px; background: #1f2937; border: 1px solid #374151; color: #e5e7eb; cursor: pointer; }
	.idc-actions button:hover { border-color: #4b5563; }
	.idc-actions button:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	.idc-error { font-size: 12px; color: #f87171; }
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

	@media (max-width: 640px) {
		.idc-item { flex-direction: column; }
		.idc-banner { width: 100%; }
	}
	@media (prefers-reduced-motion: reduce) {
		.idc-card, .idc-card img, .idc-over, .idc-over svg { transition: none; }
	}
</style>
