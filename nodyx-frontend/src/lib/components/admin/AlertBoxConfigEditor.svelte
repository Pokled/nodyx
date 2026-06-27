<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import AlertThemePreview from './AlertThemePreview.svelte'
	import MediaSoundPicker  from './MediaSoundPicker.svelte'
	import Tooltip           from '$lib/components/ui/Tooltip.svelte'
	import { PRESET_LIBRARY, isPresetUrl, playPreset, presetUrl, presetKeyOf, type PresetKey } from '$lib/sounds/presetSounds'

	type AlertTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'holographic' | 'minimal' | 'custom'
	type AlertPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'
	type AlertAnimation = 'slide-right' | 'slide-left' | 'slide-top' | 'slide-bottom' | 'scale' | 'bounce' | 'fade'
	type AlertEventKey =
		| 'channel.follow' | 'channel.subscribe' | 'channel.subscription.gift'
		| 'channel.cheer'  | 'channel.raid'
	type AlertEventCfg = { enabled: boolean; template: string; iconUrl?: string | null; soundUrl?: string | null }
	type CustomTheme = {
		bgImageUrl?:  string | null
		bgColor?:     string | null
		accentColor?: string | null
		textColor?:   string | null
	}
	type AlertConfig = {
		theme:        AlertTheme
		position:     AlertPosition
		animation:    AlertAnimation
		durationMs:   number
		soundVolume:  number
		events:       Record<AlertEventKey, AlertEventCfg>
		customTheme:  CustomTheme
	}

	interface Props {
		token:      string
		overlayId:  string
		initial:    Record<string, unknown> | null
		onSaved?:   () => void
	}

	let { token, overlayId, initial, onSaved }: Props = $props()

	const VALID_THEMES     = ['cyber', 'soft', 'retro', 'neon', 'holographic', 'minimal', 'custom'] as const
	const VALID_POSITIONS  = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center'] as const
	const VALID_ANIMATIONS = ['slide-right', 'slide-left', 'slide-top', 'slide-bottom', 'scale', 'bounce', 'fade'] as const

	const DEFAULTS: AlertConfig = {
		theme:       'cyber',
		position:    'top-right',
		animation:   'slide-right',
		durationMs:  5000,
		soundVolume: 0.6,
		events: {
			'channel.follow':            { enabled: true, template: '{user_name} a follow !',                                         iconUrl: null, soundUrl: null },
			'channel.subscribe':         { enabled: true, template: '{user_name} s\'abonne (tier {tier}) !',                          iconUrl: null, soundUrl: null },
			'channel.subscription.gift': { enabled: true, template: '{user_name} offre {total} sub{total_plural} !',                   iconUrl: null, soundUrl: null },
			'channel.cheer':             { enabled: true, template: '{user_name} envoie {bits} bits !',                               iconUrl: null, soundUrl: null },
			'channel.raid':              { enabled: true, template: 'Raid de {from_broadcaster_user_name} avec {viewers} viewers !', iconUrl: null, soundUrl: null },
		},
		customTheme: { bgImageUrl: null, bgColor: null, accentColor: null, textColor: null },
	}

	function merge(raw: Record<string, unknown> | null): AlertConfig {
		const cfg = raw ?? {}
		const events = JSON.parse(JSON.stringify(DEFAULTS.events)) as AlertConfig['events']
		const rawEvents = (cfg.events ?? {}) as Record<string, Partial<AlertEventCfg>>
		for (const k of Object.keys(events) as AlertEventKey[]) {
			const inc = rawEvents[k]
			if (inc) events[k] = {
				enabled:  typeof inc.enabled  === 'boolean' ? inc.enabled  : events[k].enabled,
				template: typeof inc.template === 'string'  ? inc.template : events[k].template,
				iconUrl:  typeof inc.iconUrl  === 'string'  ? inc.iconUrl  : null,
				soundUrl: typeof inc.soundUrl === 'string'  ? inc.soundUrl : null,
			}
		}
		const theme = (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
			? cfg.theme as AlertTheme : DEFAULTS.theme
		const position = (VALID_POSITIONS as readonly string[]).includes(cfg.position as string)
			? cfg.position as AlertPosition : DEFAULTS.position
		const animation = (VALID_ANIMATIONS as readonly string[]).includes(cfg.animation as string)
			? cfg.animation as AlertAnimation : DEFAULTS.animation
		const durationMs = typeof cfg.durationMs === 'number' && cfg.durationMs >= 1000 && cfg.durationMs <= 30000
			? cfg.durationMs : DEFAULTS.durationMs
		const soundVolume = typeof cfg.soundVolume === 'number' && cfg.soundVolume >= 0 && cfg.soundVolume <= 1
			? cfg.soundVolume : DEFAULTS.soundVolume
		const ct = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		const customTheme: CustomTheme = {
			bgImageUrl:  typeof ct.bgImageUrl  === 'string' ? ct.bgImageUrl  : null,
			bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
			accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
			textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
		}
		return { theme, position, animation, durationMs, soundVolume, events, customTheme }
	}

	let config = $state<AlertConfig>(merge(initial))
	let saving = $state(false)
	let firing = $state<string | null>(null)
	let toast  = $state<{ text: string; ok: boolean } | null>(null)

	// Picker médiathèque : on garde l'event key courant pour savoir où placer
	// l'URL sélectionnée.
	let pickerOpen      = $state(false)
	let pickerTargetKey = $state<AlertEventKey | null>(null)

	function openPickerFor(key: AlertEventKey): void {
		pickerTargetKey = key
		pickerOpen      = true
	}
	function onPickSound(url: string, _label: string): void {
		if (!pickerTargetKey) return
		config.events[pickerTargetKey].soundUrl = url
	}

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
				flash('Config sauvegardée. L\'overlay applique automatiquement.', true)
				onSaved?.()
			} else flash('Échec de la sauvegarde.', false)
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			saving = false
		}
	}

	function previewSound(url: string | null | undefined): void {
		if (!url) return

		// Cas spécial : preset Nodyx synthétisé en WebAudio (zéro réseau, zéro
		// fichier). Court-circuit avant les checks mixed-content / Audio API.
		if (isPresetUrl(url)) {
			playPreset(presetKeyOf(url)!, Math.min(1, Math.max(0, config.soundVolume)))
			return
		}

		// Détection précoce : mixed-content. Si Nodyx est en HTTPS et le son
		// en HTTP, le navigateur bloque silencieusement.
		if (typeof window !== 'undefined'
			&& window.location.protocol === 'https:'
			&& url.startsWith('http://')) {
			flash('URL en HTTP bloquée car Nodyx est en HTTPS. Utilise une URL https://...', false)
			return
		}

		try {
			const audio = new Audio(url)
			audio.volume = Math.min(1, Math.max(0, config.soundVolume))
			// Pas de crossOrigin : on a juste besoin de lire l'audio, pas de
			// l'inspecter via Web Audio API. Sans crossOrigin, le browser
			// accepte n'importe quelle origine. AVEC, il exige les headers
			// CORS que la plupart des hosts publics n'envoient pas.

			// Erreur de chargement (404, codec, CORS strict, etc) — vient via
			// l'event "error" sur l'élément Audio, pas via le reject de play().
			audio.addEventListener('error', () => {
				const me = audio.error
				const code = me?.code
				const reason =
					code === MediaError.MEDIA_ERR_NETWORK   ? 'erreur réseau (URL inaccessible ?)'
					: code === MediaError.MEDIA_ERR_DECODE  ? 'fichier corrompu ou codec non supporté'
					: code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED ? 'format non supporté (essaye un mp3 ou wav standard)'
					: code === MediaError.MEDIA_ERR_ABORTED ? 'lecture annulée'
					: 'origine bloquée ou URL invalide'
				flash(`Son injouable : ${reason}.`, false)
			}, { once: true })

			audio.play().catch((err: DOMException) => {
				const name = err?.name ?? ''
				const reason =
					name === 'NotAllowedError'    ? 'autoplay bloqué (clique d\'abord sur la page)'
					: name === 'NotSupportedError' ? 'format non supporté par le navigateur'
					: name === 'AbortError'        ? 'lecture annulée'
					: err?.message?.slice(0, 80) || 'raison inconnue'
				flash(`Son injouable : ${reason}.`, false)
			})
		} catch (err) {
			flash(`URL son invalide : ${(err as Error).message?.slice(0, 80) ?? 'parsing échoué'}.`, false)
		}
	}

	async function testFire(evtType: AlertEventKey): Promise<void> {
		if (firing) return
		firing = evtType
		try {
			const res = await apiFetch(fetch, `/streamer/overlays/${overlayId}/test-fire`, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ eventType: evtType }),
			})
			if (res.ok) flash('Event factice envoyé. Vérifie l\'overlay.', true)
			else flash('Test-fire échoué.', false)
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			firing = null
		}
	}

	const EVENT_META: Record<AlertEventKey, { label: string; accent: string; vars: string[] }> = {
		'channel.follow':            { label: 'Follow',     accent: '#06b6d4', vars: ['user_name', 'user_login'] },
		'channel.subscribe':         { label: 'Subscribe',  accent: '#a855f7', vars: ['user_name', 'tier'] },
		'channel.subscription.gift': { label: 'Gift sub',   accent: '#ec4899', vars: ['user_name', 'total', 'total_plural'] },
		'channel.cheer':             { label: 'Bits',       accent: '#f59e0b', vars: ['user_name', 'bits'] },
		'channel.raid':              { label: 'Raid',       accent: '#ef4444', vars: ['from_broadcaster_user_name', 'viewers'] },
	}

	const THEME_META: Record<AlertTheme, { label: string; tagline: string }> = {
		cyber:        { label: 'Cyber',        tagline: 'Sombre · accent gradient · style Nodyx' },
		soft:         { label: 'Soft',         tagline: 'Blanc rond · doux · glassmorphism' },
		retro:        { label: 'Retro',        tagline: 'Pixel · gras · contour épais' },
		neon:         { label: 'Neon',         tagline: 'Glow pulsant · couleur saturée' },
		holographic:  { label: 'Holographic',  tagline: 'Gradient iridescent animé' },
		minimal:      { label: 'Minimal',      tagline: 'Texte seul · gros gras · ombre' },
		custom:       { label: 'Custom',       tagline: 'Tes propres images et couleurs' },
	}
