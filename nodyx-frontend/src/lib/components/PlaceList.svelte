<script lang="ts">
	// La liste du « # » (maquette https://nodyx.org/commandes-maquette.html, section 2),
	// même allure que celle des mentions. Rangée par sorte d'endroit, dans l'ordre de D59
	// (le serveur trie). Elle ne gère ni le clavier ni la position : le champ la pilote.
	import { t, locale } from '$lib/i18n'
	import { fold } from '$lib/commands'
	import { viewerZone, showZone } from '$lib/eventTime'
	import { KIND_LABEL_KEYS, type Place } from '$lib/places'

	let { items, active = 0, query = '', onpick, id = 'nx-place-list' }: {
		items: Place[]
		active?: number
		query?: string
		onpick: (p: Place) => void
		id?: string
	} = $props()

	const ICON: Record<Place['kind'], string> = {
		channel: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
		event: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
		thread: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
		wiki: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
		poll: 'M18 20V10M12 20V4M6 20v-6',
		board: 'M3 3h18v18H3zM9 3v18M15 3v18',
	}

	const q = $derived(fold(query.trim()))
	/** Le nom avec la partie tapée surlignée (comparaison sans accents). */
	function parts(name: string): [string, string, string] {
		const f = fold(name), i = q ? f.indexOf(q) : -1
		if (i < 0) return [name, '', '']
		return [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)]
	}

	/** Ce qui aide à choisir : la date d'un événement, la catégorie d'un sujet… */
	function hint(p: Place): string {
		const h = p.hint
		switch (p.kind) {
			case 'event': {
				if (!h.starts_at) return ''
				const z = { timeZone: showZone({ is_all_day: h.is_all_day }, $viewerZone) }
				const when = new Date(h.starts_at).toLocaleString($locale, h.is_all_day
					? { weekday: 'long', day: 'numeric', month: 'short', ...z }
					: { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', ...z })
				const going = h.going ? ` · ${$t(new Intl.PluralRules($locale).select(h.going) === 'one' ? 'place.going_one' : 'place.going_other', { count: String(h.going) })}` : ''
				return when + going + (p.private ? ` · ${$t('place.private_badge')}` : '')
			}
			case 'thread': {
				const n = h.replies ?? 0
				const replies = $t(new Intl.PluralRules($locale).select(n) === 'one' ? 'place.replies_one' : 'place.replies_other', { count: String(n) })
				return h.category ? `${$t('place.in_category', { name: h.category })} · ${replies}` : replies
			}
			case 'poll': {
				const n = h.votes ?? 0
				return `${$t(new Intl.PluralRules($locale).select(n) === 'one' ? 'place.votes_one' : 'place.votes_other', { count: String(n) })} · ${$t(h.closed ? 'place.poll_closed' : 'place.poll_open')}`
			}
			case 'board': {
				const n = h.cards ?? 0
				return $t(new Intl.PluralRules($locale).select(n) === 'one' ? 'place.cards_one' : 'place.cards_other', { count: String(n) })
			}
			case 'wiki': return h.category ? $t('place.in_category', { name: h.category }) : $t('place.kind_wiki')
			case 'channel': return h.description || $t('place.kind_channel')
		}
	}
</script>

<div class="pl" role="listbox" {id} aria-label={$t('place.list_aria')}>
	{#each items as p, i (p.ref)}
		{@const [a, b, c] = parts(p.title)}
		{#if i === 0 || items[i - 1].kind !== p.kind}<div class="pl-h" role="presentation">{$t(KIND_LABEL_KEYS[p.kind])}</div>{/if}
		<button type="button" class="pl-o" class:on={i === active} role="option" id="{id}-{i}" aria-selected={i === active}
			onmousedown={(e) => { e.preventDefault(); onpick(p) }}>
			<span class="pl-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d={ICON[p.kind]}/></svg></span>
			<span class="pl-t">
				<span class="pl-n">{a}{#if b}<mark>{b}</mark>{/if}{c}</span>
				<span class="pl-w">{hint(p)}</span>
			</span>
		</button>
	{/each}
	<div class="pl-f" aria-hidden="true">
		<span><kbd>↑</kbd> <kbd>↓</kbd> {$t('mention.key_choose')}</span>
		<span><kbd>{$t('mention.key_enter')}</kbd> {$t('mention.key_insert')}</span>
		<span><kbd>{$t('mention.key_esc')}</kbd> {$t('mention.key_close')}</span>
	</div>
</div>

<style>
	.pl { background: var(--nx-surface); border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.18); padding: 6px; max-height: 360px; overflow: auto; width: min(400px, calc(100vw - 32px)); color: var(--nx-text); }
	.pl-h { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--nx-text-faint); padding: 8px 8px 4px; }
	.pl-o { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: transparent; border-radius: 8px; padding: 6px 8px; cursor: pointer; color: inherit; }
	.pl-o.on, .pl-o:hover { background: color-mix(in srgb, var(--nx-header-accent) 14%, transparent); }
	.pl-ico { width: 28px; height: 28px; border-radius: 8px; flex: none; display: grid; place-items: center; background: color-mix(in srgb, var(--nx-text) 7%, transparent); color: var(--nx-text-muted); }
	.pl-ico svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.pl-t { display: flex; flex-direction: column; min-width: 0; }
	.pl-n { font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pl-n mark { background: color-mix(in srgb, var(--nx-header-accent) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
	.pl-w { font-size: 12px; color: var(--nx-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pl-f { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--nx-text-faint); padding: 6px 8px 2px; border-top: 1px solid color-mix(in srgb, var(--nx-text) 8%, transparent); margin-top: 4px; }
	.pl-f kbd { font-family: inherit; border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); border-radius: 4px; padding: 0 4px; }
	@media (hover: none) { .pl-f { display: none; } }
</style>
