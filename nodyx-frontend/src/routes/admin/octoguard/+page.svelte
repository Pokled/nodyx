<script lang="ts">
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import { LEVEL_ICON, intendedOf, type Level, type Rule } from '$lib/octoguard/rules'
	import { eventOf, KIND_ICON } from '$lib/octoguard/events'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const openReports = $derived(((page.data as any).access?.open_reports as number | null) ?? 0)

	let rules = $state<Rule[]>(untrack(() => data.rules as Rule[]))
	const stats = $derived((data.stats ?? { rules: {}, totals: { acted: 0, observed: 0, undone: 0 } }) as any)
	const on = $derived(rules.filter((r) => r.enabled))
	const observing = $derived(on.filter((r) => r.dry_run))
	const enabled = $derived(!!data.settings?.enabled)

	// Ce qui mérite un coup d'œil : OctoGuard suggère, l'équipe décide.
	type Tip = { key: string; kind: Level | 'ok' | 'acc'; icon: string; text: string; meta?: string; href?: string; hrefLabel?: string; rule?: Rule }
	const tips = $derived.by(() => {
		const out: Tip[] = []
		if (data.settings && !data.settings.re2_active) out.push({ key: 're2', kind: 'warn', icon: LEVEL_ICON.warn, text: tFn('og2.re2_missing') })
		for (const r of observing) {
			const n = stats.rules?.[r.id]?.observed ?? 0
			if (n > 0) out.push({ key: `obs-${r.id}`, kind: 'observe', icon: LEVEL_ICON.observe, rule: r,
				text: tFn('og2.tip_observed', { name: r.name, n }), meta: tFn('og2.tip_observed_meta', { what: tFn(`og2.lv_would_${intendedOf(r)}`) }),
				href: `/admin/octoguard/rules#rule-${r.id}`, hrefLabel: tFn('og2.see') })
		}
		const kw = rules.find((r) => r.type === 'keywords')
		if (kw && !(kw.params?.words ?? []).length) out.push({ key: 'kw-empty', kind: 'warn', icon: LEVEL_ICON.warn, text: tFn('og2.tip_words_empty'), meta: tFn('og2.tip_words_empty_meta'), href: `/admin/octoguard/rules#rule-${kw.id}`, hrefLabel: tFn('og2.tip_words_fill') })
		else if (kw && !kw.enabled) out.push({ key: 'kw-off', kind: 'acc', icon: LEVEL_ICON.report, text: tFn('og2.tip_words_off'), href: `/admin/octoguard/rules#rule-${kw.id}`, hrefLabel: tFn('og2.see') })
		if (openReports > 0) out.push({ key: 'reports', kind: 'report', icon: LEVEL_ICON.report, text: tFn('og2.tip_reports', { n: openReports }), href: '/admin/reports', hrefLabel: tFn('og2.open') })
		return out.slice(0, 5)
	})

	// Passer une règle observée à son cran prévu, d'un clic, depuis la suggestion.
	let promoting = $state<string | null>(null)
	let promoted = $state<Record<string, boolean>>({})
	async function promote(r: Rule) {
		promoting = r.id
		try {
			const res = await og<{ rule: Rule }>(token, `/rules/${r.id}`, 'PUT', { dry_run: false })
			rules = rules.map((x) => (x.id === r.id ? res.rule : x))
			promoted = { ...promoted, [r.id]: true }
		} catch { /* la carte de la règle reste la voie sûre */ }
		finally { promoting = null }
	}

	// Les dernières actions, racontées en phrases (lib/octoguard/events.ts).
	const ago = (iso: string) => {
		const d = new Date(iso)
		if (isNaN(d.getTime())) return ''
		const min = Math.round((Date.now() - d.getTime()) / 60000)
		if (min < 1) return tFn('og2.ago_now')
		if (min < 60) return tFn('og2.ago_min', { n: min })
		if (min < 1440) return tFn('og2.ago_h', { n: Math.round(min / 60) })
		return d.toLocaleDateString(String($locale ?? 'fr'), { day: 'numeric', month: 'short' })
	}
</script>

