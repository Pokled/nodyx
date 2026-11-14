<script lang="ts">
	// « Tout ce que tu peux taper » (maquette https://nodyx.org/commandes-maquette.html,
	// section 4). Le contenu de la page /help ET du panneau d'aide (HelpOverlay), qui
	// s'ouvre par-dessus la page sans la quitter : rien de ce qu'on écrivait n'est perdu.
	// Il lit la source unique `lib/commands.ts` : il ne peut pas annoncer une commande
	// qui n'existe pas, ni en oublier une.
	//
	// `onclose` : dans le panneau, une croix ferme ; `titleId` relie le titre au dialogue.
	import { page } from '$app/state'
	import { t, locale } from '$lib/i18n'
	import { visibleCommands, searchCommands, nameOf, argsOf, isTeamRole, type CommandDef, type Trigger } from '$lib/commands'

	let { onclose, titleId = 'nx-help-title' }: { onclose?: () => void; titleId?: string } = $props()

	const tFn = $derived($t)
	const isTeam = $derived(isTeamRole((page.data as { user?: { role?: string } })?.user?.role))
	const list = $derived(visibleCommands(isTeam))

	const SECTIONS: { k: Trigger; title: string; sub: string; tile: string; tileSub: string }[] = [
		{ k: '@', title: 'cmd.sec_at_title', sub: 'cmd.sec_at_sub', tile: 'cmd.tile_at', tileSub: 'cmd.tile_at_sub' },
		{ k: '/', title: 'cmd.sec_slash_title', sub: 'cmd.sec_slash_sub', tile: 'cmd.tile_slash', tileSub: 'cmd.tile_slash_sub' },
	]

	let query = $state('')
	let tab = $state<Trigger | 'all'>('all')
	let searchEl: HTMLInputElement | null = $state(null)

	const found = $derived(searchCommands(list, query, tFn))
	const rowsOf = (k: Trigger) => found.filter(c => c.trigger === k && (tab === 'all' || tab === k))
	const shown = $derived(SECTIONS.reduce((n, s) => n + rowsOf(s.k).length, 0))
	const countOf = (k: Trigger) => list.filter(c => c.trigger === k).length
	const plural = (n: number, one: string, other: string) => tFn(new Intl.PluralRules($locale).select(n) === 'one' ? one : other, { count: n })

	function pickTab(k: Trigger) { tab = tab === k ? 'all' : k }   // recliquer : tout revoir
	function showAll() { tab = 'all'; query = ''; searchEl?.focus() }

	/** Ce qui s'écrit : la touche, le nom, puis les arguments en plus discret. */
	function head(c: CommandDef): { name: string; args: string } {
		return { name: `${c.trigger}${nameOf(c, tFn)}`, args: argsOf(c, tFn) }
	}
</script>

