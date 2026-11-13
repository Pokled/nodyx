<script lang="ts">
	// Cartes « Nodyx relié » sous un message privé (maquette https://nodyx.org/cartes2-maquette.html).
	// D45 : message CHIFFRÉ → jamais de carte automatique. Afficher une carte demande au
	// serveur ce qu'il y a derrière le lien ; il apprendrait quels liens circulent dans une
	// conversation qui lui est cachée. Un bouton « Voir l'aperçu » : c'est la personne qui
	// décide, comme quand elle ouvre le lien.
	// D46 : « Toujours afficher » par conversation, sur cet appareil (lib/dmPeek.ts).
	// D47 : message NON chiffré (ancien) → cartes automatiques, comme le chat.
	import { onMount } from 'svelte'
	import { t } from '$lib/i18n'
	import LinkCard from './LinkCard.svelte'
	import { findInternalLinksInText } from '$lib/linkCards'
	import { peekAlways, loadPeekAlways, setPeekAlways } from '$lib/dmPeek'

	let { text, token = null, encrypted, conversationId }: {
		text: string
		token?: string | null
		encrypted: boolean
		conversationId: string
	} = $props()

	let origin = $state<string | null>(null)
	let revealed = $state(false)
	onMount(() => { origin = location.origin; loadPeekAlways(conversationId) })

	const paths = $derived(origin ? findInternalLinksInText(text ?? '', origin) : [])
	const always = $derived(!!$peekAlways[conversationId])
	// Une carte déjà affichée reste affichée jusqu'au prochain chargement : décocher
	// « Toujours afficher » vaut pour la suite, sans faire disparaître ce qu'on a sous les yeux.
	$effect(() => { if (always) revealed = true })
	const show = $derived(!encrypted || revealed || always)
</script>

{#if paths.length}
	{#if show}
		<div class="dmc">
			{#each paths as p (p)}<LinkCard path={p} {token} />{/each}
			{#if encrypted}
				<label class="dmc-always">
					<input type="checkbox" checked={always} onchange={(e) => setPeekAlways(conversationId, (e.currentTarget as HTMLInputElement).checked)} />
					{$t('link_card.peek_always')}
				</label>
			{/if}
		</div>
	{:else}
		<div class="dmc-peek">
			<button type="button" class="dmc-btn" onclick={() => (revealed = true)}>
				<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="7" y1="14" x2="13" y2="14"/></svg>
				{paths.length > 1 ? $t('link_card.peek_many', { count: paths.length }) : $t('link_card.peek')}
			</button>
			<details class="dmc-why">
				<summary>{$t('link_card.peek_why')}</summary>
				<p>{$t('link_card.peek_why_text')}</p>
			</details>
		</div>
	{/if}
{/if}

<style>
	.dmc { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
	.dmc-always { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--nx-text-muted); cursor: pointer; }
	.dmc-always input { accent-color: var(--nx-header-accent); }
	.dmc-peek { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; margin-top: 8px; }
	.dmc-btn {
		display: inline-flex; align-items: center; gap: 7px; padding: 5px 11px; border-radius: 9px;
		border: 1px dashed color-mix(in srgb, var(--nx-text) 28%, transparent); background: transparent;
		font-size: 12.5px; font-weight: 600; color: var(--nx-text); cursor: pointer; transition: border-color .15s, background-color .15s;
	}
	.dmc-btn:hover { border-color: var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 7%, transparent); }
	.dmc-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.dmc-why { font-size: 11.5px; color: var(--nx-text-muted); max-width: 420px; }
	.dmc-why summary { cursor: pointer; width: fit-content; }
	.dmc-why summary:hover { color: var(--nx-text); }
	.dmc-why p { margin: 4px 0 0; line-height: 1.45; }
</style>
