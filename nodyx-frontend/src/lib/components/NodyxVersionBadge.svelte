<!--
  Badge version Nodyx — logo octopus + "Nodyx vX.Y.Z", cliquable vers la
  release GitHub correspondante. Utilisable en footer, sidebar, panel admin.

  Props :
    - version : string (ex: '2.5.0'). Si 'unknown', le badge se rend en dégradé.
    - variant : 'footer' | 'inline' | 'admin' — contrôle la taille / l'opacité.
    - showLogo : boolean (défaut true)
-->
<script lang="ts">

	import { t } from '$lib/i18n'
	const tFn = $derived($t)
	interface Props {
		version:   string
		variant?: 'footer' | 'inline' | 'admin'
		showLogo?: boolean
	}

	let { version, variant = 'inline', showLogo = true }: Props = $props()

	const sizeClass = $derived(
		variant === 'footer' ? 'text-xs gap-1.5'
		: variant === 'admin'  ? 'text-xs gap-1.5'
		: 'text-sm gap-2'
	)
	const logoSizeClass = $derived(
		variant === 'footer' ? 'h-3.5 w-3.5'
		: variant === 'admin'  ? 'h-3.5 w-3.5'
		: 'h-4 w-4'
	)
</script>

<a
	href="/about"
	class="inline-flex items-center {sizeClass} opacity-60 hover:opacity-100 transition-opacity text-zinc-400 hover:text-zinc-200"
	title={tFn('about.meta_title')}
>
	{#if showLogo}
		<img
			src="/nodyx-octopus.png"
			alt=""
			class="{logoSizeClass} object-contain opacity-80"
			loading="lazy"
		/>
	{/if}
	<span class="font-mono tracking-tight">
		Nodyx v{version}
	</span>
</a>
