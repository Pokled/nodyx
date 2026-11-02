<script lang="ts">
	import { enhance } from '$app/forms'
	import { page } from '$app/state'
	import type { PageData, ActionData } from './$types'
	import { t, locale } from '$lib/i18n'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	// La file : un DOSSIER par contenu signalé (plusieurs membres peuvent avoir
	// signalé le même message), le plus ancien en tête : on traite dans l'ordre
	// d'arrivée, rien ne doit dormir au fond.
	type Report = {
		id: string; target_type: string; target_id: string; category: string | null; reason: string
		status: string; created_at: string; reporter_username: string | null
		target_author_id: string | null; target_author_username: string | null; target_author_role: string | null
		snapshot: string | null; target_label: string | null; target_link: string | null
		claimed_by_username: string | null; reviewed_by_username: string | null
		reviewed_at: string | null; resolution: string | null
	}
	type Case = { key: string; first: Report; reports: Report[]; categories: Record<string, number> }

	const cases = $derived.by((): Case[] => {
		const map = new Map<string, Case>()
		for (const r of data.reports as Report[]) {
			const key = `${r.target_type}:${r.target_id}`
			let c = map.get(key)
			if (!c) { c = { key, first: r, reports: [], categories: {} }; map.set(key, c) }
			c.reports.push(r)
			const cat = r.category ?? 'other'
			c.categories[cat] = (c.categories[cat] ?? 0) + 1
			if (r.created_at < c.first.created_at) c.first = { ...r, snapshot: c.first.snapshot ?? r.snapshot }
		}
		const list = [...map.values()]
		return data.status === 'open'
			? list.sort((a, b) => a.first.created_at.localeCompare(b.first.created_at))
			: list.sort((a, b) => (b.first.reviewed_at ?? '').localeCompare(a.first.reviewed_at ?? ''))
	})

	const STATUSES = ['open', 'actioned', 'dismissed', 'reviewed'] as const

	const access = $derived((page.data as any).access as { role: string | null; permissions: string[] } | undefined)
	const canDeleteContent = $derived(!!access?.permissions.includes('moderate_content'))

	const TYPE_ICON: Record<string, string> = {
		post: 'M8 10h8M8 14h5M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
		thread: 'M4 6h16M4 12h16M4 18h10',
		message: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.9 9.9 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
		user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
	}

	function ago(iso: string) {
		const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
		if (m < 1) return tFn('areports.just_now')
		if (m < 60) return tFn('areports.ago_min', { n: m })
		const h = Math.floor(m / 60)
		if (h < 24) return tFn('areports.ago_h', { n: h })
		return new Date(iso).toLocaleDateString($locale, { day: '2-digit', month: 'short' })
	}

	const errorText = $derived((form as any)?.errorKey ? tFn((form as any).errorKey) : null)
	let notes = $state<Record<string, string>>({})

	// Un seul formulaire de clôture, trois boutons : seul « Supprimer et clore »
	// demande la suppression du contenu (champ caché remis à 0 par les autres).
	function setDelete(e: MouseEvent, on: boolean) {
		const f = (e.currentTarget as HTMLButtonElement).form
		const h = f?.querySelector<HTMLInputElement>('input[name=delete_content]')
		if (h) h.value = on ? '1' : '0'
	}
</script>

<svelte:head><title>{tFn('areports.page_title')}</title></svelte:head>

