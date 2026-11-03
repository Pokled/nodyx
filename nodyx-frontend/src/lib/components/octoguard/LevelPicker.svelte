<script lang="ts">
	// Le sélecteur des crans, le même sur chaque règle : icône + couleur + nom,
	// puis une phrase qui dit ce qui se passe à ce cran.
	import { t } from '$lib/i18n'
	import Icon from './Icon.svelte'
	import { LEVELS, LEVEL_ICON, type Level, type Acting } from '$lib/octoguard/rules'

	let { value, intended, name, busy = false, onpick }: {
		value: Level
		intended: Acting
		name: string
		busy?: boolean
		onpick: (l: Level) => void
	} = $props()
	const tFn = $derived($t)
</script>

<div class="og-seg" role="radiogroup" aria-label={tFn('og2.level_label')}>
	{#each LEVELS as l (l)}
		<label class="og-k-{l}">
			<input type="radio" {name} value={l} checked={value === l} disabled={busy} onchange={() => onpick(l)} />
			<Icon d={LEVEL_ICON[l]} />
			<span>{tFn(`og2.lv_${l}`)}</span>
		</label>
	{/each}
</div>
<p class="og-sentence og-k-{value}">
	<b>{tFn(`og2.lv_${value}`)}</b> : {value === 'observe'
		? tFn('og2.lv_say_observe', { would: tFn(`og2.lv_would_${intended}`) })
		: tFn(`og2.lv_say_${value}`)}
</p>
