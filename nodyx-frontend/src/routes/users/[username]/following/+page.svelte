<script lang="ts">
	import type { PageData } from './$types'
	import FollowList from '$lib/components/FollowList.svelte'
	let { data }: { data: PageData } = $props()
</script>

<FollowList username={data.username} users={data.users} mode={data.mode} />
