<script lang="ts">
	// Sous la zone de saisie (maquette https://nodyx.org/commandes-maquette.html, section 1) :
	// la ligne qui rappelle les touches et le bouton « ? » qui ouvre l'aide.
	//
	// D54 : les touches ne s'affichent que champ vide (elles ne gênent jamais l'écriture) ;
	// pendant la frappe, la ligne montre `hint` (les raccourcis d'envoi). Le « ? » reste.
	// Ordinateur : bulle ancrée au bouton. Téléphone : panneau du bas, sur un voile.
	import { browser } from '$app/env'
	import { onDestroy, tick } from 'svelte'
	import { t } from '$lib/i18n'
	import { anchoredPopover } from '$lib/actions/anchoredPopover'
	import { portal } from '$lib/actions/portal'
	import type { Trigger } from '$lib/commands'

	let { empty, triggers, ontry, hint = '', id = 'nx-cmd-help' }: {
		/** Le champ est vide : on montre les touches. */
		empty: boolean
		/** Les touches qui marchent ici (on n'annonce que ce qui marche). */
		triggers: Trigger[]
		/** Écrit la touche dans le champ et ouvre sa liste. */
		ontry: (t: Trigger) => void
		/** Ce qu'on montre pendant la frappe (raccourcis d'envoi). */
		hint?: string
		id?: string
	} = $props()

	const ROWS: Record<Trigger, { title: string; sub: string; ex: string; hint: string }> = {
		'@': { title: 'cmd.at_title', sub: 'cmd.at_sub', ex: 'cmd.at_ex', hint: 'cmd.hint_at' },
		'/': { title: 'cmd.slash_title', sub: 'cmd.slash_sub', ex: 'cmd.slash_ex', hint: 'cmd.hint_slash' },
	}

	let open = $state(false)
	let btn: HTMLButtonElement | null = $state(null)
	let panel: HTMLElement | null = $state(null)
	let narrow = $state(false)

	let mq: MediaQueryList | null = null
	const onMq = () => { narrow = !!mq?.matches }
	if (browser) { mq = window.matchMedia('(max-width: 639px)'); onMq(); mq.addEventListener('change', onMq) }
	onDestroy(() => mq?.removeEventListener('change', onMq))

	async function show() {
		open = true
		await tick()
		panel?.focus()
	}
	function hide(refocus = true) {
		if (!open) return
		open = false
		if (refocus) btn?.focus()
	}
	function tryKey(k: Trigger) {
		hide(false)
		ontry(k)
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide() }
	}
	// Un clic ailleurs ferme la bulle (le panneau du bas a son voile)
	function onDocDown(e: PointerEvent) {
		if (!open || narrow) return
		const el = e.target as Node
		if (panel?.contains(el) || btn?.contains(el)) return
		hide(false)
	}
	$effect(() => {
		if (!browser || !open) return
		document.addEventListener('pointerdown', onDocDown, true)
		return () => document.removeEventListener('pointerdown', onDocDown, true)
	})
</script>

