<script lang="ts">
	// La carte d'un groupe mentionné (« @Organisation »), au survol ou au focus de sa puce :
	// qui est dedans. Montée dans <body> par l'action mentionChips.
	import { t, locale } from '$lib/i18n'
	import type { MentionGroupCard } from '$lib/mentions'

	let { group, name, x, y, onenter, onleave }: {
		group: MentionGroupCard; name: string; x: number; y: number
		onenter?: () => void; onleave?: () => void
	} = $props()
	const others = $derived(Math.max(0, group.count - group.sample.length))
	const count = $derived($t(new Intl.PluralRules($locale).select(group.count) === 'one' ? 'mention.why_people_one' : 'mention.why_people_other', { count: group.count }))
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="nx-gcard" style="left:{x}px; top:{y}px" role="dialog" tabindex="-1" aria-label={name} onmouseenter={onenter} onmouseleave={onleave}>
	<div class="nx-gcard-h">
		<span class="nx-gcard-dot" style={group.color ? `background:${group.color}` : ''} aria-hidden="true"></span>
		<b>{name}</b>
		<span class="nx-gcard-n">{count}</span>
	</div>
	{#if group.sample.length}
		<p class="nx-gcard-who">{group.sample.map(p => p.display_name || p.username).join(', ')}{#if others} {$t('mention.group_card_more', { count: others })}{/if}</p>
	{:else}
		<p class="nx-gcard-who">{$t('mention.group_card_empty')}</p>
	{/if}
</div>

<style>
	.nx-gcard { position: fixed; z-index: 80; width: 260px; background: var(--nx-surface); color: var(--nx-text); border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,.2); padding: 12px; font-size: 13px; line-height: 1.45; }
	.nx-gcard-h { display: flex; align-items: center; gap: 8px; }
	.nx-gcard-h b { font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.nx-gcard-dot { width: 10px; height: 10px; border-radius: 99px; background: color-mix(in srgb, var(--nx-text) 35%, transparent); flex: none; }
	.nx-gcard-n { font-size: 12px; color: var(--nx-text-muted); }
	.nx-gcard-who { margin: 8px 0 0; color: var(--nx-text-muted); font-size: 12.5px; }
</style>
