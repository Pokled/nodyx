<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	type Category = 'subs' | 'bits' | 'raids' | 'chatters'
	type Period   = 'session' | '7d' | '30d' | 'all'
	type Theme    = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type CustomTheme = { bgColor?: string | null; textColor?: string | null }

	type Config = {
		category:      Category
		period:        Period
		topN:          number
		showOnOffline: boolean
		theme:         Theme
		customTheme:   CustomTheme
	}

	interface Props {
		token:      string
		overlayId:  string
		initial:    Record<string, unknown> | null
		onSaved?:   () => void
	}

	let { token, overlayId, initial, onSaved }: Props = $props()

	const DEFAULTS: Config = {
		category:      'subs',
		period:        '7d',
		topN:          10,
		showOnOffline: true,
		theme:         'cyber',
		customTheme:   { bgColor: null, textColor: null },
	}
	const VALID_CATEGORIES = ['subs', 'bits', 'raids', 'chatters'] as const
	const VALID_PERIODS    = ['session', '7d', '30d', 'all']        as const
	const VALID_THEMES     = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom'] as const

	function merge(raw: Record<string, unknown> | null): Config {
		const cfg = raw ?? {}
		const ct  = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		return {
			category: (VALID_CATEGORIES as readonly string[]).includes(cfg.category as string)
				? cfg.category as Category : DEFAULTS.category,
			period: (VALID_PERIODS as readonly string[]).includes(cfg.period as string)
				? cfg.period as Period : DEFAULTS.period,
			topN: typeof cfg.topN === 'number' && cfg.topN >= 3 && cfg.topN <= 20
				? Math.floor(cfg.topN) : DEFAULTS.topN,
			showOnOffline: typeof cfg.showOnOffline === 'boolean' ? cfg.showOnOffline : DEFAULTS.showOnOffline,
			theme: (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
				? cfg.theme as Theme : DEFAULTS.theme,
			customTheme: {
				bgColor:   typeof ct.bgColor   === 'string' ? ct.bgColor   : null,
				textColor: typeof ct.textColor === 'string' ? ct.textColor : null,
			},
		}
	}

	let config = $state<Config>(merge(initial))
	let saving = $state(false)
	let toast  = $state<{ text: string; ok: boolean } | null>(null)

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3000)
	}

	async function save(): Promise<void> {
		if (saving) return
		saving = true
		try {
			const res = await apiFetch(fetch, `/streamer/overlays/${overlayId}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ config }),
			})
			if (res.ok) { flash(tFn('ovcfg.saved_refreshed'), true); onSaved?.() }
			else         flash(tFn('ovcfg.err_save'), false)
		} catch {
			flash(tFn('ovcfg.err_network'), false)
		} finally {
			saving = false
		}
	}

	const CATEGORY_META: Record<Category, { labelKey: string; descKey: string }> = {
		subs:     { labelKey: 'lb.cat_subs_label',     descKey: 'lb.cat_subs_desc' },
		bits:     { labelKey: 'lb.cat_bits_label',     descKey: 'lb.cat_bits_desc' },
		raids:    { labelKey: 'lb.cat_raids_label',    descKey: 'lb.cat_raids_desc' },
		chatters: { labelKey: 'lb.cat_chatters_label', descKey: 'lb.cat_chatters_desc' },
	}
	const PERIOD_META: Record<Period, string> = {
		session: 'lb.period_session_desc',
		'7d':    'lb.period_7d_desc',
		'30d':   'lb.period_30d_desc',
		all:     'lb.period_all_desc',
	}
	const THEME_META: Record<Theme, { label: string; tagKey: string }> = {
		cyber:   { label: 'Cyber',   tagKey: 'lb.tag_cyber' },
		soft:    { label: 'Soft',    tagKey: 'lb.tag_soft' },
		retro:   { label: 'Retro',   tagKey: 'lb.tag_retro' },
		neon:    { label: 'Neon',    tagKey: 'lb.tag_neon' },
		minimal: { label: 'Minimal', tagKey: 'lb.tag_minimal' },
		custom:  { label: 'Custom',  tagKey: 'lb.tag_custom' },
	}
</script>

<div class="rounded-lg border border-slate-700/40 bg-slate-950/60 p-4 space-y-4 mt-3">
	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Category picker -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">{tFn('lb.category_title')}</div>
		<div class="grid grid-cols-2 gap-2">
			{#each Object.entries(CATEGORY_META) as [k, m] (k)}
				{@const isActive = config.category === k}
				<button type="button" onclick={() => config.category = k as Category}
					class="text-left rounded-lg border p-3 transition-colors
						{isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<div class="text-sm font-semibold {isActive ? 'text-cyan-200' : 'text-slate-200'}">{tFn(m.labelKey)}</div>
					<div class="text-[10px] text-slate-500 mt-0.5 leading-snug">{tFn(m.descKey)}</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Period + topN + showOnOffline -->
	<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
		<div>
			<label for="lb-period" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('lb.period_label')}</label>
			<select id="lb-period" bind:value={config.period}
				class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors">
				<option value="session">{tFn('lb.period_session_opt')}</option>
				<option value="7d">{tFn('lb.period_7d_opt')}</option>
				<option value="30d">{tFn('lb.period_30d_opt')}</option>
				<option value="all">{tFn('lb.period_all_opt')}</option>
			</select>
			<div class="text-[10px] text-slate-500 mt-1">{PERIOD_META[config.period]}</div>
		</div>
		<div>
			<label for="lb-topn" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">
				{tFn('lb.depth_label')} <span class="text-cyan-300 font-mono">top {config.topN}</span>
			</label>
			<input id="lb-topn" type="range" min="3" max="20" step="1" bind:value={config.topN}
				class="w-full accent-cyan-500"/>
			<div class="flex justify-between text-[10px] text-slate-600 font-mono mt-0.5"><span>{tFn('lb.depth_min')}</span><span>20</span></div>
		</div>
		<label class="flex items-start gap-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 cursor-pointer hover:border-slate-600/80">
			<input type="checkbox" bind:checked={config.showOnOffline} class="mt-1 accent-cyan-500"/>
			<div>
				<div class="text-sm font-medium text-white">{tFn('lb.recap_title')}</div>
				<div class="text-[10px] text-slate-500 leading-snug">{tFn('lb.recap_desc_1')} <code class="font-mono text-[10px]">stream.offline</code> {tFn('lb.recap_desc_2')}</div>
			</div>
		</label>
	</div>

	<!-- Theme picker (sans preview pour l'instant — leaderboard est trop visuel pour une mini-preview à scale 0.5) -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">{tFn('ovcfg.theme')}</div>
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
			{#each Object.entries(THEME_META) as [k, m] (k)}
				{@const isActive = config.theme === k}
				<button type="button" onclick={() => config.theme = k as Theme}
					class="text-left rounded-lg border p-3 transition-colors
						{isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<div class="text-sm font-semibold {isActive ? 'text-cyan-200' : 'text-slate-200'}">{m.label}</div>
					<div class="text-[10px] text-slate-500 mt-0.5 leading-snug">{tFn(m.tagKey)}</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Custom theme panel -->
	{#if config.theme === 'custom'}
		<div class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
			<div class="text-[11px] uppercase tracking-widest font-semibold text-cyan-400">{tFn('ovcfg.custom_params')}</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('goal.custom_card_bg')}</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.bgColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.bgColor} placeholder={tFn('ovcfg.ph_bg')}
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('ovcfg.text_color')}</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.textColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.textColor} placeholder={tFn('ovcfg.ph_text')}
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
			</div>
		</div>
	{/if}

	<button type="button" onclick={save} disabled={saving}
		class="w-full rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2 text-sm transition-colors">
		{saving ? tFn('ovcfg.saving') : tFn('ovcfg.save_config')}
	</button>
</div>