<div class="ch">
	{#if empty}
		{#each triggers as k (k)}
			<button type="button" class="ch-k" onclick={() => tryKey(k)} title={$t(ROWS[k].title)}>
				<b>{k}</b><span class="ch-l">{$t(ROWS[k].hint)}</span>
			</button>
		{/each}
	{:else if hint}
		<span class="ch-hint">{hint}</span>
	{/if}
	<span class="ch-sp"></span>
	<button type="button" class="ch-q" bind:this={btn} aria-expanded={open} aria-controls={id} aria-haspopup="dialog"
		title={$t('cmd.help_title')} aria-label={$t('cmd.help_title')} onclick={() => (open ? hide() : show())}>?</button>
</div>

{#snippet body()}
	<div class="ch-h">
		<b id="{id}-title">{$t('cmd.help_title')}</b>
		<button type="button" class="ch-x" onclick={() => hide()} aria-label={$t('common.close')}>
			<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
		</button>
	</div>
	{#each triggers as k (k)}
		<div class="ch-row">
			<span class="ch-sym" aria-hidden="true">{k}</span>
			<div class="ch-t">
				<b>{$t(ROWS[k].title)}</b>
				<span>{$t(ROWS[k].sub)}</span>
				<span class="ch-ex">{$t('cmd.example')} <code>{$t(ROWS[k].ex)}</code></span>
			</div>
			{#if k === '/' && !empty}
				<span class="ch-start">{$t('cmd.slash_start_only')}</span>
			{:else}
				<button type="button" class="ch-try" onclick={() => tryKey(k)}>{$t('cmd.try')}</button>
			{/if}
		</div>
	{/each}
	<details class="ch-keys">
		<summary>{$t('cmd.keys_title')}</summary>
		<ul>
			<li><span>{$t('cmd.key_send')}</span><span><kbd>{$t('mention.key_enter')}</kbd></span></li>
			<li><span>{$t('cmd.key_newline')}</span><span><kbd>{$t('cmd.kbd_shift')}</kbd> + <kbd>{$t('mention.key_enter')}</kbd></span></li>
			<li><span>{$t('cmd.key_pick')}</span><span><kbd>↑</kbd> <kbd>↓</kbd> {$t('cmd.then')} <kbd>{$t('mention.key_enter')}</kbd></span></li>
			<li><span>{$t('cmd.key_close')}</span><span><kbd>{$t('mention.key_esc')}</kbd></span></li>
			<li><span>{$t('cmd.key_rich')}</span><span><kbd>{$t('cmd.kbd_ctrl')}</kbd> + <kbd>{$t('cmd.kbd_shift')}</kbd> + <kbd>E</kbd></span></li>
			<li><span>{$t('cmd.key_palette')}</span><span><kbd>{$t('cmd.kbd_ctrl')}</kbd> + <kbd>K</kbd></span></li>
			<li><span>{$t('cmd.key_ptt')}</span><span><kbd>{$t('cmd.kbd_alt')}</kbd></span></li>
		</ul>
	</details>
	<div class="ch-f">
		<a href="/help" onclick={() => hide(false)}>{$t('cmd.see_all_examples')}</a>
	</div>
{/snippet}

{#if open}
	{#if narrow}
		<div use:portal>
			<!-- Le voile : un clic ferme. Au clavier, Échap ferme (sur le panneau). -->
			<div class="ch-scrim" role="presentation" onclick={() => hide()}></div>
			<div class="ch-pop ch-sheet" {id} role="dialog" aria-modal="true" aria-labelledby="{id}-title" tabindex="-1" bind:this={panel} onkeydown={onKey}>
				{@render body()}
			</div>
		</div>
	{:else}
		<div class="ch-pop" {id} role="dialog" aria-labelledby="{id}-title" tabindex="-1" bind:this={panel} onkeydown={onKey}
			use:anchoredPopover={{ anchor: btn, placement: 'top', align: 'end', gap: 8 }}>
			{@render body()}
		</div>
	{/if}
{/if}

<style>
	.ch { display: flex; align-items: center; gap: 4px 12px; flex-wrap: wrap; min-height: 26px; margin-top: 4px; font-size: 12px; color: var(--nx-text-muted); }
	.ch-k { display: inline-flex; align-items: center; gap: 5px; border: 0; background: none; padding: 2px 5px; border-radius: 6px; color: var(--nx-text-muted); font-size: 12px; cursor: pointer; }
	.ch-k:hover { background: color-mix(in srgb, var(--nx-text) 6%, transparent); color: var(--nx-text); }
	.ch-k b { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); }
	.ch-hint { font-size: 10.5px; }
	.ch-sp { flex: 1; }
	.ch-q { width: 24px; height: 24px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); background: var(--nx-surface); color: var(--nx-text-muted); font-weight: 700; font-size: 13px; display: grid; place-items: center; padding: 0; cursor: pointer; flex: none; }
	.ch-q:hover, .ch-q[aria-expanded="true"] { border-color: var(--nx-header-accent); color: var(--nx-text); background: color-mix(in srgb, var(--nx-header-accent) 14%, var(--nx-surface)); }
	@media (max-width: 520px) { .ch-l { display: none; } }

	.ch-pop { position: fixed; z-index: 70; width: 380px; max-width: calc(100vw - 16px); background: var(--nx-surface); color: var(--nx-text); border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 14px; box-shadow: 0 16px 40px rgba(0,0,0,.22); overflow: hidden; outline: none; }
	.ch-sheet { left: 0; right: 0; bottom: 0; width: 100%; max-width: 100%; border-radius: 16px 16px 0 0; max-height: 85vh; overflow: auto; padding-bottom: env(safe-area-inset-bottom); }
	.ch-scrim { position: fixed; inset: 0; z-index: 69; background: rgba(0,0,0,.4); }
	.ch-h { display: flex; align-items: center; gap: 8px; padding: 12px 14px 8px; }
	.ch-h b { font-size: 14.5px; flex: 1; }
	.ch-x { border: 0; background: none; color: var(--nx-text-muted); border-radius: 6px; width: 28px; height: 28px; display: grid; place-items: center; cursor: pointer; }
	.ch-x:hover { background: color-mix(in srgb, var(--nx-text) 6%, transparent); }
	.ch-x svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
	.ch-row { display: flex; gap: 12px; align-items: flex-start; padding: 10px 14px; border-top: 1px solid color-mix(in srgb, var(--nx-text) 7%, transparent); }
	.ch-sym { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; flex: none; font: 700 17px ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--nx-header-accent) 16%, transparent); color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); }
	.ch-t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
	.ch-t b { font-size: 13.5px; }
	.ch-t > span { font-size: 12.5px; color: var(--nx-text-muted); }
	.ch-t .ch-ex { margin-top: 3px; font-size: 12px; color: var(--nx-text-faint); }
	.ch-ex code { color: var(--nx-text); background: color-mix(in srgb, var(--nx-text) 7%, transparent); padding: 0 5px; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
	.ch-try { align-self: center; border: 1px solid color-mix(in srgb, var(--nx-text) 14%, transparent); background: var(--nx-surface); color: var(--nx-text); border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
	.ch-start { align-self: center; max-width: 92px; font-size: 11px; line-height: 1.3; color: var(--nx-text-faint); text-align: right; }
	.ch-try:hover { border-color: var(--nx-header-accent); }
	.ch-keys { border-top: 1px solid color-mix(in srgb, var(--nx-text) 7%, transparent); padding: 9px 14px; font-size: 12.5px; }
	.ch-keys summary { cursor: pointer; color: var(--nx-text-muted); font-weight: 600; }
	.ch-keys ul { list-style: none; margin: 8px 0 2px; padding: 0; display: grid; gap: 6px; }
	.ch-keys li { display: flex; justify-content: space-between; gap: 10px; color: var(--nx-text-muted); }
	.ch-keys li > span:last-child { white-space: nowrap; }
	kbd { font-family: inherit; font-size: 11px; border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; background: var(--nx-surface); color: var(--nx-text-muted); }
	.ch-f { padding: 10px 14px; border-top: 1px solid color-mix(in srgb, var(--nx-text) 7%, transparent); background: color-mix(in srgb, var(--nx-text) 2%, var(--nx-surface)); font-size: 12.5px; }
	.ch-f a { color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); text-decoration: underline; }
</style>
