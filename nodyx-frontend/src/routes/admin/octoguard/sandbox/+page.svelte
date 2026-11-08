<script lang="ts">
	// Bac à sable : le VRAI moteur (POST /admin/octoguard/sandbox), sans aucun
	// effet de bord. On tape, on voit ce que chaque règle ferait, et pourquoi.
	import { page } from '$app/state'
	import { onMount, untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og, OgError } from '$lib/octoguard/api'
	import { LEVEL_ICON, SURFACES, ruleIcon, intendedOf, type Level, type Surface, type Rule } from '$lib/octoguard/rules'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const focusRule = page.url.searchParams.get('rule')

	type Outcome = 'none' | 'observe' | 'report' | 'hold' | 'warn' | 'delete' | 'mute' | 'ban_temp' | 'notify'
	type R = { id: string; name: string; type: string; enabled: boolean; applies_here: boolean; immune: boolean; conditions_ok: boolean; testable: boolean; matched: boolean; excerpt: string | null; outcome: Outcome; intended: Outcome }
	type Result = { system: { blocked: boolean; rule: string | null }; rules: R[]; first: string | null }

	const LV: Record<Outcome, Level | null> = { none: null, observe: 'observe', report: 'report', notify: 'report', hold: 'hold', warn: 'warn', delete: 'delete', mute: 'delete', ban_temp: 'delete' }

	let content = $state('')
	let surface = $state<Surface>('chat')
	let age = $state<number>(400)
	let role = $state<'member' | 'moderator'>('member')
	let result = $state<Result | null>(null)
	let busy = $state(false)
	let failed = $state(false)

	onMount(() => { untrack(() => { if (!content) content = tFn('og2.sb_default') }) })

	let timer: ReturnType<typeof setTimeout> | undefined
	let seq = 0
	$effect(() => {
		const body = { content: content.trim(), surface, account_age_days: age, role }
		clearTimeout(timer)
		if (!body.content) { result = null; return }
		timer = setTimeout(async () => {
			const mine = ++seq
			busy = true
			try {
				const r = await og<Result>(untrack(() => token), '/sandbox', 'POST', body)
				if (mine === seq) { result = r; failed = false }
			} catch { if (mine === seq) failed = true }
			finally { if (mine === seq) busy = false }
		}, 300)
		return () => clearTimeout(timer)
	})

	const firstRule = $derived(result?.first ? result.rules.find((r) => r.id === result!.first) ?? null : null)
	const observedHits = $derived(result ? result.rules.filter((r) => r.matched && r.outcome === 'observe').length : 0)

	// ─── Rejouer une règle sur 30 jours (lot 11, D26) ────────────────────────
	// Le cœur relit les messages du mois, sans rien toucher ni enregistrer.
	type Example = { at: string; author: string | null; place: string | null; surface: 'chat' | 'forum'; text: string; excerpt: string; probable_fp: boolean }
	type Replay = { rule: { id: string; name: string }; scanned: number; matched: number; members: number; probable_fp: number; examples: Example[]; truncated: null | 'too_many' | 'too_long' }
	const replayRules = $derived(data.rules as Rule[])
	let replayId = $state<string>(untrack(() => focusRule ?? ((data.rules as Rule[]).find((r) => !r.enabled || r.dry_run)?.id ?? (data.rules as Rule[])[0]?.id ?? '')))
	let replay = $state<Replay | null>(null)
	let replayBusy = $state(false)
	let replayError = $state<string | null>(null)
	let dismissed = $state<Set<number>>(new Set())
	const replayLevel = (r: Rule | undefined): Level => (r ? (intendedOf(r) as Level) : 'warn')
	const ruleLabel = (r: Rule) => tFn('og2.rpl_option', { name: r.name, lv: tFn(`og2.lv_${replayLevel(r)}`) })
	async function runReplay() {
		if (!replayId) return
		replayBusy = true; replayError = null; replay = null; dismissed = new Set()
		try { replay = await og<Replay>(token, `/rules/${replayId}/replay`, 'POST') }
		catch (e) {
			const code = e instanceof OgError ? e.code : null
			replayError = tFn(code === 'REPLAY_COOLDOWN' ? 'og2.rpl_err_cooldown' : code === 'REPLAY_BUSY' ? 'og2.rpl_err_busy' : 'og2.rpl_err')
		} finally { replayBusy = false }
	}
	// « Pas un abus » : retire l'exemple du calcul AFFICHÉ, rien n'est enregistré
	const shownMatched = $derived(replay ? Math.max(0, replay.matched - dismissed.size) : 0)
	const shownFp = $derived(replay ? Math.max(0, replay.probable_fp - [...dismissed].filter((i) => replay!.examples[i]?.probable_fp).length) : 0)
	const replayedRule = $derived((data.rules as Rule[]).find((r) => r.id === replay?.rule.id))
	const num = (n: number) => n.toLocaleString(String($locale ?? 'fr'))
	const day = (iso: string) => new Date(iso).toLocaleDateString(String($locale ?? 'fr'), { day: 'numeric', month: 'short' })

	function why(r: R): string {
		if (!r.enabled) return tFn('og2.sb_off')
		if (!r.applies_here) return tFn('og2.sb_not_here')
		if (r.immune) return tFn('og2.sb_immune')
		if (!r.conditions_ok) return tFn('og2.sb_cond')
		if (!r.testable) return tFn('og2.sb_untestable')
		return ''
	}
	const ruleRow = (id: string) => (data.rules as any[]).find((x) => x.id === id) ?? { type: 'regex' }

	let highlighted = $state(false)
	$effect(() => {
		if (!highlighted && focusRule && result) {
			highlighted = true
			setTimeout(() => document.getElementById(`sb-${focusRule}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
		}
	})
</script>

<svelte:head><title>{tFn('og2.nav_sandbox')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M9 3h6 M10 3v6L4.5 19A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-2L14 9V3 M7 15h10" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_sandbox')}</h1>
				<p class="adm-desc">{tFn('og2.sb_desc')}</p>
			</div>
		</div>
		<a class="adm-btn" href="/admin/octoguard/rules"><Icon d="M10 19l-7-7 7-7 M3 12h18" />{tFn('og2.nav_rules')}</a>
	</header>

	<div class="og-grid2">
		<div class="adm-card" style="display:flex;flex-direction:column;gap:0.875rem">
			<label class="og-field">
				<span class="og-lbl">{tFn('og2.sb_message')}</span>
				<textarea class="adm-input" rows="5" style="padding:0.6rem 0.75rem;min-height:7rem;resize:vertical" bind:value={content}></textarea>
			</label>
			<div class="adm-actions" style="gap:0.75rem">
				<label class="og-field"><span class="og-help">{tFn('og2.sb_where')}</span>
					<select class="adm-input" bind:value={surface}>{#each SURFACES as s (s)}<option value={s}>{tFn(`og2.surface_${s}`)}</option>{/each}</select>
				</label>
				<label class="og-field"><span class="og-help">{tFn('og2.sb_age')}</span>
					<select class="adm-input" bind:value={age}>
						<option value={400}>{tFn('og2.sb_age_old')}</option>
						<option value={10}>{tFn('og2.sb_age_days', { n: 10 })}</option>
						<option value={1}>{tFn('og2.sb_age_days', { n: 1 })}</option>
					</select>
				</label>
				<label class="og-field"><span class="og-help">{tFn('og2.sb_role')}</span>
					<select class="adm-input" bind:value={role}>
						<option value="member">{tFn('og2.role_member')}</option>
						<option value="moderator">{tFn('og2.role_moderator')}</option>
					</select>
				</label>
			</div>
			<div class="adm-actions">
				<span class="og-help">{tFn('og2.sb_examples')}</span>
				{#each ['normal', 'insult', 'links', 'mentions'] as ex (ex)}
					<button type="button" class="adm-chip" onclick={() => (content = tFn(`og2.sb_ex_${ex}_text`))}>{tFn(`og2.sb_ex_${ex}`)}</button>
				{/each}
			</div>
		</div>

		<div class="adm-card" aria-live="polite" aria-busy={busy}>
			<div class="adm-card-head"><h2 class="adm-title" style="font-size:0.9375rem">{tFn('og2.sb_result')}</h2>{#if busy}<span class="og-help">{tFn('og2.loading')}</span>{/if}</div>
			{#if failed}
				<p class="og-error" role="alert">{tFn('og2.err_sandbox')}</p>
			{:else if !result}
				<p class="og-empty">{tFn('og2.sb_type')}</p>
			{:else}
				{#if result.system.blocked}
					<div class="og-verdict og-k-delete"><span>{tFn('og2.sb_v_system')}</span></div>
				{:else if firstRule}
					{@const lv = LV[firstRule.outcome] ?? 'delete'}
					<div class="og-verdict og-k-{lv}">
						<span>{tFn('og2.sb_v_rule', { what: tFn(`og2.sb_do_${firstRule.outcome}`), name: firstRule.name })}</span>
						<span class="adm-pill og-tone og-k-{lv}"><Icon d={LEVEL_ICON[lv]} />{tFn(`og2.lv_${lv}`)}</span>
					</div>
				{:else}
					<div class="og-verdict og-k-ok"><span><b>{tFn('og2.sb_v_pass')}</b> {observedHits ? tFn('og2.sb_v_pass_observed', { n: observedHits }) : tFn('og2.sb_v_pass_none')}</span></div>
				{/if}

				<div class="og-rows" style="margin-top:0.875rem">
					{#each result.rules as r (r.id)}
						{@const lv = r.matched && !why(r) ? LV[r.outcome] : null}
						<div class="og-row {focusRule === r.id ? 'og-hl' : ''}" id="sb-{r.id}">
							<span class="og-ic {lv ? `og-k-${lv}` : 'og-k-ok'}"><Icon d={lv ? LEVEL_ICON[lv] : ruleIcon(ruleRow(r.id))} /></span>
							<div class="og-row-body">
								<div><b style="font-weight:600">{r.name}</b></div>
								<div class="og-meta">
									{#if why(r)}{why(r)}{:else if r.matched}{r.excerpt ?? ''}{#if r.outcome === 'observe'} · {tFn('og2.sb_would', { what: tFn(`og2.sb_do_${r.intended}`) })}{/if}{:else}{tFn('og2.sb_nothing')}{/if}
								</div>
							</div>
							{#if lv}<span class="adm-pill og-tone og-k-{lv}"><Icon d={LEVEL_ICON[lv]} />{tFn(`og2.lv_${lv}`)}</span>{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<section class="adm-card og-replay" aria-labelledby="og-rpl-t">
		<div class="og-replay-head">
			<div class="og-head-l">
				<span class="og-ic og-k-acc"><Icon d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8 M3 3v5h5 M12 7v5l3 2" /></span>
				<div>
					<h2 id="og-rpl-t" class="og-rp-h">{tFn('og2.rpl_title')}</h2>
					<p class="og-help">{tFn('og2.rpl_help')}</p>
				</div>
			</div>
			<div class="adm-actions">
				<select class="adm-input og-replay-select" bind:value={replayId} aria-label={tFn('og2.rpl_pick')}>
					{#each replayRules as r (r.id)}<option value={r.id}>{ruleLabel(r)}</option>{/each}
				</select>
				<button type="button" class="adm-btn adm-btn--primary" disabled={replayBusy || !replayId} onclick={runReplay}>
					<Icon d="M3 12a9 9 0 109-9 9.7 9.7 0 00-6.7 2.8L3 8 M3 3v5h5" />{tFn(replayBusy ? 'og2.rpl_running' : 'og2.rpl_go')}
				</button>
			</div>
		</div>

		{#if replayError}<p class="og-error" role="alert">{replayError}</p>{/if}
		{#if !replay && !replayError}
			<p class="og-help">{tFn(replayBusy ? 'og2.rpl_running_long' : 'og2.rpl_idle')}</p>
		{:else if replay}
			{@const lv = replayLevel(replayedRule)}
			<div role="status">
				{#if shownMatched === 0}
					<p class="og-okmsg">{tFn('og2.rpl_none', { n: num(replay.scanned) })}</p>
				{:else}
					<div class="og-rp-facts">
						<span class="adm-pill og-tone og-k-{lv}"><Icon d={LEVEL_ICON[lv]} />{tFn(`og2.rpl_did_${lv}`, { n: shownMatched })}</span>
						<span class="adm-pill">{tFn(replay.members > 1 ? 'og2.rpl_members_n' : 'og2.rpl_members_1', { n: replay.members })}</span>
						{#if shownFp > 0}<span class="adm-pill og-tone og-k-warn" title={tFn('og2.rpl_fp_help')}>{tFn(shownFp > 1 ? 'og2.rpl_fp_n' : 'og2.rpl_fp_1', { n: shownFp })}</span>{/if}
					</div>
					<div class="og-rows" style="margin-top:0.75rem">
						{#each replay.examples as e, i (i)}
							{#if !dismissed.has(i)}
								<div class="og-row">
									<span class="og-meta og-replay-day">{day(e.at)}</span>
									<div class="og-row-body">
										<div><b style="font-weight:600">{e.author ?? tFn('areports.deleted_account')}</b> · {e.surface === 'chat' ? `#${e.place ?? ''}` : tFn('og2.rpl_in_thread', { t: e.place ?? '' })}{#if e.probable_fp}<span class="adm-pill og-tone og-k-warn og-replay-tag">{tFn('og2.rpl_fp_tag')}</span>{/if}</div>
										<p class="og-quote">{e.text}</p>
										<div class="og-meta">{e.excerpt}</div>
									</div>
									<button type="button" class="adm-btn adm-btn--sm" onclick={() => (dismissed = new Set([...dismissed, i]))}>{tFn('og2.rpl_not_abuse')}</button>
								</div>
							{/if}
						{/each}
					</div>
					{#if replay.matched > replay.examples.length}<p class="og-help">{tFn('og2.rpl_more', { n: replay.examples.length, total: num(replay.matched) })}</p>{/if}
				{/if}
				<p class="og-help">{[tFn('og2.rpl_scanned', { n: num(replay.scanned) }), replay.truncated ? tFn(`og2.rpl_trunc_${replay.truncated}`) : '', tFn('og2.rpl_nothing_kept')].filter(Boolean).join(' ')}</p>
			</div>
		{/if}
	</section>
</div>
