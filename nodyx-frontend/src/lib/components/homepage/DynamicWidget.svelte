<script lang="ts">
	// Charge un widget externe (Web Component) à la volée
	// Le widget doit s'auto-enregistrer via customElements.define('nodyx-widget-{id}', ...)
	import { onMount } from 'svelte'
	import { browser } from '$app/environment'

	interface Props {
		widgetId: string                      // ex: "my-countdown"
		entry:    string                      // ex: "widget.iife.js"
		config:   Record<string, unknown>
		instance: Record<string, unknown>
		user:     Record<string, unknown> | null
		title?:   string | null
	}

	let { widgetId, entry, config, instance, user, title }: Props = $props()

	type LoadState = 'loading' | 'ready' | 'error'
	let state    = $state<LoadState>('loading')
	let errorMsg = $state('')

	// Le tag HTML du custom element : nodyx-widget-my-countdown
	const tagName = `nodyx-widget-${widgetId}`

	// Charge un <script> dynamiquement (idempotent)
	function loadScript(src: string): Promise<void> {
		return new Promise((resolve, reject) => {
			if (document.querySelector(`script[data-nodyx-widget="${src}"]`)) {
				resolve()
				return
			}
			const el = document.createElement('script')
			el.src = src
			el.dataset.nodyx_widget = src
			el.onload  = () => resolve()
			el.onerror = () => reject(new Error(`Impossible de charger ${src}`))
			document.head.appendChild(el)
		})
	}

	onMount(async () => {
		if (!browser) return
		try {
			// Déjà enregistré ? (ex: page naviguée deux fois)
			if (!customElements.get(tagName)) {
				await loadScript(`/api/v1/widget-assets/${widgetId}/${entry}`)
				// Timeout de 5s pour l'enregistrement du custom element
				await Promise.race([
					customElements.whenDefined(tagName),
					new Promise((_, reject) =>
						setTimeout(() => reject(new Error(`${tagName} non enregistré après 5s`)), 5000)
					),
				])
			}
			state = 'ready'
		} catch (e) {
			state = 'error'
			errorMsg = e instanceof Error ? e.message : String(e)
		}
	})

	// Sérialise les props pour le custom element (attributs JSON)
	const configAttr   = $derived(JSON.stringify(config))
	const instanceAttr = $derived(JSON.stringify(instance))
	const userAttr     = $derived(user ? JSON.stringify(user) : '')
</script>

{#if state === 'loading'}
	<!-- Skeleton pendant le chargement du JS -->
	<div class="w-full flex items-center justify-center py-8 gap-2" style="color:#374151">
		<div class="w-4 h-4 rounded-full border-2 animate-spin"
		     style="border-color:rgba(167,139,250,.2); border-top-color:#a78bfa"></div>
		<span class="text-xs">Chargement du widget…</span>
	</div>

{:else if state === 'error'}
	<!-- Erreur visible uniquement en dev / pour l'admin -->
	<div class="w-full px-4 py-3 text-xs" style="background:rgba(239,68,68,.06); border:1px solid rgba(239,68,68,.2); color:#fca5a5">
		<span class="font-bold">Widget {widgetId} — erreur de chargement :</span>
		{errorMsg}
	</div>

{:else}
	<!-- Web Component rendu — le widget reçoit ses données via attributs JSON -->
	<!-- svelte-ignore svelte_component_dynamic_element_attributes -->
	<svelte:element
		this={tagName}
		data-config={configAttr}
		data-instance={instanceAttr}
		data-user={userAttr}
		data-title={title ?? ''}
		style="display:contents"
	></svelte:element>
{/if}
