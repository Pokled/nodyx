<!--
  Dispatche le rendu d'une icône de canal :
  - 'twemoji:NAME'  → SVG bundlé via @iconify/svelte
  - 'lucide:NAME'   → composant lucide-svelte (chargement dynamique)
  - sinon (emoji brut, null) → texte (avec fallback éventuel)
-->
<script lang="ts">
	import Icon from '@iconify/svelte'
	import { registerChannelIconCollections } from '$lib/channelIcons'
	import type { Component } from 'svelte'

	type Props = {
		value:    string | null | undefined
		fallback?: string  // ex: '#', '🔊'
		size?:    number   // px
		color?:   string | null
	}

	let { value, fallback = '#', size = 14, color = null }: Props = $props()

	let LucideComp = $state<Component | null>(null)

	$effect(() => {
		if (!value) { LucideComp = null; return }
		if (value.startsWith('twemoji:')) {
			registerChannelIconCollections()
			LucideComp = null
			return
		}
		if (value.startsWith('lucide:')) {
			loadLucide(value.slice('lucide:'.length))
			return
		}
		LucideComp = null
	})

	async function loadLucide(name: string) {
		try {
			const mod = await import('lucide-svelte')
			const pascal = name.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('')
			const Comp = (mod as any)[pascal]
			LucideComp = Comp ?? null
		} catch {
			LucideComp = null
		}
	}

	const isTwemoji = $derived(!!value && value.startsWith('twemoji:'))
	const isLucide  = $derived(!!value && value.startsWith('lucide:'))
	const colorStyle = $derived(color ? `color: ${color};` : '')
</script>

{#if isTwemoji && value}
	<Icon icon={value} style="font-size: {size}px; vertical-align: middle; {colorStyle}" />
{:else if isLucide && LucideComp}
	<LucideComp size={size} style={colorStyle} />
{:else if value}
	<span style="font-size: {size}px; line-height: 1; {colorStyle}">{value}</span>
{:else}
	<span style="font-size: {size}px; line-height: 1; {colorStyle}">{fallback}</span>
{/if}
