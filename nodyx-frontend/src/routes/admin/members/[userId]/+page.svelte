<script lang="ts">
	import { enhance } from '$app/forms'
	import { page } from '$app/state'
	import type { PageData, ActionData } from './$types'
	import { t, locale } from '$lib/i18n'
	import { inkOn } from '$lib/adminTheme'
	import { invalidateAll } from '$app/navigation'
	import LadderGauge from '$lib/components/octoguard/LadderGauge.svelte'
	import LadderAction from '$lib/components/octoguard/LadderAction.svelte'
	import { og, OgError } from '$lib/octoguard/api'
	import { loadMemberLadder, optionKey, kindOf, LADDER_ERR, type MemberLadder, type LadderEntry } from '$lib/octoguard/ladder'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	const f = $derived(data.file as any)
	const m = $derived(f.member)
	const st = $derived(f.status)

	// Ce que l'utilisateur peut faire ici, et sur qui (le cœur revérifie tout)
	const RANK: Record<string, number> = { member: 0, moderator: 1, admin: 2, owner: 3 }
	const access = $derived((page.data as any).access as { role: string | null; permissions: string[] } | undefined)
	const myRank = $derived(RANK[access?.role ?? ''] ?? -1)
	const isAdmin = $derived(myRank >= RANK.admin)
	const isSelf = $derived((page.data as any).user?.id === m.id)
	const targetable = $derived(!isSelf && m.role !== 'owner' && (isAdmin || myRank > (RANK[m.role ?? 'member'] ?? 0)))
	const canMembers = $derived(!!access?.permissions.includes('moderate_members'))
	const canBan = $derived(!!access?.permissions.includes('ban_members'))
	const myId = $derived((page.data as any).user?.id as string | undefined)

	function fmt(iso: string | null, withTime = false) {
		if (!iso) return '·'
		return new Date(iso).toLocaleString($locale, withTime
			? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
			: { day: '2-digit', month: 'short', year: 'numeric' })
	}

	// Frise : filtre par famille
	type Kind = 'all' | 'warn' | 'audit' | 'report' | 'note'
	let filter = $state<Kind>('all')
	const items = $derived((f.timeline as any[]).filter((i) => filter === 'all' || i.kind === filter))
	const countOf = (k: Kind) => (f.timeline as any[]).filter((i) => k === 'all' || i.kind === k).length

	// Libellés des actions du journal (mêmes clés que la page Journal)
	const KNOWN_AUDIT = new Set([
		'ban_user', 'unban_user', 'kick_member', 'change_role', 'voice_kick', 'reveal_email', 'warn_user',
		'octoguard_delete_message', 'octoguard_mute_user', 'octoguard_unmute_user', 'octoguard_ban_temp_user',
		'octoguard_notify', 'octoguard_action_undone',
		'octoguard_ladder_applied', 'octoguard_ladder_proposed', 'octoguard_ladder_approved',
		'octoguard_ladder_refused', 'octoguard_ladder_expired', 'octoguard_ladder_undone',
	])
	function auditLabel(action: string) {
		const k = action.replace(/\./g, '_')
		return KNOWN_AUDIT.has(k) ? tFn(`alog.a_${k}`) : action
	}
	function auditDetail(i: any): string {
		const md = i.meta ?? {}
		if (i.action === 'change_role' && md.old_role && md.new_role) return `${tFn(`amem.role_${md.old_role}`)} → ${tFn(`amem.role_${md.new_role}`)}`
		if (i.action === 'ban_user' && md.reason) return md.reason
		if (md.reason) return String(md.reason)
		return ''
	}

	const ICONS: Record<string, string> = {
		warn: 'M12 9v4m0 4h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z',
		audit: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.6a1 1 0 01.7.3l5.4 5.4a1 1 0 01.3.7V19a2 2 0 01-2 2z',
		report: 'M4 21V4m0 0h11l-1.5 4L15 12H4',
		note: 'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.4-9.6a2 2 0 112.8 2.8L11.8 15H9v-2.8l8.6-8.6z',
	}

	const errorText = $derived((form as any)?.errorKey ? tFn((form as any).errorKey) : null)
	const okText = $derived((form as any)?.ok ? tFn(`afile.ok_${(form as any).ok}`) : null)

	// Le barème (lot 4b) : la jauge, l'action, et l'historique des étapes
	const token = $derived(((page.data as any).token as string | null) ?? null)
	let ladder = $state<MemberLadder | null>(null)
	let ladderErr = $state<string | null>(null)
	async function loadLadder() {
		try { ladder = await loadMemberLadder(token, m.id) } catch { ladder = null }
	}
	$effect(() => { if (m.id && canMembers) loadLadder() })
	async function ladderChanged() { await loadLadder(); await invalidateAll() }
	async function undoStep(e: LadderEntry) {
		ladderErr = null
		try { await og(token, `/ladder/${e.id}/undo`, 'POST'); await ladderChanged() }
		catch (err) { ladderErr = tFn((err instanceof OgError && err.code && LADDER_ERR[err.code]) || 'areports.err_generic') }
	}
	const canUndo = (e: LadderEntry) => e.status === 'applied' && (kindOf(e.sanction) === 'ban' ? canBan : canMembers)

	let warnReason = $state('')
	let noteBody = $state('')
	let banOpen = $state(false)
