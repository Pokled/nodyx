<script lang="ts">
	// Une règle, en carte : ce qu'elle surveille, son cran, ce qu'elle a fait
	// cette semaine. Interrupteur et cran s'enregistrent tout de suite (et
	// reviennent en arrière si le serveur refuse).
	import { t } from '$lib/i18n'
	import Icon from './Icon.svelte'
	import LevelPicker from './LevelPicker.svelte'
	import WordsEditor from './WordsEditor.svelte'
	import { og } from '$lib/octoguard/api'
	import { levelOf, intendedOf, patchForLevel, describe, ruleIcon, scopeText, sanctionOf, durationText, type Rule, type Level } from '$lib/octoguard/rules'

	let { rule, stats, token, onchange, onsettings }: {
		rule: Rule
		stats?: { acted: number; observed: number }
		token: string | null
		onchange: (r: Rule) => void
		onsettings: (r: Rule) => void
	} = $props()
	const tFn = $derived($t)

	let busy = $state(false)
	let error = $state<string | null>(null)
	const level = $derived(levelOf(rule))
	const sanction = $derived(sanctionOf(rule))
	const immune = $derived((rule.immunized_role_types ?? []).length > 0)

	async function save(patch: Partial<Rule>, optimistic: Partial<Rule> = patch) {
		const before = rule
		onchange({ ...rule, ...optimistic })
		busy = true
		error = null
		try {
			const res = await og<{ rule: Rule }>(token, `/rules/${rule.id}`, 'PUT', patch)
			onchange(res.rule)
		} catch (e: any) {
			onchange(before)
			error = e?.code === 'RE2_REQUIRED' ? tFn('og2.err_re2') : tFn('og2.err_save')
		} finally {
			busy = false
		}
	}

	const pickLevel = (l: Level) => save(patchForLevel(rule, l))
	const toggle = (on: boolean) => save({ enabled: on })
	const saveWords = (words: string[], exceptions: string[]) => save({ params: { ...rule.params, words, exceptions } })

	const n = $derived(level === 'observe' ? stats?.observed ?? 0 : stats?.acted ?? 0)
</script>

<article class="adm-card og-rule {rule.enabled ? '' : 'og-off'} {rule.type === 'keywords' ? 'og-wide' : ''}" id="rule-{rule.id}">
	<div class="og-rule-top">
		<span class="og-rule-ico og-dim"><Icon d={ruleIcon(rule)} /></span>
		<div class="og-t og-dim">
			<h3>
				{rule.name}
				{#if rule.type === 'keywords'}
					<button type="button" class="og-info" aria-label={tFn('og2.help')}><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" /><span class="og-tip" role="tooltip">{tFn('og2.tip_keywords')}</span></button>
				{:else if rule.conditions?.account_max_age_days}
					<button type="button" class="og-info" aria-label={tFn('og2.help')}><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" /><span class="og-tip" role="tooltip">{tFn('og2.tip_newcomers')}</span></button>
				{/if}
				{#if rule.customized}<span class="adm-pill">{tFn('og2.customized')}</span>{/if}
			</h3>
			<p>{describe(rule, tFn)}</p>
		</div>
		<label class="og-switch" title={tFn(rule.enabled ? 'og2.rule_on' : 'og2.rule_off')}>
			<input type="checkbox" checked={rule.enabled} disabled={busy} onchange={(e) => toggle(e.currentTarget.checked)} aria-label={tFn('og2.rule_toggle', { name: rule.name })} />
			<span class="og-track"></span>
		</label>
	</div>

	<div class="og-dim">
		<LevelPicker value={level} intended={intendedOf(rule)} name="lv-{rule.id}" {busy} onpick={pickLevel} />
	</div>

	{#if sanction && level === 'delete'}
		<div class="og-note"><Icon d="M11 5L6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6" />{tFn(`og2.sanction_${sanction}`, { dur: durationText(rule.action_duration, tFn) })}</div>
	{/if}
	{#if rule.escalation && (level === 'warn' || level === 'observe')}
		<div class="og-note"><Icon d="M3 17l6-6 4 4 8-8 M15 7h6v6" />{tFn('og2.escalation_line', {
			n: rule.escalation.warns_threshold,
			d: rule.escalation.window_days,
			what: tFn(`og2.sanction_short_${rule.escalation.action === 'ban_temp' ? 'ban_temp' : 'mute'}`, { dur: durationText(rule.escalation.duration, tFn) }),
		})}</div>
	{/if}

	{#if rule.type === 'keywords'}
		<WordsEditor words={rule.params?.words ?? []} exceptions={rule.params?.exceptions ?? []} {busy} onsave={saveWords} />
	{/if}

	<div class="og-rule-meta">
		{#if n > 0}
			<span><b>{n}</b> {tFn(level === 'observe' ? 'og2.stat_would' : 'og2.stat_took', { n })} · <button type="button" class="og-linkbtn" onclick={() => onsettings(rule)}>{tFn('og2.see_which')}</button></span>
		{:else}
			<span>{tFn('og2.stat_none')}</span>
		{/if}
	</div>

	<div class="adm-actions" style="gap:0.375rem">
		<span class="adm-pill">{scopeText(rule, tFn)}</span>
		{#if immune}<span class="adm-pill">{tFn('og2.team_exempt')}</span>{/if}
	</div>

	{#if error}<p class="og-error" role="alert">{error}</p>{/if}

	<div class="og-rule-foot">
		<a class="adm-btn adm-btn--sm" href="/admin/octoguard/sandbox?rule={rule.id}"><Icon d="M9 3h6 M10 3v6L4.5 19A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-2L14 9V3 M7 15h10" />{tFn('og2.try')}</a>
		<button type="button" class="adm-btn adm-btn--sm" onclick={() => onsettings(rule)}><Icon d="M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5a2 2 0 100 4 2 2 0 000-4z M10 15a2 2 0 100 4 2 2 0 000-4z" />{tFn('og2.settings')}</button>
	</div>
</article>
