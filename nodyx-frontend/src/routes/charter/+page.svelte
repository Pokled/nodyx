<script lang="ts">
	// La page « La charte » (lot 7d-3, maquette v4 validée le 20/11/2026 ; règles
	// d'interface du 20/11 en pilote : Atkinson, Cobalt). On la relit, on voit ce qu'on a
	// signé ; l'équipe passe d'une charte à l'autre. Le sommaire se fait seul depuis les
	// titres. Rien n'est compté ici : relire n'ouvre pas de lecture (/charter/:aud/text).
	import { untrack } from 'svelte'
	import { page } from '$app/state'
	import { replaceState } from '$app/navigation'
	import { t, locale } from '$lib/i18n'
	import { fillVars } from '$lib/charter/door'
	import { outline, OUTLINE_MIN } from '$lib/charter/outline'
	import '$lib/charter/charter.css'
	import '$lib/charter/pilot.css'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)

	let aud = $state<'members' | 'team'>(untrack(() => data.aud))
	$effect(() => { aud = data.aud })
	const c = $derived(aud === 'team' ? data.team : data.members)
	const hasTeamTab = $derived(!!data.team?.version)
	const username = $derived((page.data.user as { username?: string } | null)?.username ?? '')

	const doc = $derived(c?.version ? outline(fillVars(c.body_html ?? '', c.community, username)) : null)
	const showOutline = $derived((doc?.items.length ?? 0) >= OUTLINE_MIN)

	const day = (iso: string | null | undefined) => {
		if (!iso) return ''
		try { return new Intl.DateTimeFormat($locale, { day: 'numeric', month: 'long' }).format(new Date(iso)) }
		catch { return '' }
	}
	const title = $derived(aud === 'team' ? tFn('charter.read_title_team') : tFn('charter.read_title_members', { community: c?.community ?? '' }))
	const status = $derived.by(() => {
		if (!c?.version) return null
		const s = c.signed
		if (s && s.version === c.version) return { kind: 'ok', label: tFn('charter.read_status_signed'),
			line: tFn(s.way === 'hand' ? 'charter.read_signed_current_hand' : 'charter.read_signed_current_phrase', { date: day(s.signed_at) }) }
		if (s) return { kind: 'changed', label: tFn('charter.read_status_new'), line: tFn('charter.read_signed_old', { version: String(s.version), date: day(s.signed_at) }) }
		return { kind: 'changed', label: tFn('charter.read_status_unsigned'), line: tFn('charter.read_not_signed') }
	})

	function pick(a: 'members' | 'team') {
		aud = a
		replaceState(page.url.pathname + (a === 'team' ? '?aud=team' : ''), {})
	}
	$effect(() => { try { localStorage.setItem('nx-charter-seen', '1') } catch { /* navigation privée */ } })
	/** Le sommaire emmène aussi le clavier : le titre reçoit le focus. */
	function jump(e: MouseEvent, id: string) {
		const el = document.getElementById(id)
		if (!el) return
		e.preventDefault()
		el.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
		el.focus({ preventScroll: true })
		history.replaceState(history.state, '', `#${id}`)
	}
</script>

<svelte:head><title>{tFn('charter.read_page_title')} · {c?.community ?? ''}</title></svelte:head>

