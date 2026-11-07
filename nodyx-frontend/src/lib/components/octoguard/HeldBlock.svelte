<script lang="ts">
	// Un contenu de l'auteur retenu par OctoGuard (cran « Retenir ») : lui seul
	// le voit, « en attente de validation », jusqu'à la décision de l'équipe.
	// Jamais le nom de la règle (D20).
	import { t } from '$lib/i18n'
	import { htmlToText } from '$lib/octoguard/text'

	let { kind, content, title = null }: { kind: 'chat' | 'post' | 'thread' | 'post_edit'; content: string; title?: string | null } = $props()
	const tFn = $derived($t)
</script>

<div class="og-heldblock" role="status">
	<div class="og-heldblock-head">
		<span class="og-heldblock-pill">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
			{tFn('ogmsg.held_pill')}
		</span>
		<span class="og-heldblock-what">{tFn(`ogmsg.held_kind_${kind}`)}</span>
	</div>
	{#if title}<p class="og-heldblock-title">{title}</p>{/if}
	<p class="og-heldblock-text">{htmlToText(content)}</p>
	<p class="og-heldblock-help">{tFn(kind === 'post_edit' ? 'ogmsg.held_edit_help' : 'ogmsg.held_only_you')}</p>
</div>

<style>
	.og-heldblock { display: flex; flex-direction: column; gap: 0.375rem; padding: 0.875rem 1rem; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--nx-hold) 30%, var(--nx-border));
		background: color-mix(in srgb, var(--nx-hold) 6%, var(--nx-surface)); box-shadow: inset 3px 0 0 var(--nx-hold); }
	.og-heldblock-head { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
	.og-heldblock-pill { display: inline-flex; align-items: center; gap: 0.3rem; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 600;
		color: var(--nx-hold); border: 1px solid color-mix(in srgb, var(--nx-hold) 35%, transparent); background: color-mix(in srgb, var(--nx-hold) 10%, transparent); }
	.og-heldblock-pill svg { width: 12px; height: 12px; }
	.og-heldblock-what { font-size: 0.8125rem; font-weight: 600; color: var(--nx-text); }
	.og-heldblock-title { margin: 0; font-weight: 600; color: var(--nx-text); }
	.og-heldblock-text { margin: 0; font-size: 0.875rem; color: var(--nx-text); opacity: 0.85; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 14rem; overflow: auto; }
	.og-heldblock-help { margin: 0; font-size: 0.75rem; color: var(--nx-text-muted); }
</style>
