<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fade, fly, scale } from 'svelte/transition'
	import { backOut, cubicOut } from 'svelte/easing'

	// Podium top 3 (gold/silver/bronze) + liste rang 4-N en dessous. Avatars
	// Twitch sur les têtes des podiums. Refresh state toutes les 60s + push
	// socket pour config-updated. Mode "récap fin de stream" auto-trigger sur
	// stream.offline.

	const token = $derived(($page.params as { token: string }).token)

	type Category = 'subs' | 'bits' | 'raids' | 'chatters'
	type Period   = 'session' | '7d' | '30d' | 'all'
	type Theme    = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
	type CustomTheme = { bgColor?: string | null; textColor?: string | null }

	type Entry = {
		userId:    string
		userName:  string
		score:     number
		avatarUrl: string | null
	}

	type Config = {
		category:      Category
		period:        Period
		topN:          number
		showOnOffline: boolean
		theme:         Theme
		customTheme?:  CustomTheme | null
	}

	type State = {
		category:    Category
		period:      Period
		entries:     Entry[]
		totalCount:  number
		generatedAt: string
	}

	let status   = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let config   = $state<Config | null>(null)
	let entries  = $state<Entry[]>([])
	let recapMode = $state(false)             // auto-trigger sur stream.offline si showOnOffline
	let timer:  ReturnType<typeof setInterval> | null = null
	let socket: { disconnect: () => void } | null = null

	const CATEGORY_LABELS: Record<Category, { plural: string; unit: string }> = {
		subs:     { plural: 'Top Subs',     unit: 'subs'     },
		bits:     { plural: 'Top Bits',     unit: 'bits'     },
		raids:    { plural: 'Top Raids',    unit: 'raids'    },
		chatters: { plural: 'Top Chatteurs', unit: 'messages' },
	}
	const PERIOD_LABELS: Record<Period, string> = {
		session: 'session en cours',
		'7d':    '7 derniers jours',
		'30d':   '30 derniers jours',
		all:     'depuis toujours',
	}

	async function fetchState(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/leaderboard/${token}/state`)
			if (res.status === 404 || res.status === 400) { status = 'invalid'; return }
			if (!res.ok) { status = 'error'; return }
			const data = await res.json() as { ok: boolean; config: Config; state: State }
			if (!data.ok) { status = 'invalid'; return }
			config  = data.config
			entries = data.state.entries
			status  = 'ready'
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
		s.on('overlay:event', (evt: { eventType: string }) => {
			// stream.offline → trigger récap (si admin l'a activé)
			if (evt.eventType === 'stream.offline' && config?.showOnOffline) {
				recapMode = true
				fetchState()
				return
			}
			// stream.online → sort du récap mode
			if (evt.eventType === 'stream.online') { recapMode = false; return }
			// Tout autre event qui pourrait changer le score : on re-fetch
			fetchState()
		})
		s.on('overlay:config-updated', () => { fetchState() })
		socket = s
	}

	onMount(() => {
		if (!browser) return
		fetchState()
		openSocket()
		// Refresh régulier — 60s, le scoring change lentement entre events
		timer = setInterval(fetchState, 60_000)
	})

	onDestroy(() => {
		if (timer)  clearInterval(timer)
		if (socket) socket.disconnect()
	})

	function safeCssValue(s: string | null | undefined): string {
		if (!s) return ''
		return s.replace(/[\\;}{"`]/g, '').slice(0, 200)
	}

	const customStyle = $derived(() => {
		if (!config || config.theme !== 'custom' || !config.customTheme) return ''
		const parts: string[] = []
		if (config.customTheme.bgColor)   parts.push(`--card-bg: ${safeCssValue(config.customTheme.bgColor)}`)
		if (config.customTheme.textColor) parts.push(`--text-color: ${safeCssValue(config.customTheme.textColor)}`)
		return parts.join('; ')
	})

	function fmtScore(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
		if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
		return n.toString()
	}

	// Top 3 vs rest. Order pour le podium : silver(2nd) à gauche, gold(1st) au
	// centre, bronze(3rd) à droite. Visuel classique JO.
	const top3      = $derived(entries.slice(0, 3))
	const rest      = $derived(entries.slice(3))
	const podiumOrder = $derived<Entry[]>(
		top3.length === 0 ? [] :
		top3.length === 1 ? [top3[0]] :
		top3.length === 2 ? [top3[1], top3[0]] :
		[top3[1], top3[0], top3[2]],
	)
	const podiumRanks = $derived<number[]>(
		top3.length === 0 ? [] :
		top3.length === 1 ? [1] :
		top3.length === 2 ? [2, 1] :
		[2, 1, 3],
	)

	const MEDAL_COLORS: Record<number, string> = {
		1: '#fbbf24',     // gold
		2: '#cbd5e1',     // silver
		3: '#d97706',     // bronze
	}
	const PEDESTAL_HEIGHTS: Record<number, number> = {
		1: 110,
		2: 80,
		3: 60,
	}
