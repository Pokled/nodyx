<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fade } from 'svelte/transition'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	// Goal bar : barre de progression vers un objectif (followers, subs cette
	// session, bits cette session, ou valeur custom). Polling 30s du backend
	// qui agrège les chiffres. Quand reached === true, animation de
	// célébration (pulse + sparkle) pour le streamer et ses viewers.

	const token = $derived(($page.params as { token: string }).token)

	type GoalTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type CustomTheme = {
		bgColor?:    string | null
		textColor?:  string | null
		barBgColor?: string | null
	}
	type GoalState = {
		current:     number
		target:      number
		percent:     number
		reached:     boolean
		label:       string
		goalType:    'followers_total' | 'subs_session' | 'bits_session' | 'custom'
		accent:      string
		theme:       GoalTheme
		customTheme?: CustomTheme | null
	}

	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 200)
	}

	function buildCustomStyle(s: GoalState | null): string {
		if (!s || s.theme !== 'custom' || !s.customTheme) return ''
		const c = s.customTheme
		const parts: string[] = []
		if (c.bgColor)    parts.push(`--card-bg: ${safeCssValue(c.bgColor)}`)
		if (c.textColor)  parts.push(`--text-color: ${safeCssValue(c.textColor)}`)
		if (c.barBgColor) parts.push(`--bar-bg: ${safeCssValue(c.barBgColor)}`)
		return parts.join('; ')
	}

	let status = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let goalState = $state<GoalState | null>(null)
	let timer:  ReturnType<typeof setInterval> | null = null
	let socket: { disconnect: () => void } | null = null

	async function fetchState(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/goal/${token}/state`)
			if (res.status === 404 || res.status === 400) { status = 'invalid'; return }
			if (!res.ok) { status = 'error'; return }
			const data = await res.json() as { ok: boolean; state: GoalState }
			if (!data.ok) { status = 'invalid'; return }
			goalState = data.state
			status = 'ready'
		} catch {
			status = 'error'
		}
	}

	async function openSocket(): Promise<void> {
		// Branche un socket sur le namespace /overlay pour recevoir le push
		// overlay:config-updated dès que l'admin sauve. On re-fetch alors
		// immédiatement au lieu d'attendre le prochain poll 30s.
		const { io } = await import('socket.io-client')
		const s = io(`${PUBLIC_API_URL}/overlay`, {
			auth:       { token },
			transports: ['polling', 'websocket'],
			path:       '/socket.io/',
		})
		s.on('overlay:config-updated', () => { fetchState() })
		socket = s
	}

	onMount(() => {
		if (!browser) return
		fetchState()
		openSocket()
		// Refresh régulier — 30 s suffit pour les progressions naturelles
		// (follow/sub/bits qui s'incrémentent). Les changements de config
		// admin sont déjà pushés via socket.
		timer = setInterval(fetchState, 30_000)
	})

	onDestroy(() => {
		if (timer)  clearInterval(timer)
		if (socket) socket.disconnect()
	})

	function fmtNumber(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
		if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
		return n.toString()
	}
</script>

<svelte:head>
	<title>Overlay goal bar</title>
	<style>
		html, body {
			background: transparent !important;
			margin: 0; padding: 0; overflow: hidden; height: 100vh;
		}
	</style>
</svelte:head>

<div class="overlay-root">
	{#if status === 'invalid'}
		<div class="status-msg" transition:fade>{tFn('overlay_board.invalid')}</div>
	{:else if status === 'error'}
		<div class="status-msg" transition:fade>{tFn('overlay_alert.conn_failed')}</div>
	{:else if status === 'loading'}
		<div class="status-msg loading" transition:fade>{tFn('overlay_goal.loading')}</div>
	{:else if goalState}
		{@const accent = goalState.accent}
		{@const themeCls = `theme-${goalState.theme}`}
		{@const cstyle  = buildCustomStyle(goalState)}
		<div class="card {themeCls}" style="--accent: {accent}; {cstyle}" class:reached={goalState.reached} transition:fade>
			<div class="label-row">
				<span class="label">{goalState.label}</span>
				<span class="counter">
					<span class="current">{fmtNumber(goalState.current)}</span>
					<span class="sep">/</span>
					<span class="target">{fmtNumber(goalState.target)}</span>
				</span>
			</div>
			<div class="bar">
				<div class="bar-fill" style="width: {goalState.percent}%; background: linear-gradient(90deg, {accent}, color-mix(in oklab, {accent} 70%, white));"></div>
				{#if goalState.reached}
					<div class="celebrate-sparkle"></div>
				{/if}
			</div>
			<div class="percent-row">
				<span class="percent">{goalState.percent}%</span>
				{#if goalState.reached}
					<span class="reached-badge">Objectif atteint !</span>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.overlay-root {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		pointer-events: none;
		min-width: 320px;
		max-width: 600px;
		width: min(560px, 80vw);
	}

	/* ══ Variables thèmes (overridées par chaque .theme-*) ════════════════ */
	.card {
		padding: 14px 18px;
		border-radius: 14px;
		--bar-bg:    rgba(255, 255, 255, 0.06);
		--text-color: #f1f5f9;
		--card-bg:   rgba(15, 23, 42, 0.88);
	}

	.label-row {
		display: flex; justify-content: space-between; align-items: baseline;
		margin-bottom: 8px;
		gap: 16px;
	}

	.label {
		font-size: 13px;
		font-weight: 600;
		color: var(--text-color);
		letter-spacing: 0.02em;
	}

	.counter {
		font-family: 'JetBrains Mono', 'SF Mono', monospace;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
		color: var(--text-color);
		opacity: 0.9;
		font-weight: 600;
		white-space: nowrap;
	}
	.counter .current { color: var(--accent); opacity: 1; }
	.counter .sep     { color: var(--text-color); opacity: 0.4; margin: 0 2px; }

	.bar {
		position: relative;
		height: 14px;
		background: var(--bar-bg);
		border-radius: 999px;
		overflow: hidden;
		border: 1px solid rgba(255, 255, 255, 0.04);
	}

	.bar-fill {
		height: 100%;
		border-radius: 999px;
		transition: width 800ms cubic-bezier(0.34, 1.56, 0.64, 1);
		box-shadow:
			0 0 12px color-mix(in oklab, var(--accent) 60%, transparent),
			inset 0 0 8px rgba(255, 255, 255, 0.15);
	}

	.celebrate-sparkle {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(90deg, transparent 0%, rgba(255, 255, 255, 0.35) 50%, transparent 100%);
		background-size: 60% 100%;
		background-repeat: no-repeat;
		animation: sparkle-sweep 2s linear infinite;
		pointer-events: none;
	}
	@keyframes sparkle-sweep {
		0%   { background-position: -60% 0; }
		100% { background-position: 160% 0; }
	}

	.percent-row {
		margin-top: 6px;
		display: flex; justify-content: space-between; align-items: center;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-color);
		opacity: 0.7;
		letter-spacing: 0.04em;
	}

	.percent { font-family: 'JetBrains Mono', monospace; }

	.reached-badge {
		padding: 2px 8px;
		border-radius: 999px;
		background: color-mix(in oklab, var(--accent) 20%, transparent);
		color: var(--accent);
		border: 1px solid color-mix(in oklab, var(--accent) 50%, transparent);
		text-transform: uppercase;
		font-size: 10px;
		letter-spacing: 0.14em;
	}

	/* ══ THEMES ════════════════════════════════════════════════════════════ */

	/* Cyber : sombre glassmorphism, accent border, pulse au reached. */
	.theme-cyber {
		background: rgba(15, 23, 42, 0.88);
		backdrop-filter: blur(10px);
		border: 1px solid color-mix(in oklab, var(--accent) 35%, transparent);
		box-shadow: 0 8px 32px color-mix(in oklab, var(--accent) 25%, transparent);
	}
	.theme-cyber.reached { animation: cyber-pulse 1.5s ease-in-out infinite; }
	@keyframes cyber-pulse {
		0%, 100% { box-shadow: 0 8px 32px color-mix(in oklab, var(--accent) 25%, transparent); }
		50%      { box-shadow: 0 8px 48px color-mix(in oklab, var(--accent) 65%, transparent); }
	}

	/* Soft : blanc rond, glassmorphism doux, ombre légère. */
	.theme-soft {
		--text-color: #1e293b;
		background: rgba(255, 255, 255, 0.95);
		border-radius: 22px;
		border: 1px solid rgba(0, 0, 0, 0.04);
		box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
	}
	.theme-soft .bar { --bar-bg: rgba(0, 0, 0, 0.08); }

	/* Retro : pixel, gros gras, ombre dure, barre carrée. */
	.theme-retro {
		font-family: 'VT323', 'Press Start 2P', monospace;
		background: #1a1a2e;
		border: 3px solid var(--accent);
		border-radius: 0;
		box-shadow: 6px 6px 0 0 color-mix(in oklab, var(--accent) 60%, black);
	}
	.theme-retro .label  { font-size: 18px; }
	.theme-retro .counter { font-size: 18px; font-family: 'VT323', monospace; }
	.theme-retro .bar    { border-radius: 0; height: 18px; --bar-bg: #0a0a14; }
	.theme-retro .bar-fill { border-radius: 0; box-shadow: inset 0 -2px 0 0 rgba(0,0,0,0.3); }
	.theme-retro .percent { font-size: 14px; }

	/* Neon : dark + glow puissant pulsant. */
	.theme-neon {
		background: #050511;
		border: 2px solid var(--accent);
		box-shadow:
			0 0 16px var(--accent),
			0 0 32px color-mix(in oklab, var(--accent) 60%, transparent);
		animation: neon-pulse 2.4s ease-in-out infinite;
	}
	@keyframes neon-pulse {
		0%, 100% { box-shadow: 0 0 16px var(--accent), 0 0 32px color-mix(in oklab, var(--accent) 60%, transparent); }
		50%      { box-shadow: 0 0 24px var(--accent), 0 0 48px color-mix(in oklab, var(--accent) 75%, transparent); }
	}
	.theme-neon .label { text-shadow: 0 0 6px var(--accent); }
	.theme-neon .bar   { --bar-bg: rgba(255,255,255,0.04); }
	.theme-neon .bar-fill { box-shadow: 0 0 12px var(--accent), inset 0 0 8px rgba(255,255,255,0.2); }

	/* Minimal : pas de card, juste label + barre fine + texte gros gras. */
	.theme-minimal {
		background: transparent;
		border: none;
		box-shadow: none;
		padding: 0;
	}
	.theme-minimal .label   { font-size: 18px; font-weight: 800; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
	.theme-minimal .counter { color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.7); }
	.theme-minimal .bar     { height: 8px; --bar-bg: rgba(255,255,255,0.15); border: none; }
	.theme-minimal .percent { color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.7); }

	/* Custom : valeurs dans --card-bg / --text-color / --bar-bg via inline style. */
	.theme-custom {
		background: var(--card-bg);
		border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
		border-radius: 14px;
		box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3);
	}

	.status-msg {
		padding: 8px 14px;
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
		font-size: 12px;
		font-weight: 500;
		text-align: center;
	}
	.status-msg.loading {
		background: rgba(15, 23, 42, 0.85);
		color: #94a3b8;
		border: 1px solid rgba(148, 163, 184, 0.2);
	}
</style>
