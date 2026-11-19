<script lang="ts">
	// La carte d'un groupe mentionné (« @Organisation »), au survol ou au focus de sa puce :
	// qui est dedans. Montée dans <body> par l'action mentionChips.
	import { t, locale } from '$lib/i18n'
	import type { MentionGroupCard } from '$lib/mentions'
	import EventVisual from '$lib/components/EventVisual.svelte'
	import { hasLook } from '$lib/eventGames'

	let { group, name, x, y, onenter, onleave }: {
		group: MentionGroupCard; name: string; x: number; y: number
		onenter?: () => void; onleave?: () => void
	} = $props()
	const others = $derived(Math.max(0, group.count - group.sample.length))
	const count = $derived($t(new Intl.PluralRules($locale).select(group.count) === 'one' ? 'mention.why_people_one' : 'mention.why_people_other', { count: group.count }))
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="nx-gcard" style="left:{x}px; top:{y}px" role="dialog" tabindex="-1" aria-label={name} onmouseenter={onenter} onmouseleave={onleave}>
	{#if group.event && hasLook(group.event)}
		<div class="nx-gcard-game">
			<EventVisual look={group.event} size="md" shape={group.event.game_cover ? 'jaq' : 'tile'} />
			{#if group.event.game_name}<span>{group.event.game_name}</span>{/if}
		</div>
	{/if}
	<div class="nx-gcard-h">
		<span class="nx-gcard-dot" style={group.color ? `background:${group.color}` : ''} aria-hidden="true"></span>
		<b>{name}</b>
		<span class="nx-gcard-n">{count}</span>
	</div>
	{#if group.event}
		<p class="nx-gcard-ev">{new Intl.DateTimeFormat($locale, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(group.event.starts_at))}{#if group.event.is_cancelled} · <span class="nx-gcard-x">{$t('mention.event_cancelled')}</span>{/if}</p>
	{/if}
	{#if group.sample.length}
		<p class="nx-gcard-who">{group.sample.map(p => p.display_name || p.username).join(', ')}{#if others} {$t('mention.group_card_more', { count: others })}{/if}</p>
	{:else if !group.event}
		<p class="nx-gcard-who">{$t('mention.group_card_empty')}</p>
	{/if}
	{#if group.event}
		<a class="nx-gcard-go" href="/calendar/{group.event.id}">{$t('mention.event_card_open')}</a>
	{/if}
</div>

<style>
	.nx-gcard { position: fixed; z-index: 80; width: 260px; background: var(--nx-surface); color: var(--nx-text); border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,.2); padding: 12px; font-size: 13px; line-height: 1.45; }
	.nx-gcard-game { display: flex; align-items: flex-end; gap: 10px; margin-bottom: 8px; font-size: 12px; font-weight: 600; color: var(--nx-text-muted); }
	.nx-gcard-h { display: flex; align-items: center; gap: 8px; }
	.nx-gcard-h b { font-size: 14px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.nx-gcard-dot { width: 10px; height: 10px; border-radius: 99px; background: color-mix(in srgb, var(--nx-text) 35%, transparent); flex: none; }
	.nx-gcard-n { font-size: 12px; color: var(--nx-text-muted); }
	.nx-gcard-ev { margin: 6px 0 0; font-size: 12.5px; color: var(--nx-text); }
	.nx-gcard-x { color: var(--nx-bad, #b91c1c); font-weight: 600; }
	.nx-gcard-go { display: block; margin-top: 10px; text-align: center; border-radius: 8px; padding: 5px 10px; font-size: 12.5px; font-weight: 600; background: var(--nx-header-accent); color: var(--nx-on-accent, #16120c); text-decoration: none; }
	.nx-gcard-who { margin: 8px 0 0; color: var(--nx-text-muted); font-size: 12.5px; }
</style>
