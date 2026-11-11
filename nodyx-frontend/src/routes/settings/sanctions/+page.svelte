<script lang="ts">
	// OctoGuard lot 8 : un membre retrouve ses avertissements et sourdines des 30
	// derniers jours, et peut contester chacun une fois. Jamais le nom de la règle
	// ni celui de la personne qui a décidé (D20) : « l'équipe » ou « OctoGuard ».
	import { t, locale } from '$lib/i18n'
	import { page } from '$app/state'
	import { onMount, tick, untrack } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { durationText, type Duration } from '$lib/octoguard/rules'
	import type { PageData } from './$types'

	const tFn = $derived($t)
	let { data }: { data: PageData } = $props()

	type Appeal = { status: 'open' | 'upheld' | 'overturned'; reply: string | null; created_at: string; handled_at: string | null }
	type Decision = {
		type: 'warn' | 'mute'; id: string; at: string; reason: string | null; source: 'team' | 'octoguard'
		ladder_step: number | null; expires_at: string | null; active: boolean; undone: boolean
		contestable: boolean; appeal: Appeal | null
	}

	const MIN = 10, MAX = 1000
	let decisions = $state<Decision[]>(untrack(() => (data.decisions ?? []) as Decision[]))
	let openId = $state<string | null>(null)
	let text = $state('')
	let busy = $state(false)
	let error = $state<string | null>(null)
	let sentId = $state<string | null>(null)
	let focusId = $state<string | null>(null)

	const fmt = (iso: string) => new Date(iso).toLocaleString($locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

	/** La durée d'une sourdine, avec les mots d'OctoGuard (« 1 h », « 7 j »). */
	function muteDuration(d: Decision): string | null {
		if (!d.expires_at) return null
		const min = Math.round((new Date(d.expires_at).getTime() - new Date(d.at).getTime()) / 60_000)
		const dur: Duration = min % 1440 === 0 ? { value: min / 1440, unit: 'd' } : min % 60 === 0 ? { value: min / 60, unit: 'h' } : { value: min, unit: 'm' }
		return durationText(dur, tFn)
	}
	function title(d: Decision): string {
		if (d.type === 'warn') return tFn('sanc.warn')
		const dur = muteDuration(d)
		return dur ? tFn('sanc.mute', { dur }) : tFn('sanc.mute_open')
	}
	function stateOf(d: Decision): { key: string; tone: string; vars?: Record<string, string> } {
		if (d.undone) return { key: d.type === 'warn' ? 'sanc.st_undone_warn' : 'sanc.st_undone_mute', tone: 'ok' }
		if (d.type === 'warn') return { key: 'sanc.st_active_warn', tone: 'warn' }
		if (d.active) return d.expires_at ? { key: 'sanc.st_active_mute', tone: 'bad', vars: { at: fmt(d.expires_at) } } : { key: 'sanc.st_active_mute_open', tone: 'bad' }
		return { key: 'sanc.st_ended', tone: 'muted' }
	}

	function open(id: string) {
		openId = id; text = ''; error = null
		tick().then(() => (document.getElementById(`sanc-text-${id}`) as HTMLTextAreaElement | null)?.focus())
	}
	const left = $derived(Math.max(0, MIN - text.trim().length))

	async function send(d: Decision) {
		if (left > 0 || busy) return
		busy = true; error = null
		try {
			const res = await apiFetch(fetch, '/reports/appeals', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${page.data.token}` },
				body: JSON.stringify({ decision_type: d.type, decision_id: d.id, message: text.trim() }),
			})
			const json = await res.json().catch(() => ({}))
			if (!res.ok) {
				const known = ['APPEAL_EXISTS', 'APPEAL_TOO_LATE', 'DECISION_UNDONE', 'NOT_FOUND']
				error = tFn(known.includes(json.code) ? `sanc.err_${json.code}` : 'sanc.err_generic')
				return
			}
			decisions = decisions.map((x) => x.id === d.id ? { ...x, contestable: false, appeal: { status: 'open', reply: null, created_at: json.created_at ?? new Date().toISOString(), handled_at: null } } : x)
			openId = null; sentId = d.id; text = ''
		} catch {
			error = tFn('sanc.err_generic')
		} finally {
			busy = false
		}
	}

	// Arrivée depuis une notification ou le chat : ?decision=<id>&contest=1
	onMount(async () => {
		const want = page.url.searchParams.get('decision')
		if (!want) return
		focusId = want
		await tick()
		document.getElementById(`sanc-${want}`)?.scrollIntoView({ block: 'center' })
		const d = decisions.find((x) => x.id === want)
		if (d?.contestable && page.url.searchParams.get('contest') === '1') open(want)
	})
</script>

<svelte:head><title>{tFn('sanc.title')}</title></svelte:head>

<div class="sanc">
	<header class="sanc-head">
		<a class="sanc-back" href="/settings">{tFn('sanc.back')}</a>
		<h1 class="sanc-title">{tFn('sanc.title')}</h1>
		<p class="sanc-desc">{tFn('sanc.desc', { d: data.appealDays })}</p>
	</header>

	<section class="sanc-how" aria-labelledby="sanc-how-h">
		<h2 id="sanc-how-h" class="sanc-h2">{tFn('sanc.how_title')}</h2>
		<ol class="sanc-steps">
			<li><span class="sanc-n">1</span><span><b>{tFn('sanc.how1_t')}</b> {tFn('sanc.how1')}</span></li>
			<li><span class="sanc-n">2</span><span><b>{tFn('sanc.how2_t')}</b> {tFn('sanc.how2')}</span></li>
			<li><span class="sanc-n">3</span><span><b>{tFn('sanc.how3_t')}</b> {tFn('sanc.how3')}</span></li>
		</ol>
	</section>

	{#if data.failed}
		<p class="sanc-error" role="alert">{tFn('sanc.err_load')}</p>
	{:else if decisions.length === 0}
		<div class="sanc-empty">
			<p class="sanc-empty-t">{tFn('sanc.empty_title')}</p>
			<p class="sanc-muted">{tFn('sanc.empty', { d: data.appealDays })}</p>
		</div>
	{:else}
		<ul class="sanc-list">
			{#each decisions as d (d.type + d.id)}
				{@const st = stateOf(d)}
				<li id="sanc-{d.id}" class="sanc-card" class:sanc-focus={focusId === d.id}>
					<div class="sanc-top">
						<span class="sanc-ico sanc-ico--{d.type}" aria-hidden="true">
							{#if d.type === 'warn'}
								<svg viewBox="0 0 24 24"><path d="M12 3l9 16H3z M12 10v4 M12 17h.01" /></svg>
							{:else}
								<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6" /></svg>
							{/if}
						</span>
						<div class="sanc-main">
							<p class="sanc-what">{title(d)}</p>
							<p class="sanc-meta">
								{tFn(d.source === 'team' ? 'sanc.by_team' : 'sanc.by_octoguard')} · {fmt(d.at)}
								{#if d.ladder_step}
									· <span class="sanc-ladder">{tFn('sanc.ladder_step', { n: d.ladder_step })}
										<span class="sanc-tipwrap"><button type="button" class="sanc-info" aria-label={tFn('sanc.what_ladder')}>?</button><span class="sanc-tip" role="tooltip">{tFn('sanc.tip_ladder')}</span></span>
									</span>
								{/if}
							</p>
						</div>
						<span class="sanc-pill sanc-pill--{st.tone}">{tFn(st.key, st.vars)}</span>
					</div>

					{#if d.reason}
						<blockquote class="sanc-reason"><span class="sanc-lbl">{tFn('sanc.reason')}</span>« {d.reason} »</blockquote>
					{:else if d.source === 'octoguard'}
						<p class="sanc-muted sanc-small">{tFn('sanc.no_reason_octoguard')}</p>
					{/if}

					{#if d.appeal}
						<div class="sanc-appeal sanc-appeal--{d.appeal.status}">
							<p class="sanc-appeal-t">
								{#if d.appeal.status === 'open'}{tFn('sanc.ap_open', { at: fmt(d.appeal.created_at) })}
								{:else}{tFn(d.appeal.status === 'overturned' ? 'sanc.ap_overturned' : 'sanc.ap_upheld', { at: fmt(d.appeal.handled_at ?? d.appeal.created_at) })}{/if}
							</p>
							{#if d.appeal.status === 'open' && d.type === 'mute' && d.active}<p class="sanc-small sanc-muted">{tFn('sanc.ap_mute_stays')}</p>{/if}
							{#if d.appeal.reply}<blockquote class="sanc-reply"><span class="sanc-lbl">{tFn('sanc.ap_reply')}</span>« {d.appeal.reply} »</blockquote>{/if}
							{#if sentId === d.id}<p class="sanc-ok" role="status">{tFn('sanc.sent')}</p>{/if}
						</div>
					{:else if d.contestable}
						{#if openId === d.id}
							<form class="sanc-form" onsubmit={(e) => { e.preventDefault(); send(d) }}>
								<label class="sanc-lbl2" for="sanc-text-{d.id}">{tFn('sanc.form_label')}</label>
								<textarea id="sanc-text-{d.id}" class="sanc-text" rows="4" maxlength={MAX} bind:value={text} placeholder={tFn('sanc.form_ph')} aria-describedby="sanc-help-{d.id}"></textarea>
								<div class="sanc-row">
									<span id="sanc-help-{d.id}" class="sanc-small sanc-muted">{left > 0 ? tFn('sanc.form_min', { n: left }) : tFn('sanc.form_count', { n: text.length, max: MAX })}</span>
								</div>
								<details class="sanc-ex">
									<summary>{tFn('sanc.ex_title')}</summary>
									<p class="sanc-ex-h">{tFn('sanc.ex_good_t')}</p>
									<ul>
										<li>{tFn('sanc.ex_good1')}</li>
										<li>{tFn('sanc.ex_good2')}</li>
										<li>{tFn('sanc.ex_good3')}</li>
									</ul>
									<p class="sanc-ex-h">{tFn('sanc.ex_bad_t')}</p>
									<p class="sanc-small">{tFn('sanc.ex_bad')}</p>
								</details>
								{#if error}<p class="sanc-error" role="alert">{error}</p>{/if}
								<div class="sanc-actions">
									<button type="button" class="sanc-btn" disabled={busy} onclick={() => (openId = null)}>{tFn('sanc.cancel')}</button>
									<button type="submit" class="sanc-btn sanc-btn--primary" disabled={busy || left > 0}>{tFn('sanc.send')}</button>
								</div>
								<p class="sanc-small sanc-muted">{tFn('sanc.form_once')}</p>
							</form>
						{:else}
							<div class="sanc-actions sanc-actions--start">
								<button type="button" class="sanc-btn" onclick={() => open(d.id)}>{tFn('sanc.contest')}</button>
								<span class="sanc-small sanc-muted">{tFn('sanc.contest_who')}</span>
							</div>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	/* Sous /settings, le gabarit ne pose aucune marge : la page pose la sienne (16 px au téléphone) */
	.sanc { flex: 1 0 auto; width: 100%; max-width: 46rem; margin: 0 auto; padding: 2rem 1rem 3rem; box-sizing: border-box; display: flex; flex-direction: column; gap: 1.25rem; color: var(--nx-text); }
	.sanc-back { font-size: 0.8rem; color: var(--nx-text-muted); text-decoration: none; }
	.sanc-back:hover { color: var(--nx-text); }
	.sanc-title { font-size: 1.5rem; font-weight: 700; margin: 0.25rem 0 0.35rem; }
	.sanc-desc { margin: 0; color: var(--nx-text-muted); font-size: 0.9rem; line-height: 1.5; }
	.sanc-h2 { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--nx-text-muted); margin: 0 0 0.6rem; }
	.sanc-how { border: 1px solid var(--nx-border); border-radius: 0.75rem; padding: 1rem 1.1rem; background: color-mix(in srgb, var(--nx-surface) 60%, transparent); }
	.sanc-steps { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.55rem; }
	.sanc-steps li { display: flex; gap: 0.6rem; align-items: flex-start; font-size: 0.875rem; line-height: 1.45; }
	.sanc-n { flex: 0 0 1.4rem; height: 1.4rem; border-radius: 999px; display: grid; place-items: center; font-size: 0.75rem; font-weight: 700; background: color-mix(in srgb, var(--nx-header-accent) 18%, transparent); color: var(--nx-header-accent); }
	.sanc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.75rem; }
	.sanc-card { border: 1px solid var(--nx-border); border-radius: 0.75rem; padding: 1rem 1.1rem; background: var(--nx-surface); display: flex; flex-direction: column; gap: 0.75rem; scroll-margin: 6rem; }
	.sanc-focus { border-color: var(--nx-header-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--nx-header-accent) 20%, transparent); }
	.sanc-top { display: flex; gap: 0.75rem; align-items: flex-start; }
	.sanc-ico { flex: 0 0 2.25rem; height: 2.25rem; border-radius: 0.6rem; display: grid; place-items: center; }
	.sanc-ico svg { width: 1.15rem; height: 1.15rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.sanc-ico--warn { background: color-mix(in srgb, var(--nx-warn) 16%, transparent); color: var(--nx-warn); }
	.sanc-ico--mute { background: color-mix(in srgb, var(--nx-bad) 14%, transparent); color: var(--nx-bad); }
	.sanc-main { flex: 1; min-width: 0; }
	.sanc-what { margin: 0; font-weight: 600; }
	.sanc-meta { margin: 0.15rem 0 0; font-size: 0.8rem; color: var(--nx-text-muted); }
	.sanc-ladder { white-space: nowrap; }
	.sanc-pill { flex: 0 0 auto; font-size: 0.72rem; font-weight: 600; padding: 0.2rem 0.55rem; border-radius: 999px; border: 1px solid currentColor; white-space: nowrap; }
	.sanc-pill--warn { color: var(--nx-warn); }
	.sanc-pill--bad { color: var(--nx-bad); }
	.sanc-pill--ok { color: var(--nx-ok); }
	.sanc-pill--muted { color: var(--nx-text-muted); }
	.sanc-lbl { display: block; font-size: 0.7rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--nx-text-muted); margin-bottom: 0.2rem; font-style: normal; }
	.sanc-reason, .sanc-reply { margin: 0; padding: 0.55rem 0.75rem; border-left: 3px solid var(--nx-border); background: color-mix(in srgb, var(--nx-text) 4%, transparent); border-radius: 0 0.4rem 0.4rem 0; font-size: 0.875rem; }
	.sanc-appeal { border-radius: 0.6rem; padding: 0.7rem 0.85rem; display: flex; flex-direction: column; gap: 0.45rem; border: 1px solid var(--nx-border); }
	.sanc-appeal--open { border-color: color-mix(in srgb, var(--nx-info) 45%, transparent); background: color-mix(in srgb, var(--nx-info) 8%, transparent); }
	.sanc-appeal--overturned { border-color: color-mix(in srgb, var(--nx-ok) 45%, transparent); background: color-mix(in srgb, var(--nx-ok) 8%, transparent); }
	.sanc-appeal--upheld { background: color-mix(in srgb, var(--nx-text) 4%, transparent); }
	.sanc-appeal-t { margin: 0; font-size: 0.875rem; font-weight: 600; }
	.sanc-form { display: flex; flex-direction: column; gap: 0.5rem; border-top: 1px solid var(--nx-border); padding-top: 0.75rem; }
	.sanc-lbl2 { font-size: 0.85rem; font-weight: 600; }
	.sanc-text { width: 100%; box-sizing: border-box; resize: vertical; min-height: 6rem; border-radius: 0.5rem; border: 1px solid var(--nx-border); background: var(--nx-surface-raised); color: var(--nx-text); padding: 0.6rem 0.7rem; font: inherit; font-size: 0.9rem; }
	.sanc-text:focus { outline: 2px solid color-mix(in srgb, var(--nx-header-accent) 55%, transparent); outline-offset: 1px; }
	.sanc-ex { font-size: 0.85rem; border: 1px dashed var(--nx-border); border-radius: 0.5rem; padding: 0.5rem 0.75rem; }
	.sanc-ex summary { cursor: pointer; font-weight: 600; color: var(--nx-header-accent); }
	.sanc-ex ul { margin: 0.25rem 0 0.5rem; padding-left: 1.1rem; display: grid; gap: 0.25rem; }
	.sanc-ex-h { margin: 0.6rem 0 0.1rem; font-size: 0.75rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--nx-text-muted); }
	.sanc-actions { display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap; align-items: center; }
	.sanc-actions--start { justify-content: flex-start; gap: 0.75rem; }
	.sanc-btn { font: inherit; font-size: 0.85rem; font-weight: 600; padding: 0.45rem 0.9rem; border-radius: 0.5rem; border: 1px solid var(--nx-border); background: var(--nx-surface-raised); color: var(--nx-text); cursor: pointer; }
	.sanc-btn:hover:not(:disabled) { border-color: var(--nx-text-muted); }
	.sanc-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.sanc-btn--primary { background: var(--nx-header-accent); border-color: var(--nx-header-accent); color: #fff; }
	.sanc-small { font-size: 0.78rem; margin: 0; }
	.sanc-muted { color: var(--nx-text-muted); }
	.sanc-ok { margin: 0; font-size: 0.85rem; color: var(--nx-ok); }
	.sanc-error { margin: 0; font-size: 0.85rem; color: var(--nx-bad); }
	.sanc-empty { border: 1px solid var(--nx-border); border-radius: 0.75rem; padding: 2rem 1rem; text-align: center; }
	.sanc-empty-t { margin: 0 0 0.25rem; font-weight: 600; }
	.sanc-empty .sanc-muted { margin: 0; font-size: 0.875rem; }
	/* Bulle d'aide : au survol ET au focus clavier, jamais coupée */
	.sanc-tipwrap { position: relative; display: inline-block; }
	.sanc-info { width: 1rem; height: 1rem; border-radius: 999px; border: 1px solid var(--nx-text-muted); background: none; color: var(--nx-text-muted); font-size: 0.65rem; line-height: 1; cursor: help; padding: 0; margin-left: 0.15rem; vertical-align: 1px; }
	.sanc-tip { position: absolute; left: 50%; bottom: calc(100% + 6px); transform: translateX(-50%); width: max-content; max-width: min(16rem, 70vw); white-space: normal; background: var(--nx-surface-raised); color: var(--nx-text); border: 1px solid var(--nx-border); border-radius: 0.5rem; padding: 0.5rem 0.65rem; font-size: 0.78rem; line-height: 1.4; box-shadow: 0 8px 24px rgb(0 0 0 / 0.25); opacity: 0; pointer-events: none; transition: opacity 0.12s; z-index: 5; }
	.sanc-tipwrap:hover .sanc-tip, .sanc-info:focus-visible + .sanc-tip { opacity: 1; }
	@media (max-width: 520px) {
		.sanc-top { flex-wrap: wrap; }
		/* La pastille passe sous le titre au lieu de l'écraser mot à mot */
		.sanc-main { flex-basis: calc(100% - 3rem); }
		.sanc-pill { order: 3; margin-left: 3rem; white-space: normal; }
	}
</style>