<div class="charter-page nx-pilot nx-themed">
	{#if !c?.version && !hasTeamTab}
		<div class="cp-empty">
			<img src="/nodyx-octopus.png" alt="" width="48" height="48" />
			<h1>{tFn('charter.read_empty_title')}</h1>
			<p>{tFn('charter.read_empty_text', { community: data.members?.community ?? '' })}</p>
		</div>
	{:else}
		<header class="cp-head">
			<div>
				<h1>{title}</h1>
				{#if c?.version}
					<p class="cp-sub">{tFn('charter.read_published', { version: String(c.version), date: day(c.published_at) })} {status?.line ?? ''}</p>
				{/if}
			</div>
			{#if status}<span class="pl-status {status.kind === 'ok' ? 'pl-status--ok' : 'pl-status--changed'}">{status.label}</span>{/if}
		</header>

		{#if hasTeamTab}
			<div class="cp-tabs" role="tablist" aria-label={tFn('charter.read_tabs_aria')}>
				<button type="button" role="tab" aria-selected={aud === 'members'} onclick={() => pick('members')}>{tFn('charter.read_tab_members')}</button>
				<button type="button" role="tab" aria-selected={aud === 'team'} onclick={() => pick('team')}>{tFn('charter.read_tab_team')}</button>
			</div>
		{/if}

		{#if doc}
			<div class="cp-grid">
				<article class="cp-doc"><div class="charter-doc">{@html doc.html}</div></article>
				<aside class="cp-side">
					{#if showOutline}
						<nav class="cp-outline" aria-label={tFn('charter.read_outline')}>
							<h2>{tFn('charter.read_outline')}</h2>
							{#each doc.items as it (it.id)}
								<a href="#{it.id}" onclick={(e) => jump(e, it.id)}><i class="cp-dot" data-color={it.color ?? undefined} aria-hidden="true"></i>{it.text}</a>
							{/each}
						</nav>
					{/if}
					<div class="cp-help">
						<p>{tFn('charter.read_help')}</p>
						<a class="pl-btn pl-btn--secondary" href="/members">{tFn('charter.read_team_link')}</a>
					</div>
					<p class="cp-auto">{tFn('charter.read_auto')}</p>
				</aside>
			</div>
		{:else}
			<div class="cp-empty cp-empty--inline">
				<p>{tFn('charter.read_empty_text', { community: c?.community ?? '' })}</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.charter-page { flex: 1 0 auto; width: 100%; max-width: 1080px; margin: 0 auto; padding: 28px 20px 72px; color: var(--nx-text); font-size: 15px; line-height: 1.55; }
	.cp-head { display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: flex-start; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid var(--nx-border); }
	.cp-head h1 { margin: 0; font-size: 26px; line-height: 1.2; font-weight: 800; letter-spacing: -.01em; }
	.cp-sub { margin: 6px 0 0; color: var(--nx-text-muted); max-width: 75ch; }
	.cp-tabs { display: flex; gap: 22px; border-bottom: 1px solid var(--nx-border); margin-top: -1px; }
	.cp-tabs button { font: inherit; font-weight: 600; color: var(--nx-text-muted); background: none; border: 0; padding: 12px 0 10px; border-bottom: 2px solid transparent; cursor: pointer; }
	.cp-tabs button[aria-selected='true'] { color: var(--nx-text); border-bottom-color: var(--pl-accent); }

	.cp-grid { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 36px; margin-top: 26px; align-items: start; }
	.cp-doc { background: var(--nx-surface); border: 1px solid var(--nx-border); border-radius: var(--pl-r-panel); overflow: hidden; }
	/* Le contenu de l'admin garde sa feuille (charter.css) : on n'ajuste que la lecture */
	.cp-doc :global(.charter-doc) { padding: 0 32px 30px; font-size: 16.5px; line-height: 1.7; max-width: 72ch; }
	.cp-doc :global(.charter-doc > :first-child:not(.nx-banner)) { margin-top: 26px; }
	.cp-doc :global(.charter-doc h2) { scroll-margin-top: 80px; outline: none; }
	.cp-doc :global(.charter-doc h2:focus-visible) { outline: 2px solid var(--pl-accent); outline-offset: 4px; border-radius: 4px; }
	.cp-doc :global(.charter-doc h2) { font-size: 20px; line-height: 1.3; margin: 30px 0 6px; }
	.cp-doc :global(.charter-doc .nx-banner) { margin: 0 -32px 14px; height: 220px; }
	.cp-doc :global(.charter-doc > .nx-banner:first-child) { margin-top: 0; }
	.cp-doc :global(.nx-banner figcaption) { padding: 0 32px 18px; font-size: 28px; font-weight: 800; }

	.cp-side { position: sticky; top: 76px; display: grid; gap: 18px; font-size: 14px; }
	.cp-outline h2 { font-size: 14px; margin: 0 0 8px; color: var(--nx-text-muted); font-weight: 700; }
	.cp-outline a { display: flex; gap: 10px; align-items: baseline; padding: 6px 10px; margin-left: -10px; border-radius: var(--pl-r-control); color: var(--nx-text); text-decoration: none; }
	.cp-outline a:hover { background: color-mix(in srgb, var(--nx-text) 6%, transparent); }
	.cp-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: var(--nx-text-faint); transform: translateY(-1px); }
	.cp-dot[data-color='green'] { background: #22c55e; } .cp-dot[data-color='blue'] { background: #3b82f6; } .cp-dot[data-color='violet'] { background: #8b5cf6; }
	.cp-dot[data-color='orange'] { background: #f59e0b; } .cp-dot[data-color='red'] { background: #e5484d; }
	.cp-help { border-top: 1px solid var(--nx-border); padding-top: 16px; }
	.cp-help p { margin: 0 0 10px; color: var(--nx-text-muted); }
	.cp-auto { color: var(--nx-text-faint); font-size: 13px; margin: 0; }

	.cp-empty { max-width: 460px; margin: 60px auto; text-align: center; }
	.cp-empty img { width: 48px; height: 48px; padding: 10px; box-sizing: content-box; border-radius: 50%; background: #1c2230; }
	.cp-empty h1 { font-size: 22px; margin: 14px 0 6px; }
	.cp-empty p { color: var(--nx-text-muted); margin: 0; }
	.cp-empty--inline { margin: 40px auto; }

	@media (max-width: 900px) {
		.cp-grid { grid-template-columns: 1fr; gap: 20px; }
		.cp-side { position: static; }
		.cp-outline { display: none; }
	}
	@media (max-width: 600px) {
		.charter-page { padding: 18px 14px 56px; }
		.cp-head h1 { font-size: 22px; }
		.cp-doc :global(.charter-doc) { padding: 0 18px 22px; font-size: 16px; }
		.cp-doc :global(.charter-doc .nx-banner) { margin: 0 -18px 12px; height: 150px; }
		.cp-doc :global(.nx-banner figcaption) { padding: 0 18px 14px; font-size: 21px; }
	}
</style>
