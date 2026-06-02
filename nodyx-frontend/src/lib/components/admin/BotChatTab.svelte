<script lang="ts">
	import ChatTimersPanel    from './ChatTimersPanel.svelte'
	import ChatCommandsPanel  from './ChatCommandsPanel.svelte'

	interface Props {
		token: string
	}

	let { token }: Props = $props()

	type SubTab = 'timers' | 'commands'
	let active = $state<SubTab>('timers')
</script>

<!-- Sous-nav : 2 onglets, soulignement violet, fond plein zinc-900 pour vraiment "rail". -->
<div class="-mx-2 px-2 mb-5 border-b border-zinc-800 bg-zinc-950">
	<nav class="flex gap-6">
		<button type="button" onclick={() => active = 'timers'}
			class="relative py-2.5 text-sm font-medium transition-colors
				{active === 'timers' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}">
			Timers récurrents
			{#if active === 'timers'}
				<span class="absolute left-0 right-0 -bottom-px h-0.5 bg-purple-500"></span>
			{/if}
		</button>
		<button type="button" onclick={() => active = 'commands'}
			class="relative py-2.5 text-sm font-medium transition-colors
				{active === 'commands' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}">
			Commandes custom
			{#if active === 'commands'}
				<span class="absolute left-0 right-0 -bottom-px h-0.5 bg-purple-500"></span>
			{/if}
		</button>
	</nav>
</div>

{#if active === 'timers'}
	<ChatTimersPanel {token} />
{:else}
	<ChatCommandsPanel {token} />
{/if}
