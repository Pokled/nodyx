<script lang="ts">
	/**
	 * Style propre à UNE zone du contenant (SPECS/NODYX_APPARENCE_CDC.md,
	 * partie 3) : « comme si on en modifiait le CSS », mais par réglages typés
	 * et bornés (le core revalide tout). Chaque réglage absent s'hérite de
	 * l'ambiance ; un réglage posé se remet à l'ambiance par sa flèche ↺.
	 *
	 * Sans état serveur : reçoit l'ambiance entière, signale l'ambiance suivante.
	 */
	import { t } from '$lib/i18n'
	import { deriveShellVars, type ShellTheme, type ShellZone, type ZoneStyle } from '$lib/shellTheme'
	import { setZoneStyle, clearZone, copyZoneToAll } from '$lib/ambianceTools'

	let { value, zone, token, dark, onchange }: {
		value: ShellTheme
		zone: ShellZone
		token: string | null
		/** Mode affiché : les valeurs héritées (fond, opacité) en dépendent. */
		dark: boolean
		onchange: (v: ShellTheme, opts?: { continuous?: boolean }) => void
	} = $props()

	const tFn = $derived($t)
	const z = $derived<ZoneStyle>(value.zones?.[zone] ?? {})
	const styled = $derived(Object.keys(z).length > 0)
	const others = $derived(Object.keys(value.zones ?? {}).filter(k => k !== zone).length)

	// Ce que la zone hérite de l'ambiance : montré tant qu'on n'a rien posé.
	const base = $derived(deriveShellVars(value, dark))
	const inherited = $derived({
		surface: base['--nx-surface'],
		accent: base['--nx-header-accent'],
		opacity: dark ? 62 : 72,
		blur: 28,
		radius: 18,
		shadow: 100,
		border_width: 0,
		border_color: base['--nx-border'],
	})

	const set = (patch: Partial<Record<keyof ZoneStyle, unknown>>, continuous = false) => onchange(setZoneStyle(value, zone, patch), { continuous })
	const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value)
	const hex = (e: Event) => (e.currentTarget as HTMLInputElement).value.toLowerCase()

	// ── Image de fond de la zone ─────────────────────────────────────────────
	let uploading = $state(false)
	let uploadError = $state('')
	async function upload(file: File) {
		if (!token) return
		uploading = true; uploadError = ''
		try {
			const fd = new FormData()
			fd.append('file', file)
			const res = await fetch('/api/v1/admin/branding/upload?type=banner', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
			const json = await res.json().catch(() => ({}))
			if (!res.ok || !json.url) { uploadError = json.error ?? tFn('appr.upload_error'); return }
			set({ image: { url: json.url, x: z.image?.x ?? 50, y: z.image?.y ?? 50, zoom: z.image?.zoom ?? 100, veil: z.image?.veil ?? 60 } })
		} catch {
			uploadError = tFn('appr.upload_error')
		} finally {
			uploading = false
		}
	}
	const setImage = (p: Partial<NonNullable<ZoneStyle['image']>>, continuous = false) => { if (z.image) set({ image: { ...z.image, ...p } }, continuous) }
	// Un clic sur la vignette place le point de cadrage : plus direct que deux curseurs.
	function focusAt(e: MouseEvent) {
		const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
		const pct = (v: number) => Math.round(Math.min(100, Math.max(0, v * 100)))
		setImage({ x: pct((e.clientX - r.left) / r.width), y: pct((e.clientY - r.top) / r.height) })
	}

	const fonts = $derived([
		{ id: undefined,             label: tFn('zone.font_inherit') },
		{ id: 'system'  as const,    label: tFn('zone.font_system') },
		{ id: 'rounded' as const,    label: tFn('zone.font_rounded') },
		{ id: 'serif'   as const,    label: tFn('zone.font_serif') },
		{ id: 'mono'    as const,    label: tFn('zone.font_mono') },
	])

	type RangeKey = 'opacity' | 'blur' | 'radius' | 'shadow' | 'border_width'
	const ranges = $derived<{ k: RangeKey; label: string; min: number; max: number; unit: string }[]>([
		{ k: 'opacity',      label: tFn('zone.opacity'),      min: 0, max: 100, unit: '%' },
		{ k: 'blur',         label: tFn('zone.blur'),         min: 0, max: 40,  unit: 'px' },
		{ k: 'shadow',       label: tFn('zone.shadow'),       min: 0, max: 100, unit: '%' },
		{ k: 'radius',       label: tFn('zone.radius'),       min: 0, max: 32,  unit: 'px' },
		{ k: 'border_width', label: tFn('zone.border_width'), min: 0, max: 3,   unit: 'px' },
	])
</script>

{#snippet reset(keys: (keyof ZoneStyle)[])}
	{#if keys.some(k => z[k] !== undefined)}
		<button type="button" class="zs-reset" title={tFn('zone.reset_one')} aria-label={tFn('zone.reset_one')}
		        onclick={() => set(Object.fromEntries(keys.map(k => [k, undefined])))}>↺</button>
	{:else}
		<span class="zs-inh">{tFn('zone.inherited')}</span>
	{/if}
{/snippet}

<div class="zs" style="--zs: {z.accent ?? inherited.accent}">
	<p class="zs-intro">{tFn('zone.intro')}</p>

	<!-- ── Couleurs ─────────────────────────────────────────────────────── -->
	<section class="zs-sec">
		<h3>{tFn('zone.colors')}</h3>
		<div class="zs-row">
			<label class="zs-sw" style="background: {z.surface ?? inherited.surface}">
				<input type="color" value={z.surface ?? inherited.surface} aria-label={tFn('zone.surface')} oninput={(e) => set({ surface: hex(e) }, true)} />
			</label>
			<span class="zs-name">{tFn('zone.surface')}<small>{tFn('zone.surface_help')}</small></span>
			{@render reset(['surface'])}
		</div>
		<div class="zs-row">
			<label class="zs-sw" style="background: {z.accent ?? inherited.accent}">
				<input type="color" value={z.accent ?? inherited.accent} aria-label={tFn('zone.accent')} oninput={(e) => set({ accent: hex(e) }, true)} />
			</label>
			<span class="zs-name">{tFn('zone.accent')}<small>{tFn('zone.accent_help')}</small></span>
			{@render reset(['accent'])}
		</div>
	</section>

	<!-- ── Matière et forme ─────────────────────────────────────────────── -->
	<section class="zs-sec">
		<h3>{tFn('zone.material')}</h3>
		{#each ranges as r (r.k)}
			{@const v = z[r.k] ?? inherited[r.k]}
			<div class="zs-range" class:set={z[r.k] !== undefined}>
				<span class="zs-name">{r.label}</span>
				<input type="range" min={r.min} max={r.max} step="1" value={v} aria-label={r.label}
				       oninput={(e) => set({ [r.k]: num(e) }, true)} />
				<output>{v}{r.unit}</output>
				{@render reset([r.k])}
			</div>
		{/each}
		{#if (z.border_width ?? 0) > 0 || z.border_color}
			<div class="zs-row">
				<label class="zs-sw small" style="background: {z.border_color ?? inherited.border_color}">
					<input type="color" value={z.border_color ?? inherited.border_color} aria-label={tFn('zone.border_color')} oninput={(e) => set({ border_color: hex(e) }, true)} />
				</label>
				<span class="zs-name">{tFn('zone.border_color')}</span>
				{@render reset(['border_color'])}
			</div>
		{/if}
	</section>

	<!-- ── Image de fond ────────────────────────────────────────────────── -->
	<section class="zs-sec">
		<h3>{tFn('zone.image')}</h3>
		{#if z.image}
			<button type="button" class="zs-thumb" onclick={focusAt} title={tFn('zone.image_focus')} aria-label={tFn('zone.image_focus')}>
				<img src={z.image.url} alt="" style="object-position: {z.image.x}% {z.image.y}%" />
				<span class="zs-focus" style="left: {z.image.x}%; top: {z.image.y}%" aria-hidden="true"></span>
			</button>
			<p class="zs-hint">{tFn('zone.image_focus_help')}</p>
			<div class="zs-range">
				<span class="zs-name">{tFn('zone.image_zoom')}</span>
				<input type="range" min="100" max="300" step="5" value={z.image.zoom} aria-label={tFn('zone.image_zoom')} oninput={(e) => setImage({ zoom: num(e) }, true)} />
				<output>{z.image.zoom}%</output>
			</div>
			<div class="zs-range">
				<span class="zs-name">{tFn('zone.image_veil')}</span>
				<input type="range" min="0" max="100" step="1" value={z.image.veil} aria-label={tFn('zone.image_veil')} oninput={(e) => setImage({ veil: num(e) }, true)} />
				<output>{z.image.veil}%</output>
			</div>
			<p class="zs-hint" class:warn={z.image.veil < 50}>{z.image.veil < 50 ? tFn('zone.image_veil_low') : tFn('zone.image_veil_help')}</p>
		{/if}
		<div class="zs-actions">
			<label class="zs-btn">
				{uploading ? tFn('appr.uploading') : z.image ? tFn('zone.image_replace') : tFn('zone.image_choose')}
				<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only" disabled={uploading}
				       onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) upload(f); (e.currentTarget as HTMLInputElement).value = '' }} />
			</label>
			{#if z.image}<button type="button" class="zs-btn ghost" onclick={() => set({ image: undefined })}>{tFn('zone.image_remove')}</button>{/if}
		</div>
		{#if uploadError}<p class="zs-error">{uploadError}</p>{/if}
	</section>

	<!-- ── Police ───────────────────────────────────────────────────────── -->
	<section class="zs-sec">
		<h3>{tFn('zone.font')}</h3>
		<div class="zs-fonts">
			{#each fonts as f (f.id ?? 'inherit')}
				<button type="button" class="zs-font {f.id ?? ''}" class:on={z.font === f.id} aria-pressed={z.font === f.id} onclick={() => set({ font: f.id })}>
					<span>Aa</span>{f.label}
				</button>
			{/each}
		</div>
	</section>

	<!-- ── Toute la zone ────────────────────────────────────────────────── -->
	<footer class="zs-foot">
		<button type="button" class="zs-btn" disabled={!styled} onclick={() => onchange(clearZone(value, zone))}>{tFn('zone.reset_all')}</button>
		<button type="button" class="zs-btn ghost" disabled={!styled} onclick={() => onchange(copyZoneToAll(value, zone))}>{tFn('zone.copy_all')}</button>
	</footer>
	{#if others > 0}<p class="zs-hint">{tFn('zone.others_styled', { count: others })}</p>{/if}
</div>

<style>
	.zs { display: flex; flex-direction: column; gap: 20px; }
	.zs-intro { font-size: 12.5px; color: #9ca3af; line-height: 1.45; }
	.zs-sec h3 { font-size: 12px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: #6b7280; margin-bottom: 10px; }
	.zs-row { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
	.zs-name { flex: 1; font-size: 13px; color: #e5e7eb; display: flex; flex-direction: column; min-width: 0; }
	.zs-name small { font-size: 11.5px; color: #6b7280; }
	.zs-sw {
		position: relative; width: 36px; height: 36px; border-radius: 11px; flex-shrink: 0; cursor: pointer;
		box-shadow: inset 0 1px 0 rgb(255 255 255 / .2), 0 0 0 1px rgb(255 255 255 / .12);
		transition: transform .3s var(--ease-spring);
	}
	.zs-sw.small { width: 26px; height: 26px; border-radius: 8px; }
	.zs-sw:hover { transform: scale(1.06); }
	.zs-sw input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
	.zs-sw:focus-within { outline: 2px solid var(--zs); outline-offset: 2px; }

	.zs-range { display: grid; grid-template-columns: 92px 1fr 46px 58px; align-items: center; gap: 10px; padding: 4px 0; }
	.zs-range input { accent-color: var(--zs); min-width: 0; }
	.zs-range output { font: 12px ui-monospace, monospace; color: #6b7280; text-align: right; }
	.zs-range.set output { color: #e5e7eb; }
	.zs-inh { font-size: 10.5px; color: #4b5563; text-align: right; justify-self: end; }
	.zs-reset {
		justify-self: end; width: 26px; height: 26px; border-radius: 8px; border: none; cursor: pointer;
		background: color-mix(in srgb, var(--zs) 16%, transparent); color: var(--zs); font-size: 14px;
	}
	.zs-reset:hover { background: color-mix(in srgb, var(--zs) 28%, transparent); }
	.zs-reset:focus-visible { outline: 2px solid var(--zs); outline-offset: 2px; }

	.zs-thumb { position: relative; display: block; width: 100%; height: 110px; padding: 0; border: none; border-radius: 10px; overflow: hidden; cursor: crosshair; box-shadow: 0 0 0 1px #374151; }
	.zs-thumb img { width: 100%; height: 100%; object-fit: cover; }
	.zs-thumb:focus-visible { outline: 2px solid var(--zs); outline-offset: 2px; }
	.zs-focus {
		position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 999px; pointer-events: none;
		border: 2px solid #fff; box-shadow: 0 0 0 2px rgb(0 0 0 / .5), 0 0 12px rgb(0 0 0 / .6);
		transition: left .25s var(--ease-spring), top .25s var(--ease-spring);
	}
	.zs-hint { font-size: 11.5px; color: #6b7280; margin-top: 6px; }
	.zs-hint.warn { color: #fbbf24; }
	.zs-error { font-size: 12px; color: #f87171; margin-top: 6px; }
	.zs-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
	.zs-btn {
		padding: 7px 12px; border-radius: 8px; font-size: 13px; cursor: pointer;
		background: #1f2937; border: 1px solid #374151; color: #e5e7eb;
	}
	.zs-btn:hover:not(:disabled) { border-color: #4b5563; }
	.zs-btn.ghost { background: transparent; }
	.zs-btn:disabled { opacity: .4; cursor: default; }
	.zs-btn:focus-visible, .zs-btn:focus-within { outline: 2px solid var(--zs); outline-offset: 2px; }

	.zs-fonts { display: grid; grid-template-columns: repeat(auto-fill, minmax(76px, 1fr)); gap: 6px; }
	.zs-font {
		display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 4px; border-radius: 10px; cursor: pointer;
		background: #111827; border: 1px solid #1f2937; color: #9ca3af; font-size: 11px;
	}
	.zs-font span { font-size: 18px; color: #f3f4f6; line-height: 1.2; }
	.zs-font.system span  { font-family: -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }
	.zs-font.rounded span { font-family: ui-rounded, 'SF Pro Rounded', system-ui, sans-serif; }
	.zs-font.serif span   { font-family: ui-serif, Georgia, serif; }
	.zs-font.mono span    { font-family: ui-monospace, Menlo, monospace; }
	.zs-font:hover { border-color: #374151; }
	.zs-font.on { border-color: var(--zs); box-shadow: 0 0 0 1px var(--zs); color: #e5e7eb; }
	.zs-font:focus-visible { outline: 2px solid var(--zs); outline-offset: 2px; }

	.zs-foot { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 14px; border-top: 1px solid #1f2937; }
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	@media (prefers-reduced-motion: reduce) { .zs-sw, .zs-focus { transition: none; } }
</style>
