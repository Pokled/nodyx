<script lang="ts">
	// Le jeu de l'événement, dans le formulaire (maquette https://nodyx.org/inscrits-maquette.html,
	// point 2 ; D66). Le catalogue de la communauté, une recherche, et pour l'équipe :
	// ajouter un jeu (jaquette téléversée, ou trouvée sur Steam puis copiée sur l'instance)
	// ou le retirer. Ce n'est pas un jeu : une icône et une couleur. Le formulaire reçoit
	// game_id, icon et icon_color (champs cachés) ; le cœur vérifie tout.
	import { onMount } from 'svelte'
	import { t } from '$lib/i18n'
	import EventVisual from '$lib/components/EventVisual.svelte'
	import {
		GAME_ICONS, GAME_COLORS, ICON_PATHS, COLOR_BG, GAME_ERROR_KEYS,
		listGames, gamesStatus, uploadGame, steamSearch, steamImport, deleteGame,
		type Game, type GameIcon, type GameColor,
	} from '$lib/eventGames'

	let { token, gameId = null, icon = null, iconColor = null }: {
		token: string | null
		gameId?: string | null
		icon?: GameIcon | null
		iconColor?: GameColor | null
	} = $props()

	let games = $state<Game[]>([])
	let loaded = $state(false)
	let canManage = $state(false)
	let steamOn = $state(false)
	let q = $state('')
	let selected = $state<string | null>(null)
	let pickedIcon = $state<GameIcon | null>(null)
	let pickedColor = $state<GameColor>('violet')
	let adding = $state(false)
	let newName = $state('')
	let busy = $state(false)
	let error = $state('')
	let notice = $state('')
	let steamResults = $state<{ appid: number; name: string }[] | null>(null)
	let fileEl = $state<HTMLInputElement | null>(null)

	$effect.pre(() => {
		// Valeurs de départ (modification d'un événement), une seule fois
		if (!loaded) { selected = gameId; pickedIcon = icon; pickedColor = iconColor ?? 'violet' }
	})

	onMount(async () => {
		const [st, ls] = await Promise.all([gamesStatus(token), listGames(token)])
		if (st.ok) { canManage = st.data.can_manage; steamOn = st.data.steam }
		if (ls.ok) games = ls.data.games
		loaded = true
	})

	const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
	const shown = $derived(q.trim() ? games.filter(g => fold(g.name).includes(fold(q.trim()))) : games)
	const current = $derived(games.find(g => g.id === selected) ?? null)
	const look = $derived(current ? { game_name: current.name, game_cover: current.cover_path } : { icon: pickedIcon, icon_color: pickedColor })

	function pickGame(id: string | null) { selected = id; if (id) pickedIcon = null }
	function pickIcon(i: GameIcon | null) { pickedIcon = i; if (i) selected = null }
	const errText = (code: string) => $t(GAME_ERROR_KEYS[code] ?? 'eventgame.err_generic', { reason: code })

	function added(g: Game) {
		games = [...games, g].sort((a, b) => a.name.localeCompare(b.name))
		pickGame(g.id)
		notice = $t('eventgame.added', { name: g.name })
		adding = false; newName = ''; steamResults = null; q = ''
	}
	async function onUpload() {
		const file = fileEl?.files?.[0]
		if (!file) return
		error = ''; notice = ''
		if (!newName.trim()) { error = $t('eventgame.err_name'); if (fileEl) fileEl.value = ''; return }
		busy = true
		const r = await uploadGame(token, newName.trim(), file)
		busy = false
		if (fileEl) fileEl.value = ''
		if (r.ok) added(r.data.game); else error = errText(r.code)
	}
	async function onSteamSearch() {
		error = ''; notice = ''
		if (newName.trim().length < 2) { error = $t('eventgame.err_name'); return }
		busy = true
		const r = await steamSearch(token, newName.trim())
		busy = false
		if (r.ok) steamResults = r.data.results; else error = errText(r.code)
	}
	async function onSteamCopy(res: { appid: number; name: string }) {
		error = ''; busy = true
		const r = await steamImport(token, res.appid, res.name)
		busy = false
		if (r.ok) added(r.data.game); else error = errText(r.code)
	}
	async function onRemove(g: Game) {
		if (!confirm($t('eventgame.remove_confirm', { name: g.name }))) return
		const r = await deleteGame(token, g.id)
		if (!r.ok) { error = errText(r.code); return }
		games = games.filter(x => x.id !== g.id)
		if (selected === g.id) selected = null
	}
</script>

<input type="hidden" name="game_id" value={selected ?? ''} />
<input type="hidden" name="icon" value={selected ? '' : pickedIcon ?? ''} />
<input type="hidden" name="icon_color" value={selected || !pickedIcon ? '' : pickedColor} />

