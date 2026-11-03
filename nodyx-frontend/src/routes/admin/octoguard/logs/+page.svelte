<script lang="ts">
	// Le journal d'OctoGuard : chaque action racontée en phrase, avec « Annuler »
	// quand le moteur sait le faire (avertissement, sourdine), une seule fois.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import { eventOf, KIND_ICON, type OgLog, type EventSource } from '$lib/octoguard/events'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	let logs = $state<OgLog[]>(untrack(() => data.logs as OgLog[]))
	$effect(() => { const l = data.logs as OgLog[]; untrack(() => { logs = l }) })
	let filter = $state<'all' | EventSource>('all')
	const shown = $derived(filter === 'all' ? logs : logs.filter((l) => eventOf(l).source === filter))
	const pages = $derived(Math.max(1, Math.ceil((data.total ?? 0) / (data.limit ?? 50))))

	let busy = $state<string | null>(null)
	let msg = $state<Record<string, { ok: boolean; text: string }>>({})
	async function undo(l: OgLog) {
		busy = l.id
		try {
			await og(token, `/logs/${l.id}/undo`, 'POST')
			logs = logs.map((x) => (x.id === l.id ? { ...x, undone: true } : x))
			msg = { ...msg, [l.id]: { ok: true, text: tFn('og2.undo_done') } }
		} catch (e: any) {
			const key = e?.code === 'ALREADY_UNDONE' ? 'og2.undo_err_already' : e?.code === 'NOTHING_TO_UNDO' ? 'og2.undo_err_nothing' : 'og2.undo_err'
			if (e?.code === 'ALREADY_UNDONE') logs = logs.map((x) => (x.id === l.id ? { ...x, undone: true } : x))
			msg = { ...msg, [l.id]: { ok: false, text: tFn(key) } }
		} finally { busy = null }
	}
	const when = (iso: string) => {
		const d = new Date(iso)
		return isNaN(d.getTime()) ? '' : d.toLocaleString(String($locale ?? 'fr'), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
	}
	const FILTERS: Array<'all' | EventSource> = ['all', 'octoguard', 'team', 'observed']
</script>

<svelte:head><title>{tFn('og2.nav_log')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M9 6h11 M9 12h11 M9 18h11 M4.5 6h.01 M4.5 12h.01 M4.5 18h.01" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_log')}</h1>
				<p class="adm-desc">{tFn('og2.log_desc')}</p>
			</div>
		</div>
		<div class="adm-chips" role="group" aria-label={tFn('og2.log_filters')}>
			{#each FILTERS as f (f)}
				<button type="button" class="adm-chip" aria-pressed={filter === f} onclick={() => (filter = f)}>{tFn(`og2.log_f_${f}`)}</button>
			{/each}
		</div>
	</header>

	<section class="adm-card">
		{#if data.failed}
			<p class="og-error" role="alert">{tFn('og2.err_load')}</p>
		{:else if shown.length === 0}
			<p class="og-empty">{tFn(logs.length ? 'og2.log_none_filter' : 'og2.log_empty')}</p>
		{:else}
			<div class="og-rows">
				{#each shown as l (l.id)}
					{@const ev = eventOf(l)}
					<div class="og-row">
						<span class="og-ic og-k-{ev.kind}"><Icon d={KIND_ICON[ev.kind]} /></span>
						<div class="og-row-body">
							<div>{tFn(`og2.${ev.key}`, { rule: l.metadata?.rule_name ?? '', who: l.actor_username ?? '' })}</div>
							{#if l.target_label}<p class="og-quote">{l.target_label}</p>{/if}
							<div class="og-meta">
								{when(l.created_at)}{#if ev.source === 'team' && l.actor_username} · {l.actor_username}{/if}{#if ev.source === 'observed'} · {tFn('og2.log_observed_note')}{/if}
							</div>
							{#if msg[l.id]}<p class={msg[l.id].ok ? 'og-okmsg' : 'og-error'} role="status">{msg[l.id].text}</p>{/if}
						</div>
						{#if l.undone}
							<span class="adm-pill adm-pill--ok">{tFn('og2.undone')}</span>
						{:else if l.metadata?.undoable}
							<button type="button" class="adm-btn adm-btn--sm" disabled={busy === l.id} onclick={() => undo(l)}>
								<Icon d={KIND_ICON.ok} />{tFn('og2.undo')}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if pages > 1}
		<nav class="adm-actions" style="justify-content:space-between" aria-label={tFn('og2.pagination')}>
			<span class="og-help">{tFn('og2.page_of', { p: data.page, n: pages, total: data.total })}</span>
			<span class="adm-actions">
				{#if data.page > 1}<a class="adm-btn adm-btn--sm" href="?page={data.page - 1}">{tFn('og2.prev')}</a>{/if}
				{#if data.page < pages}<a class="adm-btn adm-btn--sm" href="?page={data.page + 1}">{tFn('og2.next')}</a>{/if}
			</span>
		</nav>
	{/if}
</div>
