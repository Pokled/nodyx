<script lang="ts">
	// « Comprendre les crans » : ce qui arrive au message, à son auteur et à
	// l'équipe, cran par cran. Replié, on ne garde que le titre.
	import { t } from '$lib/i18n'
	import Icon from './Icon.svelte'
	import { LEVELS, LEVEL_ICON } from '$lib/octoguard/rules'

	const tFn = $derived($t)
	const ROWS = [
		{ key: 'message', icon: 'M21 12a8 8 0 01-11.6 7.1L4 20l1.2-4.4A8 8 0 1121 12z' },
		{ key: 'author', icon: 'M12 4a4 4 0 100 8 4 4 0 000-8z M4 21a8 8 0 0116 0' },
		{ key: 'team', icon: 'M9 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M2.5 20a6.5 6.5 0 0113 0 M16 4.6a3.5 3.5 0 010 6.8 M21.5 20a6.5 6.5 0 00-4-6' },
	]
	let open = $state(true)
</script>

<details class="adm-card og-legend" bind:open>
	<summary>
		<span class="og-ic og-k-acc"><Icon d="M12 4v16 M6 20h12 M5 8h14 M5 8l-2.5 6a2.5 2.5 0 005 0z M19 8l-2.5 6a2.5 2.5 0 005 0z" /></span>
		<span>
			<span class="og-legend-title">{tFn('og2.legend_title')}</span>
			<span class="og-help" style="display:block">{tFn('og2.legend_sub')}</span>
		</span>
		<Icon d="M9 6l6 6-6 6" cls="og-ico og-chev" />
	</summary>
	<div class="og-lgwrap">
		<div class="og-lg">
			<span></span>
			{#each LEVELS as l (l)}
				<span class="og-lg-h og-k-{l}"><Icon d={LEVEL_ICON[l]} />{tFn(`og2.lv_${l}`)}</span>
			{/each}
			{#each ROWS as row (row.key)}
				<span class="og-lg-k"><Icon d={row.icon} />{tFn(`og2.legend_row_${row.key}`)}</span>
				{#each LEVELS as l (l)}
					<span class="og-lg-c">{tFn(`og2.legend_${row.key}_${l}`)}</span>
				{/each}
			{/each}
			<span class="og-lg-tip">{tFn('og2.legend_start')}</span>
			<span class="og-lg-scale"><span>{tFn('og2.legend_softer')}</span><i></i><span>{tFn('og2.legend_firmer')}</span></span>
		</div>
	</div>
</details>
