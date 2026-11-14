<script lang="ts">
	// Le panneau d'aide par-dessus la page (lib/helpOverlay.ts). Ordinateur : grand
	// panneau centré sur un voile. Téléphone : plein écran. Fermer : la croix, Échap,
	// ou un clic sur le voile ; le focus revient où on écrivait. Changer de page le ferme.
	import { tick } from 'svelte'
	import { page } from '$app/state'
	import { portal } from '$lib/actions/portal'
	import { helpOverlayOpen, closeHelpOverlay } from '$lib/helpOverlay'
	import HelpContent from './HelpContent.svelte'

	let box: HTMLElement | null = $state(null)

	$effect(() => {
		if (!$helpOverlayOpen) return
		void tick().then(() => box?.focus({ preventScroll: true }))   // sans faire défiler le panneau
		// La page derrière ne défile plus pendant la lecture
		const prev = document.documentElement.style.overflow
		document.documentElement.style.overflow = 'hidden'
		return () => { document.documentElement.style.overflow = prev }
	})

	// Une navigation (lien de l'aide, retour arrière) ferme le panneau
	let lastPath = page.url.pathname
	$effect(() => {
		const p = page.url.pathname
		if (p !== lastPath) { lastPath = p; if ($helpOverlayOpen) helpOverlayOpen.set(false) }
	})

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeHelpOverlay(); return }
		// Le focus reste dans le panneau (dialogue modal)
		if (e.key === 'Tab' && box) {
			const f = [...box.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]:not([tabindex="-1"])')].filter(el => !el.hasAttribute('disabled') && el.offsetParent !== null)
			if (!f.length) return
			const first = f[0], last = f[f.length - 1]
			if (e.shiftKey && (document.activeElement === first || document.activeElement === box)) { e.preventDefault(); last.focus() }
			else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
		}
	}
</script>

{#if $helpOverlayOpen}
	<div use:portal class="ho">
		<div class="ho-scrim" role="presentation" onclick={closeHelpOverlay}></div>
		<div class="ho-box" role="dialog" aria-modal="true" aria-labelledby="nx-help-overlay-title" tabindex="-1" bind:this={box} onkeydown={onKey}>
			<HelpContent onclose={closeHelpOverlay} titleId="nx-help-overlay-title" />
		</div>
	</div>
{/if}

<style>
	.ho { position: fixed; inset: 0; z-index: 90; display: grid; place-items: start center; padding: 6vh 16px 16px; overflow-y: auto; overscroll-behavior: contain; }
	.ho-scrim { position: fixed; inset: 0; background: rgba(0,0,0,.45); }
	.ho-box { position: relative; width: min(940px, 100%); outline: none; border-radius: 16px; box-shadow: 0 24px 60px rgba(0,0,0,.35); margin-bottom: 6vh; }
	@media (max-width: 640px) {
		.ho { padding: 0; place-items: stretch; }
		.ho-box { width: 100%; min-height: 100%; margin: 0; border-radius: 0; box-shadow: none; background: var(--nx-surface); }
		.ho-box :global(.hp) { border: 0; border-radius: 0; }
	}
</style>
