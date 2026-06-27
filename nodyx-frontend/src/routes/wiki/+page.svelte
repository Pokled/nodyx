<script lang="ts">
	import type { PageData } from './$types'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()

	const isAdminOrMod = $derived(
		data.user?.role === 'owner' || data.user?.role === 'admin' || data.user?.role === 'moderator'
	)

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
	}
</script>

<svelte:head>
	<title>Wiki — {data.communityName}</title>
</svelte:head>

<!-- ── Header ──────────────────────────────────────────────────────────────── -->
<div class="wiki-header">
	<div class="wiki-header-row">
		<div class="wiki-title-block">
			<h1 class="wiki-title">Wiki</h1>
			<p class="wiki-subtitle">{tFn('wiki.subtitle')}</p>
		</div>

		<div class="wiki-header-actions">
			<form method="GET" class="wiki-search-form">
				<input
					name="search"
					value={data.search}
					placeholder={tFn('wiki.search_placeholder')}
					class="wiki-search-input"
				/>
				{#if data.activeCategory}
					<input type="hidden" name="category" value={data.activeCategory} />
				{/if}
				<button type="submit" class="wiki-search-btn" aria-label={tFn('wiki.search_aria')}>
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
					</svg>
				</button>
			</form>
			{#if isAdminOrMod}
				<a href="/wiki/new" class="wiki-new-btn">
					<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
					</svg>
					{tFn('wiki.new_page')}
				</a>
			{/if}
		</div>
	</div>

	<!-- Category tabs -->
	{#if data.categories.length > 0}
		<div class="wiki-cats">
			<a
				href="/wiki"
				class="wiki-cat {!data.activeCategory ? 'wiki-cat--active' : ''}"
			>
				{tFn('wiki.all_categories')}
			</a>
			{#each data.categories as cat}
				<a
					href="/wiki?category={encodeURIComponent(cat)}"
					class="wiki-cat {data.activeCategory === cat ? 'wiki-cat--active' : ''}"
				>
					{cat}
				</a>
			{/each}
		</div>
	{/if}
</div>

<!-- ── Content ──────────────────────────────────────────────────────────────── -->
<div class="wiki-body">
	{#if data.pages.length === 0}
		<div class="wiki-empty">
			<div class="wiki-empty-icon">📖</div>
			<p class="wiki-empty-main">
				{data.search
					? `${tFn('wiki.no_match')} « ${data.search} »`
					: tFn('wiki.empty')}
			</p>
			{#if isAdminOrMod}
				<a href="/wiki/new" class="wiki-empty-link">{tFn('wiki.create_first')} →</a>
			{/if}
		</div>
	{:else}
		<div class="wiki-grid">
			{#each data.pages as pg (pg.id)}
				<a href="/wiki/{pg.slug}" class="wiki-card">
					{#if pg.category}
						<span class="wiki-card-cat">{pg.category}</span>
					{/if}

					<h2 class="wiki-card-title">{pg.title}</h2>

					{#if pg.excerpt}
						<p class="wiki-card-excerpt">{pg.excerpt}</p>
					{/if}

					<div class="wiki-card-meta">
						<div class="wiki-card-author">
							{#if pg.author_avatar}
								<img src={pg.author_avatar} alt="" class="wiki-card-avatar" />
							{:else}
								<div class="wiki-card-avatar-placeholder">
									{(pg.author_username ?? '?')[0].toUpperCase()}
								</div>
							{/if}
							<span>{pg.author_username ?? tFn('common.unknown')}</span>
						</div>
						<div class="wiki-card-right">
							<span>{formatDate(pg.updated_at)}</span>
							<span class="wiki-card-views">
								<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
								</svg>
								{pg.views}
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>
	{/if}
</div>

<style>
/* ── Header ─────────────────────────────────────────────────────────────────── */
.wiki-header {
	position: sticky;
	top: 0;
	z-index: 20;
	background: rgba(9, 9, 15, 0.92);
	backdrop-filter: blur(16px);
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	padding: 20px 28px 0;
}

.wiki-header-row {
	display: flex;
	align-items: center;
	gap: 16px;
	margin-bottom: 16px;
	flex-wrap: wrap;
}

.wiki-title-block {
	flex: 0 0 auto;
}

.wiki-title {
	font-size: 1.125rem;
	font-weight: 700;
	color: #fff;
	margin: 0 0 2px;
	letter-spacing: -0.01em;
}

.wiki-subtitle {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.35);
	margin: 0;
}

.wiki-header-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	margin-left: auto;
}

/* ── Search ─────────────────────────────────────────────────────────────────── */
.wiki-search-form {
	display: flex;
	gap: 0;
}

.wiki-search-input {
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.08);
	border-right: none;
	padding: 7px 14px;
	color: #fff;
	font-size: 0.8125rem;
	outline: none;
	width: 220px;
	transition: border-color 0.15s;
}

.wiki-search-input::placeholder {
	color: rgba(255, 255, 255, 0.25);
}

.wiki-search-input:focus {
	border-color: rgba(139, 92, 246, 0.5);
}

.wiki-search-btn {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 7px 12px;
	background: rgba(255, 255, 255, 0.06);
	border: 1px solid rgba(255, 255, 255, 0.08);
	color: rgba(255, 255, 255, 0.5);
	cursor: pointer;
	transition: background 0.15s, color 0.15s;
}

.wiki-search-btn:hover {
	background: rgba(255, 255, 255, 0.1);
	color: #fff;
}

.wiki-new-btn {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 7px 14px;
	background: rgba(139, 92, 246, 0.85);
	border: none;
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	text-decoration: none;
	transition: background 0.15s;
	white-space: nowrap;
}

.wiki-new-btn:hover {
	background: rgb(139, 92, 246);
}

/* ── Category tabs ──────────────────────────────────────────────────────────── */
.wiki-cats {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 0;
}

.wiki-cat {
	display: inline-block;
	padding: 8px 14px;
	font-size: 0.75rem;
	font-weight: 500;
	color: rgba(255, 255, 255, 0.35);
	text-decoration: none;
	border-bottom: 2px solid transparent;
	transition: color 0.15s, border-color 0.15s;
	white-space: nowrap;
}

.wiki-cat:hover {
	color: rgba(255, 255, 255, 0.7);
}

.wiki-cat--active {
	color: var(--nx-accent-2-soft);
	border-bottom-color: var(--nx-accent-2-soft);
}

/* ── Body ───────────────────────────────────────────────────────────────────── */
.wiki-body {
	padding: 24px 28px 48px;
}

/* ── Grid ───────────────────────────────────────────────────────────────────── */
.wiki-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
	gap: 1px;
	background: rgba(255, 255, 255, 0.05);
	border: 1px solid rgba(255, 255, 255, 0.05);
}

.wiki-card {
	display: block;
	background: rgba(9, 9, 15, 1);
	padding: 18px 20px;
	text-decoration: none;
	transition: background 0.15s;
	position: relative;
}

.wiki-card:hover {
	background: rgba(255, 255, 255, 0.025);
}

.wiki-card:hover .wiki-card-title {
	color: var(--nx-accent-2-soft2);
}

.wiki-card-cat {
	display: block;
	font-size: 0.625rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.08em;
	color: rgba(251, 191, 36, 0.7);
	margin-bottom: 8px;
}

.wiki-card-title {
	font-size: 0.875rem;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.9);
	margin: 0 0 8px;
	line-height: 1.4;
	transition: color 0.15s;
}

.wiki-card-excerpt {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.3);
	line-height: 1.5;
	margin: 0 0 14px;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.wiki-card-meta {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	font-size: 0.6875rem;
	color: rgba(255, 255, 255, 0.2);
}

.wiki-card-author {
	display: flex;
	align-items: center;
	gap: 6px;
}

.wiki-card-avatar {
	width: 16px;
	height: 16px;
	border-radius: 50%;
	object-fit: cover;
}

.wiki-card-avatar-placeholder {
	width: 16px;
	height: 16px;
	border-radius: 50%;
	background: rgba(255, 255, 255, 0.08);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 0.5rem;
	color: rgba(255, 255, 255, 0.4);
}

.wiki-card-right {
	display: flex;
	align-items: center;
	gap: 10px;
}

.wiki-card-views {
	display: flex;
	align-items: center;
	gap: 3px;
}

/* ── Empty state ────────────────────────────────────────────────────────────── */
.wiki-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 80px 20px;
	text-align: center;
}

.wiki-empty-icon {
	font-size: 2.5rem;
	margin-bottom: 16px;
	opacity: 0.2;
}

.wiki-empty-main {
	font-size: 0.875rem;
	color: rgba(255, 255, 255, 0.35);
	margin: 0 0 12px;
}

.wiki-empty-link {
	font-size: 0.8125rem;
	color: var(--nx-accent-2-soft);
	text-decoration: none;
	transition: color 0.15s;
}

.wiki-empty-link:hover {
	color: var(--nx-accent-2-soft2);
}
</style>
