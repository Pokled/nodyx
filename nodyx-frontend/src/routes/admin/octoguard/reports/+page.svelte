<script lang="ts">
	// Signalements, dans OctoGuard (maquette validée, CDC E4h) : à gauche la
	// file, au centre le contenu, à droite la décision. Une seule file pour les
	// signalements des membres, ceux d'OctoGuard et les contenus retenus.
	import { page } from '$app/state'
	import { invalidateAll } from '$app/navigation'
	import { t, locale } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og, OgError } from '$lib/octoguard/api'
	import { LEVEL_ICON } from '$lib/octoguard/rules'
	import { htmlToText } from '$lib/octoguard/text'
	import ContextView from '$lib/components/octoguard/ContextView.svelte'
	import LadderGauge from '$lib/components/octoguard/LadderGauge.svelte'
	import LadderAction from '$lib/components/octoguard/LadderAction.svelte'
	import { loadMemberLadder, type MemberLadder } from '$lib/octoguard/ladder'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const access = $derived((page.data as any).access as { permissions: string[] } | undefined)
	const canDeleteContent = $derived(!!access?.permissions.includes('moderate_content'))
	const canMembers = $derived(!!access?.permissions.includes('moderate_members'))
	const canBan = $derived(!!access?.permissions.includes('ban_members'))
	const myId = $derived(((page.data as any).user?.id as string | undefined))

	type Report = {
		id: string; target_type: string; target_id: string; category: string | null; reason: string; source?: string
		status: string; created_at: string; reporter_username: string | null
		target_author_id: string | null; target_author_username: string | null
		snapshot: string | null; target_label: string | null; target_link: string | null
		claimed_by_username: string | null; reviewed_by_username: string | null; reviewed_at: string | null; resolution: string | null
	}
	type Held = {
		id: string; kind: 'chat' | 'post' | 'thread' | 'post_edit'; author_id: string; author_username: string; author_created_at: string
		channel_name: string | null; thread_title: string | null; payload: { content: string; title?: string }
		rule_name: string; created_at: string
	}
	type Case = { key: string; first: Report; reports: Report[]; categories: Record<string, number>; octoguard: boolean }

	// Un dossier par contenu (plusieurs membres peuvent signaler le même message)
	const cases = $derived.by((): Case[] => {
		const map = new Map<string, Case>()
		for (const r of data.reports as Report[]) {
			const key = `${r.target_type}:${r.target_id}`
			let c = map.get(key)
			if (!c) { c = { key, first: r, reports: [], categories: {}, octoguard: false }; map.set(key, c) }
			c.reports.push(r)
			if (r.source === 'octoguard') c.octoguard = true
			const cat = r.category ?? 'other'
			c.categories[cat] = (c.categories[cat] ?? 0) + 1
			if (r.created_at < c.first.created_at) c.first = { ...r, snapshot: c.first.snapshot ?? r.snapshot }
		}
		const list = [...map.values()]
		return data.tab === 'open'
			? list.sort((a, b) => a.first.created_at.localeCompare(b.first.created_at))
			: list.sort((a, b) => (b.first.reviewed_at ?? '').localeCompare(a.first.reviewed_at ?? ''))
	})
	const held = $derived(data.held as Held[])

	let current = $state<string | null>(null)
	const items = $derived(data.tab === 'held' ? held.map((h) => h.id) : cases.map((c) => c.key))
	const sel = $derived(current && items.includes(current) ? current : (items[0] ?? null))
	const selHeld = $derived(data.tab === 'held' ? (held.find((h) => h.id === sel) ?? null) : null)
	const selCase = $derived(data.tab !== 'held' ? (cases.find((c) => c.key === sel) ?? null) : null)

	// Le contexte (lot 3) : chargé à la sélection, gardé en mémoire le temps de la page
	type Brief = { id: string; username: string; created_at: string; warns_active: number; muted: boolean; muted_until: string | null }
	type Ctx = { place: string; around: any[]; current: string | null; edits: any[]; author: Brief | null }
	let ctxCache = $state<Record<string, Ctx | 'gone' | 'error'>>({})
	const ctxPath = $derived(selHeld ? `/held/${selHeld.id}/context` : selCase ? `/reports/${selCase.first.id}/context` : null)
	const ctx = $derived(ctxPath ? ctxCache[ctxPath] : undefined)
	$effect(() => {
		const path = ctxPath
		if (!path || ctxCache[path]) return
		og<{ context: Ctx }>(token, path)
			.then((r) => { ctxCache[path] = r.context })
			.catch((e) => { ctxCache[path] = e instanceof OgError && (e.code === 'CONTENT_GONE' || e.status === 404) ? 'gone' : 'error' })
	})
	const ctxOk = $derived(ctx && typeof ctx === 'object' ? ctx : null)

	// Le barème (lot 4b) : où en est l'auteur du contenu signalé
	let ladderCache = $state<Record<string, MemberLadder>>({})
	const ladderUser = $derived(data.tab === 'open' ? (selCase?.first.target_author_id ?? null) : null)
	const ladder = $derived(ladderUser ? (ladderCache[ladderUser] ?? null) : null)
	async function loadLadder(id: string) {
		try { ladderCache[id] = await loadMemberLadder(token, id) } catch { /* la jauge reste simplement absente */ }
	}
	$effect(() => { const id = ladderUser; if (id && !ladderCache[id]) loadLadder(id) })
	async function ladderChanged() {
		if (ladderUser) await loadLadder(ladderUser)
		await invalidateAll()
	}

	const TABS = $derived([
		{ id: 'open', label: tFn('og2.rp_tab_open'), n: cases.length && data.tab === 'open' ? cases.length : data.openCount },
		{ id: 'held', label: tFn('og2.rp_tab_held'), n: data.heldCount },
		{ id: 'done', label: tFn('og2.rp_tab_done'), n: null as number | null },
	])

	const KIND_ICON = {
		chat: 'M21 12a8 8 0 01-11.6 7.1L4 20l1.2-4.4A8 8 0 1121 12z',
		post: 'M4 6h16 M4 12h16 M4 18h10',
		user: 'M12 4a4 4 0 100 8 4 4 0 000-8z M4 21a8 8 0 0116 0',
	}

	function ago(iso: string) {
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
		if (m < 1) return tFn('areports.just_now')
		if (m < 60) return tFn('og2.rp_min', { n: m })
		const h = Math.floor(m / 60)
		if (h < 24) return tFn('og2.rp_h', { n: h })
		return new Date(iso).toLocaleDateString($locale, { day: '2-digit', month: 'short' })
	}
	function clock(iso: string) {
		return new Date(iso).toLocaleString($locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
	}
	/** D17 : le temps qu'il reste avant le refus automatique. */
	function expiresIn(iso: string) {
		const left = new Date(iso).getTime() + data.expiryHours * 3_600_000 - Date.now()
		const h = Math.max(0, Math.floor(left / 3_600_000))
		return h >= 24 ? tFn('og2.rp_left_d', { d: Math.floor(h / 24), h: h % 24 }) : tFn('og2.rp_left_h', { h: Math.max(1, h) })
	}
	/** L'âge du compte, l'indice qui compte le plus pour un message retenu (maquette : « compte de 3 heures »). */
	function accountAge(iso: string) {
		const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000)
		if (h < 1) return tFn('og2.rp_age_new')
		if (h < 48) return tFn('og2.rp_age_h', { n: h })
		const d = Math.floor(h / 24)
		if (d < 60) return tFn('og2.rp_age_d', { n: d })
		return tFn('og2.rp_age_m', { n: Math.floor(d / 30) })
	}
	/** « Léa, Max et OctoGuard » : qui a signalé, dans la langue de l'écran. */
	function reporters(c: Case) {
		const names = [...new Set(c.reports.map((r) => (r.source === 'octoguard' ? 'OctoGuard' : (r.reporter_username ?? tFn('areports.deleted_account')))))]
		try { return new Intl.ListFormat($locale, { style: 'long', type: 'conjunction' }).format(names) } catch { return names.join(', ') }
	}
	const caseTitle = (r: Report) => r.target_type === 'user'
		? tFn('og2.rp_case_title_user', { name: r.target_author_username ?? tFn('areports.deleted_account') })
		: tFn(`og2.rp_case_title_${r.target_type === 'message' ? 'message' : 'forum'}`, { name: r.target_author_username ?? tFn('areports.deleted_account'), place: r.target_label ?? '' })
	function heldPlace(h: Held) {
		if (h.kind === 'chat') return h.channel_name ? `#${h.channel_name}` : tFn('og2.rp_place_chat')
		if (h.kind === 'thread') return tFn('og2.rp_place_new_thread')
		return h.thread_title ?? tFn('og2.rp_place_forum')
	}

	let busy = $state(false)
	let error = $state<string | null>(null)
	let note = $state('')
	let done = $state<string | null>(null)

	const ERR: Record<string, string> = {
		CANNOT_REVIEW_SELF: 'og2.rp_err_self', RANK_TOO_LOW: 'areports.err_rank', ALREADY_DECIDED: 'og2.rp_err_decided',
		PUBLISH_FAILED: 'og2.rp_err_gone', FORBIDDEN: 'areports.err_forbidden',
		AUTHOR_BANNED: 'og2.rp_err_banned', THREAD_LOCKED: 'og2.rp_err_locked',
	}
	async function run(fn: () => Promise<unknown>, okKey: string) {
		busy = true; error = null; done = null
		try {
			await fn()
			done = tFn(okKey)
			note = ''
			await invalidateAll()
		} catch (e) {
			error = tFn((e instanceof OgError && e.code && ERR[e.code]) || 'areports.err_generic')
			if (e instanceof OgError && e.code === 'ALREADY_DECIDED') await invalidateAll()
		} finally { busy = false }
	}
	const decideHeld = (h: Held, d: 'approve' | 'refuse') =>
		run(() => og(token, `/held/${h.id}/${d}`, 'POST'), d === 'approve' ? 'og2.rp_ok_approved' : 'og2.rp_ok_refused')
	const patchReport = (r: Report, body: Record<string, unknown>, okKey: string) =>
		run(() => og(token, `/reports/${r.id}`, 'PATCH', body), okKey)

	function onQueueKey(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
		e.preventDefault()
		const i = items.indexOf(sel ?? '')
		const next = items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))]
		if (next) { current = next; document.getElementById(`q-${next}`)?.focus() }
	}