<div class="hp">
		<header class="hp-head">
			{#if onclose}
				<button type="button" class="hp-x" onclick={onclose} aria-label={tFn('common.close')} title={tFn('common.close')}>
					<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				</button>
			{/if}
			<span class="eyebrow">{tFn('cmd.eyebrow')}</span>
			<svelte:element this={onclose ? 'h2' : 'h1'} class="hp-title" id={titleId}>{tFn('cmd.help_page_title')}</svelte:element>
			<p>{tFn('cmd.help_page_sub')}</p>
			<label class="search">
				<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
				<input bind:this={searchEl} bind:value={query} placeholder={tFn('cmd.search_placeholder')} aria-label={tFn('cmd.search_aria')} />
				{#if query}
					<button type="button" class="clear" onclick={() => { query = ''; searchEl?.focus() }} aria-label={tFn('cmd.search_clear')}>
						<svg viewBox="0 0 24 24" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				{/if}
			</label>
		</header>

		<div class="tiles" role="group" aria-label={tFn('cmd.tiles_aria')}>
			{#each SECTIONS as s (s.k)}
				<button type="button" class="tile" aria-pressed={tab === s.k} onclick={() => pickTab(s.k)}>
					<span class="sym" aria-hidden="true">{s.k}</span>
					<span>
						<b>{tFn(s.tile)}</b>
						<small>{tFn(s.tileSub)}</small>
						<span class="cnt">{plural(countOf(s.k), 'cmd.count_one', 'cmd.count_other')}</span>
					</span>
				</button>
			{/each}
		</div>

		{#if (tab !== 'all' || query.trim()) && shown > 0}
			<div class="filterline">
				<span>
					{#if tab !== 'all'}{plural(shown, 'cmd.filter_in_one', 'cmd.filter_in_other')} <b>{tab} {tFn(SECTIONS.find(s => s.k === tab)!.tile)}</b>{:else}{plural(shown, 'cmd.count_one', 'cmd.count_other')}{/if}{#if query.trim()} {tFn('cmd.filter_for', { q: query.trim() })}{/if}
				</span>
				<button type="button" onclick={showAll}>{tFn('cmd.show_all')}</button>
			</div>
		{/if}

		<div class="hp-body">
			{#each SECTIONS as s (s.k)}
				{@const rows = rowsOf(s.k)}
				{#if rows.length}
					<section class="hsec">
						<h2><span class="sym" aria-hidden="true">{s.k}</span>{tFn(s.title)}</h2>
						<p>{tFn(s.sub)}</p>
						<table class="ctab">
							<tbody>
								{#each rows as c (c.id)}
									{@const h = head(c)}
									<tr>
										<td class="c-name"><code>{h.name}</code>{#if h.args}<span class="arg" class:sep={h.name.length > 1}>{h.args}</span>{/if}</td>
										<td class="c-desc">{tFn(c.descKey)}{#if c.exampleKey}<span class="ex">{tFn(c.exampleKey)}</span>{/if}</td>
										<td class="c-where">
											{#if c.team}<span class="pill team">{tFn('cmd.pill_team')}</span>{/if}
											{#each c.where as w (w)}<span class="pill">{tFn(w === 'chat' ? 'cmd.pill_chat' : 'cmd.pill_forum')}</span>{/each}
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</section>
				{/if}
			{/each}

			{#if shown === 0}
				<div class="empty">
					<b>{tFn('cmd.empty_title')}</b>
					<span>{tFn('cmd.empty_sub')}</span>
				</div>
			{/if}

			{#if tab === 'all' && !query.trim()}
				<section class="hsec">
					<h2><span class="sym kb" aria-hidden="true">⌨</span>{tFn('cmd.keys_title')}</h2>
					<p>{tFn('cmd.keys_sub')}</p>
					<table class="ctab keys">
						<tbody>
							<tr><td>{tFn('cmd.key_send')}</td><td><kbd>{tFn('mention.key_enter')}</kbd></td></tr>
							<tr><td>{tFn('cmd.key_newline')}</td><td><kbd>{tFn('cmd.kbd_shift')}</kbd> + <kbd>{tFn('mention.key_enter')}</kbd></td></tr>
							<tr><td>{tFn('cmd.key_pick')}</td><td><kbd>↑</kbd> <kbd>↓</kbd> {tFn('cmd.then')} <kbd>{tFn('mention.key_enter')}</kbd></td></tr>
							<tr><td>{tFn('cmd.key_close')}</td><td><kbd>{tFn('mention.key_esc')}</kbd></td></tr>
							<tr><td>{tFn('cmd.key_rich')}</td><td><kbd>{tFn('cmd.kbd_ctrl')}</kbd> + <kbd>{tFn('cmd.kbd_shift')}</kbd> + <kbd>E</kbd></td></tr>
							<tr><td>{tFn('cmd.key_palette')}</td><td><kbd>{tFn('cmd.kbd_ctrl')}</kbd> + <kbd>K</kbd></td></tr>
							<tr><td>{tFn('cmd.key_ptt')}</td><td><kbd>{tFn('cmd.kbd_alt')}</kbd></td></tr>
						</tbody>
					</table>
				</section>
			{/if}
		</div>
	</div>

<style>
	.hp { color: var(--nx-text); background: var(--nx-surface); border: 1px solid color-mix(in srgb, var(--nx-text) 10%, transparent); border-radius: 16px; overflow: hidden; }
	.hp-head { position: relative; padding: 26px 26px 20px; border-bottom: 1px solid color-mix(in srgb, var(--nx-text) 7%, transparent);
		background: linear-gradient(180deg, color-mix(in srgb, var(--nx-header-accent) 9%, var(--nx-surface)), var(--nx-surface)); }
	.eyebrow { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); }
	.hp-head:has(.hp-x) { padding-right: 64px; }
	.hp-x { position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; border-radius: 10px; border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); background: var(--nx-surface); color: var(--nx-text-muted); display: grid; place-items: center; cursor: pointer; }
	.hp-x:hover { color: var(--nx-text); border-color: var(--nx-header-accent); }
	.hp-x svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
	.hp-head .hp-title { margin: 6px 0 4px; font-size: 22px; font-weight: 700; letter-spacing: -.01em; }
	.hp-head > p { margin: 0 0 16px; color: var(--nx-text-muted); font-size: 14px; max-width: 60ch; }
	.search { display: flex; align-items: center; gap: 10px; border: 1px solid color-mix(in srgb, var(--nx-text) 14%, transparent); border-radius: 12px; padding: 0 12px 0 14px; height: 44px; background: var(--nx-surface); max-width: 560px; }
	.search:focus-within { border-color: color-mix(in srgb, var(--nx-header-accent) 60%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--nx-header-accent) 18%, transparent); }
	.search svg { width: 17px; height: 17px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; color: var(--nx-text-faint); }
	.search input { border: 0; outline: 0; background: transparent; flex: 1; min-width: 0; font-size: 14.5px; color: var(--nx-text); }
	.search .clear { border: 0; background: none; color: var(--nx-text-faint); border-radius: 6px; width: 28px; height: 28px; display: grid; place-items: center; cursor: pointer; }
	.search .clear:hover { background: color-mix(in srgb, var(--nx-text) 6%, transparent); color: var(--nx-text); }
	.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; padding: 16px 26px; border-bottom: 1px solid color-mix(in srgb, var(--nx-text) 7%, transparent); }
	.tile { display: flex; gap: 11px; align-items: flex-start; text-align: left; border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); background: var(--nx-surface); color: var(--nx-text); border-radius: 12px; padding: 11px 12px; cursor: pointer; transition: border-color .15s, background .15s; }
	.tile:hover { border-color: color-mix(in srgb, var(--nx-header-accent) 45%, transparent); }
	.tile[aria-pressed="true"] { border-color: var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 9%, var(--nx-surface)); box-shadow: inset 0 0 0 1px var(--nx-header-accent); }
	.tile b { display: block; font-size: 13.5px; }
	.tile small { display: block; font-size: 12px; color: var(--nx-text-muted); line-height: 1.35; margin-top: 1px; }
	.tile .cnt { display: inline-block; margin-top: 5px; font-size: 11px; font-weight: 600; color: var(--nx-text-faint); }
	.sym { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; flex: none; font: 700 16px ui-monospace, SFMono-Regular, Menlo, monospace; background: color-mix(in srgb, var(--nx-header-accent) 16%, transparent); color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); }
	.sym.kb { font-size: 15px; }
	.filterline { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 10px; padding: 12px 26px 0; font-size: 12.5px; color: var(--nx-text-muted); }
	.filterline b { color: var(--nx-text); }
	.filterline button { border: 0; background: none; padding: 0; color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); text-decoration: underline; font-size: 12.5px; cursor: pointer; }
	.hp-body { padding: 0 26px 14px; }
	.hsec { padding: 18px 0 10px; }
	.hsec + .hsec { border-top: 1px solid color-mix(in srgb, var(--nx-text) 7%, transparent); }
	.hsec h2 { margin: 0 0 2px; font-size: 15px; font-weight: 700; display: flex; gap: 10px; align-items: center; }
	.hsec > p { margin: 0 0 10px 42px; color: var(--nx-text-muted); font-size: 13px; }
	.ctab { width: 100%; border-collapse: collapse; font-size: 13px; }
	.ctab td { padding: 8px; border-top: 1px solid color-mix(in srgb, var(--nx-text) 6%, transparent); vertical-align: top; }
	.ctab tr:first-child td { border-top: 0; }
	.c-name { width: 200px; white-space: nowrap; }
	.c-name code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 700; color: color-mix(in srgb, var(--nx-header-accent) 72%, var(--nx-text)); }
	.c-name .arg.sep { margin-left: 7px; }
	.c-name .arg { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--nx-text-faint); }
	.c-desc .ex { display: block; color: var(--nx-text-faint); font-size: 12px; margin-top: 2px; }
	.c-where { white-space: nowrap; text-align: right; }
	.pill { display: inline-block; font-size: 10.5px; font-weight: 600; padding: 1px 7px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--nx-text) 14%, transparent); color: var(--nx-text-muted); margin-left: 3px; }
	.pill.team { border-color: color-mix(in srgb, var(--nx-info, #1d4ed8) 40%, transparent); color: var(--nx-info, #1d4ed8); }
	.keys td:last-child { text-align: right; white-space: nowrap; }
	kbd { font-family: inherit; font-size: 11px; border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); border-bottom-width: 2px; border-radius: 5px; padding: 0 5px; background: var(--nx-surface); color: var(--nx-text-muted); }
	.empty { text-align: center; padding: 34px 16px 30px; color: var(--nx-text-muted); display: flex; flex-direction: column; gap: 4px; }
	.empty b { color: var(--nx-text); font-size: 14.5px; }
	@media (max-width: 640px) {
		.hp-head, .tiles, .hp-body, .filterline { padding-left: 16px; padding-right: 16px; }
		.tiles { grid-template-columns: 1fr 1fr; }
		.tile small { display: none; }
		.ctab tr { display: grid; grid-template-columns: 1fr auto; }
		.ctab td { border-top: 0; }
		.ctab tr + tr { border-top: 1px solid color-mix(in srgb, var(--nx-text) 6%, transparent); }
		.c-name { width: auto; white-space: normal; }
		.c-desc { grid-column: 1 / -1; padding-top: 0; }
		.c-where { grid-row: 1; grid-column: 2; }
		.hsec > p { margin-left: 0; }
	}
</style>
