<script lang="ts">
	// NodyxEditor, chargé À LA DEMANDE.
	//
	// L'implémentation vit dans NodyxEditorCore.svelte (TipTap, ~1 800 lignes). Importée
	// en dur, elle partageait un bloc JS avec des fonctions internes de Svelte dont le
	// layout racine a besoin : CHAQUE page de Nodyx chargeait ~42 Ko (gzip) d'éditeur,
	// même l'accueil (mesuré le 13/11/2026). Importée ici dynamiquement, elle sort dans
	// son propre bloc, chargé seulement là où un éditeur s'affiche.
	//
	// Pendant le chargement : la même coque (même taille, pas de saut de page) et le
	// champ caché du formulaire déjà rempli, pour qu'un envoi immédiat ne perde rien.
	// Si le chargement échoue (page ouverte avant un déploiement, réseau coupé) : un
	// champ texte simple, pour ne jamais bloquer ni perdre ce que la personne écrit.
	import type { ComponentProps } from 'svelte'
	import type NodyxEditorCore from './NodyxEditorCore.svelte'
	import { t } from '$lib/i18n'

	let props: ComponentProps<typeof NodyxEditorCore> = $props()
	const tFn = $derived($t)

	const load = import('./NodyxEditorCore.svelte')
	load.catch(() => onFallbackError())

	// Repli texte simple. Pré-rempli avec le texte du contenu existant (modification) ;
	// le contenu d'origine n'est remplacé QUE si la personne change quelque chose, sinon
	// un simple « Enregistrer » aplatirait sa mise en forme.
	function htmlToText(html: string): string {
		if (!html || typeof DOMParser === 'undefined') return ''
		const doc = new DOMParser().parseFromString(html, 'text/html')
		doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'))
		return Array.from(doc.body.children).map(el => el.textContent?.trim() ?? '').filter(Boolean).join('\n\n')
			|| (doc.body.textContent ?? '').trim()
	}
	let fallbackText = $state('')
	let fallbackDirty = $state(false)
	function onFallbackError() { fallbackText = htmlToText(props.initialContent ?? '') }
	function textToHtml(text: string): string {
		const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		return text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
			.map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
	}
	const fallbackHtml = $derived(textToHtml(fallbackText))
	$effect(() => { if (fallbackDirty) props.onchange?.(fallbackHtml) })
</script>

{#await load}
	<input type="hidden" name={props.name ?? 'content'} value={props.initialContent ?? ''} />
	<div class="nodyx-editor rounded-xl border border-gray-700 themed:border-[var(--nx-border)] bg-gray-900 themed:bg-[var(--nx-surface)]" aria-busy="true">
		<div class="h-[41px] border-b border-gray-800 themed:border-[var(--nx-border)]"></div>
		<div class="px-4 py-4 {props.compact ? 'min-h-[120px]' : 'min-h-[320px]'}"></div>
	</div>
{:then mod}
	<mod.default {...props} />
{:catch}
	<input type="hidden" name={props.name ?? 'content'} value={fallbackDirty ? fallbackHtml : (props.initialContent ?? '')} />
	<div class="rounded-xl border border-gray-700 themed:border-[var(--nx-border)] bg-gray-900 themed:bg-[var(--nx-surface)]">
		<p class="px-4 pt-3 text-xs text-[var(--nx-text-muted)]" role="status">
			{tFn('editor.load_failed')}
			<button type="button" class="underline text-[var(--nx-header-accent)]" onclick={() => location.reload()}>{tFn('editor.load_failed_reload')}</button>
		</p>
		<textarea
			bind:value={fallbackText}
			oninput={() => fallbackDirty = true}
			placeholder={props.placeholder || tFn('editor.default_placeholder')}
			class="w-full bg-transparent px-4 py-3 outline-none resize-y {props.compact ? 'min-h-[120px]' : 'min-h-[320px]'} text-[var(--nx-text)]"
		></textarea>
	</div>
{/await}
