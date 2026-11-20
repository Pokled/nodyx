<script lang="ts">
	// La porte de l'équipe (lot 7e, CDC §E4j) : on arrive ici depuis n'importe quel outil
	// de l'admin tant que la charte de l'équipe n'est pas signée. La porte s'ouvre seule ;
	// signée, on revient où l'on allait ; « Plus tard », on rentre à l'accueil.
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { t } from '$lib/i18n'
	import CharterDoor from '$lib/components/charter/CharterDoor.svelte'
	import { safeAdminNext } from '$lib/charter/teamDoor'
	import '$lib/charter/pilot.css'

	const tFn = $derived($t)
	const user = $derived(page.data.user as { username: string } | null)
	let open = $state(true)
	let signed = $state(false)

	async function closed() {
		open = false
		if (signed) await goto(safeAdminNext(page.url.searchParams.get('next')), { invalidateAll: true })
		else await goto('/')
	}
</script>

<svelte:head><title>{tFn('charter.team_gate_title')}</title></svelte:head>

<div class="tg nx-pilot">
	<img src="/nodyx-octopus.png" alt="" width="40" height="40" />
	<h1>{tFn('charter.team_gate_title')}</h1>
	<p>{tFn('charter.team_gate_text')}</p>
	{#if !open}
		<button type="button" class="pl-btn pl-btn--primary" onclick={() => (open = true)}>{tFn('charter.team_gate_open')}</button>
	{/if}
</div>

{#if open && user}
	<CharterDoor audience="team" closable username={user.username} token={(page.data.token as string | null) ?? null} onsigned={() => (signed = true)} onclose={closed} />
{/if}

<style>
	.tg { max-width: 480px; margin: 72px auto; padding: 0 20px; text-align: center; color: var(--nx-text); }
	.tg img { width: 40px; height: 40px; padding: 10px; box-sizing: content-box; border-radius: 50%; background: #1c2230; }
	.tg h1 { font-size: 22px; margin: 14px 0 6px; }
	.tg p { color: var(--nx-text-muted); margin: 0 0 18px; line-height: 1.55; }
</style>
