<script lang="ts">
	// Tooltip discret style Linear : icone info Lucide monoline 14px, bulle
	// sobre fond zinc, pas de halo coloré. Pure CSS (group hover/focus),
	// accessible (aria-label sur le bouton).

	interface Props {
		text:     string
		position?: 'top' | 'bottom' | 'right'
		size?:    'sm' | 'md'           // hérité de l'ancienne API, n'affecte plus que le wrapper
		variant?: 'info' | 'tip' | 'warn' // hérité, mais on garde un look unifié
	}

	let { text, position = 'top' }: Props = $props()
</script>

<span class="relative inline-flex group align-middle">
	<button type="button" tabindex="0" aria-label={text}
		class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500/60">
		<svg class="w-full h-full" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
			<circle cx="12" cy="12" r="10"/>
			<line x1="12" y1="16" x2="12" y2="12"/>
			<line x1="12" y1="8" x2="12.01" y2="8"/>
		</svg>
	</button>

	{#if position === 'top'}
		<span role="tooltip" class="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[16rem] px-2 py-1 rounded border border-zinc-800 bg-zinc-950 text-[11px] leading-snug text-zinc-300 shadow-lg z-50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
			{text}
		</span>
	{:else if position === 'bottom'}
		<span role="tooltip" class="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-max max-w-[16rem] px-2 py-1 rounded border border-zinc-800 bg-zinc-950 text-[11px] leading-snug text-zinc-300 shadow-lg z-50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
			{text}
		</span>
	{:else}
		<span role="tooltip" class="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-1.5 w-max max-w-[16rem] px-2 py-1 rounded border border-zinc-800 bg-zinc-950 text-[11px] leading-snug text-zinc-300 shadow-lg z-50 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150">
			{text}
		</span>
	{/if}
</span>