<div class="adm-page">
	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('areports.title')}</h1>
			<p class="adm-desc">{tFn('areports.desc')}</p>
		</div>
	</header>

	<nav class="adm-chips" aria-label={tFn('areports.title')}>
		{#each STATUSES as s (s)}
			<a class="adm-chip" aria-current={data.status === s ? 'page' : undefined}
				href={s === 'open' ? '/admin/reports' : `/admin/reports?status=${s}`}>
				{tFn(`areports.tab_${s}`)} <span class="adm-chip-count">{(data.counts as Record<string, number>)[s] ?? 0}</span>
			</a>
		{/each}
	</nav>

	{#if errorText}
		<div class="adm-notice adm-notice--bad" role="alert">{errorText}</div>
	{/if}

	{#if cases.length === 0}
		<div class="adm-card adm-empty">
			{data.status === 'open' ? tFn('areports.empty_open') : tFn('areports.empty_other')}
		</div>
	{/if}

	{#each cases as c (c.key)}
		{@const r = c.first}
		<article class="adm-card adm-case">
			<div class="adm-case-head">
				<div class="adm-case-title">
					<span class="adm-case-type" aria-hidden="true">
						<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d={TYPE_ICON[r.target_type] ?? TYPE_ICON.post}/></svg>
					</span>
					<div class="min-w-0">
						<div class="adm-case-label">
							{tFn(`areports.type_${r.target_type}`)}
							{#if r.target_author_username}
								· <a href="/admin/members/{r.target_author_id}" class="hover:underline" title={tFn('amem.open_file')}>{r.target_author_username}</a>
							{/if}
							{#if r.target_author_role && r.target_author_role !== 'member'}
								<span class="adm-pill adm-pill--{r.target_author_role}">{tFn(`amem.role_${r.target_author_role}`)}</span>
							{/if}
						</div>
						<div class="adm-case-meta">
							{r.target_label ?? ''}
							· {c.reports.length > 1 ? tFn('areports.count_many', { n: c.reports.length }) : tFn('areports.count_one')}
							· {ago(r.created_at)}
						</div>
					</div>
				</div>
				<div class="flex flex-wrap gap-1">
					{#each Object.entries(c.categories) as [cat, n] (cat)}
						<span class="adm-pill {cat === 'illegal' || cat === 'hate' ? 'adm-pill--admin' : cat === 'harassment' ? 'adm-pill--owner' : 'adm-pill--member'}">
							{tFn(`report.cat_${cat}`)}{n > 1 ? ` ×${n}` : ''}
						</span>
					{/each}
				</div>
			</div>

			{#if r.snapshot}
				<figure class="m-0 flex flex-col gap-1">
					<figcaption class="adm-label">{tFn('areports.snapshot')}</figcaption>
					<blockquote class="adm-quote">{r.snapshot}</blockquote>
				</figure>
			{/if}

			<div>
				<h3 class="adm-label mb-1.5">{tFn('areports.reporters')}</h3>
				<ul class="adm-reporters">
					{#each c.reports as rep (rep.id)}
						<li>
							<strong>{rep.reporter_username ?? tFn('areports.deleted_account')}</strong>
							<span class="adm-muted">{tFn(`report.cat_${rep.category ?? 'other'}`)} · {ago(rep.created_at)}</span>
							{#if rep.reason}<span class="adm-reason">« {rep.reason} »</span>{/if}
						</li>
					{/each}
				</ul>
			</div>

			{#if data.status === 'open'}
				<div class="adm-case-actions">
					{#if r.target_link}
						<a class="adm-btn adm-btn--sm" href={r.target_link} target="_blank" rel="noopener">
							<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M10 14L20 4M20 14v6H4V4h6"/></svg>
							{tFn('areports.open_content')}
						</a>
					{/if}
					{#if r.claimed_by_username}
						<span class="adm-claim">
							<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>
							{tFn('areports.claimed_by', { name: r.claimed_by_username })}
						</span>
					{:else}
						<form method="POST" action="?/claim" use:enhance>
							<input type="hidden" name="id" value={r.id} />
							<button type="submit" class="adm-btn adm-btn--sm">{tFn('areports.claim')}</button>
						</form>
					{/if}
				</div>

				<form method="POST" action="?/resolve" use:enhance class="adm-case-actions">
					<input type="hidden" name="id" value={r.id} />
					<input class="adm-input" name="resolution" maxlength="1000" bind:value={notes[c.key]}
						placeholder={tFn('areports.note_ph')} aria-label={tFn('areports.note_ph')} />
					{#if canDeleteContent && r.target_type !== 'user'}
						<button type="submit" name="status" value="actioned" class="adm-btn adm-btn--sm adm-btn--danger"
							onclick={(e) => {
								if (!confirm(tFn('areports.confirm_delete'))) { e.preventDefault(); return }
								setDelete(e, true)
							}}>
							{tFn('areports.delete_and_close')}
						</button>
					{/if}
					<input type="hidden" name="delete_content" value="0" />
					<button type="submit" name="status" value="actioned" class="adm-btn adm-btn--sm"
						onclick={(e) => setDelete(e, false)} title={tFn('areports.actioned_hint')}>{tFn('areports.actioned')}</button>
					<button type="submit" name="status" value="dismissed" class="adm-btn adm-btn--sm" onclick={(e) => setDelete(e, false)}>{tFn('areports.dismiss')}</button>
				</form>
			{:else}
				<p class="adm-case-meta">
					{tFn(`areports.tab_${data.status}`)}
					{#if r.reviewed_by_username}· {tFn('areports.by', { name: r.reviewed_by_username })}{/if}
					{#if r.reviewed_at}· {ago(r.reviewed_at)}{/if}
					{#if r.resolution}· « {r.resolution} »{/if}
				</p>
			{/if}
		</article>
	{/each}

	<p class="adm-hint">{tFn('areports.footer')}</p>
</div>
