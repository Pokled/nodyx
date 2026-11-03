<script lang="ts">
	// Bac à sable : le VRAI moteur (POST /admin/octoguard/sandbox), sans aucun
	// effet de bord. On tape, on voit ce que chaque règle ferait, et pourquoi.
	import { page } from '$app/state'
	import { onMount, untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import { LEVEL_ICON, SURFACES, ruleIcon, type Level, type Surface } from '$lib/octoguard/rules'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const focusRule = page.url.searchParams.get('rule')

	type Outcome = 'none' | 'observe' | 'report' | 'warn' | 'delete' | 'mute' | 'ban_temp' | 'notify'
	type R = { id: string; name: string; type: string; enabled: boolean; applies_here: boolean; immune: boolean; conditions_ok: boolean; testable: boolean; matched: boolean; excerpt: string | null; outcome: Outcome; intended: Outcome }
	type Result = { system: { blocked: boolean; rule: string | null }; rules: R[]; first: string | null }

	const LV: Record<Outcome, Level | null> = { none: null, observe: 'observe', report: 'report', notify: 'report', warn: 'warn', delete: 'delete', mute: 'delete', ban_temp: 'delete' }

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
</div>
