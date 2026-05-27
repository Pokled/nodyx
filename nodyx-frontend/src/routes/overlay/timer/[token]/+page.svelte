<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fade } from 'svelte/transition'

	// Stream timer overlay : affiche le temps écoulé depuis le started_at de
	// la session en cours. Bootstrap l'état + config via REST, tick local
	// chaque seconde, écoute stream.online (reset depuis le nouveau started_at)
	// et stream.offline (cache l'overlay). Push socket pour les updates de
	// config admin (theme, position, format) en live.
	//
	// 6 thèmes (cyber/soft/retro/neon/minimal/custom), 5 positions, 3 formats.

	const token = $derived(($page.params as { token: string }).token)

	type State = { isLive: boolean; startedAt: string | null }
	type Theme    = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type Position = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'
	type Format   = 'auto' | 'mm_ss' | 'h_mm_ss'
	type CustomTheme = { bgColor?: string | null; textColor?: string | null; accentColor?: string | null }
	type Config = {
		theme:        Theme
		position:     Position
		format:       Format
		customTheme?: CustomTheme | null
	}

	const VALID_THEMES    = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom'] as const
	const VALID_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center'] as const
	const VALID_FORMATS   = ['auto', 'mm_ss', 'h_mm_ss'] as const

	const DEFAULT_CONFIG: Config = {
		theme:    'cyber',
		position: 'top-left',
		format:   'auto',
	}

	function mergeConfig(raw: Record<string, unknown> | null | undefined): Config {
		const cfg = raw ?? {}
		const theme = (VALID_THEMES as readonly string[]).includes(cfg.theme as string)
			? cfg.theme as Theme : DEFAULT_CONFIG.theme
		const position = (VALID_POSITIONS as readonly string[]).includes(cfg.position as string)
			? cfg.position as Position : DEFAULT_CONFIG.position
		const format = (VALID_FORMATS as readonly string[]).includes(cfg.format as string)
			? cfg.format as Format : DEFAULT_CONFIG.format
		const ct = (cfg.customTheme ?? {}) as Partial<CustomTheme>
		const customTheme: CustomTheme = {
			bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
			textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
			accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
		}
		return { theme, position, format, customTheme }
	}

	let status   = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let isLive   = $state(false)
	let startedAt = $state<string | null>(null)
	let now      = $state(Date.now())
	let config   = $state<Config>(DEFAULT_CONFIG)
	let tickTimer: ReturnType<typeof setInterval> | null = null
	let socket: { disconnect: () => void } | null = null

	async function bootstrap(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/lookup/${token}`)
			if (!res.ok) { status = 'invalid'; return }
			const data = await res.json() as {
				ok: boolean
				overlay: { overlayType: string; config: Record<string, unknown>; state?: State | null }
			}
			if (!data.ok || data.overlay.overlayType !== 'stream_timer') { status = 'invalid'; return }

			config = mergeConfig(data.overlay.config)
			const s = data.overlay.state
			if (s) { isLive = s.isLive; startedAt = s.startedAt }
			status = 'ready'
			openSocket()
			startTicking()
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
		s.on('overlay:event', (evt: { eventType: string; payload: { event?: Record<string, unknown> }; occurredAt: string }) => {
			if (evt.eventType === 'stream.online') {
				const e = evt.payload?.event ?? {}
				const sa = (e.started_at as string | undefined) ?? evt.occurredAt
				startedAt = sa
				isLive    = true
			} else if (evt.eventType === 'stream.offline') {
				isLive    = false
				startedAt = null
			}
		})
		// Push live de la config depuis l'admin sans avoir à reload OBS
		s.on('overlay:config-updated', (data: { config: Record<string, unknown> }) => {
			config = mergeConfig(data.config)
		})
		socket = s
	}

	function startTicking(): void {
		if (tickTimer) clearInterval(tickTimer)
		tickTimer = setInterval(() => { now = Date.now() }, 1000)
	}

	onMount(() => { if (browser) bootstrap() })
	onDestroy(() => {
		if (tickTimer) clearInterval(tickTimer)
		if (socket)    socket.disconnect()
	})

	const elapsedMs = $derived(
		isLive && startedAt
			? Math.max(0, now - new Date(startedAt).getTime())
			: 0,
	)

	function formatHMS(ms: number, format: Format): string {
		const totalSec = Math.floor(ms / 1000)
		const h = Math.floor(totalSec / 3600)
		const m = Math.floor((totalSec % 3600) / 60)
		const s = totalSec % 60
		const mm = m.toString().padStart(2, '0')
		const ss = s.toString().padStart(2, '0')
		const hh = h.toString().padStart(2, '0')
		switch (format) {
			case 'mm_ss':   return `${mm}:${ss}`
			case 'h_mm_ss': return `${hh}:${mm}:${ss}`
			case 'auto':
			default:        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
		}
	}

	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 200)
	}

	const customStyle = $derived(() => {
		if (!config || config.theme !== 'custom' || !config.customTheme) return ''
		const c = config.customTheme
		const parts: string[] = []
		if (c.bgColor)     parts.push(`--bg: ${safeCssValue(c.bgColor)}`)
		if (c.textColor)   parts.push(`--text: ${safeCssValue(c.textColor)}`)
		if (c.accentColor) parts.push(`--accent: ${safeCssValue(c.accentColor)}`)
		return parts.join('; ')
	})
</script>

<svelte:head>
	<title>Overlay stream timer</title>
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

<div class="overlay-root pos-{config.position}">
	{#if status === 'invalid'}
		<div class="status-msg status-error" transition:fade>
			Overlay invalide ou révoquée.
		</div>
	{:else if status === 'error'}
		<div class="status-msg status-error" transition:fade>
			Connexion Nodyx impossible.
		</div>
	{:else if status === 'ready' && isLive}
		<div class="timer-card theme-{config.theme}" style={customStyle()} transition:fade>
			<span class="dot"></span>
			<span class="timer-text">{formatHMS(elapsedMs, config.format)}</span>
		</div>
	{/if}
</div>

<style>
	.overlay-root {
		position: fixed;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		pointer-events: none;
	}
	.overlay-root.pos-top-left     { top: 24px;    left:  24px; }
	.overlay-root.pos-top-right    { top: 24px;    right: 24px; }
	.overlay-root.pos-bottom-left  { bottom: 24px; left:  24px; }
	.overlay-root.pos-bottom-right { bottom: 24px; right: 24px; }
	.overlay-root.pos-center       { top: 50%; left: 50%; transform: translate(-50%, -50%); }

	.timer-card {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 8px 14px 8px 12px;
		/* defaults overridden par les thèmes */
		--bg:     rgba(15, 23, 42, 0.78);
		--text:   #f1f5f9;
		--accent: #f43f5e;
		background: var(--bg);
		backdrop-filter: blur(8px);
		border-radius: 999px;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
	}

	.timer-text {
		font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace;
		font-size: 22px;
		font-weight: 700;
		color: var(--text);
		font-variant-numeric: tabular-nums;
		letter-spacing: 0.5px;
	}

	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--accent);
		box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 25%, transparent);
		animation: pulse 2s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1;    box-shadow: 0 0 0 4px color-mix(in oklab, var(--accent) 25%, transparent); }
		50%      { opacity: 0.7;  box-shadow: 0 0 0 8px color-mix(in oklab, var(--accent) 6%,  transparent); }
	}

	/* ══ THEMES ════════════════════════════════════════════════════════════ */

	.theme-cyber   { border: 1px solid color-mix(in oklab, var(--accent) 35%, transparent); }

	.theme-soft {
		--bg:   rgba(255, 255, 255, 0.95);
		--text: #1e293b;
		border: 1px solid rgba(0, 0, 0, 0.04);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
	}

	.theme-retro {
		--bg: #1a1a2e;
		font-family: 'VT323', monospace;
		border: 3px solid var(--accent);
		border-radius: 0;
		box-shadow: 4px 4px 0 0 color-mix(in oklab, var(--accent) 60%, black);
		padding: 6px 14px 6px 10px;
	}
	.theme-retro .timer-text { font-family: 'VT323', monospace; font-size: 28px; font-weight: 400; }
	.theme-retro .dot        { border-radius: 0; }

	.theme-neon {
		--bg: #050511;
		border: 2px solid var(--accent);
		box-shadow:
			0 0 14px var(--accent),
			0 0 28px color-mix(in oklab, var(--accent) 60%, transparent);
	}
	.theme-neon .timer-text  { text-shadow: 0 0 8px color-mix(in oklab, var(--accent) 60%, transparent); }
	.theme-neon .dot         { box-shadow: 0 0 12px var(--accent); }

	.theme-minimal {
		background: transparent;
		backdrop-filter: none;
		box-shadow: none;
		padding: 0;
		gap: 8px;
	}
	.theme-minimal .timer-text {
		font-size: 28px;
		font-weight: 800;
		text-shadow:
			0 2px 4px rgba(0, 0, 0, 0.9),
			0 4px 16px rgba(0, 0, 0, 0.7);
		letter-spacing: -0.01em;
	}

	.theme-custom {
		/* --bg / --text / --accent set via inline style */
		border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
	}

	/* ── Status ─────────────────────────────────────────────────────────── */
	.status-msg {
		padding: 8px 14px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 500;
	}
	.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}
</style>
