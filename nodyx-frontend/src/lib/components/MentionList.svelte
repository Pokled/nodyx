<script lang="ts">
	// La liste des propositions de mention (maquette https://nodyx.org/mentions-maquette.html,
	// section 1), partagée par la zone de saisie du chat et l'éditeur. Elle ne gère ni le
	// clavier ni la position : c'est le champ qui la pilote (flèches, Entrée, Échap).
	import { t, locale } from '$lib/i18n'
	import { onlineMembersStore } from '$lib/socket'
	import { fold, insertLabel, type MentionSuggestion } from '$lib/mentions'

	let { items, active = 0, query = '', context = 'channel', onpick, id = 'nx-mention-list' }: {
		items: MentionSuggestion[]
		active?: number
		query?: string
		context?: 'channel' | 'thread'
		onpick: (s: MentionSuggestion) => void
		id?: string
	} = $props()

	const online = $derived(new Set($onlineMembersStore.map(m => m.userId)))
	const q = $derived(fold(query))

	function ago(iso?: string): string {
		if (!iso) return ''
		const s = Math.round((new Date(iso).getTime() - Date.now()) / 1000)
		const rtf = new Intl.RelativeTimeFormat($locale, { numeric: 'auto' })
		const a = Math.abs(s)
		if (a < 60) return rtf.format(Math.round(s), 'second')
		if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
		if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
		return rtf.format(Math.round(s / 86400), 'day')
	}

	function why(s: MentionSuggestion): string {
		if (s.reason === 'here') return $t(context === 'thread' ? 'mention.why_here_thread' : 'mention.why_here', { when: ago(s.last_at) })
		if (s.reason === 'frequent') return $t('mention.why_frequent')
		if (s.reason === 'group') {
			const n = s.count ?? 0
			if (s.key === 'ici') return $t('mention.why_online', { count: n })
			return $t(new Intl.PluralRules($locale).select(n) === 'one' ? 'mention.why_people_one' : 'mention.why_people_other', { count: n })
		}
		return '@' + s.username
	}

	const groupOf = (r: MentionSuggestion['reason']) =>
		r === 'here' ? $t(context === 'thread' ? 'mention.group_here_thread' : 'mention.group_here')
		: r === 'frequent' ? $t('mention.group_frequent') : r === 'group' ? $t('mention.group_groups') : $t('mention.group_member')

	/** Le nom avec la partie tapée surlignée (comparaison sans accents). */
	function parts(name: string): [string, string, string] {
		const f = fold(name), i = q ? f.indexOf(q) : -1
		if (i < 0) return [name, '', '']
		return [name.slice(0, i), name.slice(i, i + q.length), name.slice(i + q.length)]
	}

	const COLORS = ['#7c3aed', '#0f766e', '#b45309', '#be185d', '#334155', '#1d4ed8', '#15803d']
	const colorOf = (n: string) => COLORS[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]
</script>

<div class="ml" role="listbox" {id} aria-label={$t('mention.list_aria')}>
	{#each items as s, i (s.id)}
		{@const name = insertLabel(s, $t)}
		{@const [a, b, c] = parts(name)}
		{#if i === 0 || items[i - 1].reason !== s.reason}<div class="ml-h" role="presentation">{groupOf(s.reason)}</div>{/if}
		<button type="button" class="ml-o" class:on={i === active} role="option" id="{id}-{i}" aria-selected={i === active}
			onmousedown={(e) => { e.preventDefault(); onpick(s) }}>
			{#if s.reason === 'group'}
				<span class="ml-av ml-grp" aria-hidden="true">
					<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
				</span>
			{:else}
				<span class="ml-av" style={s.avatar ? '' : `background:${colorOf(s.username)}`}>
					{#if s.avatar}<img src={s.avatar} alt="" />{:else}{name.slice(0, 1).toUpperCase()}{/if}
					<span class="ml-dot" class:is-on={online.has(s.id)} aria-hidden="true"></span>
				</span>
			{/if}
			<span class="ml-t">
				<span class="ml-n">{#if s.reason === 'group'}@{/if}{a}{#if b}<mark>{b}</mark>{/if}{c}</span>
				<span class="ml-w">{why(s)}</span>
			</span>
		</button>
	{/each}
	<div class="ml-f" aria-hidden="true">
		<span><kbd>↑</kbd> <kbd>↓</kbd> {$t('mention.key_choose')}</span>
		<span><kbd>{$t('mention.key_enter')}</kbd> {$t('mention.key_insert')}</span>
		<span><kbd>{$t('mention.key_esc')}</kbd> {$t('mention.key_close')}</span>
	</div>
</div>

<style>
	.ml { background: var(--nx-surface); border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent); border-radius: 12px; box-shadow: 0 12px 32px rgba(0,0,0,.18); padding: 6px; max-height: 340px; overflow: auto; width: min(360px, calc(100vw - 32px)); color: var(--nx-text); }
	.ml-h { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--nx-text-faint); padding: 8px 8px 4px; }
	.ml-o { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; background: transparent; border-radius: 8px; padding: 6px 8px; cursor: pointer; color: inherit; }
	.ml-o.on, .ml-o:hover { background: color-mix(in srgb, var(--nx-header-accent) 14%, transparent); }
	.ml-av { position: relative; width: 28px; height: 28px; border-radius: 8px; flex: none; display: grid; place-items: center; color: #fff; font-weight: 700; font-size: 12px; }
	.ml-grp { background: color-mix(in srgb, var(--nx-text) 9%, transparent); color: var(--nx-text-muted); }
	.ml-grp svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.ml-av img { width: 100%; height: 100%; border-radius: 8px; object-fit: cover; }
	.ml-dot { position: absolute; right: -2px; bottom: -2px; width: 9px; height: 9px; border-radius: 99px; border: 2px solid var(--nx-surface); background: #9ca3af; }
	.ml-dot.is-on { background: #22c55e; }
	.ml-t { display: flex; flex-direction: column; min-width: 0; }
	.ml-n { font-weight: 600; font-size: 13.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ml-n mark { background: color-mix(in srgb, var(--nx-header-accent) 30%, transparent); color: inherit; border-radius: 3px; padding: 0 1px; }
	.ml-w { font-size: 12px; color: var(--nx-text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.ml-f { display: flex; gap: 12px; flex-wrap: wrap; font-size: 11px; color: var(--nx-text-faint); padding: 6px 8px 2px; border-top: 1px solid color-mix(in srgb, var(--nx-text) 8%, transparent); margin-top: 4px; }
	.ml-f kbd { font-family: inherit; border: 1px solid color-mix(in srgb, var(--nx-text) 15%, transparent); border-radius: 4px; padding: 0 4px; }
	@media (hover: none) { .ml-f { display: none; } }
</style>