</script>

<svelte:head><title>{tFn('afile.page_title', { name: m.username })}</title></svelte:head>

<div class="adm-page">
	<a href="/admin/members" class="adm-btn adm-btn--sm self-start">
		<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>
		{tFn('afile.back')}
	</a>

	{#if errorText}<div class="adm-notice adm-notice--bad" role="alert">{errorText}</div>{/if}
	{#if okText}<div class="adm-notice adm-notice--ok" role="status">{okText}</div>{/if}

	<!-- ── Identité et état ─────────────────────────────────────────────── -->
	<section class="adm-card adm-file-head">
		<div class="adm-file-id">
			{#if m.avatar}
				<img class="adm-file-avatar" src={m.avatar} alt="" />
			{:else}
				<span class="adm-file-avatar adm-file-avatar--letter" aria-hidden="true">{m.username.charAt(0).toUpperCase()}</span>
			{/if}
			<div class="min-w-0">
				<h1 class="adm-title flex flex-wrap items-center gap-2">
					{m.username}
					{#if m.role}<span class="adm-pill adm-pill--{m.role}">{tFn(`amem.role_${m.role}`)}</span>{/if}
					{#if m.grade}<span class="adm-swatch" style="background:{m.grade.color}; color:{inkOn(m.grade.color)}">{m.grade.name}</span>{/if}
				</h1>
				<p class="adm-desc">
					{tFn('afile.joined', { date: fmt(m.joined_at ?? m.created_at) })}
					· <a href="/users/{encodeURIComponent(m.username)}" class="hover:underline">{tFn('afile.public_profile')}</a>
				</p>
			</div>
		</div>

		<div class="adm-stats">
			<div class="adm-stat"><span class="adm-label">{tFn('afile.stat_threads')}</span><span class="adm-stat-value">{m.threads}</span></div>
			<div class="adm-stat"><span class="adm-label">{tFn('afile.stat_posts')}</span><span class="adm-stat-value">{m.posts}</span></div>
			<div class="adm-stat"><span class="adm-label">{tFn('afile.stat_messages')}</span><span class="adm-stat-value">{m.messages}</span></div>
			<div class="adm-stat"><span class="adm-label">{tFn('afile.stat_warns')}</span><span class="adm-stat-value">{st.warns_active}</span></div>
		</div>

		<div class="flex flex-wrap gap-2">
			{#if st.banned}
				<span class="adm-state adm-state--bad">{tFn('afile.state_banned', { date: fmt(st.banned.at) })}{st.banned.reason ? ` : ${st.banned.reason}` : ''}</span>
			{/if}
			{#each st.mutes as mu (mu.id)}
				<span class="adm-state adm-state--warn">
					{mu.channel_name ? tFn('afile.state_muted_channel', { channel: mu.channel_name }) : tFn('afile.state_muted')}
					{mu.expires_at ? tFn('afile.until', { date: fmt(mu.expires_at, true) }) : tFn('afile.until_lifted')}
				</span>
			{/each}
			{#if st.reports_open > 0}
				<a class="adm-state adm-state--info" href="/admin/octoguard/reports">{tFn('afile.state_reports', { n: st.reports_open })}</a>
			{/if}
			{#if !st.banned && st.mutes.length === 0 && st.reports_open === 0}
				<span class="adm-state adm-state--ok">{tFn('afile.state_clean')}</span>
			{/if}
		</div>
	</section>

	<div class="adm-file-grid">
		<!-- ── Actions ──────────────────────────────────────────────────── -->
		<section class="adm-card flex flex-col gap-4">
			{#if canMembers && targetable && ladder}
				<div class="flex flex-col gap-2">
					<h2 class="adm-label">{tFn('og2.lad_title')}</h2>
					<LadderGauge state={ladder} />
					<LadderAction {token} userId={m.id} username={m.username} state={ladder} {canMembers} {canBan} {myId} onChanged={ladderChanged} />
					{#if ladder.history.length}
						<ul class="adm-lad-hist">
							{#each ladder.history.slice(0, 6) as e (e.id)}
								<li class:adm-lad-off={e.status !== 'applied' && e.status !== 'pending'}>
									<span>{tFn('og2.lad_hist_line', { n: e.step, what: tFn(optionKey(e.sanction)) })}</span>
									<span class="adm-hint">{tFn(`og2.lad_status_${e.status}`)} · {e.actor ?? 'OctoGuard'} · {fmt(e.created_at)}</span>
									{#if canUndo(e)}<button type="button" class="adm-btn adm-btn--sm" onclick={() => undoStep(e)}>{tFn('og2.lad_undo')}</button>{/if}
								</li>
							{/each}
						</ul>
					{/if}
					{#if ladderErr}<p class="adm-hint" role="alert" style="color:var(--nx-bad)">{ladderErr}</p>{/if}
				</div>
				<hr class="adm-sep" />
			{/if}
			<h2 class="adm-label">{tFn('afile.actions')}</h2>
			{#if !targetable}
				<p class="adm-hint">{isSelf ? tFn('afile.self') : tFn('afile.rank_hint')}</p>
			{:else}
				{#if canMembers}
					<form method="POST" action="?/warn" class="adm-form" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') warnReason = '' }}>
						<label class="adm-field">
							<span class="adm-label">{tFn('afile.warn')}</span>
							<textarea class="adm-input adm-textarea" name="reason" rows="2" minlength="3" maxlength="500" required bind:value={warnReason} placeholder={tFn('afile.warn_ph')}></textarea>
						</label>
						<p class="adm-hint">{tFn('afile.warn_hint')}</p>
						<div><button type="submit" class="adm-btn adm-btn--sm adm-btn--primary">{tFn('afile.warn_btn')}</button></div>
					</form>

					<form method="POST" action="?/mute" class="adm-form" use:enhance>
						<span class="adm-label">{tFn('afile.mute')}</span>
						<div class="flex flex-wrap gap-2">
							<select class="adm-input" name="duration" aria-label={tFn('afile.mute_duration')}>
								{#each ['10m', '1h', '24h', '7d', 'forever'] as d (d)}
									<option value={d} selected={d === '1h'}>{tFn(`afile.d_${d}`)}</option>
								{/each}
							</select>
							<input class="adm-input flex-1 min-w-0" name="reason" maxlength="500" placeholder={tFn('afile.reason_ph')} aria-label={tFn('afile.reason_ph')} />
							<button type="submit" class="adm-btn adm-btn--sm">{tFn('afile.mute_btn')}</button>
						</div>
						<p class="adm-hint">{tFn('afile.mute_hint')}</p>
					</form>

					{#each st.mutes as mu (mu.id)}
						<form method="POST" action="?/unmute" use:enhance class="flex items-center justify-between gap-2">
							<input type="hidden" name="mute_id" value={mu.id} />
							<span class="text-sm">{mu.channel_name ? tFn('afile.state_muted_channel', { channel: mu.channel_name }) : tFn('afile.state_muted')} {mu.by ? tFn('afile.by', { name: mu.by }) : ''}</span>
							<button type="submit" class="adm-btn adm-btn--sm">{tFn('afile.unmute_btn')}</button>
						</form>
					{/each}
				{/if}

				<div class="adm-menu-sep" role="separator"></div>

				<div class="flex flex-wrap gap-2">
					{#if canMembers && !st.banned && m.role}
						<form method="POST" action="?/kick" use:enhance>
							<button type="submit" class="adm-btn adm-btn--sm adm-btn--danger"
								onclick={(e) => { if (!confirm(tFn('amem.confirm_kick', { username: m.username }))) e.preventDefault() }}>
								{tFn('amem.kick')}
							</button>
						</form>
					{/if}
					{#if canBan}
						{#if st.banned}
							<form method="POST" action="?/unban" use:enhance>
								<button type="submit" class="adm-btn adm-btn--sm"
									onclick={(e) => { if (!confirm(tFn('amem.confirm_unban', { username: m.username }))) e.preventDefault() }}>
									{tFn('amem.unban')}
								</button>
							</form>
						{:else}
							<button type="button" class="adm-btn adm-btn--sm adm-btn--danger" aria-expanded={banOpen} onclick={() => banOpen = !banOpen}>{tFn('amem.ban')}</button>
						{/if}
					{/if}
				</div>

				{#if banOpen && canBan && !st.banned}
					<form method="POST" action="?/ban" class="adm-form adm-card" use:enhance={() => async ({ update }) => { await update(); banOpen = false }}>
						<label class="adm-field">
							<span class="adm-label">{tFn('afile.ban_reason')}</span>
							<input class="adm-input" name="reason" maxlength="500" placeholder={tFn('afile.reason_ph')} />
						</label>
						<label class="adm-check"><input type="checkbox" name="ban_ip" /> {tFn('afile.ban_ip')}</label>
						<label class="adm-check"><input type="checkbox" name="ban_email" /> {tFn('afile.ban_email')}</label>
						<div><button type="submit" class="adm-btn adm-btn--sm adm-btn--danger">{tFn('afile.ban_confirm', { name: m.username })}</button></div>
					</form>
				{/if}
			{/if}
		</section>

		<!-- ── Notes de l'équipe (D5) ───────────────────────────────────── -->
		<section class="adm-card flex flex-col gap-3">
			<h2 class="adm-label">{tFn('afile.notes')}</h2>
			<p class="adm-hint">{tFn('afile.notes_hint')}</p>
			{#if canMembers}
				<form method="POST" action="?/note" class="adm-form" use:enhance={() => async ({ result, update }) => { await update(); if (result.type === 'success') noteBody = '' }}>
					<textarea class="adm-input adm-textarea" name="body" rows="2" maxlength="2000" required bind:value={noteBody} placeholder={tFn('afile.note_ph')} aria-label={tFn('afile.note_ph')}></textarea>
					<div><button type="submit" class="adm-btn adm-btn--sm">{tFn('afile.note_btn')}</button></div>
				</form>
			{/if}
			{#each (f.timeline as any[]).filter((i) => i.kind === 'note') as n (n.id)}
				<article class="adm-note">
					<p>{n.text}</p>
					<footer>
						<span>{n.actor ?? tFn('areports.deleted_account')} · {fmt(n.at, true)}</span>
						{#if canMembers && (isAdmin || n.meta?.author_id === myId)}
							<form method="POST" action="?/deleteNote" use:enhance>
								<input type="hidden" name="note_id" value={n.id} />
								<button type="submit" class="adm-link-danger" onclick={(e) => { if (!confirm(tFn('afile.note_delete_confirm'))) e.preventDefault() }}>{tFn('common.delete')}</button>
							</form>
						{/if}
					</footer>
				</article>
			{:else}
				<p class="adm-muted text-sm">{tFn('afile.no_notes')}</p>
			{/each}
		</section>
	</div>

	<!-- ── Frise ────────────────────────────────────────────────────────── -->
	<section class="adm-card flex flex-col gap-3">
		<div class="adm-card-head flex-wrap">
			<h2 class="adm-label">{tFn('afile.timeline')}</h2>
			<div class="adm-chips" role="group" aria-label={tFn('afile.timeline')}>
				{#each ['all', 'warn', 'audit', 'report', 'note'] as k (k)}
					<button type="button" class="adm-chip" aria-pressed={filter === k} onclick={() => filter = k as Kind}>
						{tFn(`afile.f_${k}`)} <span class="adm-chip-count">{countOf(k as Kind)}</span>
					</button>
				{/each}
			</div>
		</div>

		{#if items.length === 0}
			<p class="adm-empty">{tFn('afile.timeline_empty')}</p>
		{:else}
			<ol class="adm-timeline">
				{#each items as i (i.kind + i.id)}
					<li class="adm-tl adm-tl--{i.kind}">
						<span class="adm-tl-dot" aria-hidden="true">
							<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d={ICONS[i.kind]}/></svg>
						</span>
						<div class="adm-tl-body">
							<div class="adm-tl-title">
								{#if i.kind === 'warn'}
									{i.actor ? tFn('afile.tl_warn_by', { name: i.actor }) : tFn('afile.tl_warn_auto', { rule: i.meta?.rule ?? '·' })}
								{:else if i.kind === 'audit'}
									{auditLabel(i.action)}{i.actor ? ` · ${tFn('afile.by', { name: i.actor })}` : ` · ${tFn('alog.actor_octoguard')}`}
								{:else if i.kind === 'report'}
									{tFn('afile.tl_report', { cat: tFn(`report.cat_${i.meta?.category ?? 'other'}`) })}
									<span class="adm-pill">{tFn(`areports.tab_${i.meta?.status ?? 'open'}`)}</span>
								{:else}
									{tFn('afile.tl_note', { name: i.actor ?? tFn('areports.deleted_account') })}
								{/if}
							</div>
							{#if i.kind === 'audit' && auditDetail(i)}
								<p class="adm-tl-text">{auditDetail(i)}</p>
							{:else if i.text}
								<p class="adm-tl-text">{i.text}</p>
							{/if}
							<time class="adm-tl-time" datetime={i.at}>{fmt(i.at, true)}</time>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</div>

<style>
	.adm-lad-hist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
	.adm-lad-hist li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; font-size: 0.8125rem; }
	.adm-lad-hist li > span:first-child { font-weight: 600; }
	.adm-lad-off { opacity: 0.6; }
	.adm-sep { border: 0; border-top: 1px solid var(--nx-border); margin: 4px 0; }
</style>
