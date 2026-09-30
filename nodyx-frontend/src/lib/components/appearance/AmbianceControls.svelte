<script lang="ts">
	/**
	 * Réglages de l'Ambiance (SPECS/NODYX_APPARENCE_CDC.md) : un accent, un
	 * décor, une intensité, un mode par défaut. Composant sans état serveur :
	 * il reçoit une ambiance et signale chaque changement. L'écran Apparence
	 * l'utilise aujourd'hui ; les panneaux du stylo en direct le réutiliseront
	 * (mêmes contrôles, pas de doublon de code).
	 */
	import { t } from '$lib/i18n'
	import { deriveShellVars, type ShellTheme } from '$lib/shellTheme'
	import { extractPalette, loadImagePixels } from '$lib/paletteFromImage'
	import { AMBIANCE_PRESETS, ORIGINEL, applyPreset, presetMatches, bannerPreset, type AmbiancePreset } from '$lib/ambianceTools'

	type Section = 'presets' | 'accent' | 'neutrals' | 'backdrop' | 'intensity' | 'mode'
	let { value, banner, token, onchange, sections }: {
		value: ShellTheme
		banner: string | null
		token: string | null
		/** Sous-ensemble à afficher (panneaux du stylo). Absent = tout. */
		sections?: Section[]
		/** `continuous` : geste qui glisse (curseur, sélecteur de couleur). Ses
		 *  valeurs successives comptent pour UN seul pas d'Annuler. */
		onchange: (v: ShellTheme, opts?: { continuous?: boolean }) => void
	} = $props()

	const tFn = $derived($t)
	const show = (k: Section) => !sections || sections.includes(k)
	const set = (patch: Partial<ShellTheme>, continuous = false) => onchange({ ...value, ...patch }, { continuous })

	// ── « Les couleurs de ta bannière » ─────────────────────────────────────
	let palette = $state<string[]>([])
	// Trois échecs distincts, trois messages : pas de bannière, bannière
	// illisible (hébergée ailleurs sans CORS), ou bannière sans couleur franche.
	let paletteState = $state<'idle' | 'loading' | 'ready' | 'none' | 'nobanner' | 'unreadable'>('idle')
	$effect(() => {
		const url = banner
		if (!url) { palette = []; paletteState = 'nobanner'; return }
		paletteState = 'loading'
		let cancelled = false
		loadImagePixels(url).then(px => {
			if (cancelled) return
			if (!px) { palette = []; paletteState = 'unreadable'; return }
			palette = extractPalette(px, 5)
			paletteState = palette.length ? 'ready' : 'none'
		})
		return () => { cancelled = true }
	})

	// Saisie hexadécimale libre : on n'applique qu'une valeur complète et valide.
	let hexInput = $state('')
	$effect(() => { hexInput = value.accent })
	function onHexInput(v: string) {
		hexInput = v
		const norm = v.trim().startsWith('#') ? v.trim() : `#${v.trim()}`
		if (/^#[0-9a-fA-F]{6}$/.test(norm)) set({ accent: norm.toLowerCase() })
	}

	// Le calcul a-t-il dû ajuster l'accent pour qu'il reste lisible ? On le dit.
	const adjusted = $derived({
		light: deriveShellVars(value, false)['--nx-header-accent'] !== value.accent.toLowerCase(),
		dark:  deriveShellVars(value, true)['--nx-header-accent']  !== value.accent.toLowerCase(),
	})

	// ── Décor personnalisé : réutilise le téléversement de l'identité visuelle ──
	let uploading = $state(false)
	let uploadError = $state('')
	async function uploadBackdrop(file: File) {
		if (!token) return
		uploading = true; uploadError = ''
		try {
			const fd = new FormData()
			fd.append('file', file)
			const res = await fetch('/api/v1/admin/branding/upload?type=banner', {
				method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
			})
			const json = await res.json().catch(() => ({}))
			if (!res.ok || !json.url) { uploadError = json.error ?? tFn('appr.upload_error'); return }
			set({ backdrop: 'custom', backdrop_url: json.url })
		} catch {
			uploadError = tFn('appr.upload_error')
		} finally {
			uploading = false
		}
	}

	// Groupes « radio » au clavier : flèches gauche/droite (et haut/bas)
	// déplacent la sélection ET le focus, comme un vrai groupe de boutons radio.
	function radioKeys(e: KeyboardEvent) {
		const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }
		if (!(e.key in keys)) return
		const btns = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="radio"]'))
		const i = btns.indexOf(document.activeElement as HTMLButtonElement)
		if (i < 0) return
		e.preventDefault()
		const next = btns[(i + keys[e.key] + btns.length) % btns.length]
		next.focus(); next.click()
	}

	// Cartes d'ambiance : l'Originel d'abord (on peut TOUJOURS y revenir),
	// puis « Ta bannière » dès que sa palette est lue, puis les autres. Chaque
	// carte montre un vrai échantillon : le fond et l'accent qu'elle donnera.
	const cards = $derived<(AmbiancePreset & { special?: 'default' | 'banner' })[]>([
		{ ...ORIGINEL, special: 'default' },
		...(palette[0] ? [{ ...bannerPreset(palette[0]), special: 'banner' as const }] : []),
		...AMBIANCE_PRESETS,
	])
	function swatch(p: AmbiancePreset) {
		const v = deriveShellVars(applyPreset(value, p), (p.theme.default_mode ?? 'dark') !== 'light')
		return { bg: v['--nx-surface'], accent: v['--nx-header-accent'], text: v['--nx-text'] }
	}
	const neutralsOpts = $derived([
		{ id: 'graphite' as const, label: tFn('appr.neutrals_graphite') },
		{ id: 'tinted'   as const, label: tFn('appr.neutrals_tinted') },
		{ id: 'black'    as const, label: tFn('appr.neutrals_black') },
	])

	const backdrops = $derived([
		{ id: 'banner' as const, label: tFn('appr.backdrop_banner') },
		{ id: 'custom' as const, label: tFn('appr.backdrop_custom') },
		{ id: 'none'   as const, label: tFn('appr.backdrop_none') },
	])
	const modes = $derived([
		{ id: 'dark'   as const, label: tFn('appr.mode_dark') },
		{ id: 'light'  as const, label: tFn('appr.mode_light') },
		{ id: 'system' as const, label: tFn('appr.mode_system') },
	])