</script>

{#snippet facts(a: Brief)}
	<div class="og-rp-facts">
		<span class="adm-pill og-tone {Date.now() - new Date(a.created_at).getTime() < 7 * 86_400_000 ? 'og-k-warn' : 'og-k-observe'}">{accountAge(a.created_at)}</span>
		{#if a.warns_active > 0}<span class="adm-pill og-tone og-k-warn">{tFn(a.warns_active > 1 ? 'og2.cx_warns_n' : 'og2.cx_warns_1', { n: a.warns_active })}</span>{/if}
		{#if a.muted}<span class="adm-pill og-tone og-k-delete">{a.muted_until ? tFn('og2.cx_muted_until', { at: clock(a.muted_until) }) : tFn('og2.cx_muted')}</span>{/if}
	</div>
{/snippet}

<svelte:head><title>{tFn('og2.nav_reports')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d={LEVEL_ICON.report} /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_reports')}</h1>
				<p class="adm-desc">{tFn('og2.rp_desc')}</p>
			</div>
		</div>
		<nav class="adm-chips" aria-label={tFn('og2.nav_reports')}>
			{#each TABS as tab (tab.id)}
				<a class="adm-chip" aria-current={data.tab === tab.id ? 'page' : undefined}
					href={tab.id === 'open' ? '/admin/octoguard/reports' : `/admin/octoguard/reports?tab=${tab.id}`}>
					{tab.label}{#if tab.n !== null}<span class="adm-chip-count">{tab.n}</span>{/if}
				</a>
			{/each}
		</nav>
	</header>

	{#if data.tab === 'held'}
		<div class="og-note"><Icon d={LEVEL_ICON.hold} />{tFn('og2.rp_held_how', { h: data.expiryHours })}</div>
	{/if}
	{#if data.failed}<p class="og-error" role="alert">{tFn('areports.err_generic')}</p>{/if}
	{#if error}<p class="og-error" role="alert">{error}</p>{/if}
	{#if done}<p class="og-okmsg" role="status">{done}</p>{/if}

	{#if items.length === 0}
		<div class="adm-card og-rp-empty">
			<span class="og-ic og-k-ok"><Icon d="M20 6L9 17l-5-5" /></span>
			<div>
				<b>{tFn(data.tab === 'held' ? 'og2.rp_empty_held' : data.tab === 'open' ? 'areports.empty_open' : 'areports.empty_other')}</b>
				{#if data.tab === 'held'}<p class="og-help">{tFn('og2.rp_empty_held_sub')}</p>{/if}
				{#if data.tab === 'open' && data.heldCount > 0}
					<p class="og-help">{tFn(data.heldCount > 1 ? 'og2.rp_held_waiting_n' : 'og2.rp_held_waiting_1', { n: data.heldCount })}</p>
					<a class="adm-btn adm-btn--sm adm-btn--primary og-rp-open" style="margin-top:0.5rem" href="/admin/octoguard/reports?tab=held"><Icon d={LEVEL_ICON.hold} />{tFn('og2.rp_go_held')}</a>
				{/if}
			</div>
		</div>
	{:else}
		<div class="og-split-wrap"><div class="og-split">
			<!-- La file -->
			<div class="adm-card og-queue" role="listbox" tabindex="-1" aria-label={tFn('og2.rp_queue')} onkeydown={onQueueKey}>
				{#if data.tab === 'held'}
					{#each held as h (h.id)}
						<button type="button" class="og-q" id="q-{h.id}" role="option" aria-selected={sel === h.id} onclick={() => { current = h.id; done = null; error = null }}>
							<span class="og-ic og-k-hold"><Icon d={LEVEL_ICON.hold} /></span>
							<b>{h.author_username}, {heldPlace(h)}</b>
							<span class="og-q-time">{ago(h.created_at)}</span>
							<span class="og-q-sub">{tFn('og2.rp_q_held', { age: accountAge(h.author_created_at), rule: h.rule_name })}</span>
						</button>
					{/each}
				{:else}
					{#each cases as c (c.key)}
						{@const r = c.first}
						<button type="button" class="og-q" id="q-{c.key}" role="option" aria-selected={sel === c.key} onclick={() => { current = c.key; done = null; error = null }}>
							<span class="og-ic {c.octoguard ? 'og-k-report' : 'og-k-delete'}"><Icon d={LEVEL_ICON.report} /></span>
							<b>{r.target_author_username ?? tFn('areports.deleted_account')}, {r.target_label ?? tFn(`areports.type_${r.target_type}`)}</b>
							<span class="og-q-time">{ago(r.created_at)}</span>
							<span class="og-q-sub">
								{reporters(c)} · {Object.keys(c.categories).map((k) => tFn(`report.cat_${k}`).toLowerCase()).join(', ')}
							</span>
						</button>
					{/each}
				{/if}
			</div>

			<!-- Le contenu -->
			<section class="adm-card og-rp-main" aria-live="polite">
				{#if selHeld}
					{@const h = selHeld}
					<div class="og-rp-top">
						<div>
							<div class="og-rp-title">{tFn(`og2.rp_held_title_${h.kind}`, { name: h.author_username, place: heldPlace(h) })}</div>
							<div class="og-meta">{tFn('og2.rp_held_by', { rule: h.rule_name, at: clock(h.created_at) })}</div>
						</div>
						<span class="adm-pill og-tone og-k-hold"><Icon d={LEVEL_ICON.hold} />{tFn('og2.rp_pending')}</span>
					</div>
					<div class="og-field">
						<span class="og-lbl">{tFn(h.kind === 'post_edit' ? 'og2.rp_new_text' : 'og2.rp_held_text')}</span>
						{#if h.payload.title}<p class="og-rp-subject">{h.payload.title}</p>{/if}
						<blockquote class="og-quote og-rp-text">{htmlToText(h.payload.content)}</blockquote>
						<p class="og-help">{tFn('og2.rp_only_author')}</p>
					</div>
					{#if ctxOk}<ContextView around={ctxOk.around} current={ctxOk.current} edits={ctxOk.edits} heldAt={h.kind === 'chat' || h.kind === 'post' ? h.created_at : null} />{:else if ctx === undefined}<p class="og-help">{tFn('og2.cx_loading')}</p>{/if}
					<p class="og-meta"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2" />{tFn('og2.rp_expires', { left: expiresIn(h.created_at) })}</p>
				{:else if selCase}
					{@const r = selCase.first}
					<div class="og-rp-top">
						<div>
							<div class="og-rp-title">{caseTitle(r)}</div>
							<div class="og-meta">{tFn('og2.rp_reported_by', { names: reporters(selCase), at: clock(r.created_at) })}</div>
						</div>
						<div class="og-rp-pills">
							{#each Object.entries(selCase.categories) as [cat, n] (cat)}
								<span class="adm-pill og-tone {cat === 'illegal' || cat === 'hate' || cat === 'harassment' ? 'og-k-delete' : 'og-k-warn'}">{tFn(`report.cat_${cat}`)}{n > 1 ? ` ×${n}` : ''}</span>
							{/each}
						</div>
					</div>
					{#if ctxOk}
						<ContextView around={ctxOk.around} current={ctxOk.current} edits={ctxOk.edits} reportedAt={r.created_at} />
					{:else if ctx === undefined}
						<p class="og-help">{tFn('og2.cx_loading')}</p>
					{:else if ctx === 'gone'}
						<p class="og-help">{tFn('og2.cx_gone')}</p>
					{/if}
					{#if r.snapshot && (!ctxOk || ctxOk.current === null)}
						<div class="og-field">
							<span class="og-lbl">{tFn('areports.snapshot')}</span>
							<blockquote class="og-quote og-rp-text">{r.snapshot}</blockquote>
						</div>
					{/if}
					<div class="og-field">
						<span class="og-lbl">{tFn('areports.reporters')}</span>
						<ul class="og-rp-who">
							{#each selCase.reports as rep (rep.id)}
								<li>
									<b>{rep.source === 'octoguard' ? tFn('areports.by_octoguard') : (rep.reporter_username ?? tFn('areports.deleted_account'))}</b>
									<span class="og-meta">{tFn(`report.cat_${rep.category ?? 'other'}`)} · {ago(rep.created_at)}</span>
									{#if rep.reason}<span class="og-rp-reason">« {rep.reason} »</span>{/if}
								</li>
							{/each}
						</ul>
					</div>
					{#if r.target_link}
						<a class="adm-btn adm-btn--sm og-rp-open" href={r.target_link} target="_blank" rel="noopener"><Icon d="M14 4h6v6 M10 14L20 4 M20 14v6H4V4h6" />{tFn('areports.open_content')}</a>
					{/if}
				{/if}
			</section>

			<!-- La décision -->
			<aside class="og-rp-side">
				{#if selHeld}
					{@const h = selHeld}
					<div class="adm-card og-rp-card">
						<h2 class="og-rp-h">{tFn('og2.rp_brief', { name: h.author_username })}</h2>
						{@render facts(ctxOk?.author ?? { id: h.author_id, username: h.author_username, created_at: h.author_created_at, warns_active: 0, muted: false, muted_until: null })}
						<a class="adm-btn adm-btn--sm" href="/admin/members/{h.author_id}"><Icon d={KIND_ICON.user} />{tFn('amem.open_file')}</a>
					</div>
					<div class="adm-card og-rp-card">
						<h2 class="og-rp-h">{tFn('og2.rp_decide')}</h2>
						<button type="button" class="adm-btn adm-btn--primary" disabled={busy} onclick={() => decideHeld(h, 'approve')}>
							<Icon d="M20 6L9 17l-5-5" />{tFn(h.kind === 'post_edit' ? 'og2.rp_approve_edit' : 'og2.rp_approve')}
						</button>
						<button type="button" class="adm-btn adm-btn--danger" disabled={busy} onclick={() => decideHeld(h, 'refuse')}>
							<Icon d="M18 6L6 18 M6 6l12 12" />{tFn('og2.rp_refuse')}
						</button>
						<p class="og-help">{tFn('og2.rp_decide_help')}</p>
					</div>
				{:else if selCase}
					{@const r = selCase.first}
					{#if r.target_author_id}
						<div class="adm-card og-rp-card">
							<h2 class="og-rp-h">{tFn('og2.rp_brief', { name: r.target_author_username ?? '' })}</h2>
							{#if ctxOk?.author}{@render facts(ctxOk.author)}{/if}
							{#if data.tab === 'open'}<LadderGauge state={ladder} />{/if}
							<a class="adm-btn adm-btn--sm" href="/admin/members/{r.target_author_id}"><Icon d={KIND_ICON.user} />{tFn('amem.open_file')}</a>
						</div>
					{/if}
					{#if data.tab === 'open'}
						<div class="adm-card og-rp-card">
							<h2 class="og-rp-h">{tFn('og2.rp_decide')}</h2>
							{#if r.target_author_id}
								<LadderAction {token} userId={r.target_author_id} username={r.target_author_username ?? ''} reportId={r.id}
									state={ladder} {canMembers} {canBan} {myId} onChanged={ladderChanged} />
							{/if}
							{#if r.claimed_by_username}
								<span class="og-meta"><Icon d={LEVEL_ICON.observe} />{tFn('areports.claimed_by', { name: r.claimed_by_username })}</span>
							{:else}
								<button type="button" class="adm-btn adm-btn--sm" disabled={busy} onclick={() => patchReport(r, { claim: true }, 'og2.rp_ok_claimed')}>{tFn('areports.claim')}</button>
							{/if}
							<input class="adm-input" maxlength="1000" bind:value={note} placeholder={tFn('areports.note_ph')} aria-label={tFn('areports.note_ph')} />
							{#if canDeleteContent && r.target_type !== 'user'}
								<button type="button" class="adm-btn adm-btn--danger" disabled={busy}
									onclick={() => { if (confirm(tFn('areports.confirm_delete'))) patchReport(r, { status: 'actioned', delete_content: true, resolution: note.trim() || undefined }, 'og2.rp_ok_closed') }}>
									{tFn('areports.delete_and_close')}
								</button>
							{/if}
							<div class="og-rp-row">
								<button type="button" class="adm-btn adm-btn--sm" disabled={busy} title={tFn('areports.actioned_hint')}
									onclick={() => patchReport(r, { status: 'actioned', resolution: note.trim() || undefined }, 'og2.rp_ok_closed')}>{tFn('areports.actioned')}</button>
								<button type="button" class="adm-btn adm-btn--sm" disabled={busy}
									onclick={() => patchReport(r, { status: 'dismissed', resolution: note.trim() || undefined }, 'og2.rp_ok_closed')}>{tFn('areports.dismiss')}</button>
							</div>
							<p class="og-help">{tFn('areports.footer')}</p>
						</div>
					{:else}
						<div class="adm-card og-rp-card">
							<h2 class="og-rp-h">{tFn(`areports.tab_${r.status}`)}</h2>
							<p class="og-meta">
								{#if r.reviewed_by_username}{tFn('areports.by', { name: r.reviewed_by_username })}{/if}
								{#if r.reviewed_at} · {ago(r.reviewed_at)}{/if}
							</p>
							{#if r.resolution}<p class="og-rp-reason">« {r.resolution} »</p>{/if}
						</div>
					{/if}
				{/if}
			</aside>
		</div></div>
	{/if}
</div>
