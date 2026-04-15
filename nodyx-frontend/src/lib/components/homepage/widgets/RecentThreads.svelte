<script lang="ts">
	import { onMount } from 'svelte'

	interface Thread {
		id:                   string
		title:                string
		category_id:          string
		category_name:        string
		author_username:      string
		author_avatar?:       string
		created_at:           string
		post_count:           number
		last_post_at?:        string
		last_poster_username?: string
		last_poster_avatar?:  string
		views:                number
		is_locked:            boolean
	}

	interface Props {
		config:    Record<string, unknown>
		instance?: Record<string, unknown>
		user?:     Record<string, unknown> | null
		title?:    string
	}

	let { config }: Props = $props()

	const limit       = $derived(Math.min(10, Math.max(1, Number(config.limit ?? 5))))
	const style       = $derived((config.style       as string)  ?? 'list')
	const categoryId  = $derived((config.category_id as string)  ?? '')
	const showAvatar  = $derived((config.show_avatar  as boolean) ?? true)
	const showCat     = $derived((config.show_category as boolean) ?? true)
	const showDate    = $derived((config.show_date    as boolean) ?? true)
	const showReplies = $derived((config.show_replies as boolean) ?? true)
	const heading     = $derived((config.heading      as string)  ?? '')

	let threads = $state<Thread[]>([])
	let loading = $state(true)

	onMount(async () => {
		try {
			const res = await fetch('/api/v1/instance/threads/recent')
			if (res.ok) {
				const { threads: data } = await res.json() as { threads: Thread[] }
				let filtered = data
				if (categoryId) {
					filtered = data.filter(t =>
						t.category_id === categoryId ||
						(t as any).category_slug === categoryId
					)
				}
				threads = filtered.slice(0, limit)
			}
		} catch { /* skip */ }
		loading = false
	})

	function timeAgo(dateStr: string): string {
		const diff = Date.now() - new Date(dateStr).getTime()
		const m = Math.floor(diff / 60000)
		if (m < 60)  return `${m}min`
		const h = Math.floor(m / 60)
		if (h < 24)  return `${h}h`
		const d = Math.floor(h / 24)
		if (d < 30)  return `${d}j`
		return `${Math.floor(d / 30)}mois`
	}
</script>