</script>

<div class="amb" style="--amb: {value.accent}">
	{#if show('presets')}
	<!-- ── Ambiances : l'Originel, ta bannière, et des univers ────────── -->
	<section class="amb-sec">
		<header>
			<h3>{tFn('appr.presets_title')}</h3>
			<p>{tFn('appr.presets_help')}</p>
		</header>
		<div class="amb-cards">
			{#each cards as p (p.id)}
				{@const sw = swatch(p)}
				{@const on = presetMatches(value, p)}
				<button type="button" class="amb-card" class:on aria-pressed={on} onclick={() => onchange(applyPreset(value, p))}>
					<span class="amb-card-sw" style="background: {sw.bg}; color: {sw.text}">
						<span class="amb-card-line" style="background: {sw.text}"></span>
						<span class="amb-card-line short" style="background: {sw.text}"></span>
						<span class="amb-card-dot" style="background: {sw.accent}"></span>
					</span>
					<span class="amb-card-name">
						{tFn(p.labelKey)}
						{#if p.special === 'default'}<em>{tFn('appr.preset_default')}</em>{/if}
					</span>
				</button>
			{/each}
		</div>
	</section>
	{/if}

	{#if show('accent')}
	<!-- ── Accent ──────────────────────────────────────────────────────── -->
	<section class="amb-sec">
		<header>
			<h3>{tFn('appr.accent_title')}</h3>
			<p>{tFn('appr.accent_help')}</p>
		</header>

		<div class="amb-accent">
			<label class="amb-swatch" title={tFn('appr.accent_pick')}>
				<input type="color" value={value.accent} oninput={(e) => set({ accent: (e.currentTarget as HTMLInputElement).value.toLowerCase() }, true)} aria-label={tFn('appr.accent_pick')} />
			</label>
			<input class="amb-hex" value={hexInput} maxlength="7" spellcheck="false" aria-label={tFn('appr.accent_hex')}
			       oninput={(e) => onHexInput((e.currentTarget as HTMLInputElement).value)} />
		</div>

		<div class="amb-palette">
			<span class="amb-label">{tFn('appr.palette_title')}</span>
			{#if paletteState === 'loading'}
				<span class="amb-hint">{tFn('appr.palette_loading')}</span>
			{:else if paletteState === 'ready'}
				<div class="amb-dots">
					{#each palette as c (c)}
						<button type="button" class="amb-dot" class:on={c === value.accent.toLowerCase()} style="background: {c}"
						        title={c} aria-label={tFn('appr.palette_use', { color: c })} onclick={() => set({ accent: c })}></button>
					{/each}
				</div>
			{:else if paletteState === 'nobanner'}
				<span class="amb-hint">{tFn('appr.palette_nobanner')}</span>
			{:else if paletteState === 'unreadable'}
				<span class="amb-hint">{tFn('appr.palette_unreadable')}</span>
			{:else}
				<span class="amb-hint">{tFn('appr.palette_none')}</span>
			{/if}
		</div>

		{#if adjusted.light || adjusted.dark}
			<p class="amb-note">
				{adjusted.light && adjusted.dark ? tFn('appr.adjusted_both') : adjusted.light ? tFn('appr.adjusted_light') : tFn('appr.adjusted_dark')}
			</p>
		{/if}
	</section>
	{/if}

	{#if show('neutrals')}
	<!-- ── Fonds ───────────────────────────────────────────────────────── -->
	<section class="amb-sec">
		<header>
			<h3>{tFn('appr.neutrals_title')}</h3>
			<p>{tFn('appr.neutrals_help')}</p>
		</header>
		<div class="amb-seg" role="radiogroup" tabindex="-1" onkeydown={radioKeys} aria-label={tFn('appr.neutrals_title')}>
			{#each neutralsOpts as o (o.id)}
				{@const cur = value.neutrals ?? 'tinted'}
				<button type="button" role="radio" aria-checked={cur === o.id} tabindex={cur === o.id ? 0 : -1} class:on={cur === o.id}
				        onclick={() => set({ neutrals: o.id })}>{o.label}</button>
			{/each}
		</div>
	</section>
	{/if}

	{#if show('backdrop')}
	<!-- ── Décor ───────────────────────────────────────────────────────── -->
	<section class="amb-sec">
		<header>
			<h3>{tFn('appr.backdrop_title')}</h3>
			<p>{tFn('appr.backdrop_help')}</p>
		</header>
		<div class="amb-seg" role="radiogroup" tabindex="-1" onkeydown={radioKeys} aria-label={tFn('appr.backdrop_title')}>
			{#each backdrops as b (b.id)}
				<button type="button" role="radio" aria-checked={value.backdrop === b.id} tabindex={value.backdrop === b.id ? 0 : -1} class:on={value.backdrop === b.id}
				        onclick={() => b.id === 'custom' && !value.backdrop_url ? document.getElementById('amb-backdrop-file')?.click() : set({ backdrop: b.id })}>
					{b.label}
				</button>
			{/each}
		</div>
		{#if value.backdrop === 'banner' && !banner}
			<p class="amb-hint">{tFn('appr.backdrop_no_banner')}</p>
		{/if}
		<div class="amb-upload" class:hidden={value.backdrop !== 'custom' && !uploading}>
			{#if value.backdrop === 'custom' && value.backdrop_url}
				<img src={value.backdrop_url} alt="" class="amb-thumb" />
			{/if}
			<label class="amb-btn">
				{uploading ? tFn('appr.uploading') : value.backdrop_url ? tFn('appr.backdrop_replace') : tFn('appr.backdrop_choose')}
				<input id="amb-backdrop-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only" disabled={uploading}
				       onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) uploadBackdrop(f) }} />
			</label>
		</div>
		{#if uploadError}<p class="amb-error">{uploadError}</p>{/if}
	</section>
	{/if}

	{#if show('intensity')}
	<!-- ── Intensité ───────────────────────────────────────────────────── -->
	<section class="amb-sec">
		<header>
			<h3>{tFn('appr.intensity_title')}</h3>
			<p>{tFn('appr.intensity_help')}</p>
		</header>
		<div class="amb-range">
			<span>{tFn('appr.intensity_min')}</span>
			<input type="range" min="0" max="100" step="1" value={value.intensity} aria-label={tFn('appr.intensity_title')}
			       oninput={(e) => set({ intensity: Number((e.currentTarget as HTMLInputElement).value) }, true)} />
			<span>{tFn('appr.intensity_max')}</span>
		</div>
	</section>
	{/if}

	{#if show('mode')}
	<!-- ── Mode par défaut ─────────────────────────────────────────────── -->
	<section class="amb-sec">
		<header>
			<h3>{tFn('appr.mode_title')}</h3>
			<p>{tFn('appr.mode_help')}</p>
		</header>
		<div class="amb-seg" role="radiogroup" tabindex="-1" onkeydown={radioKeys} aria-label={tFn('appr.mode_title')}>
			{#each modes as m (m.id)}
				<button type="button" role="radio" aria-checked={value.default_mode === m.id} tabindex={value.default_mode === m.id ? 0 : -1} class:on={value.default_mode === m.id}
				        onclick={() => set({ default_mode: m.id })}>{m.label}</button>
			{/each}
		</div>
	</section>
	{/if}
</div>

<style>
	.amb { display: flex; flex-direction: column; gap: 22px; }
	.amb-sec header h3 { font-size: 14px; font-weight: 600; color: #f3f4f6; }
	.amb-sec header p { font-size: 13px; color: #9ca3af; margin-top: 2px; }
	.amb-sec header { margin-bottom: 10px; }
	.amb-label { font-size: 12px; font-weight: 500; color: #d1d5db; }
	.amb-hint { font-size: 12px; color: #6b7280; }
	.amb-note { margin-top: 10px; font-size: 12px; color: #d1d5db; padding: 8px 10px; border-radius: 8px;
		background: color-mix(in srgb, var(--amb) 10%, #111827); border: 1px solid color-mix(in srgb, var(--amb) 25%, #374151); }
	.amb-error { margin-top: 8px; font-size: 12px; color: #f87171; }

	.amb-accent { display: flex; align-items: center; gap: 10px; }
	/* La pastille EST le sélecteur natif : on masque son rendu système pauvre
	   et on ne garde qu'un gros rond de la couleur choisie. */
	.amb-swatch {
		position: relative; width: 44px; height: 44px; border-radius: 14px; cursor: pointer; flex-shrink: 0;
		background: var(--amb);
		box-shadow: inset 0 1px 0 rgb(255 255 255 / .25), 0 0 0 1px rgb(0 0 0 / .4), 0 6px 18px -6px var(--amb);
		transition: transform .3s var(--ease-spring);
	}
	.amb-swatch:hover { transform: scale(1.06); }
	.amb-swatch input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
	.amb-hex {
		width: 110px; padding: 8px 10px; border-radius: 8px; font: 13px ui-monospace, monospace; text-transform: lowercase;
		background: #1f2937; border: 1px solid #374151; color: #f3f4f6;
	}
	.amb-hex:focus { outline: none; border-color: var(--amb); }

	.amb-palette { display: flex; align-items: center; gap: 12px; margin-top: 14px; flex-wrap: wrap; }
	.amb-dots { display: flex; gap: 8px; }
	.amb-dot {
		width: 28px; height: 28px; border-radius: 999px; cursor: pointer; border: none;
		box-shadow: 0 0 0 1px rgb(0 0 0 / .45), inset 0 1px 0 rgb(255 255 255 / .2);
		transition: transform .3s var(--ease-spring), box-shadow .2s;
	}
	.amb-dot:hover { transform: translateY(-2px) scale(1.1); }
	.amb-dot.on { box-shadow: 0 0 0 2px #111827, 0 0 0 4px currentColor; color: #f3f4f6; }

	.amb-seg { display: inline-flex; padding: 3px; gap: 2px; border-radius: 10px; background: #111827; border: 1px solid #1f2937; }
	.amb-seg button {
		padding: 6px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; color: #9ca3af; background: transparent; border: none; cursor: pointer;
		transition: background-color .15s, color .15s;
	}
	.amb-seg button:hover { color: #f3f4f6; }
	.amb-seg button.on { background: #374151; color: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / .4), inset 0 1px 0 rgb(255 255 255 / .06); }

	.amb-upload { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
	.amb-upload.hidden { display: none; }
	.amb-thumb { width: 96px; height: 54px; object-fit: cover; border-radius: 8px; box-shadow: 0 0 0 1px #374151; }
	.amb-btn {
		padding: 7px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;
		background: #1f2937; border: 1px solid #374151; color: #e5e7eb;
	}
	.amb-btn:hover { border-color: #4b5563; }

	.amb-range { display: flex; align-items: center; gap: 12px; font-size: 12px; color: #9ca3af; }
	.amb-range input { flex: 1; accent-color: var(--amb); }

	.amb-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
	.amb-card {
		display: flex; flex-direction: column; gap: 7px; padding: 6px; border-radius: 12px; text-align: left; cursor: pointer;
		background: #111827; border: 1px solid #1f2937;
		transition: border-color .15s, transform .3s var(--ease-spring), box-shadow .2s;
	}
	.amb-card:hover { border-color: #374151; transform: translateY(-2px); }
	.amb-card.on { border-color: var(--amb); box-shadow: 0 0 0 1px var(--amb), 0 8px 20px -10px var(--amb); }
	.amb-card-sw {
		position: relative; height: 54px; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; gap: 5px; padding: 10px;
		box-shadow: inset 0 0 0 1px rgb(255 255 255 / .06);
	}
	.amb-card-line { height: 4px; width: 62%; border-radius: 2px; opacity: .55; }
	.amb-card-line.short { width: 40%; opacity: .3; }
	.amb-card-dot { position: absolute; right: 9px; bottom: 9px; width: 16px; height: 16px; border-radius: 999px; box-shadow: 0 0 10px -2px currentColor; }
	.amb-card-name { font-size: 12.5px; font-weight: 500; color: #e5e7eb; padding: 0 4px 3px; display: flex; align-items: center; justify-content: space-between; gap: 4px; }
	.amb-card-name em { font-style: normal; font-size: 10px; font-weight: 600; color: var(--amb); }
	.amb-card:focus-visible { outline: 2px solid var(--amb); outline-offset: 2px; }

	/* Focus clavier visible partout (V3 de la passe de vérification du 29/09). */
	.amb-swatch:focus-within, .amb-dot:focus-visible, .amb-seg button:focus-visible, .amb-btn:focus-within {
		outline: 2px solid var(--amb); outline-offset: 2px;
	}
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media (prefers-reduced-motion: reduce) { .amb-swatch, .amb-dot { transition: none; } }
</style>
