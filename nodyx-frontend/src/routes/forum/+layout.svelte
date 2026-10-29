<script lang="ts">
	let { children }: { children: any } = $props()
</script>

<!-- Racine du forum : pose le fond du thème et rebranche le contenu rédigé
     (.nx-themed, cf. app.css) pour que tout le forum suive l'ambiance de
     l'instance, thème clair compris. -->
<div class="forum-root nx-themed">
	<div class="forum-inner">
		{@render children()}
	</div>
</div>

<style>
	/* flex: 1 0 auto : le parent du gabarit est une colonne flex de hauteur
	   fixe. En rétrécissant (défaut), le fond s'arrêterait au premier écran
	   (vécu sur /members et /feed le 29/10). */
	.forum-root {
		flex: 1 0 auto;
		background: var(--nx-sheet-bg, var(--nx-bg));
	}
	/* Mêmes marges qu'avant (px-4 sm:px-6 py-8, posées par le gabarit). */
	.forum-inner {
		padding: 2rem 1rem;
	}
	@media (min-width: 640px) {
		.forum-inner { padding: 2rem 1.5rem; }
	}
</style>
