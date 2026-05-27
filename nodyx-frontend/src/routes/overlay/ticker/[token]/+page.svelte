<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fade } from 'svelte/transition'

	// Bandeau défilant en bas d'écran. SVG icons par event type, typographie
	// hiérarchisée (nom gros, badge eyebrow), drift de couleur subtle du
	// bandeau vers le dernier event. 6 thèmes polished + custom.
	//
	// Push socket en live, CSS animation pure pour le scroll (0 charge JS
	// pendant que ça tourne dans OBS), bootstrap REST au premier load.

	const token = $derived(($page.params as { token: string }).token)

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
		customTheme?:  CustomTheme
	}

	type TickerEvent = {
		id:         string
		eventType:  TickerEventKey
		payload:    { event?: Record<string, unknown> }
		occurredAt: string
	}

	type DisplayToken = {
		uid:        string
		eventType:  TickerEventKey
		name:       string         // pseudo principal
		detail:     string         // info secondaire (tier, viewers, bits…)
		weight:     number         // multiplicateur (1 par défaut, 1.5-2 pour gros events)
		combo?:     number
		avatarUrl?: string         // avatar Twitch du user (remplace l'icon-orb quand dispo)
	}

	let status = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let config = $state<TickerConfig | null>(null)
	let tokens = $state<DisplayToken[]>([])
	let lastEventKey = $state<TickerEventKey | null>(null)
	let socket: { disconnect: () => void } | null = null

	// Couleurs accent par event type (cohérent avec alert box et leaderboard)
	const ACCENTS: Record<TickerEventKey, string> = {
		'channel.follow':            '#06b6d4',
		'channel.subscribe':         '#a855f7',
		'channel.subscription.gift': '#ec4899',
		'channel.cheer':             '#f59e0b',
		'channel.raid':              '#ef4444',
	}
	const LABELS: Record<TickerEventKey, string> = {
		'channel.follow':            'Follow',
		'channel.subscribe':         'Sub',
		'channel.subscription.gift': 'Gift',
		'channel.cheer':             'Bits',
		'channel.raid':              'Raid',
	}

	function weightFor(eventType: TickerEventKey, weighted: boolean): number {
		if (!weighted) return 1
		switch (eventType) {
			case 'channel.raid':              return 2
			case 'channel.cheer':             return 1.7
			case 'channel.subscription.gift': return 1.5
			case 'channel.subscribe':         return 1.3
			default:                          return 1
		}
	}

	function buildDetail(ev: TickerEvent): { name: string; detail: string } {
		const e = ev.payload?.event ?? {}
		switch (ev.eventType) {
			case 'channel.follow':
				return { name: (e.user_name as string) ?? (e.user_login as string) ?? 'Anon', detail: '' }
			case 'channel.subscribe': {
				const tier = String(e.tier ?? '').replace('000', '') || '1'
				return { name: (e.user_name as string) ?? '?', detail: `tier ${tier}` }
			}
			case 'channel.subscription.gift':
				return { name: (e.user_name as string) ?? 'Anon', detail: `×${e.total ?? 1}` }
			case 'channel.cheer':
				return {
					name:   e.is_anonymous ? 'Anonyme' : ((e.user_name as string) ?? '?'),
					detail: `${e.bits ?? 0} bits`,
				}
			case 'channel.raid':
				return {
					name:   (e.from_broadcaster_user_name as string) ?? '?',
					detail: `${e.viewers ?? 0} viewers`,
				}
			default:
				return { name: '?', detail: '' }
		}
	}

	function eventToToken(ev: TickerEvent, cfg: TickerConfig): DisplayToken {
		const { name, detail } = buildDetail(ev)
		const e = ev.payload?.event ?? {}
		return {
			uid:       `${ev.id}-${Math.random().toString(36).slice(2, 6)}`,
			eventType: ev.eventType,
			name,
			detail,
			weight:    weightFor(ev.eventType, cfg.weighted),
			avatarUrl: (e.avatarUrl as string | undefined),     // enrichi côté backend
		}
	}

	function applyCombo(events: TickerEvent[], cfg: TickerConfig): DisplayToken[] {
		if (!cfg.combo) return events.map(e => eventToToken(e, cfg))
		const out: DisplayToken[] = []
		const used = new Set<number>()
		for (let i = 0; i < events.length; i++) {
			if (used.has(i)) continue
			const ev = events[i]
			const cluster: number[] = [i]
			const t0 = new Date(ev.occurredAt).getTime()
			for (let j = i + 1; j < events.length; j++) {
				if (used.has(j)) continue
				const other = events[j]
				if (other.eventType !== ev.eventType) continue
				const tj = new Date(other.occurredAt).getTime()
				if (Math.abs(t0 - tj) > 10_000) continue
				cluster.push(j)
			}
			if (cluster.length >= 3) {
				cluster.forEach(idx => used.add(idx))
				out.push({
					uid:       `combo-${ev.id}-${cluster.length}`,
					eventType: ev.eventType,
					name:      `Burst ×${cluster.length}`,
					detail:    LABELS[ev.eventType].toLowerCase() + 's',
					weight:    1.8,
					combo:     cluster.length,
				})
			} else {
				used.add(i)
				out.push(eventToToken(ev, cfg))
			}
		}
		return out
	}

	async function bootstrap(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/ticker/${token}/state`)
			if (res.status === 404 || res.status === 400) { status = 'invalid'; return }
			if (!res.ok) { status = 'error'; return }
			const data = await res.json() as { ok: boolean; config: TickerConfig; events: TickerEvent[] }
			if (!data.ok) { status = 'invalid'; return }
			config = data.config
			tokens = applyCombo(data.events, data.config)
			lastEventKey = data.events[0]?.eventType ?? null
			status = 'ready'
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
		s.on('overlay:event', (evt: { eventType: string; payload: Record<string, unknown>; occurredAt: string }) => {
			if (!config) return
			const key = evt.eventType as TickerEventKey
			if (!config.enabledEvents.includes(key)) return
			const fake: TickerEvent = {
				id:         `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				eventType:  key,
				payload:    evt.payload as { event?: Record<string, unknown> },
				occurredAt: evt.occurredAt,
			}
			tokens = [eventToToken(fake, config), ...tokens].slice(0, 50)
			lastEventKey = key
		})
		s.on('overlay:config-updated', () => { bootstrap() })
		socket = s
	}

	onMount(() => {
		if (!browser) return
		bootstrap()
		openSocket()
	})

	onDestroy(() => {
		if (socket) socket.disconnect()
	})

	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 200)
	}

	const customStyle = $derived(() => {
		if (!config || config.theme !== 'custom' || !config.customTheme) return ''
		const c = config.customTheme
		const parts: string[] = []
		if (c.bgColor)   parts.push(`--bar-bg: ${safeCssValue(c.bgColor)}`)
		if (c.textColor) parts.push(`--text-color: ${safeCssValue(c.textColor)}`)
		return parts.join('; ')
	})

	// Drift de couleur du bandeau vers la couleur du dernier event
	const driftColor = $derived(lastEventKey ? ACCENTS[lastEventKey] : '#06b6d4')

	// Pour que le défilement entre vraiment de la droite (et pas que les
	// tokens s'agrègent à gauche quand il y en a peu), on répète le contenu
	// jusqu'à ce qu'il dépasse une viewport entière. Le duplicate dans le
	// template permet ensuite le loop seamless de translateX(0) → -50%.
	const MIN_REPEATS = 4
	const displayTokens = $derived<DisplayToken[]>(
		tokens.length === 0 ? [] :
		tokens.length >= 8 ? tokens :
		Array(Math.max(MIN_REPEATS, Math.ceil(8 / tokens.length))).fill(tokens).flat(),
	)
