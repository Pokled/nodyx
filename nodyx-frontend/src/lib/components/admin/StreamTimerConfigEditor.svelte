<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import StreamTimerThemePreview from './StreamTimerThemePreview.svelte'

	type Theme    = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type Position = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'
	type Format   = 'auto' | 'mm_ss' | 'h_mm_ss'
	type CustomTheme = { bgColor?: string | null; textColor?: string | null; accentColor?: string | null }

	type Config = {
		theme:        Theme
		position:     Position
		format:       Format
		customTheme:  CustomTheme
	}

	interface Props {
		token:      string
		overlayId:  string
		initial:    Record<string, unknown> | null
		onSaved?:   () => void
	}

	let { token, overlayId, initial, onSaved }: Props = $props()

	const VALID_THEMES    = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom'] as const
	const VALID_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center'] as const
	const VALID_FORMATS   = ['auto', 'mm_ss', 'h_mm_ss'] as const

	const DEFAULTS: Config = {
		theme:    'cyber',
		position: 'top-left',
		format:   'auto',
		customTheme: { bgColor: null, textColor: null, accentColor: null },
	}

	function merge(raw: Record<string, unknown> | null): Config {
		const cfg = raw ?? {}
		const ct  = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		return {
			theme: (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
				? cfg.theme as Theme : DEFAULTS.theme,
			position: (VALID_POSITIONS as readonly string[]).includes(cfg.position as string)
				? cfg.position as Position : DEFAULTS.position,
			format: (VALID_FORMATS as readonly string[]).includes(cfg.format as string)
				? cfg.format as Format : DEFAULTS.format,
			customTheme: {
				bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
				textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
				accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
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
			if (res.ok) { flash('Config sauvegardée. Overlay actualisée.', true); onSaved?.() }
			else         flash('Échec de la sauvegarde.', false)
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			saving = false
		}
	}

	const THEME_META: Record<Theme, { label: string; tagline: string }> = {
		cyber:   { label: 'Cyber',   tagline: 'Sombre · pillule subtle · default' },
		soft:    { label: 'Soft',    tagline: 'Blanc rond · doux' },
		retro:   { label: 'Retro',   tagline: 'Pixel VT323 · ombre dure' },
		neon:    { label: 'Neon',    tagline: 'Glow puissant · bord saturé' },
		minimal: { label: 'Minimal', tagline: 'Pas de card · gros gras avec ombre' },
		custom:  { label: 'Custom',  tagline: 'Tes couleurs : fond / texte / point' },
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
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">Thème</div>
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
			{#each Object.entries(THEME_META) as [k, m] (k)}
				{@const isActive = config.theme === k}
				<button type="button" onclick={() => config.theme = k as Theme}
					class="text-left rounded-lg border p-2 transition-colors
						{isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<StreamTimerThemePreview
						theme={k as Theme}
						customTheme={k === 'custom' ? config.customTheme : undefined}
					/>
					<div class="mt-2">
						<div class="text-xs font-semibold {isActive ? 'text-cyan-200' : 'text-slate-200'}">{m.label}</div>
						<div class="text-[10px] text-slate-500 mt-0.5 leading-snug">{m.tagline}</div>
					</div>
				</button>
			{/each}
		</div>
	</div>

	<!-- Custom theme panel -->
	{#if config.theme === 'custom'}
		<div class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
			<div class="text-[11px] uppercase tracking-widest font-semibold text-cyan-400">Paramètres custom</div>
			<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Fond</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.bgColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.bgColor} placeholder="#0f172a"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Texte</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.textColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.textColor} placeholder="#f1f5f9"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Point (accent)</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.accentColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.accentColor} placeholder="#f43f5e"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
			</div>
		</div>
	{/if}

	<!-- Position + Format -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		<div>
			<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">Position à l'écran</div>
			<div class="grid grid-cols-3 grid-rows-3 gap-1 p-1.5 rounded-lg bg-slate-950/60 border border-slate-700/40 aspect-[3/2]">
				{#each [
					['top-left',     'start', 'start'],
					[null,            null,    null  ],
					['top-right',    'end',   'start'],
					[null,            null,    null  ],
					['center',       'center','center'],
					[null,            null,    null  ],
					['bottom-left',  'start', 'end'  ],
					[null,            null,    null  ],
					['bottom-right', 'end',   'end'  ],
				] as [pos, hAlign, vAlign]}
					{#if pos === null}
						<div></div>
					{:else}
						{@const p = pos as Position}
						{@const isActive = config.position === p}
						<button type="button" onclick={() => config.position = p}
							title={p}
							class="rounded transition-colors flex p-1.5 justify-{hAlign} items-{vAlign}
								{isActive ? 'bg-cyan-500/15 border border-cyan-500/40' : 'bg-slate-900/40 border border-slate-700/40 hover:border-slate-600/60'}">
							<span class="w-3 h-1.5 rounded-sm {isActive ? 'bg-cyan-400' : 'bg-slate-600'}"></span>
						</button>
					{/if}
				{/each}
			</div>
		</div>
		<div>
			<label for="timer-format" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">Format</label>
			<select id="timer-format" bind:value={config.format}
				class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors">
				<option value="auto">Auto (mm:ss en dessous d'1h, h:mm:ss au-delà)</option>
				<option value="mm_ss">mm:ss uniquement</option>
				<option value="h_mm_ss">h:mm:ss toujours</option>
			</select>
		</div>
	</div>

	<button type="button" onclick={save} disabled={saving}
		class="w-full rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2 text-sm transition-colors">
		{saving ? 'Sauvegarde…' : 'Sauvegarder la config'}
	</button>
</div>
