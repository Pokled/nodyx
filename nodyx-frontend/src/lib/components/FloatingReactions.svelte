<script lang="ts">
	import { socket } from '$lib/socket'

	// ── Types ─────────────────────────────────────────────────────────────────
	interface FloatingEmoji {
		id:       number
		emoji:    string
		x:        number   // % from left edge
		drift:    number   // px, horizontal drift during float
		username: string
		big:      boolean  // combo mode
	}

	// ── State ─────────────────────────────────────────────────────────────────
	let items   = $state<FloatingEmoji[]>([])
	let counter = 0

	// ── Combo detection ───────────────────────────────────────────────────────
	const recentByEmoji  = new Map<string, number[]>()
	const COMBO_THRESHOLD = 5       // 5 mêmes emojis…
	const COMBO_WINDOW    = 3_000   // …en 3 secondes = COMBO
	const MAX_ON_SCREEN   = 20

	function isCombo(emoji: string): boolean {
		const now  = Date.now()
		const prev = (recentByEmoji.get(emoji) ?? []).filter(t => now - t < COMBO_WINDOW)
		return prev.length >= COMBO_THRESHOLD - 1
	}

	function trackEmoji(emoji: string): void {
		const now  = Date.now()
		const prev = (recentByEmoji.get(emoji) ?? []).filter(t => now - t < COMBO_WINDOW)
		recentByEmoji.set(emoji, [...prev, now])
	}

	// ── Add a reaction to the overlay ─────────────────────────────────────────
	function addReaction(emoji: string, username: string, xFrac: number): void {
		if (items.length >= MAX_ON_SCREEN) return
		const big   = isCombo(emoji)
		trackEmoji(emoji)
		const id    = ++counter
		const x     = Math.max(3, Math.min(88, xFrac * 100))
		const drift = (Math.random() - 0.5) * 90
		items = [...items, { id, emoji, x, drift, username, big }]
		setTimeout(() => { items = items.filter(i => i.id !== id) }, big ? 3_200 : 2_600)
	}

	// ── Socket listener (reactive to socket store) ────────────────────────────
	$effect(() => {
		const sock = $socket
		if (!sock) return

		function onEvent(data: { emoji: string; x: number; username: string }) {
			addReaction(data.emoji, data.username, data.x ?? 0.5)
		}

		sock.on('chat:float_reaction', onEvent)
		return () => { sock.off('chat:float_reaction', onEvent) }
	})
</script>

<!-- Fixed overlay — pointer-events:none, ne bloque pas les clics -->
<div
	class="fixed inset-0 pointer-events-none overflow-hidden"
	style="z-index: 998"
	aria-hidden="true"
>
	{#each items as item (item.id)}
		<div
			class="fr-emoji {item.big ? 'fr-emoji--combo' : ''}"
			style="left: {item.x}%; bottom: 140px; --drift: {item.drift}px;"
		>
			{item.emoji}
			{#if item.big}
				<span class="fr-combo-label">COMBO!</span>
			{/if}
		</div>
	{/each}
</div>

<style>
	.fr-emoji {
		position:       absolute;
		font-size:      2rem;
		line-height:    1;
		user-select:    none;
		pointer-events: none;
		animation:      fr-float 2.6s cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
		filter:         drop-shadow(0 2px 8px rgba(0, 0, 0, 0.55));
	}

	.fr-emoji--combo {
		font-size:  3.5rem;
		animation:  fr-float-combo 3.2s cubic-bezier(0.2, 0.9, 0.3, 1) forwards;
		filter:
			drop-shadow(0 0 18px rgba(255, 215, 0, 0.85))
			drop-shadow(0 2px 8px rgba(0, 0, 0, 0.6));
	}

	.fr-combo-label {
		display:       block;
		font-size:     0.65rem;
		font-weight:   900;
		text-align:    center;
		color:         #ffd700;
		text-shadow:   0 0 10px rgba(255, 215, 0, 0.9);
		font-family:   'Space Grotesk', sans-serif;
		letter-spacing: 0.12em;
		margin-top:    3px;
	}

	@keyframes fr-float {
		0%   { transform: translateY(0)    translateX(0)                 scale(0.15); opacity: 0; }
		8%   { transform: translateY(-18px) translateX(0)                scale(1.35); opacity: 1; }
		20%  { transform: translateY(-70px) translateX(calc(var(--drift) * 0.2)) scale(1.0); }
		75%  { opacity: 0.85; }
		100% { transform: translateY(-58vh) translateX(var(--drift))     scale(0.65); opacity: 0; }
	}

	@keyframes fr-float-combo {
		0%   { transform: translateY(0)     scale(0.1)  rotate(-12deg); opacity: 0; }
		6%   { transform: translateY(-25px) scale(1.65) rotate(6deg);   opacity: 1; }
		14%  { transform: translateY(-80px) scale(1.2)  rotate(-2deg); }
		75%  { opacity: 0.9; }
		100% { transform: translateY(-68vh) translateX(var(--drift)) scale(0.75); opacity: 0; }
	}
</style>
