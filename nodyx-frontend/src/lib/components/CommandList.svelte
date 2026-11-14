<script lang="ts">
	// La liste du « / » (maquette https://nodyx.org/commandes-maquette.html, section 3),
	// même allure que celle des mentions. Elle ne gère ni le clavier ni la position :
	// c'est le champ qui la pilote (flèches, Entrée, Tab, Échap).
	import { t } from '$lib/i18n'
	import { argsOf, type CommandDef } from '$lib/commands'
	import { openHelpOverlay } from '$lib/helpOverlay'

	let { items, active = 0, typed = '', onpick, id = 'nx-command-list' }: {
		items: CommandDef[]
		active?: number
		typed?: string
		onpick: (c: CommandDef) => void
		id?: string
	} = $props()

	const GROUP_KEYS: Record<CommandDef['group'], string> = { call: 'cmd.group_call', play: 'cmd.group_play' }
</script>

<div class="cl" role="listbox" {id} aria-label={$t('cmd.list_aria')}>
	{#each items as c, i (c.id)}
		{#if i === 0 || items[i - 1].group !== c.group}<div class="cl-h" role="presentation">{$t(GROUP_KEYS[c.group])}</div>{/if}
		<button type="button" class="cl-o" class:on={i === active} role="option" id="{id}-{i}" aria-selected={i === active}
			onmousedown={(e) => { e.preventDefault(); onpick(c) }}>
			<span class="cl-ico" aria-hidden="true">
				<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1"/><circle cx="15.5" cy="15.5" r="1"/><circle cx="12" cy="12" r="1"/></svg>
			</span>
			<span class="cl-t">
				<span class="cl-n"><code>/{#if typed}<mark>{c.name.slice(0, typed.length)}</mark>{/if}{c.name.slice(typed.length)}</code>{#if argsOf(c, $t)}<span class="cl-a">{argsOf(c, $t)}</span>{/if}</span>
				<span class="cl-w">{$t(c.descKey)}</span>
			</span>
		</button>
	{/each}
	<div class="cl-f" aria-hidden="true">
		<span><kbd>↑</kbd> <kbd>↓</kbd> {$t('mention.key_choose')}</span>
		<span><kbd>{$t('mention.key_enter')}</kbd> {$t('cmd.key_write')}</span>
		<span><kbd>{$t('mention.key_esc')}</kbd> {$t('mention.key_close')}</span>
		<a href="/help" class="cl-all" onmousedown={(e) => e.preventDefault()} onclickcapture={(e) => openHelpOverlay(e)}>{$t('cmd.see_all')}</a>
	</div>
</div>

<style>
	.cl { background: var(--nx-surface); border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.18); padding: 6px; max-height: 340px; overflow: auto; width: min(380px, calc(100vw - 32px)); color: var(--nx-text); }
	.cl-h { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--nx-text-faint); padding: 8px 8px 4px; }
	.cl-o { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: transparent; border-radius: 8px; padding: 6px 8px; cursor: pointer; color: inherit; }
	.cl-o.on, .cl-o:hover { background: color-mix(in srgb, var(--nx-header-accent) 14%, transparent); }
	.cl-ico { width: 28px; height: 28px; border-radius: 8px; flex: none; display: grid; place-items: center; background: color-mix(in srgb, var(--nx-text) 7%, transparent); color: var(--nx-text-muted); }
	.cl-ico svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.cl-t { display: flex; flex-direction: column; min-width: 0; }
	.cl-n { font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.cl-n code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); }
	.cl-n mark { background: color-mix(in srgb, var(--nx-header-accent) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
	.cl-a { margin-left: 6px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; color: var(--nx-text-faint); }
	.cl-w { font-size: 12px; color: var(--nx-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.cl-f { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: 11px; color: var(--nx-text-faint); padding: 6px 8px 2px; border-top: 1px solid color-mix(in srgb, var(--nx-text) 8%, transparent); margin-top: 4px; }
	.cl-f kbd { font-family: inherit; border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); border-radius: 4px; padding: 0 4px; }
	.cl-all { margin-left: auto; color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); text-decoration: underline; }
	@media (hover: none) { .cl-f span { display: none; } }
</style>
