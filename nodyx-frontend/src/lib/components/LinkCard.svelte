<script lang="ts">
	// Une carte « Nodyx relié » (maquette validée https://nodyx.org/cartes-maquette.html).
	// Chargée seulement quand elle arrive à l'écran ; le cœur vérifie les droits de CE
	// lecteur. Toute la carte s'ouvre par son lien principal (un seul lien, lisible au
	// lecteur d'écran) ; « Je participe » reste un vrai bouton, à part.
	import { onMount } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import { cardFor, patchEvent, type CardState, type Person } from '$lib/linkCards'

	let { path, token = null, onready }: {
		path: string
		token?: string | null
		/** Appelé quand la carte est prête (true) ou qu'il n'y en aura pas (false). */
		onready?: (shown: boolean) => void
	} = $props()

	let root: HTMLElement | undefined = $state()
	let st = $state<CardState>({ status: 'loading' })
	let visible = $state(false)
	let busy = $state(false)
	let rsvpError = $state<string | null>(null)
	let now = $state(Date.now())

	onMount(() => {
		if (!root) return
		if (typeof IntersectionObserver === 'undefined') { visible = true; return }
		const io = new IntersectionObserver(entries => {
			if (entries.some(e => e.isIntersecting)) { visible = true; io.disconnect() }
		}, { rootMargin: '200px' })
		io.observe(root)
		return () => io.disconnect()
	})

	$effect(() => {
		if (!visible) return
		const unsub = cardFor(path, token).subscribe(v => { st = v; now = Date.now() })
		return unsub
	})

	$effect(() => {
		if (st.status === 'ready') onready?.(st.card !== null)
		else if (st.status === 'error') onready?.(false)
	})

	const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat($locale, o)
	const plural = (n: number, one: string, other: string, vars: Record<string, string | number> = {}) =>
		$t(new Intl.PluralRules($locale).select(n) === 'one' ? one : other, { count: n, ...vars })

	function relative(iso: string): string {
		const s = Math.round((new Date(iso).getTime() - now) / 1000)
		const rtf = new Intl.RelativeTimeFormat($locale, { numeric: 'auto' })
		const a = Math.abs(s)
		if (a < 60) return rtf.format(Math.round(s), 'second')
		if (a < 3600) return rtf.format(Math.round(s / 60), 'minute')
		if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour')
		if (a < 30 * 86400) return rtf.format(Math.round(s / 86400), 'day')
		return fmt({ day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
	}

	const when = (iso: string) => fmt({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

	/** Fin d'un événement : sa fin, sinon la fin du jour où il commence. */
	function endOf(c: { starts_at: string; ends_at: string | null }): Date {
		if (c.ends_at) return new Date(c.ends_at)
		const d = new Date(c.starts_at); d.setHours(23, 59, 59, 999); return d
	}

	function eventLine(c: { starts_at: string; ends_at: string | null; is_all_day: boolean }): string {
		const start = new Date(c.starts_at)
		const day = fmt({ weekday: 'long', day: 'numeric', month: 'short' }).format(start)
		if (c.is_all_day) return $t('link_card.all_day', { day })
		const startTxt = fmt({ weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(start)
		if (!c.ends_at) return startTxt
		const end = new Date(c.ends_at)
		const sameDay = end.toDateString() === start.toDateString()
		const endTxt = sameDay ? fmt({ hour: '2-digit', minute: '2-digit' }).format(end) : when(c.ends_at)
		return $t('link_card.time_range', { start: startTxt, end: endTxt })
	}

	const COLORS = ['#7c3aed', '#0f766e', '#b45309', '#be185d', '#334155', '#1d4ed8', '#15803d']
	const colorOf = (name: string) => COLORS[[...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % COLORS.length]

	async function toggleRsvp(eventPath: string, going: boolean) {
		if (busy || !token) return
		busy = true; rsvpError = null
		const id = eventPath.split('/').pop()!
		const before = $state.snapshot(st)
		// Mise à jour immédiate, partagée par toutes les cartes de cet événement dans la page
		patchEvent(path, token, c => ({
			...c, my_rsvp: going ? null : 'going', going_count: Math.max(0, c.going_count + (going ? -1 : 1)),
		}))
		try {
			const r = await apiFetch(fetch, `/events/${id}/rsvp`, going
				? { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
				: { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ status: 'going' }) })
			if (!r.ok) {
				const j = await r.json().catch(() => ({}))
				throw new Error(j.code === 'EVENT_FULL' ? 'link_card.rsvp_full' : 'link_card.rsvp_error')
			}
		} catch (e) {
			if (before.status === 'ready' && before.card?.type === 'event') {
				const prev = before.card
				patchEvent(path, token, () => prev)
			}
			rsvpError = $t(e instanceof Error && e.message.startsWith('link_card.') ? e.message : 'link_card.rsvp_error')
		} finally { busy = false }
	}
</script>

{#snippet avatar(p: Person, cls = 'lc-av')}
	{#if p.avatar}
		<img class={cls} src={p.avatar} alt="" loading="lazy" />
	{:else}
		<span class={cls} style="background: {colorOf(p.username)}" aria-hidden="true">{p.username.slice(0, 1).toUpperCase()}</span>
	{/if}
{/snippet}

{#snippet icon(name: 'forum' | 'reply' | 'cal' | 'clock' | 'pin' | 'msg' | 'lock' | 'off' | 'check')}
	<svg class="lc-i" viewBox="0 0 24 24" aria-hidden="true">
		{#if name === 'forum'}<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
		{:else if name === 'reply'}<polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
		{:else if name === 'cal'}<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
		{:else if name === 'clock'}<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
		{:else if name === 'pin'}<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
		{:else if name === 'msg'}<path d="M21 11.5a8.38 8.38 0 0 1-9 8.5 8.5 8.5 0 0 1-4-1L3 21l2-5a8.38 8.38 0 0 1-1-4.5A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z"/>
		{:else if name === 'lock'}<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
		{:else if name === 'off'}<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>
		{:else}<polyline points="20 6 9 17 4 12"/>{/if}
	</svg>
{/snippet}

<div class="lc-slot" bind:this={root}>
	{#if st.status === 'loading'}
		<div class="lc-card" aria-busy="true" aria-label={$t('link_card.loading')}>
			<div class="lc-in"><div class="lc-sk" style="width:40%"></div><div class="lc-sk" style="width:85%;height:13px"></div><div class="lc-sk" style="width:60%"></div></div>
		</div>
	{:else if st.status === 'ready' && st.card}
		{@const c = st.card}
		{#if c.type === 'thread'}
			<div class="lc-card">
				<div class="lc-in">
					<div class="lc-kind">{@render icon('forum')}{$t('link_card.kind_thread')}{#if c.category}<span class="lc-dot">·</span>{c.category}{/if}</div>
					<a class="lc-title" href={c.url}>{c.title}</a>
					<div class="lc-meta">
						<span class="lc-p">{@render avatar(c.author)}{c.author.username}</span>
						<span class="lc-p">{@render icon('msg')}{c.replies === 0 ? $t('link_card.replies_zero') : plural(c.replies, 'link_card.replies_one', 'link_card.replies_other')}</span>
						{#if c.replies > 0}<span>{$t('link_card.last_activity', { when: relative(c.last_activity_at) })}</span>{/if}
						{#if c.is_locked}<span class="lc-badge lc-muted">{@render icon('lock')}{$t('link_card.locked')}</span>{/if}
					</div>
					{#if c.tags.length}<div class="lc-tags">{#each c.tags as tag (tag)}<span class="lc-tag">{tag}</span>{/each}</div>{/if}
				</div>
			</div>
		{:else if c.type === 'post'}
			<div class="lc-card">
				<div class="lc-in">
					<div class="lc-kind">{@render icon('reply')}<span class="lc-ell">{$t('link_card.kind_post', { title: c.thread.title })}</span></div>
					{#if c.excerpt}<p class="lc-excerpt">{c.excerpt}</p>{/if}
					<div class="lc-meta"><span class="lc-p">{@render avatar(c.author)}{c.author.username}</span><span>{when(c.created_at)}</span></div>
					<a class="lc-title lc-go" href={c.url}>{$t('link_card.go_to_reply')}</a>
				</div>
			</div>
		{:else if c.type === 'event'}
			{@const start = new Date(c.starts_at).getTime()}
			{@const end = endOf(c).getTime()}
			{@const past = now >= end}
			{@const live = !past && now >= start}
			{@const going = c.my_rsvp === 'going'}
			<div class="lc-card lc-event" class:lc-cancelled={c.is_cancelled}>
				{#if c.cover_url && !past && !c.is_cancelled}<img class="lc-cover" src={c.cover_url} alt="" loading="lazy" />{/if}
				<div class="lc-ev-row">
					<div class="lc-cal" class:lc-faded={past || c.is_cancelled} aria-hidden="true">
						<div class="lc-m">{fmt({ month: 'short' }).format(new Date(c.starts_at)).replace('.', '')}</div>
						<div class="lc-d">{fmt({ day: 'numeric' }).format(new Date(c.starts_at))}</div>
					</div>
					<div class="lc-in lc-in-flat">
						<div class="lc-kind">{@render icon('cal')}{$t('link_card.kind_event')}
							{#if c.is_cancelled}<span class="lc-badge lc-bad">{$t('link_card.cancelled')}</span>
							{:else if past}<span class="lc-badge lc-muted">{$t('link_card.past')}</span>
							{:else if live}<span class="lc-badge lc-ok">{$t('link_card.live')}</span>{/if}
						</div>
						<a class="lc-title" href={c.url}>{c.title}</a>
						<div class="lc-meta">
							{#if live && c.ends_at}
								<span class="lc-p">{@render icon('clock')}{$t('link_card.until', { time: fmt({ hour: '2-digit', minute: '2-digit' }).format(new Date(c.ends_at)) })}</span>
							{:else}
								<span class="lc-p">{@render icon('clock')}{eventLine(c)}</span>
							{/if}
							{#if c.location}<span class="lc-p">{@render icon('pin')}{c.location}</span>{/if}
						</div>
					</div>
				</div>
				{#if c.rsvp_enabled && !c.is_cancelled}
					<div class="lc-ev-foot">
						<span class="lc-going">
							{#if c.going_preview.length}<span class="lc-stack">{#each c.going_preview as p (p.username)}{@render avatar(p, 'lc-av lc-av-xs')}{/each}</span>{/if}
							<span>{c.going_count === 0
								? $t(past ? 'link_card.went_zero' : 'link_card.going_zero')
								: past
								? plural(c.going_count, 'link_card.went_one', 'link_card.went_other')
								: going
									? plural(c.going_count, 'link_card.going_with_you_one', 'link_card.going_with_you_other')
									: plural(c.going_count, 'link_card.going_one', 'link_card.going_other')}</span>
						</span>
						<span class="lc-sp"></span>
						{#if token && !past}
							{#if going}
								<button class="lc-btn lc-on" aria-pressed="true" disabled={busy} title={$t('link_card.rsvp_undo_hint')} onclick={() => toggleRsvp(c.url, true)}>{@render icon('check')}{$t('link_card.rsvp_on')}</button>
							{:else if c.is_full}
								<span class="lc-badge lc-muted">{$t('link_card.full')}</span>
							{:else}
								<button class="lc-btn lc-primary" aria-pressed="false" disabled={busy} onclick={() => toggleRsvp(c.url, false)}>{@render icon('check')}{$t('link_card.rsvp')}</button>
							{/if}
						{/if}
					</div>
					{#if rsvpError}<p class="lc-err" role="alert">{rsvpError}</p>{/if}
				{/if}
			</div>
		{:else}
			<div class="lc-card lc-na">
				<div class="lc-in lc-in-row">
					<div class="lc-na-ico">{@render icon('off')}</div>
					<div><b>{$t('link_card.unavailable_title')}</b><span>{$t('link_card.unavailable_text')}</span></div>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.lc-slot { max-width: 460px; }
	.lc-card {
		position: relative; display: flex; flex-direction: column; overflow: hidden;
		background: color-mix(in srgb, var(--nx-text) 3%, var(--nx-surface));
		border: 1px solid color-mix(in srgb, var(--nx-text) 12%, transparent);
		border-radius: 12px; transition: border-color .15s; color: var(--nx-text);
		font-size: 13px; line-height: 1.45;
	}
	.lc-card:hover { border-color: color-mix(in srgb, var(--nx-header-accent) 45%, transparent); }
	.lc-in { padding: 11px 14px 12px; min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 5px; }
	.lc-in-flat { padding: 0; }
	.lc-in-row { flex-direction: row; align-items: center; gap: 12px; }
	.lc-kind { display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--nx-text-muted); font-weight: 500; min-width: 0; flex-wrap: wrap; }
	.lc-ell { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.lc-dot { color: var(--nx-text-faint); }
	.lc-i { width: 14px; height: 14px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
	.lc-title { font-weight: 650; font-size: 14.5px; line-height: 1.3; color: var(--nx-text); text-decoration: none; overflow-wrap: anywhere; }
	.lc-title:hover { text-decoration: underline; }
	/* Toute la carte s'ouvre par le lien principal ; les boutons passent au-dessus */
	.lc-title::after { content: ""; position: absolute; inset: 0; }
	.lc-card button, .lc-card .lc-tag { position: relative; z-index: 1; }
	.lc-go { font-size: 12.5px; color: var(--nx-header-accent); }
	.lc-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 12px; color: var(--nx-text-muted); }
	.lc-p { display: inline-flex; align-items: center; gap: 5px; min-width: 0; }
	.lc-av { width: 18px; height: 18px; border-radius: 5px; flex: none; display: inline-grid; place-items: center; color: #fff; font-size: 10px; font-weight: 700; object-fit: cover; }
	.lc-av-xs { width: 22px; height: 22px; border-radius: 99px; border: 2px solid color-mix(in srgb, var(--nx-text) 3%, var(--nx-surface)); margin-left: -6px; }
	.lc-stack { display: inline-flex; padding-left: 6px; }
	.lc-tags { display: flex; gap: 5px; flex-wrap: wrap; }
	.lc-tag { font-size: 11px; padding: 1px 8px; border-radius: 99px; border: 1px solid color-mix(in srgb, var(--nx-text) 14%, transparent); color: var(--nx-text-muted); }
	.lc-excerpt { margin: 0; font-size: 13px; border-left: 3px solid color-mix(in srgb, var(--nx-text) 14%, transparent); padding-left: 10px; display: -webkit-box; -webkit-line-clamp: 3; line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
	.lc-badge { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 99px; }
	.lc-badge .lc-i { width: 11px; height: 11px; }
	.lc-muted { background: color-mix(in srgb, var(--nx-text-muted) 16%, transparent); color: var(--nx-text-muted); }
	.lc-bad { background: color-mix(in srgb, var(--nx-bad) 15%, transparent); color: var(--nx-bad); }
	.lc-ok { background: color-mix(in srgb, var(--nx-ok) 16%, transparent); color: var(--nx-ok); }
	.lc-cover { display: block; width: 100%; height: 120px; object-fit: cover; }
	.lc-ev-row { display: flex; gap: 12px; padding: 11px 14px 12px; align-items: flex-start; }
	.lc-cal { width: 46px; flex: none; border: 1px solid color-mix(in srgb, var(--nx-text) 14%, transparent); border-radius: 9px; overflow: hidden; text-align: center; background: var(--nx-surface); }
	.lc-faded { opacity: .6; }
	.lc-m { background: var(--nx-header-accent); color: var(--nx-on-accent, #16120c); font-size: 10px; font-weight: 700; text-transform: uppercase; padding: 1px 0; letter-spacing: .04em; }
	.lc-d { font-size: 18px; font-weight: 700; padding: 1px 0 3px; }
	.lc-ev-foot { display: flex; align-items: center; gap: 10px; padding: 0 14px 12px 72px; flex-wrap: wrap; }
	.lc-going { display: inline-flex; align-items: center; gap: 7px; font-size: 12px; color: var(--nx-text-muted); }
	.lc-sp { flex: 1; }
	.lc-btn { display: inline-flex; align-items: center; gap: 6px; border-radius: 8px; padding: 5px 12px; font-size: 12.5px; font-weight: 600; border: 1px solid transparent; cursor: pointer; }
	.lc-btn:disabled { opacity: .7; cursor: progress; }
	.lc-primary { background: var(--nx-header-accent); color: var(--nx-on-accent, #16120c); }
	.lc-on { background: color-mix(in srgb, var(--nx-ok) 14%, var(--nx-surface)); color: var(--nx-ok); border-color: color-mix(in srgb, var(--nx-ok) 40%, transparent); }
	.lc-cancelled .lc-title { text-decoration: line-through; color: var(--nx-text-muted); }
	.lc-err { margin: 0; padding: 0 14px 10px; font-size: 12px; color: var(--nx-bad); }
	.lc-na-ico { width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: color-mix(in srgb, var(--nx-text-muted) 13%, transparent); color: var(--nx-text-muted); flex: none; }
	.lc-na-ico .lc-i { width: 18px; height: 18px; }
	.lc-na b { font-size: 13.5px; display: block; }
	.lc-na span { font-size: 12.5px; color: var(--nx-text-muted); }
	.lc-sk { height: 10px; border-radius: 6px; background: linear-gradient(90deg, color-mix(in srgb, var(--nx-text) 6%, transparent) 0%, color-mix(in srgb, var(--nx-text) 12%, transparent) 50%, color-mix(in srgb, var(--nx-text) 6%, transparent) 100%); background-size: 200% 100%; animation: lc-sk 1.3s infinite linear; }
	@keyframes lc-sk { to { background-position: -200% 0; } }
	@media (prefers-reduced-motion: reduce) { .lc-sk { animation: none; } }
	@media (max-width: 520px) { .lc-ev-foot { padding-left: 14px; } }
</style>
