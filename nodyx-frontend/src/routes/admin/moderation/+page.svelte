<script lang="ts">
	import { enhance } from '$app/forms'
	import { goto } from '$app/navigation'
	import type { PageData, ActionData } from './$types'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props()

	function flatCategories(nodes: any[], depth = 0): any[] {
		return nodes.flatMap(n => [{ ...n, depth }, ...flatCategories(n.children ?? [], depth + 1)])
	}
	const flatCats = $derived(flatCategories(data.categories ?? []))

	function timeAgo(d: string) {
		const diff = Date.now() - new Date(d).getTime()
		const m = Math.floor(diff / 60000)
		const h = Math.floor(m / 60)
		const day = Math.floor(h / 24)
		if (m < 1)  return tFn('amod.just_now')
		if (m < 60) return tFn('amod.ago_min', { n: m })
		if (h < 24) return tFn('amod.ago_h', { n: h })
		return tFn('amod.ago_j', { n: day })
	}

	function pageHref(offset: number) {
		const p = new URLSearchParams()
		if (offset > 0) p.set('offset', String(offset))
		if (data.catFilter) p.set('category_id', data.catFilter)
		const q = p.toString()
		return q ? `?${q}` : '?'
	}

	function onCategory(e: Event) {
		const v = (e.currentTarget as HTMLSelectElement).value
		goto(v ? `?category_id=${encodeURIComponent(v)}` : '?')
	}
</script>

<svelte:head><title>{tFn('amod.page_title')}</title></svelte:head>

<div class="adm-page">
	<header class="adm-head">
		<div>
			<h1 class="adm-title">{tFn('amod.title')}</h1>
			<p class="adm-desc">{data.total > 1 ? tFn('amod.total_many', { n: data.total }) : tFn('amod.total_one', { n: data.total })}</p>
		</div>
		<label class="adm-field" style="min-width:14rem">
			<span class="sr-only">{tFn('amod.col_category')}</span>
			<select class="adm-input" onchange={onCategory}>
				<option value="">{tFn('amod.all_categories')}</option>
				{#each flatCats as c (c.id)}
					<option value={c.id} selected={c.id === data.catFilter}>{'  '.repeat(c.depth * 2)}{c.depth > 0 ? '└ ' : ''}{c.name}</option>
				{/each}
			</select>
		</label>
	</header>

	{#if (form as any)?.error}
		<div class="adm-notice adm-notice--bad" role="alert">{(form as any).error}</div>
	{/if}

	<div class="adm-table-wrap">
		<table class="adm-table">
			<thead>
				<tr>
					<th>{tFn('amod.col_thread')}</th>
					<th>{tFn('amod.col_category')}</th>
					<th class="adm-num">{tFn('amod.col_msgs')}</th>
					<th class="adm-num">{tFn('amod.col_views')}</th>
					<th>{tFn('amod.col_status')}</th>
					<th class="adm-num"><span class="sr-only">{tFn('amod.col_actions')}</span></th>
				</tr>
			</thead>
			<tbody>
				{#each data.threads as thread (thread.id)}
					<tr>
						<td class="adm-cell-main" style="max-width:22rem">
							<div class="min-w-0">
								<a href="/forum/{thread.category_slug ?? thread.category_id}/{thread.slug ?? thread.id}"
									class="font-medium line-clamp-1 hover:underline" style="color:var(--nx-text)">
									{thread.title}
								</a>
								<div class="text-xs adm-muted mt-0.5">
									{tFn('amod.by', { name: thread.author_username })} · {timeAgo(thread.created_at)}
								</div>
							</div>
						</td>
						<td class="adm-muted" data-label={tFn('amod.col_category')}>{thread.category_name}</td>
						<td class="adm-num" data-label={tFn('amod.col_msgs')}>{thread.post_count}</td>
						<td class="adm-num" data-label={tFn('amod.col_views')}>{thread.views}</td>
						<td data-label={tFn('amod.col_status')}>
							<div class="flex flex-wrap gap-1 justify-end md:justify-start">
								{#if thread.is_pinned}<span class="adm-pill adm-pill--owner">{tFn('amod.status_pinned')}</span>{/if}
								{#if thread.is_locked}<span class="adm-pill adm-pill--admin">{tFn('amod.status_locked')}</span>{/if}
								{#if !thread.is_pinned && !thread.is_locked}<span class="adm-muted">·</span>{/if}
							</div>
						</td>
						<td class="adm-num">
							<div class="adm-actions adm-actions--row">
								<form method="POST" action="?/pin" use:enhance>
									<input type="hidden" name="id" value={thread.id} />
									<input type="hidden" name="value" value={String(!thread.is_pinned)} />
									<button type="submit" class="adm-btn adm-btn--icon adm-toggle" style="--tone:var(--nx-warn)"
										aria-pressed={thread.is_pinned}
										aria-label={thread.is_pinned ? tFn('amod.unpin') : tFn('amod.pin')}
										title={thread.is_pinned ? tFn('amod.unpin') : tFn('amod.pin')}>
										<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6z"/></svg>
									</button>
								</form>
								<form method="POST" action="?/lock" use:enhance>
									<input type="hidden" name="id" value={thread.id} />
									<input type="hidden" name="value" value={String(!thread.is_locked)} />
									<button type="submit" class="adm-btn adm-btn--icon adm-toggle" style="--tone:var(--nx-bad)"
										aria-pressed={thread.is_locked}
										aria-label={thread.is_locked ? tFn('amod.unlock') : tFn('amod.lock')}
										title={thread.is_locked ? tFn('amod.unlock') : tFn('amod.lock')}>
										<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>
									</button>
								</form>
								<form method="POST" action="?/delete" use:enhance>
									<input type="hidden" name="id" value={thread.id} />
									<button type="submit" class="adm-btn adm-btn--icon adm-btn--danger"
										aria-label={tFn('amod.delete_title')} title={tFn('amod.delete_title')}
										onclick={(e) => { if (!confirm(tFn('amod.confirm_delete', { title: thread.title }))) e.preventDefault() }}>
										<svg fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 001 1h10a1 1 0 001-1l1-13M9 7V4h6v3"/></svg>
									</button>
								</form>
							</div>
						</td>
					</tr>
				{:else}
					<tr><td colspan="6" class="adm-empty">{tFn('amod.none_found')}</td></tr>
				{/each}
			</tbody>
		</table>
	</div>

	{#if data.total > data.limit}
		<nav class="adm-pager" aria-label={tFn('amod.pager_label')}>
			<span>{tFn('amod.pagination', { from: data.offset + 1, to: Math.min(data.offset + data.limit, data.total), total: data.total })}</span>
			<div class="adm-pager-links">
				{#if data.offset > 0}
					<a class="adm-btn adm-btn--sm" href={pageHref(Math.max(0, data.offset - data.limit))}>{tFn('amod.prev')}</a>
				{/if}
				{#if data.offset + data.limit < data.total}
					<a class="adm-btn adm-btn--sm" href={pageHref(data.offset + data.limit)}>{tFn('amod.next')}</a>
				{/if}
			</div>
		</nav>
	{/if}
</div>
