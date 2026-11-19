<script lang="ts">
	// Ce qui représente un événement (D66) : la jaquette de son jeu, sinon son icône et
	// sa couleur, sinon le calendrier. Jamais une image venue d'ailleurs que l'instance.
	import { ICON_PATHS, CALENDAR_PATH, COLOR_BG, isGameIcon, isGameColor, isGameCover, type EventLook } from '$lib/eventGames'

	let { look, size = 'md', shape = 'tile', title = '' }: {
		look: EventLook
		/** xs 18 · sm 28 · md 44 · lg 64 · xl 96 (largeur) */
		size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl'
		/** tile : carré arrondi ; jaq : portrait 2:3, comme une jaquette */
		shape?: 'tile' | 'jaq'
		title?: string
	} = $props()

	const cover = $derived(isGameCover(look.game_cover) ? look.game_cover : null)
	const icon = $derived(isGameIcon(look.icon) ? look.icon : null)
	const bg = $derived(cover ? null : COLOR_BG[isGameColor(look.icon_color) ? look.icon_color : 'grey'])
	const label = $derived(title || look.game_name || '')
</script>

<span class="ev-vis ev-{size} ev-{shape}" class:ev-cover={!!cover} class:ev-plain={!cover && !icon}
	style={cover ? `background-image:url(${cover})` : icon ? `background:${bg}` : ''}
	role={label ? 'img' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : 'true'} title={label || undefined}>
	{#if !cover}
		<svg viewBox="0 0 24 24" aria-hidden="true">{@html icon ? ICON_PATHS[icon] : CALENDAR_PATH}</svg>
	{/if}
</span>

<style>
	.ev-vis { display: inline-grid; place-items: center; flex: none; color: #fff; background-size: cover; background-position: center; background-color: #14110c; box-shadow: inset 0 0 0 1px rgba(255,255,255,.12); vertical-align: middle; }
	.ev-plain { background: color-mix(in srgb, var(--nx-ok, #15803d) 15%, transparent); color: var(--nx-ok, #15803d); box-shadow: none; }
	.ev-vis svg { width: 58%; height: 58%; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.ev-tile { aspect-ratio: 1; }
	.ev-jaq { aspect-ratio: 2 / 3; }
	.ev-jaq.ev-cover { box-shadow: 0 6px 18px rgba(0,0,0,.25), inset 0 0 0 1px rgba(255,255,255,.08); }
	.ev-xs { width: 18px; border-radius: 5px; }
	.ev-sm { width: 28px; border-radius: 8px; }
	.ev-md { width: 44px; border-radius: 12px; }
	.ev-lg { width: 64px; border-radius: 14px; }
	.ev-xl { width: 96px; border-radius: 12px; }
</style>
