<script lang="ts">
	interface Props {
		config: Record<string, unknown>;
		instance: Record<string, unknown>;
		user: Record<string, unknown> | null;
		title?: string | null;
	}

	let { config }: Props = $props();

	const text        = $derived((config.text as string) ?? '');
	const color       = $derived((config.color as string) ?? '#7c3aed');
	const linkUrl     = $derived((config.link_url as string) ?? null);
	const linkText    = $derived((config.link_text as string) ?? null);
	const dismissable = $derived((config.dismissable as boolean) ?? false);

	let dismissed = $state(false);
</script>

{#if text && !dismissed}
	<div class="relative flex items-center justify-center gap-3 px-6 py-2.5 text-sm font-medium text-white"
	     style="background:{color}22; border-bottom:1px solid {color}55">

		<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:{color}"></span>

		<span style="color:#e2e8f0">{text}</span>

		{#if linkUrl && linkText}
			<a href={linkUrl}
			   class="font-bold underline underline-offset-2 transition-opacity hover:opacity-80 shrink-0"
			   style="color:{color}">
				{linkText}
			</a>
		{/if}

		{#if dismissable}
			<button
				onclick={() => dismissed = true}
				class="absolute right-3 top-1/2 -translate-y-1/2 p-1 transition-opacity hover:opacity-80"
				style="color:#6b7280"
				aria-label="Fermer"
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
				</svg>
			</button>
		{/if}
	</div>
{/if}
