<script lang="ts">
	// La page /help : le même contenu que le panneau d'aide (HelpContent), pour qui
	// l'ouvre directement (lien partagé, nouvel onglet). « Retour » ramène où on était
	// dans Nodyx ; arrivé d'ailleurs, il mène à l'accueil.
	import { goto, afterNavigate } from '$app/navigation'
	import { t } from '$lib/i18n'
	import HelpContent from '$lib/components/HelpContent.svelte'

	const tFn = $derived($t)

	// Arrivé ici par un lien DE Nodyx (navigation interne) : « Retour » revient
	// en arrière, à l'endroit exact. Arrivé directement (lien partagé, nouvel
	// onglet) : il n'y a pas d'« avant » dans Nodyx, on mène à l'accueil.
	// (`document.referrer` ne convient pas : il reste celui du premier chargement.)
	let fromInside = $state(false)
	afterNavigate(({ from }) => { fromInside = !!from?.url && from.url.pathname !== '/help' })

	function back(e: MouseEvent) {
		e.preventDefault()
		if (fromInside) history.back()
		else void goto('/')
	}
</script>

<svelte:head><title>{tFn('cmd.page_title')}</title></svelte:head>

<div class="hp-root">
	<a href="/" class="hp-back" onclick={back}>
		<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
		{tFn('cmd.back')}
	</a>
	<HelpContent />
</div>

<style>
	.hp-root { flex: 1 0 auto; max-width: 980px; width: 100%; margin: 0 auto; padding: 20px 16px 64px; color: var(--nx-text); }
	.hp-back { display: inline-flex; align-items: center; gap: 6px; margin: 0 0 12px; padding: 6px 12px 6px 8px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); background: var(--nx-surface); color: var(--nx-text); font-size: 13px; font-weight: 600; text-decoration: none; }
	.hp-back:hover { border-color: var(--nx-header-accent); }
	.hp-back svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	@media (max-width: 640px) { .hp-root { padding: 12px 8px 40px; } }
</style>
