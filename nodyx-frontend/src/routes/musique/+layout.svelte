<script lang="ts">
	let { children }: { children: () => any } = $props();
</script>

{@render children()}

<style>
	/* Jetons partagés par /musique ET /musique/[slug] : déclarés ici, pas dans
	   +page.svelte, pour qu'un lien direct vers une catégorie (le cas d'usage
	   principal : partage Discord) les ait aussi, sans être passé par l'index
	   d'abord. */
	:global(:root) {
		--mus-paper:        #0c0b0d;
		--mus-paper-raised: #17151a;
		--mus-ink:          #f2ece0;
		--mus-ink-dim:      #93897a;
		--mus-groove:       #29262c;
	}
</style>
