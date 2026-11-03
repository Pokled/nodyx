<script lang="ts">
	import { page } from '$app/state'
	import { isAdminThemed } from '$lib/adminTheme'
	import './og.css'
	let { children } = $props()

	// Le menu d'OctoGuard est dans la colonne de l'administration (admin/+layout).
	// Les pages refaites (OctoGuard 2) portent leur propre en-tête ; les autres
	// gardent leur cadre sombre d'avant jusqu'à leur tour (livraison 3b).
	const refaite = $derived(isAdminThemed(page.url.pathname))
</script>

{#if refaite}
	{@render children?.()}
{:else}
	<div class="og-legacy">
		<main class="og-legacy-main">
			{@render children?.()}
		</main>
	</div>
{/if}

<style>
	.og-legacy { max-width: 1200px; margin: 0 auto; padding: 8px 0 64px; }
	.og-legacy-main { display: flex; flex-direction: column; gap: 16px; }
</style>
