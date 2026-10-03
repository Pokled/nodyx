<script lang="ts">
	/**
	 * Réduction du contenant flottant pour une ambiance et un mode donnés.
	 * Rendue avec EXACTEMENT les variables que le vrai site dérivera
	 * (deriveShellVars) : ce qu'on voit ici est ce qu'on aura, pas une
	 * illustration. Sert à voir le clair ET le sombre côte à côte, sans toucher
	 * à la préférence de l'admin qui regarde.
	 */
	import { t } from '$lib/i18n'
	import { deriveShellVars, backdropSource, contrast, type ShellTheme } from '$lib/shellTheme'

	let { theme, dark, banner, label }: { theme: ShellTheme; dark: boolean; banner: string | null; label: string } = $props()
	const tFn = $derived($t)

	const shellVars = $derived(deriveShellVars(theme, dark))
	const vars = $derived(Object.entries(shellVars).map(([k, v]) => `${k}:${v}`).join(';'))
	// Contraste réel de l'accent comme texte sur les plaques : la garantie de
	// lisibilité, rendue visible (AA dès 4,5:1, AAA dès 7:1).
	const ratio = $derived(contrast(shellVars['--nx-header-accent'], shellVars['--nx-surface']))
	const grade = $derived(ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : '')
	const backdrop = $derived(backdropSource(theme, banner))
	const links = $derived([tFn('nav.home'), tFn('nav.forum'), tFn('nav.dm')])
</script>

<figure class="mini" style={vars} aria-label={label}>
	<div class="mini-bg">
		{#if backdrop}<img src={backdrop} alt="" />{/if}
	</div>
	<div class="mini-rail"><span class="mini-logo"></span></div>
	<div class="mini-panel">
		<div class="mini-title">{tFn('appr.preview_community')}</div>
		{#each links as l, i (i)}
			<div class="mini-link" class:active={i === 1}>{l}</div>
		{/each}
	</div>
	<div class="mini-sheet">
		<div class="mini-h">{tFn('nav.forum')}</div>
		<div class="mini-line"></div>
		<div class="mini-line short"></div>
		<span class="mini-btn">{tFn('appr.preview_button')}</span>
	</div>
	<figcaption>
		{#if grade}<span class="mini-grade" title={tFn('appr.contrast_title')}>{grade} · {ratio.toFixed(1)}:1</span>{/if}
		{label}
	</figcaption>
</figure>

<style>
	.mini {
		position: relative; height: 190px; border-radius: 14px; overflow: hidden; margin: 0;
		background: var(--nx-bg); font-family: var(--font-shell);
		box-shadow: 0 0 0 1px rgb(255 255 255 / .06), 0 10px 30px -10px rgb(0 0 0 / .6);
		display: grid; grid-template-columns: 34px 110px 1fr; gap: 6px; padding: 8px;
	}
	.mini-bg { position: absolute; inset: 0; overflow: hidden; }
	.mini-bg img { position: absolute; inset: -12%; width: 124%; height: 124%; object-fit: cover; filter: var(--nx-wallpaper-filter); }
	.mini-bg::after { content: ''; position: absolute; inset: 0; background: var(--nx-wallpaper-veil); }
	.mini-rail, .mini-panel, .mini-sheet {
		position: relative; border-radius: 10px;
		background: var(--nx-glass); backdrop-filter: blur(14px) saturate(1.6);
		box-shadow: inset 0 1px 0 var(--nx-glass-rim, rgb(255 255 255 / .08)), 0 0 0 1px var(--nx-glass-edge, rgb(0 0 0 / .3));
	}
	.mini-rail { display: flex; justify-content: center; padding-top: 7px; }
	.mini-logo { width: 20px; height: 20px; border-radius: 7px; background: var(--nx-header-accent); box-shadow: 0 0 0 1.5px var(--nx-glass), 0 0 0 3px var(--nx-header-accent); }
	.mini-panel { padding: 8px 6px; display: flex; flex-direction: column; gap: 3px; }
	.mini-title { font: 700 10px var(--font-shell-rounded); color: var(--nx-text); padding: 0 4px 5px; }
	.mini-link { font-size: 9.5px; color: var(--nx-text-muted); padding: 4px 5px; border-radius: 6px; }
	.mini-link.active {
		color: var(--nx-header-accent); background: var(--nx-header-accent-soft);
		box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--nx-header-accent) 22%, transparent);
	}
	.mini-sheet { background: var(--nx-surface); padding: 10px 12px; display: flex; flex-direction: column; gap: 7px; align-items: flex-start; }
	.mini-h { font-size: 12px; font-weight: 700; color: var(--nx-text); }
	.mini-line { height: 6px; width: 90%; border-radius: 3px; background: var(--nx-border); }
	.mini-line.short { width: 60%; background: var(--nx-border-soft); }
	.mini-btn {
		margin-top: auto; font-size: 9.5px; font-weight: 600; padding: 4px 9px; border-radius: 6px;
		background: var(--nx-header-accent); color: var(--nx-on-accent);
	}
	figcaption {
		position: absolute; right: 10px; bottom: 8px; font-size: 10px; font-weight: 600; letter-spacing: .04em;
		color: var(--nx-text-faint); display: flex; align-items: center; gap: 8px;
	}
	.mini-grade {
		letter-spacing: 0; font-variant-numeric: tabular-nums; padding: 1px 6px; border-radius: 999px;
		color: var(--nx-header-accent); background: var(--nx-header-accent-soft);
	}
</style>
