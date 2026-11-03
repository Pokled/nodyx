<script lang="ts">
	// Icône au trait (24x24), couleur héritée du texte.
	let { d, cls = 'og-ico' }: { d: string; cls?: string } = $props()
</script>

<svg class={cls} fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path {d} /></svg>