<div class="egp">
	<div class="egp-head">
		<div>
			<span class="egp-title">{$t('eventgame.section_title')}</span>
			<p class="egp-sub">{$t('eventgame.section_sub')}</p>
		</div>
		<span class="egp-pv"><EventVisual {look} size="lg" shape={current ? 'jaq' : 'tile'} /></span>
	</div>

	{#if games.length > 6}
		<label class="egp-search">
			<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
			<input bind:value={q} placeholder={$t('eventgame.search_ph')} aria-label={$t('eventgame.search_ph')} />
		</label>
	{/if}

	<div class="egp-grid" role="radiogroup" aria-label={$t('eventgame.section_title')}>
		<button type="button" class="egp-g" role="radio" aria-checked={!selected} onclick={() => pickGame(null)}>
			<span class="egp-none">{$t('eventgame.none')}</span>
		</button>
		{#each shown as g (g.id)}
			<button type="button" class="egp-g" role="radio" aria-checked={selected === g.id} onclick={() => pickGame(g.id)}>
				<EventVisual look={{ game_name: g.name, game_cover: g.cover_path }} size="xl" shape="jaq" />
				<span class="egp-name">{g.name}</span>
			</button>
		{/each}
		{#if canManage}
			<button type="button" class="egp-g egp-add" onclick={() => { adding = !adding; newName = newName || q.trim() }} aria-expanded={adding}>
				<span class="egp-plus" aria-hidden="true">+</span>
				<span class="egp-name">{$t('eventgame.add')}</span>
			</button>
		{/if}
	</div>

	{#if loaded && !games.length}
		<p class="egp-note">{$t(canManage ? 'eventgame.empty_team' : 'eventgame.empty_member')}</p>
	{/if}
	{#if notice}<p class="egp-ok" role="status">{notice}</p>{/if}
	{#if error}<p class="egp-err" role="alert">{error}</p>{/if}

	{#if adding && canManage}
		<div class="egp-addbox">
			<b>{$t('eventgame.add_title')}</b>
			<label class="egp-lbl" for="egp-name">{$t('eventgame.name_label')}</label>
			<input id="egp-name" class="egp-in" bind:value={newName} maxlength="80" placeholder={$t('eventgame.name_ph')} />
			<div class="egp-acts">
				<label class="egp-btn" class:disabled={busy}>
					{$t('eventgame.upload')}
					<input bind:this={fileEl} type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onchange={onUpload} disabled={busy} />
				</label>
				{#if steamOn}<button type="button" class="egp-btn primary" onclick={onSteamSearch} disabled={busy}>{$t('eventgame.steam_search')}</button>{/if}
				<button type="button" class="egp-btn ghost" onclick={() => { adding = false; steamResults = null; error = '' }}>{$t('eventgame.cancel')}</button>
			</div>
			<small>{$t('eventgame.upload_hint')}</small>
			{#if steamResults}
				{#if steamResults.length}
					<ul class="egp-steam">
						{#each steamResults as r (r.appid)}
							<li><span>{r.name}</span><button type="button" class="egp-btn sm" onclick={() => onSteamCopy(r)} disabled={busy}>{$t('eventgame.steam_copy')}</button></li>
						{/each}
					</ul>
				{:else}
					<p class="egp-note">{$t('eventgame.steam_none', { q: newName.trim() })}</p>
				{/if}
			{/if}
			{#if steamOn}<small>{$t('eventgame.steam_note')}</small>{:else}<small>{$t('eventgame.steam_off')}</small>{/if}
		</div>
	{/if}

	{#if canManage && current}
		<button type="button" class="egp-link" onclick={() => current && onRemove(current)}>{$t('eventgame.remove')}</button>
	{/if}

	<details class="egp-more" open={!!pickedIcon && !selected}>
		<summary>{$t('eventgame.not_a_game')}</summary>
		<div class="egp-icons" role="radiogroup" aria-label={$t('eventgame.not_a_game')}>
			{#each GAME_ICONS as i (i)}
				<button type="button" class="egp-i" role="radio" aria-checked={!selected && pickedIcon === i} aria-label={$t(`eventgame.icon_${i}`)} title={$t(`eventgame.icon_${i}`)}
					style={!selected && pickedIcon === i ? `background:${COLOR_BG[pickedColor]}` : ''} onclick={() => pickIcon(pickedIcon === i ? null : i)}>
					<svg viewBox="0 0 24 24" aria-hidden="true">{@html ICON_PATHS[i]}</svg>
				</button>
			{/each}
		</div>
		<div class="egp-colors" role="radiogroup" aria-label={$t('eventgame.color')}>
			{#each GAME_COLORS as c (c)}
				<button type="button" class="egp-c" role="radio" aria-checked={pickedColor === c} aria-label={$t(`eventgame.color_${c}`)} title={$t(`eventgame.color_${c}`)}
					style="background:{COLOR_BG[c]}" onclick={() => { pickedColor = c; if (!pickedIcon) pickIcon('pad') }}></button>
			{/each}
		</div>
	</details>
</div>

<style>
	.egp { border: 1px solid var(--nx-border); border-radius: 14px; padding: 14px 16px; background: color-mix(in srgb, var(--nx-surface) 70%, transparent); color: var(--nx-text); }
	.egp-head { display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; }
	.egp-title { font-size: 14px; font-weight: 600; }
	.egp-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--nx-text-muted); max-width: 52ch; }
	.egp-search { display: flex; align-items: center; gap: 8px; margin-top: 12px; border: 1px solid var(--nx-border); border-radius: 10px; padding: 6px 10px; max-width: 360px; background: var(--nx-surface); }
	.egp-search svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; color: var(--nx-text-muted); }
	.egp-search input { border: 0; outline: 0; background: transparent; flex: 1; min-width: 0; font-size: 13.5px; color: var(--nx-text); }
	.egp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 10px; margin-top: 12px; }
	.egp-g { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 4px; border-radius: 12px; border: 2px solid transparent; background: none; cursor: pointer; color: var(--nx-text); }
	.egp-g[aria-checked="true"] { border-color: var(--nx-header-accent); }
	.egp-g :global(.ev-xl) { width: 100%; }
	.egp-none, .egp-plus { width: 100%; aspect-ratio: 2 / 3; border-radius: 12px; display: grid; place-items: center; border: 2px dashed var(--nx-border); color: var(--nx-text-muted); font-size: 12.5px; }
	.egp-plus { font-size: 28px; }
	.egp-name { font-size: 12px; font-weight: 600; text-align: center; line-height: 1.25; overflow-wrap: anywhere; }
	.egp-note { margin: 8px 0 0; font-size: 12.5px; color: var(--nx-text-muted); }
	.egp-ok { margin: 8px 0 0; font-size: 12.5px; color: var(--nx-ok); }
	.egp-err { margin: 8px 0 0; font-size: 12.5px; color: var(--nx-bad); }
	.egp-addbox { margin-top: 12px; border: 1px solid var(--nx-border); border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 6px; background: var(--nx-surface); }
	.egp-addbox b { font-size: 13.5px; }
	.egp-addbox small { color: var(--nx-text-muted); font-size: 12px; }
	.egp-lbl { font-size: 12px; color: var(--nx-text-muted); }
	.egp-in { border: 1px solid var(--nx-border); border-radius: 9px; padding: 7px 10px; font-size: 13.5px; background: var(--nx-surface-raised, var(--nx-surface)); color: var(--nx-text); }
	.egp-acts { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0; }
	.egp-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); cursor: pointer; }
	.egp-btn.primary { background: var(--nx-header-accent); color: var(--nx-on-accent, #16120c); border-color: transparent; }
	.egp-btn.ghost { border-color: transparent; background: transparent; color: var(--nx-text-muted); font-weight: 500; }
	.egp-btn.sm { padding: 3px 10px; font-size: 12px; }
	.egp-btn.disabled, .egp-btn:disabled { opacity: .6; cursor: wait; }
	.egp-steam { list-style: none; margin: 4px 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.egp-steam li { display: flex; align-items: center; gap: 10px; font-size: 13px; justify-content: space-between; }
	.egp-link { margin-top: 8px; border: 0; background: none; padding: 0; font-size: 12px; color: var(--nx-text-muted); text-decoration: underline; cursor: pointer; }
	.egp-more { margin-top: 12px; }
	.egp-more summary { cursor: pointer; font-size: 13px; font-weight: 600; }
	.egp-icons { display: flex; flex-wrap: wrap; gap: 8px; margin: 10px 0; }
	.egp-i { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; border: 2px solid transparent; background: linear-gradient(135deg,#334155,#64748b); color: #fff; cursor: pointer; }
	.egp-i[aria-checked="true"] { border-color: var(--nx-header-accent); }
	.egp-i svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.egp-colors { display: flex; gap: 8px; flex-wrap: wrap; }
	.egp-c { width: 30px; height: 30px; border-radius: 99px; border: 2px solid transparent; cursor: pointer; }
	.egp-c[aria-checked="true"] { border-color: var(--nx-header-accent); box-shadow: 0 0 0 2px var(--nx-surface) inset; }
	.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
	.egp-btn { position: relative; }
</style>
