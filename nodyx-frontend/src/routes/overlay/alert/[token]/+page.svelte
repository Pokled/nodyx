<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fly, fade, scale } from 'svelte/transition'
	import { backOut, cubicOut } from 'svelte/easing'
	import { playAlertSound } from '$lib/sounds/presetSounds'

	// Page transparente conçue pour être collée comme Browser Source dans OBS.
	// Le token dans l'URL EST l'auth : il bootstrappe la config via REST et
	// ouvre la socket overlay namespace. Le rendu suit le `theme` configuré
	// par l'admin et substitue les variables `{user_name}`, `{bits}`, etc.
	// dans les templates par event type.

	const token = $derived(($page.params as { token: string }).token)

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
		customTheme?: CustomTheme
	}

	const DEFAULT_CONFIG: AlertConfig = {
		theme:       'cyber',
		position:    'top-right',
		animation:   'slide-right',
		durationMs:  5000,
		soundVolume: 0.6,
		events: {
			'channel.follow':            { enabled: true, template: '{user_name} a follow !' },
			'channel.subscribe':         { enabled: true, template: '{user_name} s\'abonne (tier {tier}) !' },
			'channel.subscription.gift': { enabled: true, template: '{user_name} offre {total} sub{total_plural} !' },
			'channel.cheer':             { enabled: true, template: '{user_name} envoie {bits} bits !' },
			'channel.raid':              { enabled: true, template: 'Raid de {from_broadcaster_user_name} avec {viewers} viewers !' },
		},
	}

	const VALID_THEMES     = ['cyber', 'soft', 'retro', 'neon', 'holographic', 'minimal', 'custom'] as const
	const VALID_POSITIONS  = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center'] as const
	const VALID_ANIMATIONS = ['slide-right', 'slide-left', 'slide-top', 'slide-bottom', 'scale', 'bounce', 'fade'] as const

	function mergeConfig(raw: Record<string, unknown> | null | undefined): AlertConfig {
		const cfg = raw ?? {}
		const events = { ...DEFAULT_CONFIG.events }
		const rawEvents = (cfg.events ?? {}) as Record<string, Partial<AlertEventCfg>>
		for (const k of Object.keys(events) as AlertEventKey[]) {
			const inc = rawEvents[k]
			if (inc) {
				events[k] = {
					enabled:  typeof inc.enabled  === 'boolean' ? inc.enabled  : events[k].enabled,
					template: typeof inc.template === 'string'  ? inc.template : events[k].template,
					iconUrl:  typeof inc.iconUrl  === 'string'  ? inc.iconUrl  : null,
					soundUrl: typeof inc.soundUrl === 'string'  ? inc.soundUrl : null,
				}
			}
		}
		const theme = (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
			? cfg.theme as AlertTheme : DEFAULT_CONFIG.theme
		const position = (VALID_POSITIONS as readonly string[]).includes(cfg.position as string)
			? cfg.position as AlertPosition : DEFAULT_CONFIG.position
		const animation = (VALID_ANIMATIONS as readonly string[]).includes(cfg.animation as string)
			? cfg.animation as AlertAnimation : DEFAULT_CONFIG.animation
		const durationMs = typeof cfg.durationMs === 'number' && cfg.durationMs >= 1000 && cfg.durationMs <= 30000
			? cfg.durationMs : DEFAULT_CONFIG.durationMs
		const soundVolume = typeof cfg.soundVolume === 'number' && cfg.soundVolume >= 0 && cfg.soundVolume <= 1
			? cfg.soundVolume : DEFAULT_CONFIG.soundVolume
		const ct = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		const customTheme: CustomTheme = {
			bgImageUrl:  typeof ct.bgImageUrl  === 'string' ? ct.bgImageUrl  : null,
			bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
			accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
			textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
		}
		return { theme, position, animation, durationMs, soundVolume, events, customTheme }
	}

	type AlertItem = {
		id:         string
		eventType:  AlertEventKey
		message:    string
		shownAt:    number
		avatarUrl?: string         // avatar Twitch du user qui a déclenché l'event
	}

	let alerts  = $state<AlertItem[]>([])
	let status  = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let config  = $state<AlertConfig>(DEFAULT_CONFIG)
	let socket: { disconnect: () => void } | null = null

	async function bootstrap(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/lookup/${token}`)
			if (!res.ok) { status = 'invalid'; return }
			const data = await res.json() as {
				ok: boolean
				overlay: { overlayType: string; config: Record<string, unknown> }
			}
			if (!data.ok || data.overlay.overlayType !== 'alert_box') { status = 'invalid'; return }
			config = mergeConfig(data.overlay.config)
			openSocket()
		} catch {
			status = 'error'
		}
	}

	async function openSocket(): Promise<void> {
		const { io } = await import('socket.io-client')
		const s = io(`${PUBLIC_API_URL}/overlay`, {
			auth:       { token },
			transports: ['polling', 'websocket'],
			path:       '/socket.io/',
		})
		s.on('connect',         () => { status = 'ready' })
		s.on('connect_error',   () => { status = 'invalid' })
		s.on('overlay:ready',   () => { status = 'ready' })
		s.on('overlay:event',   (evt: { eventType: string; payload: { event?: Record<string, unknown> } }) => {
			handleEvent(evt)
		})
		// Push live de la config depuis l'admin : on remplace la config locale
		// sans avoir à reload OBS. Du coup tu peux tweaker les templates et
		// voir le rendu en direct via le bouton Tester de l'admin.
		s.on('overlay:config-updated', (data: { config: Record<string, unknown> }) => {
			config = mergeConfig(data.config)
		})
		socket = s
	}

	onMount(() => { if (browser) bootstrap() })
	onDestroy(() => { if (socket) socket.disconnect() })

	// ── Substitution de variables ────────────────────────────────────────────
	// {var_name} → valeur correspondante dans le payload event, fallback chaine
	// vide. Variables spéciales calculées (tier humanisé, total_plural, etc).

	function substituteTemplate(template: string, vars: Record<string, string>): string {
		return template.replace(/\{([a-z_]+)\}/gi, (_, key) => vars[key] ?? '')
	}

	function buildVars(eventType: AlertEventKey, e: Record<string, unknown>): Record<string, string> {
		const userName = (e.user_name as string) ?? (e.user_login as string) ?? 'Anonyme'
		const isAnon   = e.is_anonymous === true
		const total    = Number(e.total ?? 1)

		const base: Record<string, string> = {
			user_name:    isAnon ? 'Anonyme' : userName,
			user_login:   (e.user_login as string) ?? '',
		}

		switch (eventType) {
			case 'channel.subscribe':
				return {
					...base,
					tier: String(e.tier ?? '1000').replace('000', '') || '1',
				}
			case 'channel.subscription.gift':
				return {
					...base,
					total:        String(total),
					total_plural: total > 1 ? 's' : '',
				}
			case 'channel.cheer':
				return {
					...base,
					user_name: isAnon ? 'Anonyme' : userName,
					bits:      String(e.bits ?? 0),
				}
			case 'channel.raid':
				return {
					...base,
					from_broadcaster_user_name: (e.from_broadcaster_user_name as string) ?? '?',
					viewers:                    String(e.viewers ?? 0),
				}
			default:
				return base
		}
	}

	function handleEvent(evt: { eventType: string; payload: { event?: Record<string, unknown> } }): void {
		const key = evt.eventType as AlertEventKey
		const cfg = config.events[key]
		if (!cfg || !cfg.enabled) return     // event désactivé par l'admin

		const e    = evt.payload?.event ?? {}
		const vars = buildVars(key, e)
		const msg  = substituteTemplate(cfg.template, vars)

		const item: AlertItem = {
			id:         `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			eventType:  key,
			message:    msg,
			shownAt:    Date.now(),
			avatarUrl:  (e.avatarUrl as string | undefined),     // injecté côté backend par enrichEventWithAvatar
		}
		alerts = [...alerts, item]
		setTimeout(() => { alerts = alerts.filter(a => a.id !== item.id) }, config.durationMs)

		// Joue le son associé à l'event s'il y en a un. OBS Browser Source
		// autorise le playback audio si "Control audio via OBS" est coché.
		// Modern browsers bloquent l'autoplay sans user gesture, mais OBS bypass.
		// playAlertSound gère unifié URL classique + presets "nodyx:<key>".
		if (cfg.soundUrl) playAlertSound(cfg.soundUrl, config.soundVolume)
	}

	// ── Animation d'entrée selon config ──────────────────────────────────────
	// Wrappers qui dispatchent vers la bonne transition Svelte. La sortie est
	// toujours un fade pour rester sobre et permettre le stacking.
	function animateIn(node: Element, _params: object) {
		switch (config.animation) {
			case 'slide-left':   return fly(node, { x: -400, duration: 420, easing: cubicOut })
			case 'slide-top':    return fly(node, { y: -200, duration: 420, easing: cubicOut })
			case 'slide-bottom': return fly(node, { y:  200, duration: 420, easing: cubicOut })
			case 'scale':        return scale(node, { start: 0.6, duration: 360, easing: cubicOut })
			case 'bounce':       return scale(node, { start: 0.4, duration: 540, easing: backOut })
			case 'fade':         return fade(node, { duration: 360 })
			case 'slide-right':
			default:             return fly(node, { x: 400, duration: 420, easing: cubicOut })
		}
	}

	// ── Couleur d'accent par event type ──────────────────────────────────────
	const ACCENTS: Record<AlertEventKey, string> = {
		'channel.follow':            '#06b6d4',
		'channel.subscribe':         '#a855f7',
		'channel.subscription.gift': '#ec4899',
		'channel.cheer':             '#f59e0b',
		'channel.raid':              '#ef4444',
	}

	const LABELS: Record<AlertEventKey, string> = {
		'channel.follow':            'Nouveau follower',
		'channel.subscribe':         'Nouvel abonné',
		'channel.subscription.gift': 'Sub offert',
		'channel.cheer':             'Bits',
		'channel.raid':              'Raid',
	}

	// Echappe une string pour la mettre dans une CSS url() ou color : on
	// supprime les caractères qui pourraient casser la propriété (`)\;}{`).
	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 500)
	}

	function buildCustomStyle(c: CustomTheme | undefined): string {
		if (!c) return ''
		const parts: string[] = []
		if (c.bgImageUrl) parts.push(`background-image: url("${safeCssValue(c.bgImageUrl)}")`)
		if (c.bgColor)    parts.push(`background-color: ${safeCssValue(c.bgColor)}`)
		if (c.textColor)  parts.push(`--text-color: ${safeCssValue(c.textColor)}`)
		return parts.join('; ')
	}
