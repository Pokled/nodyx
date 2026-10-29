<script lang="ts">
	let { children }: { children: any } = $props()
</script>

<!-- Racine du forum : rebranche le contenu rédigé et l'éditeur sur le thème
     (.nx-themed, cf. app.css). Pas de fond ici : la feuille (main,
     sheetThemed dans +layout) peint celui du thème, avec les réglages de
     zone de l'admin (opacité, image, flou). -->
<div class="forum-root nx-themed">
	<div class="forum-inner">
		{@render children()}
	</div>
</div>

<style>
	/* flex: 1 0 auto : remplit l'écran sans jamais rétrécir sous son contenu. */
	.forum-root {
		flex: 1 0 auto;
	}
	/* Mêmes marges qu'avant (px-4 sm:px-6 py-8, posées par le gabarit). */
	.forum-inner {
		padding: 2rem 1rem;
	}
	@media (min-width: 640px) {
		.forum-inner { padding: 2rem 1.5rem; }
	}
</style>
