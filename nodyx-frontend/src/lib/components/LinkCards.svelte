<script lang="ts">
	// Les cartes d'un message (chat, forum) : trois au plus (D41), dans l'ordre des liens.
	// D40 : si le message n'est QUE le lien, `onsole(true)` dit au parent de cacher le
	// texte, seulement une fois la carte affichée (jamais un message vide en attendant).
	import { onMount } from 'svelte'
	import LinkCard from './LinkCard.svelte'
	import { findInternalLinks, isSoleLink } from '$lib/linkCards'

	let { html, token = null, onsole }: {
		html: string
		token?: string | null
		onsole?: (sole: boolean) => void
	} = $props()

	// Rien au rendu serveur : les cartes dépendent du lecteur. Monté seulement dans le
	// navigateur (onMount), pour que le HTML du serveur et celui de l'hydratation soient
	// identiques.
	let origin = $state<string | null>(null)
	onMount(() => { origin = location.origin })
	const paths = $derived(origin ? findInternalLinks(html ?? '', origin) : [])
	const sole = $derived(origin ? isSoleLink(html ?? '', origin) : false)
	$effect(() => { if (origin && !sole) onsole?.(false) })
</script>

{#if paths.length}
	<div class="lcs">
		{#each paths as p (p)}
			<LinkCard path={p} {token} onready={shown => { if (sole) onsole?.(shown) }} />
		{/each}
	</div>
{/if}

<style>
	.lcs { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
</style>