<div class="rt-root">
	{#if heading}
		<div class="rt-heading">
			<span class="rt-heading-line"></span>
			<span class="rt-heading-text">{heading}</span>
			<span class="rt-heading-line rt-heading-line--r"></span>
		</div>
	{/if}

	{#if loading}
		<div class="rt-loading">
			{#each Array(limit) as _}
				<div class="rt-skeleton"></div>
			{/each}
		</div>

	{:else if threads.length === 0}
		<div class="rt-empty">Aucun sujet récent.</div>

	{:else if style === 'cards'}
		<div class="rt-cards">
			{#each threads as t}
				<a class="rt-card" href="/forum/{t.category_id}/{t.id}">
					{#if showCat}
						<span class="rt-card-cat">{t.category_name}</span>
					{/if}
					<p class="rt-card-title">{t.title}</p>
					<div class="rt-card-meta">
						{#if showAvatar}
							<div class="rt-avatar rt-avatar--sm">
								{#if t.author_avatar}
									<img src={t.author_avatar} alt="" />
								{:else}
									<span>{t.author_username.charAt(0).toUpperCase()}</span>
								{/if}
							</div>
						{/if}
						<span class="rt-meta-author">{t.author_username}</span>
						{#if showDate}
							<span class="rt-meta-dot">·</span>
							<span class="rt-meta-date">{timeAgo(t.last_post_at ?? t.created_at)}</span>
						{/if}
						{#if showReplies}
							<span class="rt-meta-dot">·</span>
							<span class="rt-meta-replies">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
								</svg>
								{t.post_count}
							</span>
						{/if}
					</div>
				</a>
			{/each}
		</div>

	{:else}
		<!-- Style liste (défaut) -->
		<div class="rt-list">
			{#each threads as t, i}
				<a class="rt-item" href="/forum/{t.category_id}/{t.id}">
					{#if showAvatar}
						<div class="rt-avatar">
							{#if t.last_poster_avatar ?? t.author_avatar}
								<img src={t.last_poster_avatar ?? t.author_avatar} alt="" />
							{:else}
								<span>{(t.last_poster_username ?? t.author_username).charAt(0).toUpperCase()}</span>
							{/if}
						</div>
					{/if}

					<div class="rt-item-body">
						<p class="rt-item-title" class:rt-item-title--locked={t.is_locked}>
							{#if t.is_locked}
								<svg class="rt-lock" viewBox="0 0 24 24" fill="currentColor">
									<path d="M12 1C9.24 1 7 3.24 7 6v2H5v14h14V8h-2V6c0-2.76-2.24-5-5-5zm0 2c1.65 0 3 1.35 3 3v2H9V6c0-1.65 1.35-3 3-3z"/>
								</svg>
							{/if}
							<span class="rt-item-title-text">{t.title}</span>
						</p>
						<div class="rt-item-meta">
							{#if showCat}
								<span class="rt-cat-badge">{t.category_name}</span>
							{/if}
							{#if showDate}
								<span class="rt-meta-date">{timeAgo(t.last_post_at ?? t.created_at)}</span>
							{/if}
							{#if showReplies && t.post_count > 0}
								<span class="rt-meta-replies">
									<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
										<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
									</svg>
									{t.post_count}
								</span>
							{/if}
						</div>
					</div>
				</a>
				{#if i < threads.length - 1}
					<div class="rt-divider"></div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	.rt-root {
		width: 100%;
		padding: .75rem 0;
		font-family: var(--nfont, Inter, sans-serif);
		color: var(--nt, #e2e8f0);
	}

	/* ── Heading ────────────────────────────────────────────────────────────── */
	.rt-heading {
		display: flex;
		align-items: center;
		gap: .75rem;
		margin-bottom: 1rem;
		padding: 0 1rem;
	}
	.rt-heading-line {
		flex: 1;
		height: 1px;
		background: linear-gradient(to right, rgba(167,139,250,.3), transparent);
	}
	.rt-heading-line--r {
		background: linear-gradient(to left, rgba(167,139,250,.3), transparent);
	}
	.rt-heading-text {
		font-size: 10px;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: .2em;
		color: var(--np, #a78bfa);
		white-space: nowrap;
	}

	/* ── Loading skeletons ──────────────────────────────────────────────────── */
	.rt-loading { display: flex; flex-direction: column; gap: 8px; padding: 0 1rem; }
	.rt-skeleton {
		height: 52px;
		background: linear-gradient(90deg, rgba(255,255,255,.04) 25%, rgba(255,255,255,.07) 50%, rgba(255,255,255,.04) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s infinite;
		border-radius: 4px;
	}
	@keyframes shimmer { to { background-position: -200% 0; } }

	.rt-empty {
		padding: 1.5rem 1rem;
		font-size: 13px;
		color: #4b5563;
		text-align: center;
	}

	/* ── Avatar ─────────────────────────────────────────────────────────────── */
	.rt-avatar {
		width: 36px; height: 36px;
		flex-shrink: 0;
		background: rgba(167,139,250,.15);
		border: 1px solid rgba(167,139,250,.2);
		border-radius: 4px;
		overflow: hidden;
		display: flex; align-items: center; justify-content: center;
	}
	.rt-avatar--sm { width: 20px; height: 20px; border-radius: 2px; }
	.rt-avatar img  { width: 100%; height: 100%; object-fit: cover; }
	.rt-avatar span { font-size: 13px; font-weight: 700; color: #a78bfa; }
	.rt-avatar--sm span { font-size: 9px; }

	/* ── LIST style ─────────────────────────────────────────────────────────── */
	.rt-list { display: flex; flex-direction: column; }

	.rt-item {
		display: flex;
		align-items: center;
		gap: .75rem;
		padding: .6rem 1rem;
		text-decoration: none;
		transition: background .15s;
	}
	.rt-item:hover { background: rgba(167,139,250,.05); }

	.rt-item-body { flex: 1; min-width: 0; }

	.rt-item-title {
		font-size: 13px;
		font-weight: 500;
		color: var(--nt, #e2e8f0);
		line-height: 1.35;
		display: flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		transition: color .15s;
		margin: 0;
	}
	.rt-item-title-text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rt-item:hover .rt-item-title { color: #c4b5fd; }
	.rt-item-title--locked { color: #6b7280 !important; }

	.rt-lock { width: 11px; height: 11px; flex-shrink: 0; color: #4b5563; }

	.rt-item-meta {
		display: flex;
		align-items: center;
		gap: .4rem;
		margin-top: 3px;
	}

	.rt-cat-badge {
		font-size: 10px;
		font-weight: 600;
		color: var(--np, #a78bfa);
		background: rgba(167,139,250,.1);
		border: 1px solid rgba(167,139,250,.18);
		padding: 0 5px;
		border-radius: 2px;
		white-space: nowrap;
	}
	.rt-meta-date { font-size: 11px; color: #4b5563; }
	.rt-meta-dot  { font-size: 11px; color: #374151; }
	.rt-meta-replies {
		display: flex; align-items: center; gap: 3px;
		font-size: 11px; color: #4b5563;
	}
	.rt-meta-replies svg { width: 11px; height: 11px; }

	.rt-divider {
		height: 1px;
		background: rgba(255,255,255,.04);
		margin: 0 1rem;
	}

	/* ── CARDS style ────────────────────────────────────────────────────────── */
	.rt-cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: .75rem;
		padding: 0 1rem;
	}

	.rt-card {
		display: flex;
		flex-direction: column;
		gap: .4rem;
		padding: .875rem;
		background: var(--nc, rgba(167,139,250,.04));
		border: 1px solid var(--nborder, rgba(167,139,250,.1));
		border-radius: var(--nr, 6px);
		text-decoration: none;
		transition: border-color .15s, background .15s;
	}
	.rt-card:hover {
		border-color: rgba(167,139,250,.35);
		background: rgba(167,139,250,.07);
	}

	.rt-card-cat {
		font-size: 10px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: .12em;
		color: var(--np, #a78bfa);
	}

	.rt-card-title {
		font-size: 12px;
		font-weight: 600;
		color: var(--nt, #e2e8f0);
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin: 0;
		flex: 1;
	}
	.rt-card:hover .rt-card-title { color: #c4b5fd; }

	.rt-card-meta {
		display: flex;
		align-items: center;
		gap: .35rem;
		margin-top: .25rem;
	}
	.rt-meta-author { font-size: 11px; color: #6b7280; }

	/* ── Responsive ─────────────────────────────────────────────────────────── */
	@media (max-width: 639px) {
		.rt-cards { grid-template-columns: 1fr 1fr; }
	}
</style>