</script>

<svelte:head>
	<title>Overlay leaderboard</title>
	<style>
		html, body {
			background: transparent !important;
			margin: 0; padding: 0; overflow: hidden; height: 100vh;
		}
	</style>
</svelte:head>

<div class="overlay-root" class:recap={recapMode}>
	{#if status === 'invalid'}
		<div class="status-msg" transition:fade>Overlay invalide ou révoquée.</div>
	{:else if status === 'error'}
		<div class="status-msg" transition:fade>Connexion Nodyx impossible.</div>
	{:else if status === 'loading'}
		<div class="status-msg status-loading" transition:fade>Chargement…</div>
	{:else if config && entries.length === 0}
		<div class="card theme-{config.theme}" style={customStyle()} transition:fade>
			<header class="title">
				<h1>{CATEGORY_LABELS[config.category].plural}</h1>
				<span class="period">{PERIOD_LABELS[config.period]}</span>
			</header>
			<div class="empty-msg">Pas encore de classement sur cette période.</div>
		</div>
	{:else if config}
		<div class="card theme-{config.theme}" style={customStyle()} transition:fade>
			<header class="title">
				<h1>{CATEGORY_LABELS[config.category].plural}</h1>
				<span class="period">{PERIOD_LABELS[config.period]}</span>
				{#if recapMode}<span class="recap-badge">RÉCAP DE STREAM</span>{/if}
			</header>

			<!-- Podium top 3 -->
			{#if top3.length > 0}
				<div class="podium" class:single={top3.length === 1}>
					{#each podiumOrder as entry, i (entry.userId)}
						{@const rank = podiumRanks[i]}
						{@const medal = MEDAL_COLORS[rank]}
						{@const height = PEDESTAL_HEIGHTS[rank]}
						<div class="podium-slot rank-{rank}" style="--medal: {medal};"
						     in:fly={{ y: 50, duration: 500, delay: i * 120, easing: backOut }}>
							<div class="podium-avatar-wrap">
								{#if entry.avatarUrl}
									<img class="podium-avatar" src={entry.avatarUrl} alt={entry.userName} loading="lazy" />
								{:else}
									<div class="podium-avatar avatar-fallback">{entry.userName.charAt(0).toUpperCase()}</div>
								{/if}
								<span class="medal-badge">{rank}</span>
							</div>
							<div class="podium-name" title={entry.userName}>{entry.userName}</div>
							<div class="podium-score">{fmtScore(entry.score)}<span class="podium-unit"> {CATEGORY_LABELS[config.category].unit}</span></div>
							<div class="pedestal" style="height: {height}px;">
								<div class="pedestal-rank">#{rank}</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Liste rang 4 à topN -->
			{#if rest.length > 0}
				<ul class="rest-list">
					{#each rest as entry, i (entry.userId)}
						<li class="rest-row" in:scale={{ start: 0.95, duration: 220, delay: 600 + i * 60, easing: cubicOut }}>
							<span class="rest-rank">#{i + 4}</span>
							{#if entry.avatarUrl}
								<img class="rest-avatar" src={entry.avatarUrl} alt={entry.userName} loading="lazy" />
							{:else}
								<div class="rest-avatar avatar-fallback">{entry.userName.charAt(0).toUpperCase()}</div>
							{/if}
							<span class="rest-name">{entry.userName}</span>
							<span class="rest-score">{fmtScore(entry.score)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style>
	.overlay-root {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		pointer-events: none;
	}

	.overlay-root.recap {
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
	}

	.card {
		--card-bg:   rgba(15, 23, 42, 0.94);
		--text-color: #f1f5f9;
		--accent:     var(--nx-cyan);
		background: var(--card-bg);
		backdrop-filter: blur(12px);
		border-radius: 20px;
		padding: 24px 28px 28px;
		min-width: 380px;
		max-width: 520px;
		border: 1px solid color-mix(in oklab, var(--accent) 25%, transparent);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
	}

	.title {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 8px;
		padding-bottom: 16px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.title h1 {
		margin: 0;
		font-size: 18px;
		font-weight: 800;
		color: var(--text-color);
		letter-spacing: -0.01em;
	}
	.period {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		font-weight: 600;
		color: var(--text-color);
		opacity: 0.5;
	}
	.recap-badge {
		display: inline-block;
		padding: 2px 10px;
		border-radius: 999px;
		background: #f43f5e;
		color: #fff;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.14em;
		animation: recap-pulse 1.5s ease-in-out infinite;
	}
	@keyframes recap-pulse {
		0%, 100% { box-shadow: 0 0 0 0 rgba(244, 63, 94, 0.6); }
		50%      { box-shadow: 0 0 0 8px rgba(244, 63, 94, 0); }
	}

	.empty-msg {
		text-align: center;
		padding: 24px;
		color: var(--text-color);
		opacity: 0.55;
		font-size: 13px;
	}

	/* ── PODIUM ─────────────────────────────────────────────────────────── */

	.podium {
		display: flex;
		align-items: flex-end;
		justify-content: center;
		gap: 8px;
		margin: 28px 0 0;
		padding-bottom: 0;
	}
	.podium.single { gap: 0; }

	.podium-slot {
		display: flex;
		flex-direction: column;
		align-items: center;
		flex: 1;
		max-width: 140px;
	}

	.podium-avatar-wrap {
		position: relative;
		margin-bottom: 6px;
	}

	.podium-avatar {
		width: 56px;
		height: 56px;
		border-radius: 50%;
		object-fit: cover;
		border: 3px solid var(--medal);
		box-shadow: 0 4px 16px color-mix(in oklab, var(--medal) 45%, transparent);
		background: #1e293b;
	}
	.rank-1 .podium-avatar {
		width: 72px;
		height: 72px;
		border-width: 4px;
		box-shadow: 0 6px 24px color-mix(in oklab, var(--medal) 60%, transparent);
	}

	.avatar-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-weight: 700;
		color: #fff;
		background: linear-gradient(135deg, var(--medal), color-mix(in oklab, var(--medal) 60%, black));
		font-size: 22px;
	}
	.rank-1 .avatar-fallback { font-size: 28px; }

	.medal-badge {
		position: absolute;
		bottom: -6px;
		right: -6px;
		min-width: 24px;
		height: 24px;
		padding: 0 6px;
		border-radius: 999px;
		background: var(--medal);
		color: #0a0a14;
		font-weight: 900;
		font-size: 12px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
		border: 2px solid #0a0a14;
	}
	.rank-1 .medal-badge { width: 28px; height: 28px; font-size: 14px; }

	.podium-name {
		font-size: 12px;
		font-weight: 700;
		color: var(--text-color);
		margin-top: 4px;
		max-width: 130px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rank-1 .podium-name { font-size: 14px; }

	.podium-score {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-size: 13px;
		font-weight: 700;
		color: var(--medal);
		margin-top: 1px;
	}
	.rank-1 .podium-score { font-size: 15px; }
	.podium-unit {
		font-size: 9px;
		opacity: 0.6;
		text-transform: lowercase;
		letter-spacing: 0.05em;
		font-weight: 500;
	}

	.pedestal {
		width: 100%;
		max-width: 110px;
		margin-top: 10px;
		border-radius: 6px 6px 0 0;
		background: linear-gradient(180deg,
			color-mix(in oklab, var(--medal) 30%, transparent),
			color-mix(in oklab, var(--medal) 12%, transparent));
		border: 1px solid color-mix(in oklab, var(--medal) 35%, transparent);
		border-bottom: none;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding-top: 8px;
		position: relative;
	}
	.pedestal-rank {
		font-family: 'JetBrains Mono', monospace;
		font-size: 22px;
		font-weight: 900;
		color: var(--medal);
		line-height: 1;
		opacity: 0.85;
	}
	.rank-1 .pedestal-rank { font-size: 28px; }

	/* ── LISTE rang 4-N ────────────────────────────────────────────────── */

	.rest-list {
		margin: 18px 0 0;
		padding: 0;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rest-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 10px;
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.025);
		border: 1px solid rgba(255, 255, 255, 0.04);
	}
	.rest-rank {
		font-family: 'JetBrains Mono', monospace;
		font-size: 11px;
		font-weight: 700;
		color: var(--text-color);
		opacity: 0.4;
		width: 26px;
	}
	.rest-avatar {
		width: 26px;
		height: 26px;
		border-radius: 50%;
		object-fit: cover;
		background: #1e293b;
	}
	.rest-avatar.avatar-fallback {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 12px;
		background: linear-gradient(135deg, var(--accent), color-mix(in oklab, var(--accent) 60%, black));
	}
	.rest-name {
		flex: 1;
		font-size: 12px;
		color: var(--text-color);
		opacity: 0.85;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rest-score {
		font-family: 'JetBrains Mono', monospace;
		font-variant-numeric: tabular-nums;
		font-size: 12px;
		font-weight: 700;
		color: var(--accent);
	}

	/* ── THEMES ─────────────────────────────────────────────────────────── */

	.theme-soft {
		--card-bg:   rgba(255, 255, 255, 0.96);
		--text-color: #1e293b;
	}
	.theme-soft .rest-row { background: rgba(15, 23, 42, 0.04); border-color: rgba(15, 23, 42, 0.06); }

	.theme-retro {
		font-family: 'VT323', monospace;
		background: #1a1a2e;
		border-radius: 0;
		border: 3px solid var(--accent);
		box-shadow: 6px 6px 0 0 color-mix(in oklab, var(--accent) 60%, black);
	}
	.theme-retro .title h1 { font-size: 24px; font-weight: 400; }
	.theme-retro .podium-name  { font-size: 18px; font-weight: 400; }
	.theme-retro .podium-score { font-size: 18px; }
	.theme-retro .pedestal     { border-radius: 0; }
	.theme-retro .rest-row     { border-radius: 0; }
	.theme-retro .rest-rank,
	.theme-retro .rest-name,
	.theme-retro .rest-score   { font-size: 14px; font-family: 'VT323', monospace; }

	.theme-neon {
		--card-bg: #050511;
		border: 2px solid var(--accent);
		box-shadow:
			0 0 18px var(--accent),
			0 0 36px color-mix(in oklab, var(--accent) 50%, transparent);
	}
	.theme-neon .title h1 { text-shadow: 0 0 8px var(--accent); }
	.theme-neon .podium-avatar { box-shadow: 0 0 16px var(--medal), 0 0 32px color-mix(in oklab, var(--medal) 50%, transparent); }

	.theme-minimal {
		background: transparent;
		backdrop-filter: none;
		border: none;
		box-shadow: none;
	}
	.theme-minimal .title h1     { font-size: 22px; text-shadow: 0 2px 8px rgba(0,0,0,0.7); }
	.theme-minimal .podium-name  { color: #fff; text-shadow: 0 2px 6px rgba(0,0,0,0.8); }
	.theme-minimal .rest-row     { background: rgba(0,0,0,0.55); backdrop-filter: blur(6px); }

	.theme-custom {
		/* --card-bg + --text-color via inline style */
	}

	/* ── STATUS ─────────────────────────────────────────────────────────── */

	.status-msg {
		padding: 8px 14px;
		border-radius: 8px;
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
		font-size: 12px;
		font-weight: 500;
	}
	.status-loading {
		background: rgba(15, 23, 42, 0.85);
		color: #94a3b8;
		border-color: rgba(148, 163, 184, 0.2);
	}
</style>
