<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import TickerThemePreview from './TickerThemePreview.svelte'

	const tFn = $derived($t)

	type TickerEventKey =
		| 'channel.follow' | 'channel.subscribe' | 'channel.subscription.gift'
		| 'channel.cheer'  | 'channel.raid'
	type TickerTheme  = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type TickerPeriod = 'recent' | 'session' | '24h'
	type CustomTheme  = { bgColor?: string | null; textColor?: string | null }
	type TickerConfig = {
		enabledEvents: TickerEventKey[]
		period:        TickerPeriod
		speedSeconds:  number
		weighted:      boolean
		combo:         boolean
		theme:         TickerTheme
		customTheme:   CustomTheme
	}

	interface Props {
		token:      string
		overlayId:  string
		initial:    Record<string, unknown> | null
		onSaved?:   () => void
	}

	let { token, overlayId, initial, onSaved }: Props = $props()

	const ALL_EVENTS: TickerEventKey[] = [
		'channel.follow', 'channel.subscribe', 'channel.subscription.gift',
		'channel.cheer', 'channel.raid',
	]
	const VALID_THEMES  = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom'] as const
	const VALID_PERIODS = ['recent', 'session', '24h'] as const

	const DEFAULTS: TickerConfig = {
		enabledEvents: [...ALL_EVENTS],
		period:        'recent',
		speedSeconds:  60,
		weighted:      true,
		combo:         true,
		theme:         'cyber',
		customTheme:   { bgColor: null, textColor: null },
	}

	function merge(raw: Record<string, unknown> | null): TickerConfig {
		const cfg = raw ?? {}
		const enabledEventsRaw = Array.isArray(cfg.enabledEvents) ? cfg.enabledEvents as unknown[] : null
		const enabledEvents = enabledEventsRaw
			? enabledEventsRaw.filter((e): e is TickerEventKey => ALL_EVENTS.includes(e as TickerEventKey))
			: [...DEFAULTS.enabledEvents]
		const period = (VALID_PERIODS as readonly string[]).includes(cfg.period as string)
			? cfg.period as TickerPeriod : DEFAULTS.period
		const speedSeconds = typeof cfg.speedSeconds === 'number' && cfg.speedSeconds >= 20 && cfg.speedSeconds <= 180
			? cfg.speedSeconds : DEFAULTS.speedSeconds
		const theme = (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
			? cfg.theme as TickerTheme : DEFAULTS.theme
		const ct = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		return {
			enabledEvents,
			period,
			speedSeconds,
			weighted: typeof cfg.weighted === 'boolean' ? cfg.weighted : DEFAULTS.weighted,
			combo:    typeof cfg.combo    === 'boolean' ? cfg.combo    : DEFAULTS.combo,
			theme,
			customTheme: {
				bgColor:   typeof ct.bgColor   === 'string' ? ct.bgColor   : null,
				textColor: typeof ct.textColor === 'string' ? ct.textColor : null,
			},
		}
	}

	let config = $state<TickerConfig>(merge(initial))
	let saving = $state(false)
	let toast  = $state<{ text: string; ok: boolean } | null>(null)

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3000)
	}

	function toggleEvent(key: TickerEventKey): void {
		if (config.enabledEvents.includes(key)) {
			config.enabledEvents = config.enabledEvents.filter(e => e !== key)
		} else {
			config.enabledEvents = [...config.enabledEvents, key]
		}
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
			if (res.ok) {
				flash(tFn('ticker.saved'), true)
				onSaved?.()
			} else flash(tFn('ovcfg.err_save'), false)
		} catch {
			flash(tFn('ovcfg.err_network'), false)
		} finally {
			saving = false
		}
	}

	const EVENT_META: Record<TickerEventKey, { label: string; accent: string }> = {
		'channel.follow':            { label: 'Follow',     accent: '#06b6d4' },
		'channel.subscribe':         { label: 'Sub',        accent: '#a855f7' },
		'channel.subscription.gift': { label: 'Gift sub',   accent: '#ec4899' },
		'channel.cheer':             { label: 'Bits',       accent: '#f59e0b' },
		'channel.raid':              { label: 'Raid',       accent: '#ef4444' },
	}

	const THEME_META: Record<TickerTheme, { label: string; tagKey: string }> = {
		cyber:   { label: 'Cyber',   tagKey: 'ticker.tag_cyber' },
		soft:    { label: 'Soft',    tagKey: 'ticker.tag_soft' },
		retro:   { label: 'Retro',   tagKey: 'ticker.tag_retro' },
		neon:    { label: 'Neon',    tagKey: 'ticker.tag_neon' },
		minimal: { label: 'Minimal', tagKey: 'ticker.tag_minimal' },
		custom:  { label: 'Custom',  tagKey: 'ticker.tag_custom' },
	}

	const PERIOD_META: Record<TickerPeriod, string> = {
		recent:  'ticker.period_recent_desc',
		session: 'ticker.period_session_desc',
		'24h':   'ticker.period_24h_desc',
	}
