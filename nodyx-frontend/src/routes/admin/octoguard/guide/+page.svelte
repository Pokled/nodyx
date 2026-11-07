<script lang="ts">
	// Le Guide d'OctoGuard : huit chapitres courts, illustrés, et surtout
	// INTERACTIFS. Les démonstrations sont les vrais composants (crans, mots,
	// bac à sable branché sur le vrai moteur), et le dernier chapitre lit l'état
	// réel de l'instance pour dire ce qu'il reste à faire avant d'allumer.
	import { page } from '$app/state'
	import { goto } from '$app/navigation'
	import { onMount, untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import GuideArt from '$lib/components/octoguard/GuideArt.svelte'
	import LevelPicker from '$lib/components/octoguard/LevelPicker.svelte'
	import LevelLegend from '$lib/components/octoguard/LevelLegend.svelte'
	import WordsEditor from '$lib/components/octoguard/WordsEditor.svelte'
	import { og } from '$lib/octoguard/api'
	import { LEVEL_ICON, type Level, type Rule } from '$lib/octoguard/rules'
	import { eventOf, KIND_ICON } from '$lib/octoguard/events'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	type Ch = { id: string; go: string; points: number; demo?: 'level' | 'words' | 'sandbox' | 'journal' | 'checklist' }
	const CH: Ch[] = [
		{ id: 'intro', go: '/admin/octoguard', points: 3 },
		{ id: 'levels', go: '/admin/octoguard/rules', points: 3, demo: 'level' },
		{ id: 'words', go: '/admin/octoguard/rules', points: 4, demo: 'words' },
		{ id: 'sandbox', go: '/admin/octoguard/sandbox', points: 2, demo: 'sandbox' },
		{ id: 'log', go: '/admin/octoguard/logs', points: 3, demo: 'journal' },
		{ id: 'team', go: '/admin/octoguard/reports', points: 3 },
		{ id: 'share', go: '/admin/octoguard/templates', points: 3 },
		{ id: 'launch', go: '/admin/octoguard/rules', points: 0, demo: 'checklist' },
	]

	// Chapitre courant : dans l'adresse (?ch=…), pour pouvoir y renvoyer.
	const fromUrl = (id: string | null) => Math.max(0, CH.findIndex((c) => c.id === id))
	let cur = $state(untrack(() => fromUrl(page.url.searchParams.get('ch'))))
	$effect(() => { const i = fromUrl(page.url.searchParams.get('ch')); untrack(() => { if (i !== cur) cur = i }) })
	function open(i: number) {
		cur = i
		goto(`?ch=${CH[i].id}`, { replaceState: true, shallow: true })
		document.getElementById('og-guide-article')?.scrollIntoView({ block: 'start', behavior: 'smooth' })
	}

	// Progression : propre à ce navigateur (localStorage), jamais indispensable.
	const KEY = 'og-guide-done'
	let done = $state<string[]>([])
	onMount(() => { try { done = JSON.parse(localStorage.getItem(KEY) ?? '[]') } catch { done = [] } })
	function mark(id: string) {
		if (done.includes(id)) return
		done = [...done, id]
		try { localStorage.setItem(KEY, JSON.stringify(done)) } catch { /* navigation privée : sans importance */ }
	}
	function next() { mark(CH[cur].id); if (cur < CH.length - 1) open(cur + 1) }
	function restart() { done = []; try { localStorage.removeItem(KEY) } catch { /* idem */ } open(0) }
	const ch = $derived(CH[cur])
	const pct = $derived(Math.round((100 * done.filter((d) => CH.some((c) => c.id === d)).length) / CH.length))

	// Démo des crans : un vrai sélecteur, sans rien enregistrer.
	let demoLevel = $state<Level>('observe')

	// Démo des mots : une liste d'exemple, dans la langue de l'interface.
	const demoWords = $derived(tFn('og2.guide_words_demo').split(',').map((w) => w.trim()).filter(Boolean))
	const demoAllow = $derived(tFn('og2.guide_words_allow').split(',').map((w) => w.trim()).filter(Boolean))

	// Démo du bac à sable : le VRAI moteur, sans effet de bord.
	let sbText = $state('')
	let sbResult = $state<{ name: string; outcome: string } | 'pass' | 'system' | null>(null)
	let sbBusy = $state(false)
	let sbTimer: ReturnType<typeof setTimeout> | undefined
	$effect(() => {
		if (ch.demo !== 'sandbox') return
		const content = sbText.trim()
		clearTimeout(sbTimer)
		if (!content) { sbResult = null; return }
		sbTimer = setTimeout(async () => {
			sbBusy = true
			try {
				const r = await og<any>(untrack(() => token), '/sandbox', 'POST', { content, surface: 'chat', account_age_days: 400, role: 'member' })
				const first = r.first ? r.rules.find((x: any) => x.id === r.first) : null
				sbResult = r.system?.blocked ? 'system' : first ? { name: first.name, outcome: first.outcome } : 'pass'
			} catch { sbResult = null }
			finally { sbBusy = false }
		}, 350)
		return () => clearTimeout(sbTimer)
	})
	onMount(() => { untrack(() => { sbText = tFn('og2.sb_ex_links_text') }) })
	const OUT_LV: Record<string, Level> = { observe: 'observe', report: 'report', notify: 'report', warn: 'warn', delete: 'delete', mute: 'delete', ban_temp: 'delete' }

	// Démo du journal : deux événements d'exemple, racontés par le vrai module.
	let demoUndone = $state(false)
	const demoLogs = $derived([
		{ action: ['octoguard', 'warn_user'].join('.'), metadata: { rule_name: tFn('og2.guide_ex_rule_flood'), undoable: true }, excerpt: tFn('og2.guide_ex_flood') },
		{ action: ['octoguard', 'delete_message'].join('.'), metadata: { rule_name: tFn('og2.guide_ex_rule_links') }, excerpt: tFn('og2.guide_ex_links') },
	])

	// « Avant d'allumer » : l'état RÉEL de l'instance, point par point.
	type Item = { key: string; state: 'ok' | 'todo' | 'info'; vars?: Record<string, string | number>; href?: string }
	const rules = $derived((data.rules ?? []) as Rule[])
	const checklist = $derived.by<Item[]>(() => {
		const out: Item[] = []
		const s = data.settings as any
		out.push({ key: 're2', state: s?.re2_active ? 'ok' : 'todo' })
		const presets = (data.base as any)?.presets ?? []
		const inst = presets.filter((p: any) => p.installed).length
		out.push({ key: 'base', state: presets.length && inst === presets.length ? 'ok' : 'todo', vars: { n: inst, total: presets.length }, href: '/admin/octoguard/templates' })
		const kw = rules.find((r) => r.type === 'keywords')
		const nw = (kw?.params?.words ?? []).length
		out.push({ key: 'words', state: nw > 0 ? 'ok' : 'todo', vars: { n: nw }, href: '/admin/octoguard/rules' })
		const obs = rules.filter((r) => r.enabled && r.dry_run)
		const seen = obs.reduce((a, r) => a + ((data.stats as any)?.rules?.[r.id]?.observed ?? 0), 0)
		out.push({ key: 'observe', state: 'info', vars: { n: obs.length, m: seen }, href: '/admin/octoguard/logs' })
		const w = data.welcome as any
		out.push({ key: 'welcome', state: w?.enabled && w?.public_message ? 'ok' : 'info', href: '/admin/octoguard/welcome' })
		out.push({ key: 'switch', state: s?.enabled ? 'ok' : 'todo' })
		return out
	})
	const ITEM_ICON = { ok: 'M5 13l4 4L19 7', todo: LEVEL_ICON.warn, info: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01' }
	const ITEM_TONE = { ok: 'og-k-ok', todo: 'og-k-warn', info: 'og-k-report' }
</script>

<svelte:head><title>{tFn('og2.nav_guide')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M4 5a2 2 0 012-2h13v15H6a2 2 0 00-2 2z M4 20a2 2 0 002 1h13" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_guide')}</h1>
				<p class="adm-desc">{tFn('og2.guide_desc')}</p>
			</div>
		</div>
		<div style="min-width:13rem">
			<p class="og-help" style="margin:0 0 0.375rem">{pct === 100 ? tFn('og2.guide_all_read') : tFn('og2.guide_progress', { n: done.filter((d) => CH.some((c) => c.id === d)).length, total: CH.length })}</p>
			<div class="og-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={pct} aria-label={tFn('og2.guide_progress_label')}><i style="width:{pct}%"></i></div>
		</div>
	</header>

	<div class="og-guide">
		<nav class="og-chapters" aria-label={tFn('og2.guide_chapters')}>
			{#each CH as c, i (c.id)}
				<button type="button" class="og-chapter {done.includes(c.id) ? 'og-done' : ''}" aria-current={i === cur ? 'step' : undefined} onclick={() => open(i)}>
					<span class="og-num">{#if done.includes(c.id)}<Icon d="M5 13l4 4L19 7" />{:else}{i + 1}{/if}</span>
					<span class="og-ch-t">{tFn(`og2.g_${c.id}_title`)}</span>
					<span class="og-help og-ch-d">{tFn(`og2.g_${c.id}_time`)}</span>
				</button>
			{/each}
			{#if done.length}<button type="button" class="og-linkbtn" style="margin-top:0.5rem;font-size:0.75rem" onclick={restart}>{tFn('og2.guide_restart')}</button>{/if}
		</nav>

		<article class="adm-card og-article" id="og-guide-article" aria-labelledby="og-ch-title">
			<p class="og-help" style="margin:0">{tFn('og2.guide_chapter_of', { n: cur + 1, total: CH.length })} · {tFn(`og2.g_${ch.id}_time`)}</p>
			<h2 id="og-ch-title" class="og-ch-h">{tFn(`og2.g_${ch.id}_title`)}</h2>
			<GuideArt name={ch.id} />
			<p class="og-lead">{tFn(`og2.g_${ch.id}_lead`)}</p>
			{#if ch.points}
				<ul class="og-keys">
					{#each Array.from({ length: ch.points }, (_, k) => k + 1) as k (k)}
						<li><Icon d="M5 13l4 4L19 7" /><span>{tFn(`og2.g_${ch.id}_p${k}`)}</span></li>
					{/each}
				</ul>
			{/if}

			{#if ch.demo}
				<section class="og-demo" aria-label={tFn('og2.guide_try_here')}>
					<p class="og-demo-h"><Icon d="M8 5v14l11-7z" />{tFn('og2.guide_try_here')}</p>
					{#if ch.demo === 'level'}
						<LevelPicker value={demoLevel} intended="delete" name="guide-level" onpick={(l) => (demoLevel = l)} />
						<div style="margin-top:0.75rem"><LevelLegend /></div>
					{:else if ch.demo === 'words'}
						<WordsEditor words={demoWords} exceptions={demoAllow} demo onsave={() => {}} />
					{:else if ch.demo === 'sandbox'}
						<input class="adm-input" bind:value={sbText} aria-label={tFn('og2.sb_message')} />
						<div class="og-demo-out" aria-live="polite">
							{#if sbBusy}<span class="og-help">{tFn('og2.loading')}</span>
							{:else if sbResult === 'system'}<span class="og-verdict og-k-delete">{tFn('og2.sb_v_system')}</span>
							{:else if sbResult === 'pass'}<span class="og-verdict og-k-ok"><b>{tFn('og2.sb_v_pass')}</b>&nbsp;{tFn('og2.sb_v_pass_none')}</span>
							{:else if sbResult}<span class="og-verdict og-k-{OUT_LV[sbResult.outcome] ?? 'delete'}">{tFn('og2.sb_v_rule', { what: tFn(`og2.sb_do_${sbResult.outcome}`), name: sbResult.name })}</span>{/if}
						</div>
						<p class="og-help">{tFn('og2.guide_sandbox_real')}</p>
					{:else if ch.demo === 'journal'}
						<div class="og-rows">
							{#each demoLogs as l, i (i)}
								{@const ev = eventOf(l)}
								<div class="og-row">
									<span class="og-ic og-k-{ev.kind}"><Icon d={KIND_ICON[ev.kind]} /></span>
									<div class="og-row-body"><div>{tFn(`og2.${ev.key}`, { rule: l.metadata.rule_name, who: '' })}</div><p class="og-quote">{l.excerpt}</p></div>
									{#if l.metadata.undoable}
										{#if demoUndone}<span class="adm-pill adm-pill--ok">{tFn('og2.undone')}</span>
										{:else}<button type="button" class="adm-btn adm-btn--sm" onclick={() => (demoUndone = true)}><Icon d={KIND_ICON.ok} />{tFn('og2.undo')}</button>{/if}
									{/if}
								</div>
							{/each}
						</div>
						<p class="og-help">{tFn('og2.guide_journal_demo')}</p>
					{:else if ch.demo === 'checklist'}
						<div class="og-rows">
							{#each checklist as it (it.key)}
								<div class="og-row">
									<span class="og-ic {ITEM_TONE[it.state]}"><Icon d={ITEM_ICON[it.state]} /></span>
									<div class="og-row-body">
										<div><b style="font-weight:600">{tFn(`og2.ck_${it.key}`, it.vars)}</b></div>
										<div class="og-meta">{tFn(`og2.ck_${it.key}_${it.state}`, it.vars)}</div>
									</div>
									{#if it.href && it.state !== 'ok'}<a class="adm-btn adm-btn--sm" href={it.href}>{tFn('og2.open')}</a>{/if}
								</div>
							{/each}
						</div>
						<p class="og-help">{tFn('og2.guide_checklist_live')}</p>
					{/if}
				</section>
			{/if}

			<div class="adm-actions" style="justify-content:space-between;border-top:1px solid var(--og-line);padding-top:1rem">
				<a class="adm-btn" href={ch.go}><Icon d="M5 12h14 M13 6l6 6-6 6" />{tFn('og2.guide_open_screen')}</a>
				<span class="adm-actions">
					{#if cur > 0}<button type="button" class="adm-btn" style="border-color:transparent;background:transparent" onclick={() => open(cur - 1)}>{tFn('og2.prev')}</button>{/if}
					{#if cur < CH.length - 1}
						<button type="button" class="adm-btn adm-btn--primary" onclick={next}>{tFn('og2.guide_next')}</button>
					{:else}
						<button type="button" class="adm-btn adm-btn--primary" onclick={() => mark(ch.id)} disabled={done.includes(ch.id)}>{tFn(done.includes(ch.id) ? 'og2.guide_finished' : 'og2.guide_finish')}</button>
					{/if}
				</span>
			</div>
		</article>
	</div>
</div>

<style>
	.og-guide { display: grid; grid-template-columns: 15.5rem minmax(0, 1fr); gap: 1.5rem; align-items: start; }
	.og-chapters { display: flex; flex-direction: column; gap: 0.25rem; position: sticky; top: 1rem; }
	.og-chapter { display: grid; grid-template-columns: 1.75rem 1fr auto; gap: 0.625rem; align-items: center; padding: 0.55rem 0.625rem; border-radius: 10px; border: 1px solid transparent; background: transparent; cursor: pointer; text-align: left; width: 100%; font: inherit; font-size: 0.8125rem; color: var(--nx-text-muted); }
	.og-chapter:hover { color: var(--nx-text); background: color-mix(in srgb, var(--nx-text) 4%, transparent); }
	.og-chapter[aria-current='step'] { border-color: var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font-weight: 550; }
	.og-num { width: 1.625rem; height: 1.625rem; border-radius: 99px; display: grid; place-items: center; font-weight: 650; font-size: 0.75rem; border: 1px solid var(--nx-border); background: var(--nx-surface); }
	.og-chapter[aria-current='step'] .og-num { background: var(--nx-header-accent); color: var(--nx-on-accent, #fff); border-color: transparent; }
	.og-chapter.og-done .og-num { background: color-mix(in srgb, var(--nx-ok) 14%, transparent); color: var(--nx-ok); border-color: transparent; }
	.og-ch-t { min-width: 0; line-height: 1.3; overflow-wrap: anywhere; }
	.og-ch-d { white-space: nowrap; }
	.og-article { display: flex; flex-direction: column; gap: 1rem; }
	.og-ch-h { margin: 0; font-size: 1.25rem; font-weight: 650; letter-spacing: -0.01em; }
	.og-lead { margin: 0; font-size: 0.9rem; line-height: 1.65; }
	.og-keys { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 0.5rem; }
	.og-keys li { display: flex; gap: 0.625rem; font-size: 0.84rem; line-height: 1.5; }
	.og-keys :global(svg) { color: var(--nx-ok); margin-top: 2px; }
	.og-demo { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem; border-radius: 12px; border: 1px dashed color-mix(in srgb, var(--nx-header-accent) 45%, var(--nx-border)); background: color-mix(in srgb, var(--nx-header-accent) 4%, var(--nx-surface)); }
	.og-demo-h { margin: 0; display: flex; align-items: center; gap: 0.4rem; font-size: 0.78rem; font-weight: 650; color: var(--nx-header-accent); text-transform: uppercase; letter-spacing: 0.05em; }
	.og-demo-out { min-height: 2.75rem; display: flex; align-items: center; }
	.og-progress { height: 5px; border-radius: 99px; background: var(--nx-border); overflow: hidden; }
	.og-progress i { display: block; height: 100%; background: var(--nx-ok); transition: width .2s; }
	@media (max-width: 1023px) {
		.og-guide { grid-template-columns: 1fr; }
		.og-chapters { position: static; flex-direction: row; overflow-x: auto; }
		.og-chapter { grid-template-columns: 1.75rem auto; white-space: nowrap; }
		.og-ch-d { display: none; }
	}
</style>
