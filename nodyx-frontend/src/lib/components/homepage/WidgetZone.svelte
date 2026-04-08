<script lang="ts">
	import type { HomepageWidget } from '$lib/types/homepage';
	import { PLUGIN_REGISTRY } from './plugins';
	import DynamicWidget from './DynamicWidget.svelte';

	interface Props {
		widgets:          HomepageWidget[];
		instance:         Record<string, unknown>;
		user:             Record<string, unknown> | null;
		layout?:          string;
		installedWidgets?: Record<string, { entry: string; [k: string]: unknown }>;
	}

	let { widgets, instance, user, layout = 'full', installedWidgets = {} }: Props = $props();

	function isVisible(w: HomepageWidget): boolean {
		const v = w.visibility ?? { audience: 'all' };
		const now = new Date();
		if (v.audience === 'guests'  && user)  return false;
		if (v.audience === 'members' && !user) return false;
		if (v.start_date && new Date(v.start_date) > now) return false;
		if (v.end_date   && new Date(v.end_date)   < now) return false;
		return true;
	}

	const visibleWidgets = $derived(widgets.filter(isVisible));
</script>

{#if visibleWidgets.length > 0}
	<div class="widget-zone" data-layout={layout}>
		{#each visibleWidgets as widget (widget.id)}
			{@const nativePlugin  = PLUGIN_REGISTRY[widget.widget_type]}
			{@const dynamicManifest = installedWidgets[widget.widget_type]}
			{#if nativePlugin || dynamicManifest}
				<div
					class="widget-wrapper"
					class:hide-mobile={widget.hide_mobile}
					class:hide-tablet={widget.hide_tablet}
					data-widget={widget.widget_type}
					data-width={widget.width}
				>
					{#if nativePlugin}
						<!-- Composant natif Svelte -->
						<nativePlugin.component
							config={widget.config}
							{instance}
							{user}
							title={widget.title}
						/>
					{:else}
						<!-- Widget installé — Web Component chargé dynamiquement -->
						<DynamicWidget
							widgetId={widget.widget_type}
							entry={dynamicManifest.entry}
							config={widget.config}
							{instance}
							{user}
							title={widget.title}
						/>
					{/if}
				</div>
			{/if}
		{/each}
	</div>
{/if}

<style>
	.widget-zone {
		display: contents;
	}

	@media (max-width: 767px) {
		:global(.hide-mobile) { display: none !important; }
	}
	@media (min-width: 768px) and (max-width: 1023px) {
		:global(.hide-tablet) { display: none !important; }
	}
</style>