</script>

<div class="rounded-lg border border-slate-700/40 bg-slate-950/60 p-4 space-y-4 mt-3">
	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Theme picker -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">{tFn('ovcfg.theme')}</div>
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
			{#each Object.entries(THEME_META) as [k, m] (k)}
				{@const isActive = config.theme === k}
				<button type="button" onclick={() => config.theme = k as TickerTheme}
					class="text-left rounded-lg border p-2 transition-colors
						{isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<TickerThemePreview
						theme={k as TickerTheme}
						customTheme={k === 'custom' ? config.customTheme : undefined}
					/>
					<div class="mt-2">
						<div class="text-xs font-semibold {isActive ? 'text-cyan-200' : 'text-slate-200'}">{m.label}</div>
						<div class="text-[10px] text-slate-500 mt-0.5 leading-snug">{tFn(m.tagKey)}</div>
					</div>
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
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('ticker.custom_band_bg')}</span>
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

	<!-- Events filter -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">{tFn('ticker.events_title')}</div>
		<div class="flex flex-wrap gap-2">
			{#each Object.entries(EVENT_META) as [k, m] (k)}
				{@const key = k as TickerEventKey}
				{@const isOn = config.enabledEvents.includes(key)}
				<button type="button" onclick={() => toggleEvent(key)}
					class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border
						{isOn ? 'bg-slate-800 text-white border-slate-600' : 'bg-slate-900/50 text-slate-500 border-slate-700/40 line-through'}">
					<span class="w-2 h-2 rounded-full" style="background: {m.accent}; opacity: {isOn ? 1 : 0.3}"></span>
					{m.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Period + speed -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		<div>
			<label for="ticker-period" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('ticker.period_label')}</label>
			<select id="ticker-period" bind:value={config.period}
				class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors">
				<option value="recent">{tFn('ticker.period_recent_opt')}</option>
				<option value="session">{tFn('ticker.period_session_opt')}</option>
				<option value="24h">{tFn('ticker.period_24h_opt')}</option>
			</select>
			<div class="text-[10px] text-slate-500 mt-1">{PERIOD_META[config.period]}</div>
		</div>
		<div>
			<label for="ticker-speed" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">
				{tFn('ticker.speed_label')} <span class="text-cyan-300 font-mono">{config.speedSeconds}s</span>
			</label>
			<input id="ticker-speed" type="range" min="20" max="180" step="5" bind:value={config.speedSeconds}
				class="w-full accent-cyan-500"/>
			<div class="flex justify-between text-[10px] text-slate-600 font-mono mt-0.5"><span>{tFn('ticker.speed_fast')}</span><span>{tFn('ticker.speed_slow')}</span></div>
		</div>
	</div>

	<!-- Toggles -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		<label class="flex items-start gap-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 cursor-pointer hover:border-slate-600/80">
			<input type="checkbox" bind:checked={config.weighted} class="mt-1 accent-cyan-500"/>
			<div>
				<div class="text-sm font-medium text-white">Event weight</div>
				<div class="text-[10px] text-slate-500 leading-snug">{tFn('ticker.weight_desc')}</div>
			</div>
		</label>
		<label class="flex items-start gap-3 rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 cursor-pointer hover:border-slate-600/80">
			<input type="checkbox" bind:checked={config.combo} class="mt-1 accent-cyan-500"/>
			<div>
				<div class="text-sm font-medium text-white">Combo detection</div>
				<div class="text-[10px] text-slate-500 leading-snug">{tFn('ticker.combo_desc')}</div>
			</div>
		</label>
	</div>

	<button type="button" onclick={save} disabled={saving}
		class="w-full rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2 text-sm transition-colors">
		{saving ? tFn('ovcfg.saving') : tFn('ovcfg.save_config')}
	</button>
</div>