<svelte:head><title>OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M4 18a8 8 0 1116 0 M12 18l4-6" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_overview')}</h1>
				<p class="adm-desc">
					{#if !enabled}{tFn('og2.ov_desc_off')}{:else}{tFn('og2.ov_desc', { n: on.length, k: observing.length })}{/if}
				</p>
			</div>
		</div>
		<span class="adm-pill {enabled ? 'adm-pill--ok' : ''}" title={tFn('og2.ov_switch_help')}>
			<span class="og-dot" style="--k:{enabled ? 'var(--nx-ok)' : 'var(--nx-text-muted)'}"></span>{tFn(enabled ? 'og2.ov_on' : 'og2.ov_off')}
		</span>
	</header>

	{#if data.failed}
		<div class="adm-card og-empty" role="alert">{tFn('og2.err_load')}</div>
	{/if}

	<div class="adm-stats">
		<div class="adm-stat"><div class="adm-stat-top"><span>{tFn('og2.st_acted')}</span><Icon d={LEVEL_ICON.delete} cls="adm-stat-icon" /></div><div class="adm-stat-value">{stats.totals?.acted ?? 0}</div><div class="adm-stat-sub">{tFn('og2.st_acted_sub')}</div></div>
		<div class="adm-stat"><div class="adm-stat-top"><span>{tFn('og2.st_observed')}</span><Icon d={LEVEL_ICON.observe} cls="adm-stat-icon" /></div><div class="adm-stat-value">{stats.totals?.observed ?? 0}</div><div class="adm-stat-sub">{tFn('og2.st_observed_sub')}</div></div>
		<div class="adm-stat"><div class="adm-stat-top"><span>{tFn('og2.st_undone')}</span><Icon d={KIND_ICON.ok} cls="adm-stat-icon" /></div><div class="adm-stat-value">{stats.totals?.undone ?? 0}</div><div class="adm-stat-sub">{tFn('og2.st_undone_sub')}</div></div>
		<div class="adm-stat"><div class="adm-stat-top"><span>{tFn('og2.nav_reports')}</span><Icon d={LEVEL_ICON.report} cls="adm-stat-icon" /></div><div class="adm-stat-value">{openReports}</div><div class="adm-stat-sub"><a class="og-linkbtn" href="/admin/reports">{tFn('og2.open_queue')}</a></div></div>
	</div>

	<div class="og-grid2">
		<section class="adm-card" aria-labelledby="og-todo">
			<div class="adm-card-head"><h2 id="og-todo" class="adm-title" style="font-size:0.9375rem">{tFn('og2.todo')}</h2><span class="og-help">{tFn('og2.todo_sub')}</span></div>
			{#if tips.length === 0}
				<p class="og-empty">{tFn('og2.todo_none')}</p>
			{:else}
				<div class="og-rows">
					{#each tips as tip (tip.key)}
						<div class="og-row">
							<span class="og-ic og-k-{tip.kind}"><Icon d={tip.icon} /></span>
							<div class="og-row-body">
								<div>{tip.text}</div>
								{#if tip.meta}<div class="og-meta">{tip.meta}</div>{/if}
								<div class="adm-actions" style="margin-top:0.5rem">
									{#if tip.href}<a class="adm-btn adm-btn--sm" href={tip.href}>{tip.hrefLabel}</a>{/if}
									{#if tip.rule}
										{#if promoted[tip.rule.id]}
											<span class="adm-pill adm-pill--ok">{tFn('og2.tip_done')}</span>
										{:else}
											<button type="button" class="adm-btn adm-btn--primary adm-btn--sm" disabled={promoting === tip.rule.id} onclick={() => promote(tip.rule!)}>
												{tFn('og2.tip_promote', { lv: tFn(`og2.lv_${intendedOf(tip.rule)}`) })}
											</button>
										{/if}
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>

		<section class="adm-card" aria-labelledby="og-recent">
			<div class="adm-card-head"><h2 id="og-recent" class="adm-title" style="font-size:0.9375rem">{tFn('og2.recent')}</h2><a class="og-linkbtn" style="font-size:0.75rem" href="/admin/octoguard/logs">{tFn('og2.full_log')}</a></div>
			{#if data.logs.length === 0}
				<p class="og-empty">{tFn('og2.recent_none')}</p>
			{:else}
				<div class="og-rows">
					{#each data.logs as l (l.id)}
						{@const ev = eventOf(l)}
						<div class="og-row">
							<span class="og-ic og-k-{ev.kind}"><Icon d={KIND_ICON[ev.kind]} /></span>
							<div class="og-row-body">
								<div>{tFn(`og2.${ev.key}`, { rule: l.metadata?.rule_name ?? '', who: l.actor_username ?? '' })}</div>
								<div class="og-meta">{#if l.target_label}{tFn('og2.quoted', { t: l.target_label.slice(0, 90) })} · {/if}{ago(l.created_at)}</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	</div>

	<section aria-labelledby="og-start">
		<h2 id="og-start" class="adm-title" style="font-size:0.9375rem;margin-bottom:0.75rem">{tFn('og2.where_to')}</h2>
		<div class="og-grid3">
			<a class="adm-card og-tile" href="/admin/octoguard/rules">
				<div class="og-tile-art"><svg viewBox="0 0 160 84" aria-hidden="true"><rect class="og-art-p" x="20" y="14" width="120" height="56" rx="10"/><rect x="32" y="40" width="96" height="16" rx="6" fill="color-mix(in srgb, var(--nx-text) 10%, transparent)"/><rect x="56" y="40" width="24" height="16" rx="6" fill="var(--nx-surface)" stroke="var(--nx-info)" stroke-width="1.5"/><circle cx="44" cy="27" r="3.5" fill="var(--nx-text-muted)"/><circle cx="68" cy="27" r="3.5" fill="var(--nx-info)"/><circle cx="92" cy="27" r="3.5" fill="var(--nx-warn)"/><circle cx="116" cy="27" r="3.5" fill="var(--nx-bad)"/></svg></div>
				<div class="og-tile-tx"><b>{tFn('og2.nav_rules')}</b><span>{tFn('og2.tile_rules')}</span><span class="og-go">{tFn('og2.tile_rules_go')}</span></div>
			</a>
			<a class="adm-card og-tile" href="/admin/octoguard/sandbox">
				<div class="og-tile-art"><svg viewBox="0 0 160 84" aria-hidden="true"><rect class="og-art-p" x="14" y="16" width="64" height="52" rx="8"/><path class="og-art-s" d="M24 32h40M24 44h44M24 56h28"/><path d="M84 42h14 M94 37l6 5-6 5" fill="none" stroke="var(--nx-header-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect class="og-art-p" x="106" y="16" width="42" height="52" rx="8"/><circle cx="118" cy="30" r="4" fill="var(--nx-info)"/><circle cx="118" cy="44" r="4" fill="var(--nx-ok)"/><circle cx="118" cy="58" r="4" fill="var(--nx-text-muted)"/></svg></div>
				<div class="og-tile-tx"><b>{tFn('og2.nav_sandbox')}</b><span>{tFn('og2.tile_sandbox')}</span><span class="og-go">{tFn('og2.tile_sandbox_go')}</span></div>
			</a>
			<a class="adm-card og-tile" href="/admin/reports">
				<div class="og-tile-art"><svg viewBox="0 0 160 84" aria-hidden="true"><rect class="og-art-p" x="16" y="12" width="96" height="14" rx="5"/><rect class="og-art-p" x="16" y="32" width="84" height="14" rx="5"/><rect x="16" y="52" width="96" height="14" rx="5" fill="color-mix(in srgb, var(--nx-bad) 12%, transparent)" stroke="var(--nx-bad)" stroke-width="1.5"/><rect class="og-art-a" x="118" y="20" width="30" height="44" rx="7"/><path d="M128 32v20 M128 32h12l-2 5 2 5h-12" fill="none" stroke="var(--nx-header-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
				<div class="og-tile-tx"><b>{tFn('og2.nav_reports')}</b><span>{tFn('og2.tile_reports')}</span><span class="og-go">{tFn('og2.tile_reports_go')}</span></div>
			</a>
		</div>
	</section>

	<div class="og-health">
		<span><span class="og-dot" style="--k:{data.settings?.re2_active ? 'var(--nx-ok)' : 'var(--nx-warn)'}"></span>{tFn(data.settings?.re2_active ? 'og2.health_re2' : 'og2.health_re2_off')}</span>
		<span><span class="og-dot" style="--k:{data.settings?.hate_filter !== false ? 'var(--nx-ok)' : 'var(--nx-warn)'}"></span>{tFn(data.settings?.hate_filter !== false ? 'og2.health_hate' : 'og2.health_hate_off')}</span>
		<span>{tFn('og2.health_scope')}</span>
	</div>
</div>
