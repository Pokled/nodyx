<!--
  Tooltip vivant pour une réaction (post forum, message DM, message chat).

  Différence avec un tooltip natif :
  - Chaque username garde le `name_color` du profil (la "signature" visuelle
    de la personne reste visible, on n'écrase pas en blanc générique)
  - Chaque ligne affiche un timestamp relatif ("à l'instant", "il y a 3 min",
    "il y a 2 j") — restaure la temporalité, on voit l'élan collectif si
    plusieurs réactions arrivent en rafale
  - Click sur un nom → /users/{username}
  - Si plus d'utilisateurs que le LIMIT backend (8), un compteur "+N autres"
    apparaît en bas, en gris discret
-->
<script lang="ts">

	import { t } from '$lib/i18n'
	const tFn = $derived($t)
	interface ReactionUser {
		username:   string
		name_color: string | null
		created_at: string
	}

	interface Props {
		users:  ReactionUser[]
		total:  number
		emoji:  string
		// Position d'ancrage : par défaut au-dessus du déclencheur, centré.
		anchor?: 'top' | 'bottom'
	}

	let { users, total, emoji, anchor = 'top' }: Props = $props()

	// Timestamp relatif "humain" — pas de lib externe, ~10 lignes.
	function relativeTime(iso: string): string {
		const now  = Date.now()
		const then = new Date(iso).getTime()
		const sec  = Math.max(0, Math.floor((now - then) / 1000))
		if (sec < 5)      return tFn('follow.just_now')
		if (sec < 60)     return `il y a ${sec} s`
		const min = Math.floor(sec / 60)
		if (min < 60)     return `il y a ${min} min`
		const h = Math.floor(min / 60)
		if (h < 24)       return `il y a ${h} h`
		const d = Math.floor(h / 24)
		if (d < 7)        return `il y a ${d} j`
		const w = Math.floor(d / 7)
		if (w < 5)        return `il y a ${w} sem`
		const mo = Math.floor(d / 30)
		if (mo < 12)      return `il y a ${mo} mois`
		const y = Math.floor(d / 365)
		return `il y a ${y} an${y > 1 ? 's' : ''}`
	}

	const extraCount = $derived(Math.max(0, total - users.length))
</script>

<div
	class="rt-tooltip"
	class:rt-tooltip--top={anchor === 'top'}
	class:rt-tooltip--bottom={anchor === 'bottom'}
	role="tooltip"
>
	<div class="rt-tooltip__header">
		<span class="rt-tooltip__emoji">{emoji}</span>
		<span class="rt-tooltip__count">{total}</span>
	</div>
	<ul class="rt-tooltip__list">
		{#each users as u (u.username + u.created_at)}
			<li class="rt-tooltip__row">
				<a
					href={`/users/${u.username}`}
					class="rt-tooltip__name"
					style={u.name_color ? `color: ${u.name_color}` : ''}
				>{u.username}</a>
				<span class="rt-tooltip__time">{relativeTime(u.created_at)}</span>
			</li>
		{/each}
	</ul>
	{#if extraCount > 0}
		<div class="rt-tooltip__more">+{extraCount} autre{extraCount > 1 ? 's' : ''}</div>
	{/if}
	<div class="rt-tooltip__arrow"></div>
</div>

<style>
	.rt-tooltip {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		min-width: 180px;
		max-width: 260px;
		background: rgba(15, 15, 22, 0.96);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 10px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.4);
		padding: 8px 4px 6px 4px;
		z-index: 100;
		font-size: 12px;
		color: #e2e8f0;
		opacity: 0;
		animation: rt-fade-in 0.16s cubic-bezier(.2,.7,.3,1) forwards;
		pointer-events: auto;
	}
	.rt-tooltip--top    { bottom: calc(100% + 8px); }
	.rt-tooltip--bottom { top:    calc(100% + 8px); }

	.rt-tooltip__header {
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding: 0 8px 6px 8px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		margin-bottom: 4px;
	}
	.rt-tooltip__emoji { font-size: 14px; line-height: 1; }
	.rt-tooltip__count {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: rgba(226, 232, 240, 0.45);
		font-weight: 700;
	}

	.rt-tooltip__list {
		list-style: none;
		margin: 0;
		padding: 0;
		max-height: 220px;
		overflow-y: auto;
	}
	.rt-tooltip__row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		padding: 3px 8px;
		border-radius: 4px;
	}
	.rt-tooltip__row:hover { background: rgba(255, 255, 255, 0.04); }

	.rt-tooltip__name {
		font-weight: 600;
		text-decoration: none;
		color: #cbd5e1;
		max-width: 140px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rt-tooltip__name:hover { text-decoration: underline; }

	.rt-tooltip__time {
		font-size: 10px;
		color: rgba(226, 232, 240, 0.4);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		flex-shrink: 0;
	}

	.rt-tooltip__more {
		padding: 4px 8px 0 8px;
		font-size: 10px;
		color: rgba(226, 232, 240, 0.35);
		text-align: center;
		border-top: 1px solid rgba(255, 255, 255, 0.04);
		margin-top: 4px;
	}

	/* Petite flèche pointant vers la réaction */
	.rt-tooltip__arrow {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		width: 0;
		height: 0;
		border-left: 5px solid transparent;
		border-right: 5px solid transparent;
	}
	.rt-tooltip--top .rt-tooltip__arrow {
		bottom: -5px;
		border-top: 5px solid rgba(15, 15, 22, 0.96);
	}
	.rt-tooltip--bottom .rt-tooltip__arrow {
		top: -5px;
		border-bottom: 5px solid rgba(15, 15, 22, 0.96);
	}

	@keyframes rt-fade-in {
		from { opacity: 0; transform: translateX(-50%) translateY(4px); }
		to   { opacity: 1; transform: translateX(-50%) translateY(0); }
	}
</style>
