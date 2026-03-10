<script lang="ts">
	import '../app.css'
	import { onMount } from 'svelte'
	import { goto } from '$app/navigation'
	import { page } from '$app/stores'
	import { isSetupDone, purgeExpiredChallenges } from '$lib/storage'

	let { children } = $props()

	onMount(async () => {
		await purgeExpiredChallenges()

		const currentPath = $page.url.pathname
		const done = await isSetupDone()
		if (!done && !currentPath.startsWith('/setup')) {
			goto('/setup')
		}
	})
</script>

<svelte:head>
	<title>Nexus Signet</title>
</svelte:head>

<div class="min-h-screen flex flex-col" style="background: var(--color-bg); color: var(--color-text)">
	{@render children()}
</div>
