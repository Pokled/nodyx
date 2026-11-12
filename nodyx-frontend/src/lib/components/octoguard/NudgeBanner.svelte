<script lang="ts">
	// « Tu es sûr ? » (OctoGuard 2, lot 5) : prévient l'auteur, AVANT l'envoi,
	// qu'OctoGuard retiendrait ou refuserait son message. Il le reformule ou
	// l'envoie quand même. Jamais le nom de la règle (D20) : ce qui arriverait,
	// et de quelle sorte de souci il s'agit.
	import { t } from '$lib/i18n'
	import type { Nudge } from '$lib/octoguard/nudge'

	let { nudge, onReformulate, onSendAnyway, busy = false, publish = false, autofocus = true }: {
		nudge: Nudge
		onReformulate: () => void
		onSendAnyway: () => void
		busy?: boolean
		/** Forum : « Publier quand même » au lieu d'« Envoyer quand même » */
		publish?: boolean
		/** Faux pour un aperçu (page d'admin) : ne pas voler le focus */
		autofocus?: boolean
	} = $props()
	const tFn = $derived($t)
	let reformulateBtn = $state<HTMLButtonElement | null>(null)

	// Le bandeau apparaît à la place de l'envoi : le focus va sur « Reformuler »,
	// pour qu'un lecteur d'écran l'annonce et qu'Entrée ne renvoie pas le message.
	$effect(() => { if (autofocus) reformulateBtn?.focus() })
</script>

<div class="og-nudge" role="alertdialog" aria-labelledby="og-nudge-title" aria-describedby="og-nudge-why">
	<svg class="og-nudge-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
		<path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
	</svg>
	<div class="og-nudge-body">
		<p class="og-nudge-text">
			<b id="og-nudge-title">{tFn(`ognudge.title_${nudge.outcome}`)}</b>
			<span id="og-nudge-why" class="og-nudge-why">{tFn(`ognudge.why_${nudge.kind}`)}</span>
		</p>
		<div class="og-nudge-actions">
			<button type="button" class="og-nudge-btn og-nudge-btn--primary" bind:this={reformulateBtn} onclick={onReformulate}>{tFn('ognudge.reformulate')}</button>
			<button type="button" class="og-nudge-btn" disabled={busy} onclick={onSendAnyway}>{tFn(publish ? 'ognudge.publish_anyway' : 'ognudge.send_anyway')}</button>
		</div>
	</div>
</div>

<style>
	.og-nudge { display: flex; gap: 0.625rem; align-items: flex-start; padding: 0.625rem 0.75rem; margin-bottom: 0.375rem; border-radius: 8px; font-size: 13px; line-height: 1.45;
		border: 1px solid color-mix(in srgb, var(--nx-warn) 40%, transparent); background: color-mix(in srgb, var(--nx-warn) 8%, var(--nx-surface, transparent)); color: var(--nx-text); }
	.og-nudge-ico { width: 18px; height: 18px; flex-shrink: 0; margin-top: 1px; color: var(--nx-warn); }
	.og-nudge-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
	.og-nudge-text { margin: 0; }
	.og-nudge-why { color: var(--nx-text-muted); }
	.og-nudge-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
	.og-nudge-btn { padding: 0.3125rem 0.75rem; border-radius: 6px; font-size: 12.5px; font-weight: 600; cursor: pointer; color: var(--nx-text);
		border: 1px solid color-mix(in srgb, var(--nx-text) 18%, transparent); background: color-mix(in srgb, var(--nx-text) 5%, transparent); transition: background 0.15s; }
	.og-nudge-btn:hover:not(:disabled) { background: color-mix(in srgb, var(--nx-text) 10%, transparent); }
	.og-nudge-btn:disabled { opacity: 0.5; cursor: default; }
	.og-nudge-btn--primary { color: #fff; border-color: transparent; background: var(--nx-accent); }
	.og-nudge-btn--primary:hover:not(:disabled) { background: color-mix(in srgb, var(--nx-accent) 85%, #000); }
	.og-nudge-btn:focus-visible { outline: 2px solid var(--nx-accent); outline-offset: 2px; }
</style>
