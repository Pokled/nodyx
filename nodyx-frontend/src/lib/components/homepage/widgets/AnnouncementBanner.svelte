<script lang="ts">

	import { t } from '$lib/i18n'
	const tFn = $derived($t)
	interface Props {
		config: Record<string, unknown>;
		instance: Record<string, unknown>;
		user: Record<string, unknown> | null;
		title?: string | null;
	}

	let { config }: Props = $props();

	const text        = $derived((config.text as string) ?? '');
	// Couleur d'accent de la bannière : si l'admin en fixe une (config.color),
	// on garde l'astuce hex+alpha (#rrggbb + "22"/"55"). Sinon on suit le thème
	// du Homepage Builder EN DIRECT via --nl (couleur de lien), pas un hex figé.
	const customColor = $derived(config.color as string | undefined);
	const bannerBg     = $derived(customColor ? `${customColor}22` : 'rgb(var(--nl-rgb) / .13)');
	const bannerBorder = $derived(customColor ? `${customColor}55` : 'rgb(var(--nl-rgb) / .33)');
	const bannerDot    = $derived(customColor ?? 'var(--nl)');
	const bannerLink   = $derived(customColor ?? 'var(--nl)');
	const linkUrl     = $derived((config.link_url as string) ?? null);
	const linkText    = $derived((config.link_text as string) ?? null);
	const dismissable = $derived((config.dismissable as boolean) ?? false);

	let dismissed = $state(false);
</script>

{#if text && !dismissed}
	<div class="relative flex items-center justify-center gap-3 px-6 py-2.5 text-sm font-medium text-white"
	     style="background:{bannerBg}; border-bottom:1px solid {bannerBorder}">

		<span class="w-1.5 h-1.5 rounded-full shrink-0" style="background:{bannerDot}"></span>

		<span style="color:var(--nt)">{text}</span>

		{#if linkUrl && linkText}
			<a href={linkUrl}
			   class="font-bold underline underline-offset-2 transition-opacity hover:opacity-80 shrink-0"
			   style="color:{bannerLink}">
				{linkText}
			</a>
		{/if}

		{#if dismissable}
			<button
				onclick={() => dismissed = true}
				class="absolute right-3 top-1/2 -translate-y-1/2 p-1 transition-opacity hover:opacity-80"
				style="color:var(--ntm)"
				aria-label={tFn('common.close')}
			>
				<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
				</svg>
			</button>
		{/if}
	</div>
{/if}