</script>

<svelte:head>
	<title>Overlay event ticker</title>
	<style>
		html, body {
			background: transparent !important;
			margin: 0; padding: 0; overflow: hidden; height: 100vh;
		}
	</style>
</svelte:head>

<div class="overlay-root">
	{#if status === 'invalid'}
		<div class="status-msg" transition:fade>Overlay invalide ou révoquée.</div>
	{:else if status === 'error'}
		<div class="status-msg" transition:fade>Connexion Nodyx impossible.</div>
	{:else if status === 'loading'}
		<div class="status-msg status-loading" transition:fade>Chargement…</div>
	{:else if config && tokens.length > 0}
		<div class="ticker theme-{config.theme}"
		     style="--scroll-duration: {config.speedSeconds}s; --drift: {driftColor}; {customStyle()}">
			<div class="ticker-track">
				{#each displayTokens as t, i (`${t.uid}-${i}`)}
					{@const accent = ACCENTS[t.eventType]}
					<div class="token" style="--accent: {accent}; --weight: {t.weight};" class:is-combo={t.combo}>
						{#if t.avatarUrl}
							<img class="avatar-orb" src={t.avatarUrl} alt="" loading="lazy" />
						{:else}
							<div class="icon-orb" aria-hidden="true">
								{#if t.eventType === 'channel.follow'}
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
								{:else if t.eventType === 'channel.subscribe'}
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.39 7.36H22l-6.18 4.49 2.36 7.27L12 16.62l-6.18 4.5 2.36-7.27L2 9.36h7.61z"/></svg>
								{:else if t.eventType === 'channel.subscription.gift'}
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zM15 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z"/></svg>
								{:else if t.eventType === 'channel.cheer'}
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 10l8 12 8-12L12 2zm0 4.84L17.06 12 12 18.16 6.94 12 12 6.84z"/></svg>
								{:else if t.eventType === 'channel.raid'}
									<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
								{/if}
							</div>
						{/if}
						<div class="text">
							<div class="eyebrow">
								{LABELS[t.eventType]}
								{#if t.combo}<span class="combo-tag">×{t.combo}</span>{/if}
							</div>
							<div class="name">{t.name}</div>
							{#if t.detail}<div class="detail">{t.detail}</div>{/if}
						</div>
					</div>
				{/each}
				<!-- Duplicate pour scroll continu sans gap -->
				{#each displayTokens as t, i (`${t.uid}-dup-${i}`)}
					{@const accent = ACCENTS[t.eventType]}
					<div class="token" style="--accent: {accent}; --weight: {t.weight};" class:is-combo={t.combo} aria-hidden="true">
						{#if t.avatarUrl}
							<img class="avatar-orb" src={t.avatarUrl} alt="" loading="lazy" />
						{:else}
						<div class="icon-orb">
							{#if t.eventType === 'channel.follow'}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
							{:else if t.eventType === 'channel.subscribe'}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.39 7.36H22l-6.18 4.49 2.36 7.27L12 16.62l-6.18 4.5 2.36-7.27L2 9.36h7.61z"/></svg>
							{:else if t.eventType === 'channel.subscription.gift'}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 6h-2.18c.11-.31.18-.65.18-1a2.996 2.996 0 0 0-5.5-1.65l-.5.67-.5-.68C10.96 2.54 10.05 2 9 2 7.34 2 6 3.34 6 5c0 .35.07.69.18 1H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zM15 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zM9 4c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm11 15H4v-2h16v2zm0-5H4V8h5.08L7 10.83 8.62 12 11 8.76l1-1.36 1 1.36L15.38 12 17 10.83 14.92 8H20v6z"/></svg>
							{:else if t.eventType === 'channel.cheer'}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L4 10l8 12 8-12L12 2zm0 4.84L17.06 12 12 18.16 6.94 12 12 6.84z"/></svg>
							{:else if t.eventType === 'channel.raid'}
								<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0L19.2 12l-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>
							{/if}
						</div>
						{/if}
						<div class="text">
							<div class="eyebrow">
								{LABELS[t.eventType]}
								{#if t.combo}<span class="combo-tag">×{t.combo}</span>{/if}
							</div>
							<div class="name">{t.name}</div>
							{#if t.detail}<div class="detail">{t.detail}</div>{/if}
						</div>
					</div>
				{/each}
			</div>

			<!-- Underline lumineux qui drift vers la couleur du dernier event -->
			<div class="drift-line"></div>
		</div>
	{:else if config}
		<div class="status-msg status-loading" transition:fade>
			Aucun event encore. Le ticker se remplira au fil des follows / subs / raids.
		</div>
	{/if}
</div>

<style>
	.overlay-root {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		pointer-events: none;
		--bar-bg:     rgba(8, 12, 26, 0.92);
		--text-color: #f1f5f9;
	}

	.ticker {
		position: relative;
		width: 100%;
		overflow: hidden;
		background: var(--bar-bg);
		backdrop-filter: blur(14px);
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		padding: 12px 0 14px;
	}

	.ticker-track {
		display: inline-flex;
		gap: 18px;
		white-space: nowrap;
		animation: scroll-left var(--scroll-duration, 60s) linear infinite;
		padding-left: 18px;
		will-change: transform;
	}
	@keyframes scroll-left {
		from { transform: translateX(0); }
		to   { transform: translateX(-50%); }
	}

	/* ══ TOKEN — structure de base partagée par tous les thèmes ═══════════ */

	.token {
		display: inline-flex;
		align-items: center;
		gap: 12px;
		padding: 8px 18px 8px 8px;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid color-mix(in oklab, var(--accent) 30%, transparent);
		color: var(--text-color);
		flex-shrink: 0;
		position: relative;
		box-shadow:
			0 4px 14px color-mix(in oklab, var(--accent) 14%, transparent),
			inset 0 1px 0 rgba(255, 255, 255, 0.04);
		transition: box-shadow 0.4s ease;
	}

	.token.is-combo {
		background: linear-gradient(95deg,
			color-mix(in oklab, var(--accent) 18%, transparent),
			color-mix(in oklab, var(--accent) 6%, transparent));
		border-color: color-mix(in oklab, var(--accent) 55%, transparent);
		animation: combo-shimmer 1.6s ease-in-out infinite;
	}
	@keyframes combo-shimmer {
		0%, 100% { box-shadow: 0 4px 14px color-mix(in oklab, var(--accent) 24%, transparent), inset 0 1px 0 rgba(255, 255, 255, 0.08); }
		50%      { box-shadow: 0 6px 26px color-mix(in oklab, var(--accent) 55%, transparent), inset 0 2px 0 rgba(255, 255, 255, 0.18); }
	}

	.icon-orb {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: 50%;
		background: linear-gradient(135deg,
			color-mix(in oklab, var(--accent) 100%, transparent),
			color-mix(in oklab, var(--accent) 60%, black));
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow:
			0 2px 8px color-mix(in oklab, var(--accent) 50%, transparent),
			inset 0 -2px 4px rgba(0, 0, 0, 0.25),
			inset 0 2px 4px rgba(255, 255, 255, 0.2);
	}
	.icon-orb svg {
		width: 18px;
		height: 18px;
		color: #fff;
		filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.3));
	}

	/* Avatar Twitch — même footprint que l'icon-orb pour ne pas casser la mise en page */
	.avatar-orb {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: 50%;
		object-fit: cover;
		border: 2px solid var(--accent);
		box-shadow:
			0 2px 8px color-mix(in oklab, var(--accent) 50%, transparent),
			0 0 0 1px rgba(255, 255, 255, 0.08);
	}
	.theme-retro .avatar-orb { border-radius: 0; border-width: 3px; }
	.theme-neon  .avatar-orb { box-shadow: 0 0 14px var(--accent), 0 0 0 1px rgba(255, 255, 255, 0.06); }

	.text {
		display: flex;
		flex-direction: column;
		gap: 0;
		line-height: 1.1;
	}

	.eyebrow {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--accent);
		opacity: 0.85;
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.combo-tag {
		display: inline-block;
		padding: 1px 5px;
		border-radius: 4px;
		background: var(--accent);
		color: #0a0a14;
		font-size: 9px;
		letter-spacing: 0.06em;
	}

	.name {
		font-size: 15px;
		font-weight: 700;
		color: var(--text-color);
		letter-spacing: -0.005em;
		margin-top: 1px;
	}

	.detail {
		font-size: 10px;
		opacity: 0.55;
		font-variant-numeric: tabular-nums;
		margin-top: 1px;
	}

	/* ══ DRIFT LINE — ligne lumineuse qui tinte selon le dernier event ══ */

	.drift-line {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent 0%, var(--drift) 50%, transparent 100%);
		opacity: 0.6;
		transition: background 1.2s ease;
		pointer-events: none;
	}

	/* ══ THEMES ════════════════════════════════════════════════════════════ */

	/* Cyber — default. Scan-line subtile qui balaye horizontalement. */
	.theme-cyber {
		background:
			linear-gradient(180deg, rgba(8, 12, 26, 0.95), rgba(15, 23, 42, 0.92));
		position: relative;
	}
	.theme-cyber::before {
		content: '';
		position: absolute; inset: 0;
		background: linear-gradient(115deg, transparent 40%, rgba(255, 255, 255, 0.025) 50%, transparent 60%);
		background-size: 300% 100%;
		animation: cyber-scan 14s linear infinite;
		pointer-events: none;
	}
	@keyframes cyber-scan {
		from { background-position: 200% 0; }
		to   { background-position: -200% 0; }
	}

	/* Soft — fond clair laiteux, glass blur fort, tokens en relief doux */
	.theme-soft {
		--bar-bg:     rgba(255, 255, 255, 0.94);
		--text-color: #1e293b;
		backdrop-filter: blur(20px);
		box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.08);
	}
	.theme-soft .token {
		background: rgba(248, 250, 252, 0.95);
		border: 1px solid rgba(15, 23, 42, 0.08);
		box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08), 0 1px 0 rgba(255, 255, 255, 1) inset;
	}
	.theme-soft .eyebrow { opacity: 1; }
	.theme-soft .icon-orb { box-shadow: 0 2px 6px color-mix(in oklab, var(--accent) 40%, transparent); }

	/* Retro — pixel chunky, ombre dure, font VT323 */
	.theme-retro {
		--bar-bg: #1a1a2e;
		font-family: 'VT323', monospace;
	}
	.theme-retro .ticker, .theme-retro {
		padding-top: 14px;
		padding-bottom: 16px;
	}
	.theme-retro .token {
		border-radius: 0;
		border: 3px solid var(--accent);
		padding: 6px 14px 6px 6px;
		box-shadow: 4px 4px 0 0 color-mix(in oklab, var(--accent) 50%, black);
	}
	.theme-retro .icon-orb {
		border-radius: 0;
		width: 32px; height: 32px;
		box-shadow: none;
	}
	.theme-retro .eyebrow { font-size: 12px; }
	.theme-retro .name    { font-size: 22px; font-weight: 400; }
	.theme-retro .detail  { font-size: 14px; }

	/* Neon — dark deep + glow puissant inhalation, bord saturé */
	.theme-neon {
		--bar-bg: #050511;
		border-top: 2px solid color-mix(in oklab, var(--drift) 80%, transparent);
		box-shadow: 0 -8px 32px color-mix(in oklab, var(--drift) 35%, transparent);
		transition: box-shadow 0.8s ease, border-color 0.8s ease;
	}
	.theme-neon .token {
		background: rgba(255, 255, 255, 0.02);
		border: 1.5px solid var(--accent);
		box-shadow:
			0 0 14px color-mix(in oklab, var(--accent) 50%, transparent),
			inset 0 0 8px color-mix(in oklab, var(--accent) 18%, transparent);
		animation: neon-breathe 3s ease-in-out infinite;
	}
	@keyframes neon-breathe {
		0%, 100% { box-shadow: 0 0 14px color-mix(in oklab, var(--accent) 50%, transparent), inset 0 0 8px color-mix(in oklab, var(--accent) 18%, transparent); }
		50%      { box-shadow: 0 0 22px color-mix(in oklab, var(--accent) 70%, transparent), inset 0 0 12px color-mix(in oklab, var(--accent) 28%, transparent); }
	}
	.theme-neon .icon-orb { box-shadow: 0 0 16px var(--accent), inset 0 -2px 4px rgba(0, 0, 0, 0.25); }
	.theme-neon .eyebrow  { text-shadow: 0 0 8px var(--accent); }
	.theme-neon .name     { text-shadow: 0 0 6px color-mix(in oklab, var(--accent) 50%, transparent); }

	/* Minimal — fond transparent, tokens en élévation forte sur la scène */
	.theme-minimal {
		--bar-bg: transparent;
		backdrop-filter: none;
		border-top: none;
		padding: 16px 0;
	}
	.theme-minimal .token {
		background: rgba(0, 0, 0, 0.65);
		backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.06);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
	}
	.theme-minimal .name { font-size: 17px; font-weight: 800; }

	/* Custom — couleurs admin-driven */
	.theme-custom {
		/* --bar-bg + --text-color set via inline style depuis customTheme */
	}

	/* ══ Status ════════════════════════════════════════════════════════════ */
	.status-msg {
		display: inline-block;
		margin: 12px;
		padding: 6px 12px;
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
		font-size: 12px;
	}
	.status-loading {
		background: rgba(15, 23, 42, 0.85);
		color: #94a3b8;
		border-color: rgba(148, 163, 184, 0.2);
	}
</style>
