<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'
	import GoalBarThemePreview from './GoalBarThemePreview.svelte'

	const tFn = $derived($t)

	type GoalType = 'followers_total' | 'subs_session' | 'bits_session' | 'custom'
	type GoalTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type CustomTheme = {
		bgColor?:    string | null
		textColor?:  string | null
		barBgColor?: string | null
	}
	type GoalConfig = {
		goalType:      GoalType
		target:        number
		label:         string
		accentColor:   string
		customCurrent: number
		theme:         GoalTheme
		customTheme:   CustomTheme
	}

	interface Props {
		token:      string
		overlayId:  string
		initial:    Record<string, unknown> | null
		onSaved?:   () => void
	}

	let { token, overlayId, initial, onSaved }: Props = $props()

	const DEFAULTS: GoalConfig = {
		goalType:      'followers_total',
		target:        100,
		label:         'Objectif followers',
		accentColor:   '#06b6d4',
		customCurrent: 0,
		theme:         'cyber',
		customTheme:   { bgColor: null, textColor: null, barBgColor: null },
	}

	const VALID_GOAL_TYPES = ['followers_total', 'subs_session', 'bits_session', 'custom'] as const
	const VALID_THEMES     = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom'] as const

	function merge(raw: Record<string, unknown> | null): GoalConfig {
		const cfg = raw ?? {}
		const ct  = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		return {
			goalType: (VALID_GOAL_TYPES as readonly string[]).includes(cfg.goalType as string)
				? cfg.goalType as GoalType : DEFAULTS.goalType,
			target: typeof cfg.target === 'number' && cfg.target > 0
				? Math.min(1_000_000_000, cfg.target) : DEFAULTS.target,
			label: typeof cfg.label === 'string' && cfg.label.trim().length > 0
				? cfg.label.slice(0, 80) : DEFAULTS.label,
			accentColor: typeof cfg.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cfg.accentColor)
				? cfg.accentColor : DEFAULTS.accentColor,
			customCurrent: typeof cfg.customCurrent === 'number' && cfg.customCurrent >= 0
				? cfg.customCurrent : DEFAULTS.customCurrent,
			theme: (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
				? cfg.theme as GoalTheme : DEFAULTS.theme,
			customTheme: {
				bgColor:    typeof ct.bgColor    === 'string' ? ct.bgColor    : null,
				textColor:  typeof ct.textColor  === 'string' ? ct.textColor  : null,
				barBgColor: typeof ct.barBgColor === 'string' ? ct.barBgColor : null,
			},
		}
	}

	let config = $state<GoalConfig>(merge(initial))
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
			if (res.ok) {
				flash(tFn('goal.saved'), true)
				onSaved?.()
			} else flash(tFn('ovcfg.err_save'), false)
		} catch {
			flash(tFn('ovcfg.err_network'), false)
		} finally {
			saving = false
		}
	}

	const THEME_META: Record<GoalTheme, { label: string; tagKey: string }> = {
		cyber:   { label: 'Cyber',   tagKey: 'goal.tag_cyber' },
		soft:    { label: 'Soft',    tagKey: 'goal.tag_soft' },
		retro:   { label: 'Retro',   tagKey: 'goal.tag_retro' },
		neon:    { label: 'Neon',    tagKey: 'goal.tag_neon' },
		minimal: { label: 'Minimal', tagKey: 'goal.tag_minimal' },
		custom:  { label: 'Custom',  tagKey: 'goal.tag_custom' },
	}

	const GOAL_META: Record<GoalType, { labelKey: string; descKey: string }> = {
		followers_total: { labelKey: 'goal.gt_followers_label', descKey: 'goal.gt_followers_desc' },
		subs_session:    { labelKey: 'goal.gt_subs_label',      descKey: 'goal.gt_subs_desc' },
		bits_session:    { labelKey: 'goal.gt_bits_label',      descKey: 'goal.gt_bits_desc' },
		custom:          { labelKey: 'goal.gt_custom_label',    descKey: 'goal.gt_custom_desc' },
	}
</script>

<div class="rounded-lg border border-slate-700/40 bg-slate-950/60 p-4 space-y-4 mt-3">
	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Theme picker avec preview live -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">{tFn('ovcfg.theme')}</div>
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
			{#each Object.entries(THEME_META) as [k, m] (k)}
				{@const isActive = config.theme === k}
				<button type="button" onclick={() => config.theme = k as GoalTheme}
					class="text-left rounded-lg border p-2 transition-colors
						{isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<GoalBarThemePreview
						theme={k as GoalTheme}
						accent={config.accentColor}
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
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('goal.custom_text_color')}</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.textColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.textColor} placeholder={tFn('ovcfg.ph_text')}
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('goal.custom_bar_bg')}</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.barBgColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.barBgColor} placeholder={tFn('ovcfg.ph_barbg')}
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
			</div>
		</div>
	{/if}

	<!-- Goal type picker -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">{tFn('goal.goal_type_title')}</div>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
			{#each Object.entries(GOAL_META) as [k, m] (k)}
				{@const isActive = config.goalType === k}
				<button type="button" onclick={() => config.goalType = k as GoalType}
					class="text-left rounded-lg border p-3 transition-colors
						{isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<div class="text-sm font-semibold {isActive ? 'text-cyan-200' : 'text-slate-200'}">{tFn(m.labelKey)}</div>
					<div class="text-[10px] text-slate-500 mt-0.5 leading-snug">{tFn(m.descKey)}</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Label + target + accent -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		<div>
			<label for="goal-label" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('goal.label_shown')}</label>
			<input id="goal-label" type="text" bind:value={config.label} maxlength="80"
				placeholder={tFn('goal.label_ph')}
				class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors"/>
		</div>
		<div>
			<label for="goal-target" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('goal.target')}</label>
			<input id="goal-target" type="number" bind:value={config.target} min="1" max="1000000000" step="1"
				class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors font-mono"/>
		</div>
		<div>
			<label for="goal-accent" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('goal.accent_color')}</label>
			<div class="flex gap-1.5">
				<input id="goal-accent" type="color" bind:value={config.accentColor}
					class="w-10 h-10 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
				<input type="text" bind:value={config.accentColor} placeholder={tFn('goal.accent_ph')} maxlength="7"
					class="flex-1 rounded-lg bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors font-mono"/>
			</div>
		</div>
		{#if config.goalType === 'custom'}
			<div>
				<label for="goal-current" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">
					{tFn('goal.current_value')} <span class="text-cyan-300 font-mono">({Math.min(100, Math.round((config.customCurrent / Math.max(1, config.target)) * 100))}%)</span>
				</label>
				<input id="goal-current" type="number" bind:value={config.customCurrent} min="0" step="1"
					class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors font-mono"/>
			</div>
		{/if}
	</div>

	<button type="button" onclick={save} disabled={saving}
		class="w-full rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2 text-sm transition-colors">
		{saving ? tFn('ovcfg.saving') : tFn('ovcfg.save_config')}
	</button>
</div>
