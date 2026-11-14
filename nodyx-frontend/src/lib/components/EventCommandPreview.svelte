<script lang="ts">
	// Ce que « /événement … » a compris, AVANT toute publication (maquette
	// https://nodyx.org/commandes-maquette.html, « Aperçu avant d'agir »). Rien n'est créé :
	// « Ouvrir le formulaire » l'ouvre déjà rempli, la personne vérifie et publie.
	import { t, locale } from '$lib/i18n'
	import type { EventDraft } from '$lib/eventCommand'

	let { draft, empty, onopen, oncancel }: {
		draft: EventDraft
		/** Rien après la commande : on montre comment l'écrire. */
		empty: boolean
		onopen: () => void
		oncancel: () => void
	} = $props()

	const when = $derived.by(() => {
		if (!draft.day) return ''
		const d = new Date(draft.day.y, draft.day.m - 1, draft.day.d)
		const day = new Intl.DateTimeFormat($locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(d)
		if (!draft.time) return day
		const time = `${String(draft.time.h).padStart(2, '0')}:${String(draft.time.mi).padStart(2, '0')}`
		return `${day} ${$t('cmd.event_at', { time })}`
	})
</script>

<div class="ecp" role="status" aria-live="polite" aria-label={$t('cmd.event_aria')}>
	<span class="ecp-i" aria-hidden="true">
		<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
	</span>
	<div class="ecp-t">
		{#if empty}
			<p>{$t('cmd.event_hint')}</p>
		{:else}
			<p><b>{$t('cmd.event_preview', { title: draft.title || $t('cmd.event_untitled') })}</b>{#if when}, <b>{when}</b>{/if}</p>
			<small>{$t('cmd.event_note')}{#if !draft.day} {$t('cmd.event_no_date')}{:else if !draft.time} {$t('cmd.event_no_time')}{/if}</small>
		{/if}
		<span class="ecp-acts">
			<button type="button" class="ecp-b primary" onmousedown={(e) => e.preventDefault()} onclick={onopen}>{$t('cmd.event_open')} <kbd>{$t('mention.key_enter')}</kbd></button>
			<button type="button" class="ecp-b ghost" onmousedown={(e) => e.preventDefault()} onclick={oncancel}>{$t('cmd.event_cancel')} <kbd>{$t('mention.key_esc')}</kbd></button>
		</span>
	</div>
</div>

<style>
	.ecp { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 6px; padding: 9px 11px; border-radius: 10px; font-size: 13px;
		border: 1px solid color-mix(in srgb, var(--nx-info, #3b82f6) 28%, transparent);
		background: color-mix(in srgb, var(--nx-info, #3b82f6) 6%, var(--nx-surface)); color: var(--nx-text); }
	.ecp-i { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; flex: none;
		background: color-mix(in srgb, var(--nx-info, #3b82f6) 15%, transparent); color: var(--nx-info, #3b82f6); }
	.ecp-i svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.ecp-t { flex: 1; min-width: 0; }
	.ecp-t p { margin: 0; overflow-wrap: anywhere; }
	.ecp-t small { display: block; color: var(--nx-text-muted); font-size: 12px; margin-top: 2px; }
	.ecp-acts { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
	.ecp-b { display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; padding: 3px 10px; font-size: 12px; font-weight: 600; cursor: pointer;
		border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); }
	.ecp-b.primary { background: var(--nx-header-accent); color: var(--nx-on-accent, #fff); border-color: transparent; }
	.ecp-b.ghost { border-color: transparent; background: transparent; color: var(--nx-text-muted); font-weight: 500; }
	.ecp-b kbd { font: inherit; font-size: 10.5px; opacity: .75; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); border-radius: 4px; padding: 0 4px; }
	.ecp-b:focus-visible { outline: 2px solid var(--nx-header-accent); outline-offset: 2px; }
</style>
