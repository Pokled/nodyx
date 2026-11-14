<script lang="ts">
	// Un jeu du chat tiré par le SERVEUR (lot C2, D56 ; maquette
	// https://nodyx.org/commandes-maquette.html, section 3). Rendu depuis `game`, dans la
	// langue du LECTEUR, avec la marque « Lancé par Nodyx » : seul le cœur écrit `game`,
	// donc la marque ne s'imite pas. Aucun {@html} : pseudo et question restent du texte.
	import { t } from '$lib/i18n'

	type Move = 'rock' | 'paper' | 'scissors'
	let { game, author }: { game: any; author: string } = $props()

	const EMOJI: Record<Move, string> = { rock: '🪨', paper: '📄', scissors: '✂️' }
	const ICON: Record<string, string> = { roll: '🎲', flip: '🪙', '8ball': '🎱', rps: '✊' }

	/** Un texte traduit découpé autour de ses variables, pour mettre le pseudo en gras sans HTML. */
	function pieces(key: string, vars: Record<string, string>): { text: string; strong: boolean }[] {
		const mark = Object.fromEntries(Object.keys(vars).map(k => [k, `\u0000${k}\u0000`]))
		return $t(key, mark).split('\u0000').filter(Boolean).map(p => (p in vars ? { text: vars[p], strong: p === 'user' } : { text: p, strong: false }))
	}

	const ok = $derived(!!game && game.v === 1 && typeof game.kind === 'string' && game.result && typeof game.result === 'object')
	const view = $derived.by(() => {
		if (!ok) return null
		const g = game
		switch (g.kind) {
			case 'roll': {
				const rolls: number[] = Array.isArray(g.result.rolls) ? g.result.rolls.map(Number) : []
				return { head: pieces('cmd.game_roll', { user: author, dice: `${Number(g.input?.n)}d${Number(g.input?.sides)}` }), detail: rolls.length > 1 ? `${rolls.join(' + ')} = ` : '', result: String(Number(g.result.total)), question: '' }
			}
			case 'flip':
				return { head: pieces('cmd.game_flip', { user: author }), detail: '', result: $t(g.result.side === 'heads' ? 'cmd.game_heads' : 'cmd.game_tails'), question: '' }
			case '8ball': {
				const a = Math.min(17, Math.max(1, Number(g.result.answer) || 1))
				return { head: pieces('cmd.game_8ball', { user: author }), detail: '', result: $t(`chat.cmd.8ball_${a}`), question: String(g.input?.question ?? '') }
			}
			case 'rps': {
				const me = EMOJI[g.input?.move as Move] ?? '?', bot = EMOJI[g.result.bot as Move] ?? '?'
				const o = g.result.outcome === 'win' ? 'cmd.game_rps_win' : g.result.outcome === 'lose' ? 'cmd.game_rps_lose' : 'cmd.game_rps_tie'
				return { head: pieces('cmd.game_rps', { user: author, me, bot }), detail: '', result: $t(o), question: '' }
			}
		}
		return null
	})
</script>

{#if view}
	<div class="gm" data-game={game.kind}>
		<span class="gm-ico" aria-hidden="true">{ICON[game.kind]}</span>
		<div class="gm-t">
			<span class="gm-line">
				{#each view.head as p, i (i)}{#if p.strong}<b>{p.text}</b>{:else}{p.text}{/if}{/each}
				{#if view.question}<q>{view.question}</q>{/if}
				<span class="gm-arrow" aria-hidden="true">→</span>
				{view.detail}<strong class="gm-res">{view.result}</strong>
			</span>
			<span class="gm-seal" title={$t('cmd.game_seal_title')}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg>
				{$t('cmd.game_seal')}
			</span>
		</div>
	</div>
{/if}

<style>
	.gm { display: inline-flex; align-items: flex-start; gap: 10px; margin-top: 3px; padding: 8px 12px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--nx-text) 10%, transparent); background: color-mix(in srgb, var(--nx-text) 3%, transparent); color: var(--nx-text); max-width: 100%; }
	.gm-ico { font-size: 18px; line-height: 1.3; flex: none; }
	.gm-t { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
	.gm-line { font-size: 13.5px; overflow-wrap: anywhere; }
	.gm-line q { margin-left: 4px; color: var(--nx-text-muted); font-style: italic; }
	.gm-arrow { margin: 0 4px; color: var(--nx-text-faint); }
	.gm-res { font-size: 15px; }
	.gm-seal { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; font-weight: 600; color: var(--nx-ok, #15803d); cursor: help; }
	.gm-seal svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
</style>