</script>

<svelte:head>
	<title>Overlay alert box</title>
	<style>
		html, body {
			background: transparent !important;
			margin:     0;
			padding:    0;
			overflow:   hidden;
			height:     100vh;
		}
	</style>
</svelte:head>

<div class="overlay-root theme-{config.theme} pos-{config.position}">
	{#if status === 'invalid'}
		<div class="status-msg status-error" transition:fade>
			Overlay invalide ou révoquée. Génère une nouvelle URL dans Nodyx.
		</div>
	{:else if status === 'error'}
		<div class="status-msg status-error" transition:fade>
			Connexion Nodyx impossible.
		</div>
	{:else if status === 'loading'}
		<div class="status-msg status-info" transition:fade>
			Connexion à Nodyx…
		</div>
	{/if}

	{#each alerts as alert (alert.id)}
		{@const accent  = config.theme === 'custom' && config.customTheme?.accentColor ? config.customTheme.accentColor : ACCENTS[alert.eventType]}
		{@const label   = LABELS[alert.eventType]}
		{@const iconUrl = config.events[alert.eventType]?.iconUrl ?? null}
		{@const cstyles = config.theme === 'custom' ? buildCustomStyle(config.customTheme) : ''}
		<div class="alert-card" style="--accent: {accent}; {cstyles}"
		     in:animateIn={{}} out:fade={{ duration: 280 }}>
			<div class="alert-bar"></div>
			{#if alert.avatarUrl}
				<img src={alert.avatarUrl} alt="" class="alert-avatar" loading="lazy" />
			{:else if iconUrl}
				<img src={iconUrl} alt="" class="alert-icon" />
			{/if}
			<div class="alert-content">
				<div class="alert-eyebrow">{label}</div>
				<div class="alert-message">{alert.message}</div>
			</div>
		</div>
	{/each}
</div>

<style>
	.overlay-root {
		position: fixed;
		display: flex;
		flex-direction: column;
		gap: 12px;
		pointer-events: none;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		max-width: 480px;
	}
	.overlay-root.pos-top-right    { top: 24px;    right: 24px; align-items: flex-end;   }
	.overlay-root.pos-top-left     { top: 24px;    left:  24px; align-items: flex-start; }
	.overlay-root.pos-bottom-right { bottom: 24px; right: 24px; align-items: flex-end;   flex-direction: column-reverse; }
	.overlay-root.pos-bottom-left  { bottom: 24px; left:  24px; align-items: flex-start; flex-direction: column-reverse; }
	.overlay-root.pos-center       { top: 50%; left: 50%; transform: translate(-50%, -50%); align-items: center; }

	/* ══ THEME : Cyber (default — Nodyx) ═══════════════════════════════════ */
	.theme-cyber .alert-card {
		display: flex;
		min-width: 320px;
		max-width: 480px;
		background: rgba(15, 23, 42, 0.92);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-left: 3px solid var(--accent);
		border-radius: 10px;
		overflow: hidden;
		box-shadow: 0 8px 32px color-mix(in oklab, var(--accent) 30%, transparent);
	}
	.theme-cyber .alert-bar {
		width: 4px;
		flex-shrink: 0;
		background: var(--accent);
	}
	.theme-cyber .alert-content { padding: 12px 16px; flex: 1; }
	.theme-cyber .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.12em; margin-bottom: 4px; color: var(--accent);
	}
	.theme-cyber .alert-message {
		color: #f1f5f9; font-size: 15px; font-weight: 600; line-height: 1.35;
	}

	/* ══ THEME : Soft (rounded, doux, glassmorphism) ═══════════════════════ */
	.theme-soft .alert-card {
		display: flex;
		min-width: 320px;
		max-width: 480px;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(12px);
		border: 1px solid rgba(0, 0, 0, 0.04);
		border-radius: 22px;
		overflow: hidden;
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
	}
	.theme-soft .alert-bar {
		width: 6px;
		flex-shrink: 0;
		background: var(--accent);
	}
	.theme-soft .alert-content { padding: 14px 18px; flex: 1; }
	.theme-soft .alert-eyebrow {
		font-size: 11px; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.08em; margin-bottom: 3px;
		color: color-mix(in oklab, var(--accent) 70%, black);
	}
	.theme-soft .alert-message {
		color: #1e293b; font-size: 16px; font-weight: 600; line-height: 1.35;
	}

	/* ══ THEME : Retro (pixel, gros gras, gros contour) ══════════════════ */
	.theme-retro .alert-card {
		display: flex;
		flex-direction: column;
		min-width: 280px;
		max-width: 480px;
		background: #1a1a2e;
		border: 4px solid var(--accent);
		border-radius: 0;
		box-shadow: 6px 6px 0 0 color-mix(in oklab, var(--accent) 60%, black);
		font-family: 'VT323', 'Press Start 2P', monospace;
		image-rendering: pixelated;
	}
	.theme-retro .alert-bar { display: none; }
	.theme-retro .alert-content {
		padding: 12px 16px;
		background:
			linear-gradient(90deg, var(--accent) 0%, var(--accent) 4%, transparent 4%, transparent 96%, var(--accent) 96%, var(--accent) 100%);
		background-size: 100% 4px, 100% 100%;
		background-repeat: no-repeat;
		background-position: top, center;
	}
	.theme-retro .alert-eyebrow {
		font-size: 14px;
		font-weight: 400;
		letter-spacing: 0.2em;
		margin-bottom: 6px;
		color: var(--accent);
		text-transform: uppercase;
	}
	.theme-retro .alert-message {
		color: #f1f5f9; font-size: 20px; font-weight: 400; line-height: 1.2;
	}

	/* ══ THEME : Neon (dark + glow puissant + animation pulse) ══════════ */
	.theme-neon .alert-card {
		display: flex;
		min-width: 320px;
		max-width: 480px;
		background: #050511;
		border: 2px solid var(--accent);
		border-radius: 12px;
		overflow: hidden;
		box-shadow:
			0 0 18px var(--accent),
			0 0 36px color-mix(in oklab, var(--accent) 60%, transparent),
			inset 0 0 12px color-mix(in oklab, var(--accent) 20%, transparent);
		animation: neon-pulse 2.4s ease-in-out infinite;
	}
	@keyframes neon-pulse {
		0%, 100% { box-shadow: 0 0 18px var(--accent), 0 0 36px color-mix(in oklab, var(--accent) 60%, transparent); }
		50%      { box-shadow: 0 0 26px var(--accent), 0 0 52px color-mix(in oklab, var(--accent) 75%, transparent); }
	}
	.theme-neon .alert-bar {
		width: 4px;
		flex-shrink: 0;
		background: var(--accent);
		box-shadow: 0 0 10px var(--accent);
	}
	.theme-neon .alert-content { padding: 14px 18px; flex: 1; }
	.theme-neon .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.18em; margin-bottom: 4px;
		color: var(--accent);
		text-shadow: 0 0 8px var(--accent);
	}
	.theme-neon .alert-message {
		color: #f1f5f9; font-size: 16px; font-weight: 700; line-height: 1.3;
		text-shadow: 0 0 6px color-mix(in oklab, var(--accent) 50%, transparent);
	}

	/* ══ THEME : Holographic (iridescent gradient animé) ════════════════ */
	.theme-holographic .alert-card {
		display: flex;
		min-width: 320px;
		max-width: 480px;
		position: relative;
		background: linear-gradient(135deg, #1a0033 0%, #001a33 50%, #003322 100%);
		border-radius: 14px;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		isolation: isolate;
	}
	.theme-holographic .alert-card::before {
		content: '';
		position: absolute; inset: 0;
		background: linear-gradient(115deg,
			rgba(236, 72, 153, 0.18) 0%,
			rgba(99, 102, 241, 0.18) 25%,
			rgba(6, 182, 212, 0.18) 50%,
			rgba(168, 85, 247, 0.18) 75%,
			rgba(236, 72, 153, 0.18) 100%);
		background-size: 300% 100%;
		animation: holo-shift 6s linear infinite;
		z-index: -1;
	}
	.theme-holographic .alert-card::after {
		content: '';
		position: absolute; inset: 0;
		border-radius: 14px;
		padding: 1.5px;
		background: linear-gradient(135deg, #ec4899, var(--nx-accent), #06b6d4, var(--nx-accent-2), #ec4899);
		background-size: 300% 300%;
		-webkit-mask:
			linear-gradient(#fff 0 0) content-box,
			linear-gradient(#fff 0 0);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
		animation: holo-shift 6s linear infinite;
		pointer-events: none;
	}
	@keyframes holo-shift {
		0%   { background-position: 0%   0%; }
		100% { background-position: 300% 0%; }
	}
	.theme-holographic .alert-bar { display: none; }
	.theme-holographic .alert-content { padding: 14px 18px; flex: 1; position: relative; z-index: 1; }
	.theme-holographic .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.14em; margin-bottom: 4px;
		background: linear-gradient(90deg, #ec4899, #06b6d4);
		background-clip: text;
		-webkit-background-clip: text;
		color: transparent;
	}
	.theme-holographic .alert-message {
		color: #f1f5f9; font-size: 16px; font-weight: 600; line-height: 1.35;
	}

	/* ══ THEME : Minimal (texte seul, aucun bg, gros gras avec ombre) ══ */
	.theme-minimal .alert-card {
		display: flex;
		flex-direction: column;
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
		gap: 2px;
	}
	.theme-minimal .alert-bar { display: none; }
	.theme-minimal .alert-content { padding: 0; flex: 1; }
	.theme-minimal .alert-eyebrow {
		font-size: 11px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.2em; margin-bottom: 2px;
		color: var(--accent);
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
	}
	.theme-minimal .alert-message {
		color: #ffffff;
		font-size: 24px;
		font-weight: 800;
		line-height: 1.15;
		text-shadow:
			0 2px 4px rgba(0, 0, 0, 0.9),
			0 4px 16px rgba(0, 0, 0, 0.7),
			0 0 1px rgba(0, 0, 0, 1);
		letter-spacing: -0.01em;
	}

	/* ══ THEME : Custom (bgImage / bgColor / textColor / accent depuis admin) */
	.theme-custom .alert-card {
		display: flex;
		min-width: 320px;
		max-width: 480px;
		background: #0f172a;
		background-size: cover;
		background-position: center;
		background-repeat: no-repeat;
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-left: 4px solid var(--accent);
		border-radius: 12px;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.35);
	}
	.theme-custom .alert-bar { display: none; }
	.theme-custom .alert-content {
		padding: 14px 18px; flex: 1;
		background: linear-gradient(90deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0.3) 70%, transparent 100%);
	}
	.theme-custom .alert-eyebrow {
		font-size: 10px; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.14em; margin-bottom: 4px;
		color: var(--accent);
	}
	.theme-custom .alert-message {
		color: var(--text-color, #f1f5f9);
		font-size: 16px; font-weight: 700; line-height: 1.3;
		text-shadow: 0 2px 6px rgba(0, 0, 0, 0.7);
	}

	/* ══ Icône optionnelle à gauche du message (utilisée par custom) ═══ */
	.alert-icon {
		width: 56px;
		height: 56px;
		margin: 12px 0 12px 16px;
		object-fit: cover;
		border-radius: 8px;
		flex-shrink: 0;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
	}
	.theme-minimal .alert-icon, .theme-retro .alert-icon { display: none; }

	/* ══ Avatar Twitch du user qui a déclenché l'event ══════════════════ */
	.alert-avatar {
		width: 56px;
		height: 56px;
		margin: 12px 0 12px 16px;
		object-fit: cover;
		border-radius: 50%;
		flex-shrink: 0;
		border: 2px solid color-mix(in oklab, var(--accent) 70%, transparent);
		box-shadow:
			0 2px 12px color-mix(in oklab, var(--accent) 35%, transparent),
			0 0 0 4px rgba(255, 255, 255, 0.04);
	}
	.theme-retro .alert-avatar {
		border-radius: 0;
		border-width: 3px;
		box-shadow: 4px 4px 0 0 color-mix(in oklab, var(--accent) 50%, black);
	}
	.theme-minimal .alert-avatar {
		margin-left: 0;
		margin-right: 14px;
		border: 2px solid #fff;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
	}
	.theme-neon .alert-avatar {
		border: 2px solid var(--accent);
		box-shadow:
			0 0 16px var(--accent),
			0 0 32px color-mix(in oklab, var(--accent) 50%, transparent);
	}

	/* Status messages (loading/error) — communs à tous les thèmes */
	.status-msg {
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 500;
		font-family: 'Geist', -apple-system, sans-serif;
	}
	.status-info {
		background: rgba(15, 23, 42, 0.85);
		color: #94a3b8;
		border: 1px solid rgba(148, 163, 184, 0.2);
	}
	.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}
</style>
