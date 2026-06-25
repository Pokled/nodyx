<script lang="ts">
	import { goto } from '$app/navigation'
	import { socket } from '$lib/socket'
	import NodyxCanvas from '$lib/components/NodyxCanvas.svelte'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const u = (data as unknown as { user?: { id?: string; username?: string; avatar?: string | null } }).user ?? {}

	// Lecture seule : demander l'accès en édition au propriétaire.
	async function requestAccess() {
		await fetch(`/api/v1/canvas/${data.board.id}/request-access`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${data.token}` }
		}).catch(() => {})
	}
</script>

<svelte:head><title>{data.board?.name ?? 'Canvas'} : Canvas</title></svelte:head>

{#if $socket}
	<NodyxCanvas
		boardId={data.board.id}
		channelId={null}
		socket={$socket}
		userId={u.id ?? ''}
		username={u.username ?? ''}
		userAvatar={u.avatar ?? null}
		boardName={data.board.name}
		readOnly={!data.board.can_edit}
		lastSeen={data.board.last_seen ? new Date(data.board.last_seen).getTime() : null}
		onRequestAccess={requestAccess}
		onclose={() => goto('/canvas')}
	/>
{:else}
	<div class="fixed inset-0 z-[9999] flex items-center justify-center bg-[#0a0a10] text-gray-400 text-sm">
		Connexion au canvas…
	</div>
{/if}
