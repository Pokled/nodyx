<script lang="ts">
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import LevelLegend from '$lib/components/octoguard/LevelLegend.svelte'
	import RuleCard from '$lib/components/octoguard/RuleCard.svelte'
	import RuleDrawer from '$lib/components/octoguard/RuleDrawer.svelte'
	import { CATEGORIES, CATEGORY_ICON, categoryOf, type Category, type Rule } from '$lib/octoguard/rules'
	import { normalize } from '$lib/octoguard/keywords'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	let rules = $state<Rule[]>(untrack(() => data.rules as Rule[]))
	const stats = $derived(data.stats as Record<string, { acted: number; observed: number }>)

	let cat = $state<Category | 'all'>('all')
	let q = $state('')
	let open = $state<Rule | null>(null)

	const replace = (r: Rule) => { rules = rules.map((x) => (x.id === r.id ? r : x)) }
	const drop = (id: string) => { rules = rules.filter((x) => x.id !== id) }

	const inCat = (c: Category) => rules.filter((r) => categoryOf(r) === c)
	const present = $derived(CATEGORIES.filter((c) => inCat(c).length > 0))
	const match = (r: Rule) => !q.trim() || normalize(`${r.name} ${r.type}`).includes(normalize(q.trim()))
	const blocks = $derived(
		present
			.filter((c) => cat === 'all' || cat === c)
			.map((c) => ({ c, all: inCat(c), shown: inCat(c).filter(match) }))
			.filter((b) => b.shown.length > 0),
	)
	const onCount = (list: Rule[]) => list.filter((r) => r.enabled).length
</script>

<svelte:head><title>{tFn('og2.nav_rules')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5a2 2 0 100 4 2 2 0 000-4z M10 15a2 2 0 100 4 2 2 0 000-4z" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_rules')}</h1>
				<p class="adm-desc">{tFn('og2.rules_desc')}</p>
			</div>
		</div>
		<div class="adm-actions">
			<a class="adm-btn" href="/admin/octoguard/sandbox"><Icon d="M9 3h6 M10 3v6L4.5 19A1.5 1.5 0 006 21h12a1.5 1.5 0 001.5-2L14 9V3 M7 15h10" />{tFn('og2.nav_sandbox')}</a>
			<a class="adm-btn" href="/admin/octoguard/templates"><Icon d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5" />{tFn('og2.from_template')}</a>
			<a class="adm-btn adm-btn--primary" href="/admin/octoguard/automod"><Icon d="M12 5v14 M5 12h14" />{tFn('og2.new_rule')}</a>
		</div>
	</header>

	{#if data.settings && !data.settings.re2_active}
		<div class="og-warnbox" role="status"><Icon d="M12 9v4 M12 17h.01 M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><div>{tFn('og2.re2_missing')}</div></div>
	{/if}

	<LevelLegend />

	{#if data.failed}
		<div class="adm-card og-empty" role="alert">{tFn('og2.err_load')}</div>
	{:else if rules.length === 0}
		<div class="adm-card og-empty">{tFn('og2.rules_empty')}</div>
	{:else}
		<div class="og-catnav" role="group" aria-label={tFn('og2.categories')}>
			<button type="button" class="og-catcard" aria-pressed={cat === 'all'} onclick={() => (cat = 'all')}>
				<span class="og-cc-ico"><Icon d="M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5a2 2 0 100 4 2 2 0 000-4z M10 15a2 2 0 100 4 2 2 0 000-4z" /></span>
				<span class="og-cc-tx">
					<b>{tFn('og2.cat_all')}</b>
					<span>{tFn('og2.active_of', { on: onCount(rules), n: rules.length })}</span>
					<span class="og-dots" aria-hidden="true">{#each rules as r, i (i)}<i class={r.enabled ? 'on' : ''}></i>{/each}</span>
				</span>
			</button>
			{#each present as c (c)}
				<button type="button" class="og-catcard" aria-pressed={cat === c} onclick={() => (cat = c)}>
					<span class="og-cc-ico"><Icon d={CATEGORY_ICON[c]} /></span>
					<span class="og-cc-tx">
						<b>{tFn(`og2.cat_${c}`)}</b>
						<span>{tFn('og2.active_of', { on: onCount(inCat(c)), n: inCat(c).length })}</span>
						<span class="og-dots" aria-hidden="true">{#each inCat(c) as r, i (i)}<i class={r.enabled ? 'on' : ''}></i>{/each}</span>
					</span>
				</button>
			{/each}
		</div>

		<div class="adm-actions" style="justify-content:flex-end;margin-top:-0.5rem">
			<label class="adm-search">
				<Icon d="M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4-4" />
				<input class="adm-input" bind:value={q} placeholder={tFn('og2.search')} aria-label={tFn('og2.search')} />
			</label>
		</div>

		{#each blocks as b (b.c)}
			<section class="og-catblock" id="cat-{b.c}" aria-labelledby="cat-title-{b.c}">
				<div class="og-catblock-head">
					<span class="og-cb-ico"><Icon d={CATEGORY_ICON[b.c]} /></span>
					<div>
						<h2 id="cat-title-{b.c}">{tFn(`og2.cat_${b.c}`)}</h2>
						<p>{tFn(`og2.cat_${b.c}_desc`)}</p>
					</div>
					<span class="og-cb-count adm-pill {onCount(b.all) ? 'adm-pill--ok' : ''}">{tFn('og2.active_of', { on: onCount(b.all), n: b.all.length })}</span>
				</div>
				<div class="og-grid2">
					{#each b.shown as r (r.id)}
						<RuleCard rule={r} stats={stats[r.id]} {token} onchange={replace} onsettings={(x) => (open = x)} />
					{/each}
				</div>
			</section>
		{:else}
			<p class="og-empty">{tFn('og2.search_none')}</p>
		{/each}

		<div class="adm-card" style="display:flex;gap:0.875rem;align-items:flex-start">
			<span class="og-ic og-k-ok"><Icon d="M5 11h14v10H5z M8 11V7a4 4 0 018 0v4" /></span>
			<div class="og-row-body">
				<div><b style="font-weight:600">{tFn('og2.hate_title')}</b> <span class="adm-pill adm-pill--ok">{tFn('og2.always_on')}</span></div>
				<p class="og-help" style="margin-top:0.25rem">{tFn('og2.hate_desc')}</p>
			</div>
		</div>
	{/if}
</div>

{#if open}
	{#key open.id}
		<RuleDrawer rule={open} {token} onchange={replace} ondelete={drop} onclose={() => (open = null)} />
	{/key}
{/if}
