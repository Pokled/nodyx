<script lang="ts">
	import Vitrine from '$lib/Vitrine.svelte'
	const { data } = $props()
</script>

<Vitrine lang="en" donnees={data.donnees} />
