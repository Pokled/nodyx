<script lang="ts">
	/**
	 * Barre de publication de l'apparence : état du brouillon, Annuler /
	 * Rétablir (et leurs raccourcis), Revenir à la version publiée, Publier.
	 * Branchée sur le moteur unique (appearanceEngine) : la même barre sert à
	 * l'écran Apparence et au stylo en direct (SPECS/NODYX_APPARENCE_CDC.md).
	 */
	import type { Snippet } from 'svelte'
	import { t } from '$lib/i18n'
	import { appearance } from '$lib/appearanceEngine'

	let { extra }: { extra?: Snippet } = $props()
	const tFn = $derived($t)

	const status = $derived($appearance.status)
	const dirty = $derived(status === 'draft' || status === 'saving')
	const statusLabel = $derived(({
		idle: tFn('appr.status_loading'), loading: tFn('appr.status_loading'), published: tFn('appr.status_published'),
		saving: tFn('appr.status_saving'), draft: tFn('appr.status_draft'), publishing: tFn('appr.status_publishing'),
		error: $appearance.error,
	} as Record<string, string>)[status])

	function onKey(e: KeyboardEvent) {
		// Pas quand on tape dans un champ : Ctrl+Z y garde son sens natif.
		const el = e.target as HTMLElement
		if (el.closest('input[type="text"], input:not([type]), textarea, [contenteditable="true"]')) return
		if (!(e.ctrlKey || e.metaKey)) return
		const k = e.key.toLowerCase()
		if (k === 'z' && !e.shiftKey) { e.preventDefault(); appearance.undo() }
		else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); appearance.redo() }
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="appr-bar" class:dirty class:error={status === 'error'}>
	<span class="appr-dot"></span>
	<!-- Seul le texte d'état est annoncé en direct, pas les boutons. -->
	<span class="appr-status" role="status" aria-live="polite">{statusLabel}</span>
	<span class="appr-sep" aria-hidden="true"></span>
	<button type="button" class="appr-icon" disabled={!$appearance.hist.past.length} onclick={() => appearance.undo()} title={tFn('appr.undo')} aria-label={tFn('appr.undo')}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/></svg>
	</button>
	<button type="button" class="appr-icon" disabled={!$appearance.hist.future.length} onclick={() => appearance.redo()} title={tFn('appr.redo')} aria-label={tFn('appr.redo')}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/></svg>
	</button>
	<button type="button" class="appr-ghost" disabled={!dirty} onclick={() => appearance.revert()}>{tFn('appr.revert')}</button>
	<button type="button" class="appr-primary" disabled={!dirty || status === 'saving'} onclick={() => appearance.publish()}>{tFn('appr.publish')}</button>
	{#if extra}<span class="appr-sep" aria-hidden="true"></span>{@render extra()}{/if}
</div>

<style>
	.appr-bar {
		/* Au-dessus de la barre de navigation du bas sur mobile. */
		position: fixed; left: 50%; bottom: calc(var(--bottom-nav-h, 0px) + var(--shell-gap, 0px) + 18px); transform: translateX(-50%); z-index: 70;
		display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 16px; border-radius: 999px; max-width: calc(100vw - 24px);
		background: rgb(17 24 39 / .88); backdrop-filter: blur(16px) saturate(1.5);
		box-shadow: 0 0 0 1px rgb(255 255 255 / .08), 0 12px 32px -8px rgb(0 0 0 / .7);
		font-size: 13px; color: #d1d5db; font-family: var(--font-shell);
	}
	.appr-dot { width: 8px; height: 8px; border-radius: 999px; background: #22c55e; flex-shrink: 0; }
	.appr-bar.dirty .appr-dot { background: var(--nx-header-accent); box-shadow: 0 0 10px var(--nx-header-accent); }
	.appr-bar.error .appr-dot { background: #ef4444; }
	.appr-status { min-width: 150px; margin-right: 4px; }
	.appr-sep { width: 1px; height: 18px; background: rgb(255 255 255 / .1); }
	.appr-icon { width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: none; background: transparent; color: #d1d5db; cursor: pointer; }
	.appr-icon svg { width: 16px; height: 16px; }
	.appr-icon:hover:not(:disabled) { background: rgb(255 255 255 / .06); color: #fff; }
	.appr-ghost, .appr-primary { padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; white-space: nowrap; }
	.appr-ghost { background: transparent; color: #d1d5db; }
	.appr-ghost:hover:not(:disabled) { background: rgb(255 255 255 / .06); }
	.appr-primary { background: var(--nx-header-accent); color: var(--nx-on-accent); }
	.appr-ghost:disabled, .appr-primary:disabled, .appr-icon:disabled { opacity: .35; cursor: default; }
	.appr-ghost:focus-visible, .appr-primary:focus-visible, .appr-icon:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	/* Emplacement pour les boutons propres au stylo (Ouvrir Apparence, Quitter). */
	.appr-bar :global(.appr-extra) {
		padding: 7px 12px; border-radius: 999px; font-size: 13px; font-weight: 500; border: none; cursor: pointer; white-space: nowrap;
		background: transparent; color: #d1d5db; text-decoration: none;
	}
	.appr-bar :global(.appr-extra:hover) { background: rgb(255 255 255 / .06); color: #fff; }
	.appr-bar :global(.appr-extra:focus-visible) { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
	@media (max-width: 640px) { .appr-status { display: none; } }
</style>