</script>

<div class="rounded-lg border border-slate-700/40 bg-slate-950/60 p-4 space-y-4 mt-3">
	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Theme picker avec preview live de chaque thème -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">Thème</div>
		<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
			{#each Object.entries(THEME_META) as [k, m] (k)}
				{@const isActive = config.theme === k}
				<button type="button" onclick={() => config.theme = k as AlertTheme}
					class="text-left rounded-lg border p-2 transition-colors {isActive ? 'border-cyan-500/60 bg-cyan-500/10' : 'border-slate-700/60 bg-slate-900/50 hover:border-slate-600/80'}">
					<AlertThemePreview
						theme={k as AlertTheme}
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

	<!-- Custom theme panel (apparait uniquement si theme = custom) -->
	{#if config.theme === 'custom'}
		<div class="rounded-lg border border-slate-700/60 bg-slate-900/40 p-3 space-y-3">
			<div class="text-[11px] uppercase tracking-widest font-semibold text-cyan-400">Paramètres custom</div>
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">URL image de fond</span>
					<input type="url" bind:value={config.customTheme.bgImageUrl}
						placeholder="https://exemple.com/bg.png"
						class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Couleur de fond (fallback)</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.bgColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.bgColor} placeholder="#0f172a"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Couleur d'accent</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.accentColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.accentColor} placeholder="var(--nx-cyan)"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
				<label class="block">
					<span class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">Couleur du texte</span>
					<div class="flex gap-1.5">
						<input type="color" bind:value={config.customTheme.textColor}
							class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
						<input type="text" bind:value={config.customTheme.textColor} placeholder="#f1f5f9"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-xs text-white placeholder-slate-700 outline-none font-mono transition-colors"/>
					</div>
				</label>
			</div>
			<div class="text-[10px] text-slate-500 leading-relaxed">
				Conseil : héberge tes images sur Nodyx (galerie, post) ou n'importe quel CDN en HTTPS (Imgur, Cloudinary, etc). Le PNG/WebP transparent est idéal pour superposer sur ton stream.
			</div>
		</div>
	{/if}

	<!-- Position + Animation + Duration grouped -->
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
						{@const p = pos as AlertPosition}
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
			<label for="alert-animation" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">Animation d'entrée</label>
			<select id="alert-animation" bind:value={config.animation}
				class="w-full rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-3 py-2 text-sm text-white outline-none transition-colors">
				<option value="slide-right">Slide depuis la droite</option>
				<option value="slide-left">Slide depuis la gauche</option>
				<option value="slide-top">Slide depuis le haut</option>
				<option value="slide-bottom">Slide depuis le bas</option>
				<option value="scale">Scale (zoom doux)</option>
				<option value="bounce">Bounce (rebond)</option>
				<option value="fade">Fade (apparition simple)</option>
			</select>
		</div>
	</div>

	<!-- Duration + Volume -->
	<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
		<div>
			<label for="alert-duration" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">
				Durée : <span class="text-cyan-300 font-mono">{(config.durationMs / 1000).toFixed(1)}s</span>
			</label>
			<input id="alert-duration" type="range" min="1000" max="15000" step="500" bind:value={config.durationMs}
				class="w-full accent-cyan-500"/>
			<div class="flex justify-between text-[10px] text-slate-600 font-mono mt-0.5"><span>1s</span><span>15s</span></div>
		</div>
		<div>
			<label for="alert-volume" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">
				Volume sons : <span class="text-cyan-300 font-mono">{Math.round(config.soundVolume * 100)}%</span>
			</label>
			<input id="alert-volume" type="range" min="0" max="1" step="0.05" bind:value={config.soundVolume}
				class="w-full accent-cyan-500"/>
			<div class="flex justify-between text-[10px] text-slate-600 font-mono mt-0.5"><span>0%</span><span>100%</span></div>
		</div>
	</div>

	<!-- Events -->
	<div>
		<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-2">Templates par type d'event</div>
		<div class="space-y-2">
			{#each Object.entries(EVENT_META) as [k, m] (k)}
				{@const key = k as AlertEventKey}
				{@const cfg = config.events[key]}
				<div class="rounded-lg border border-slate-700/40 bg-slate-900/50 p-3 space-y-2">
					<div class="flex items-center justify-between gap-2">
						<div class="flex items-center gap-2 flex-1 min-w-0">
							<span class="w-2.5 h-2.5 rounded-full shrink-0" style="background: {m.accent}"></span>
							<span class="text-sm font-medium text-white">{m.label}</span>
							<span class="text-[10px] text-slate-500 font-mono truncate">{key}</span>
						</div>
						<label class="flex items-center gap-1.5 cursor-pointer shrink-0">
							<input type="checkbox" bind:checked={config.events[key].enabled} class="accent-cyan-500"/>
							<span class="text-[11px] text-slate-400">{cfg.enabled ? 'Activé' : 'Désactivé'}</span>
						</label>
					</div>
					<input type="text" bind:value={config.events[key].template} maxlength="160"
						disabled={!cfg.enabled}
						placeholder="Template avec variables {'{user_name}'} etc"
						class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-40 font-mono"/>
					{#if config.theme === 'custom'}
						<div class="flex items-center gap-2">
							<input type="url" bind:value={config.events[key].iconUrl}
								disabled={!cfg.enabled}
								placeholder="URL icône custom pour cet event (optionnel)"
								class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-[11px] text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-40 font-mono"/>
							{#if cfg.iconUrl}
								<img src={cfg.iconUrl} alt="" class="w-8 h-8 rounded object-cover border border-slate-700/60" />
							{/if}
						</div>
					{/if}
					<!-- Bibliothèque de sons Nodyx (synthétisés WebAudio, zéro réseau) -->
					<div>
						<div class="flex items-center gap-1.5 mb-1">
							<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Son Nodyx</span>
							<Tooltip text="Bibliothèque de sons générés en pur WebAudio (aucun fichier téléchargé, fonctionne offline). Choisis un preset, ou laisse 'Aucun' pour utiliser uniquement ton URL custom ci-dessous."/>
						</div>
						<div class="flex flex-wrap gap-1">
							{#each PRESET_LIBRARY as p (p.key)}
								{@const isSelected = cfg.soundUrl === presetUrl(p.key) || (p.key === 'none' && !cfg.soundUrl)}
								<button type="button" disabled={!cfg.enabled}
									onclick={() => {
										if (p.key === 'none') config.events[key].soundUrl = null
										else {
											config.events[key].soundUrl = presetUrl(p.key)
											playPreset(p.key, Math.min(1, Math.max(0, config.soundVolume)))
										}
									}}
									title={p.hint}
									class="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-30
										{isSelected ? 'bg-cyan-500/25 border-cyan-500/60 text-cyan-100' : 'bg-slate-800/40 border-slate-700/60 text-slate-300 hover:bg-slate-700/60'}">
									<span>{p.emoji}</span>
									<span>{p.label}</span>
								</button>
							{/each}
						</div>
					</div>

					<!-- URL custom ou médiathèque -->
					<div class="flex items-center gap-2">
						<input type="url" value={isPresetUrl(config.events[key].soundUrl) ? '' : (config.events[key].soundUrl ?? '')}
							oninput={(e) => { config.events[key].soundUrl = e.currentTarget.value || null }}
							disabled={!cfg.enabled}
							placeholder="…ou URL son personnalisé (mp3 / wav) / médiathèque →"
							class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 focus:ring-2 focus:ring-cyan-500/20 px-2.5 py-1.5 text-[11px] text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-40 font-mono"/>
						<button type="button" onclick={() => openPickerFor(key)}
							disabled={!cfg.enabled}
							class="shrink-0 rounded bg-indigo-500/15 hover:bg-indigo-500/25 disabled:opacity-30 border border-indigo-500/40 text-indigo-200 px-2 py-1.5 text-[10px] font-medium transition-colors inline-flex items-center gap-1"
							title="Choisir depuis la médiathèque Nodyx">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
							Médiathèque
						</button>
						{#if cfg.soundUrl}
							<button type="button" onclick={() => previewSound(cfg.soundUrl)}
								class="shrink-0 rounded bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 text-slate-300 px-2 py-1.5 text-[10px] font-medium transition-colors inline-flex items-center gap-1"
								aria-label="Preview son">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/></svg>
								Preview
							</button>
						{/if}
					</div>
					<div class="flex items-center justify-between gap-2 text-[10px]">
						<div class="text-slate-500">
							Variables :
							{#each m.vars as v, i}
								<code class="font-mono text-cyan-400/80">{`{${v}}`}</code>{#if i < m.vars.length - 1}<span class="text-slate-700"> · </span>{/if}
							{/each}
						</div>
						<button type="button" onclick={() => testFire(key)} disabled={firing !== null || !cfg.enabled}
							class="rounded bg-amber-500/15 hover:bg-amber-500/25 disabled:opacity-30 border border-amber-500/40 text-amber-200 px-2 py-1 text-[10px] font-medium transition-colors inline-flex items-center gap-1">
							{#if firing === key}
								<svg class="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
								Test…
							{:else}
								<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/></svg>
								Tester
							{/if}
						</button>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<button type="button" onclick={save} disabled={saving}
		class="w-full rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 disabled:opacity-30 border border-cyan-500/40 text-cyan-200 font-medium px-4 py-2 text-sm transition-colors">
		{saving ? 'Sauvegarde…' : 'Sauvegarder la config'}
	</button>
</div>

<MediaSoundPicker
	token={token}
	open={pickerOpen}
	onPick={onPickSound}
	onClose={() => { pickerOpen = false; pickerTargetKey = null }}
/>
