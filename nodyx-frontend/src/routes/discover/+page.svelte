<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import { untrack } from 'svelte';

	let { data }: { data: PageData } = $props();

	let query    = $state(untrack(() => data.q ?? ''));
	let type     = $state(untrack(() => data.type ?? 'all'));
	let upcoming = $state(untrack(() => data.upcoming === 'true'));
	let searching = $state(false);

	$effect(() => {
		query    = data.q ?? '';
		type     = data.type ?? 'all';
		upcoming = data.upcoming === 'true';
	});

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString([], {
			day: '2-digit', month: 'short', year: 'numeric'
		});
	}
	function formatTime(iso: string) {
		return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	function threadUrl(r: any): string {
		const base     = r.instance_url.replace(/\/$/, '');
		const category = r.category_slug ?? r.category_id ?? '';
		const thread   = r.thread_slug ?? r.thread_id;
		return category ? `${base}/forum/${category}/${thread}` : `${base}/forum/${thread}`;
	}

	function eventUrl(r: any): string {
		return `${r.instance_url.replace(/\/$/, '')}/calendar/${r.content_id ?? r.thread_id}`;
	}

	function contentUrl(r: any): string {
		return r.content_type === 'event' ? eventUrl(r) : threadUrl(r);
	}

	function instanceDisplayUrl(url: string): string {
		try { return new URL(url).hostname; } catch { return url; }
	}

	async function search(e?: Event) {
		e?.preventDefault();
		searching = true;
		const params = new URLSearchParams();
		if (query)    params.set('q', query);
		if (type !== 'all') params.set('type', type);
		if (upcoming) params.set('upcoming', 'true');
		await goto(`/discover?${params}`, { keepFocus: true });
		searching = false;
	}

	const TABS = [
		{ id: 'all',    label: 'Tout' },
		{ id: 'thread', label: 'Discussions' },
		{ id: 'event',  label: 'Événements' },
	] as const;
</script>

<svelte:head>
	<title>Découvrir le réseau Nodyx</title>
	<meta name="description" content="Recherchez du contenu sur toutes les instances du réseau Nodyx." />
</svelte:head>

<!-- ── En-tête ─────────────────────────────────────────────────────────────── -->
<div class="disc-header">
	<div class="disc-header-top">
		<div class="disc-title-block">
			<h1 class="disc-title">Découvrir le réseau</h1>
			<p class="disc-subtitle">Recherchez du contenu sur toutes les instances Nodyx connectées.</p>
		</div>

		<form onsubmit={search} class="disc-search-form">
			<input
				type="text"
				bind:value={query}
				placeholder="Godot 4, audio Linux, Rust async…"
				class="disc-search-input"
			/>
			<button type="submit" disabled={searching} class="disc-search-btn">
				{#if searching}
					<svg class="disc-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
						<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
						<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
					</svg>
				{:else}
					<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
					</svg>
				{/if}
				Rechercher
			</button>
		</form>
	</div>

	<!-- Tabs -->
	<div class="disc-tabs">
		{#each TABS as tab}
			<a
				href="/discover?{new URLSearchParams({ ...(query ? { q: query } : {}), type: tab.id, ...(upcoming && tab.id === 'event' ? { upcoming: 'true' } : {}) })}"
				class="disc-tab {data.type === tab.id || (tab.id === 'all' && !data.type) ? 'disc-tab--active' : ''}"
			>
				{tab.label}
			</a>
		{/each}

		{#if data.type === 'event'}
			<a
				href="/discover?{new URLSearchParams({ ...(query ? { q: query } : {}), type: 'event', ...(!upcoming ? { upcoming: 'true' } : {}) })}"
				class="disc-tab disc-tab--upcoming {upcoming ? 'disc-tab--upcoming-active' : ''}"
			>
				À venir uniquement
			</a>
		{/if}
	</div>
</div>

<!-- ── Erreur ──────────────────────────────────────────────────────────────── -->
{#if data.error}
	<div class="disc-error">{data.error}</div>
{/if}

<!-- ── Résultats ───────────────────────────────────────────────────────────── -->
<div class="disc-body">
	{#if data.results.length > 0}
		<p class="disc-count">
			{#if data.q}
				<span class="disc-count-num">{data.results.length}</span> résultat{data.results.length > 1 ? 's' : ''} pour <span class="disc-count-query">« {data.q} »</span>
			{:else if data.type === 'event'}
				Événements du réseau
			{:else}
				Derniers threads publiés sur le réseau
			{/if}
		</p>

		<div class="disc-list">
			{#each data.results as result}
				<a
					href={contentUrl(result)}
					target="_blank"
					rel="noopener noreferrer"
					class="disc-row"
				>
					<div class="disc-row-meta">
						<span class="disc-badge disc-badge--instance">
							<svg class="w-2 h-2" fill="currentColor" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3"/></svg>
							{instanceDisplayUrl(result.instance_url)}
						</span>

						{#if result.content_type === 'event'}
							<span class="disc-badge disc-badge--event">Événement</span>
						{/if}

						{#if result.reply_count > 0 && result.content_type !== 'event'}
							<span class="disc-replies">{result.reply_count} réponse{result.reply_count > 1 ? 's' : ''}</span>
						{/if}

						<span class="disc-date">
							{#if result.content_type === 'event' && result.starts_at}
								{formatDate(result.starts_at)}{#if !result.is_all_day} à {formatTime(result.starts_at)}{/if}
							{:else}
								{formatDate(result.updated_at)}
							{/if}
						</span>
					</div>

					<h2 class="disc-row-title {result.is_cancelled ? 'disc-row-title--cancelled' : ''}">
						{result.title}
					</h2>

					{#if result.location}
						<p class="disc-location">
							<svg class="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
							</svg>
							{result.location}
						</p>
					{/if}

					{#if result.excerpt}
						<p class="disc-excerpt">{result.excerpt}</p>
					{/if}

					{#if result.tags?.length > 0}
						<div class="disc-tags">
							{#each result.tags.slice(0, 5) as tag}
								<span class="disc-tag">{tag}</span>
							{/each}
						</div>
					{/if}

					<svg class="disc-arrow" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M9 18l6-6-6-6"/>
					</svg>
				</a>
			{/each}
		</div>

		{#if data.results.length === 20}
			<div class="disc-pagination">
				<a
					href="/discover?{new URLSearchParams({
						...(data.q ? { q: data.q } : {}),
						...(data.type !== 'all' ? { type: data.type } : {}),
						...(data.upcoming ? { upcoming: data.upcoming } : {}),
						page: String(data.page + 1)
					})}"
					class="disc-next-btn"
				>
					Page suivante →
				</a>
			</div>
		{/if}

	{:else if !data.error}
		<div class="disc-empty">
			<div class="disc-empty-icon">
				{data.type === 'event' ? '📅' : '🔭'}
			</div>
			{#if data.q}
				<p class="disc-empty-main">Aucun résultat pour <span class="disc-empty-query">« {data.q} »</span></p>
				<p class="disc-empty-sub">Essayez d'autres mots-clés ou attendez que plus d'instances rejoignent le réseau.</p>
			{:else}
				<p class="disc-empty-main">Aucun contenu indexé pour l'instant.</p>
				<p class="disc-empty-sub">Les instances avec <code class="disc-code">NODYX_GLOBAL_INDEXING=true</code> apparaîtront ici.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
/* ── Layout ────────────────────────────────────────────────────────────────── */
.disc-header {
	position: sticky;
	top: 0;
	z-index: 20;
	background: rgba(9, 9, 15, 0.92);
	backdrop-filter: blur(16px);
	border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	padding: 20px 28px 0;
}

.disc-header-top {
	display: flex;
	align-items: flex-start;
	gap: 20px;
	margin-bottom: 16px;
	flex-wrap: wrap;
}

.disc-title-block {
	flex: 0 0 auto;
}

.disc-title {
	font-size: 1.125rem;
	font-weight: 700;
	color: #fff;
	margin: 0 0 2px;
	letter-spacing: -0.01em;
}

.disc-subtitle {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.35);
	margin: 0;
}

/* ── Search ─────────────────────────────────────────────────────────────────── */
.disc-search-form {
	flex: 1;
	display: flex;
	gap: 8px;
	min-width: 0;
}

.disc-search-input {
	flex: 1;
	min-width: 0;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.08);
	padding: 8px 14px;
	color: #fff;
	font-size: 0.8125rem;
	outline: none;
	transition: border-color 0.15s;
}

.disc-search-input::placeholder {
	color: rgba(255, 255, 255, 0.25);
}

.disc-search-input:focus {
	border-color: rgba(139, 92, 246, 0.5);
}

.disc-search-btn {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 8px 16px;
	background: rgba(139, 92, 246, 0.85);
	border: none;
	color: #fff;
	font-size: 0.8125rem;
	font-weight: 600;
	cursor: pointer;
	transition: background 0.15s;
	white-space: nowrap;
}

.disc-search-btn:hover:not(:disabled) {
	background: rgba(139, 92, 246, 1);
}

.disc-search-btn:disabled {
	opacity: 0.5;
}

.disc-spin {
	animation: spin 0.8s linear infinite;
}

@keyframes spin { to { transform: rotate(360deg); } }

/* ── Tabs ───────────────────────────────────────────────────────────────────── */
.disc-tabs {
	display: flex;
	align-items: center;
	gap: 0;
}

.disc-tab {
	display: inline-block;
	padding: 9px 16px;
	font-size: 0.75rem;
	font-weight: 500;
	color: rgba(255, 255, 255, 0.4);
	text-decoration: none;
	border-bottom: 2px solid transparent;
	transition: color 0.15s, border-color 0.15s;
	white-space: nowrap;
}

.disc-tab:hover {
	color: rgba(255, 255, 255, 0.75);
}

.disc-tab--active {
	color: #a78bfa;
	border-bottom-color: #a78bfa;
}

.disc-tab--upcoming {
	margin-left: 12px;
	color: rgba(255, 255, 255, 0.3);
}

.disc-tab--upcoming-active {
	color: #34d399;
	border-bottom-color: #34d399;
}

/* ── Body ───────────────────────────────────────────────────────────────────── */
.disc-body {
	padding: 20px 28px 40px;
}

.disc-error {
	margin: 16px 28px;
	border-left: 3px solid #f87171;
	background: rgba(239, 68, 68, 0.06);
	padding: 10px 14px;
	color: #fca5a5;
	font-size: 0.8125rem;
}

.disc-count {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.35);
	margin: 0 0 14px;
}

.disc-count-num {
	color: rgba(255, 255, 255, 0.8);
	font-weight: 600;
}

.disc-count-query {
	color: #a78bfa;
}

/* ── Result rows ───────────────────────────────────────────────────────────── */
.disc-list {
	display: flex;
	flex-direction: column;
}

.disc-row {
	position: relative;
	display: flex;
	flex-direction: column;
	gap: 6px;
	padding: 16px 40px 16px 16px;
	border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	text-decoration: none;
	transition: background 0.15s;
}

.disc-row:hover {
	background: rgba(255, 255, 255, 0.025);
}

.disc-row:hover .disc-row-title {
	color: #c4b5fd;
}

.disc-row-meta {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}

.disc-badge {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 2px 7px;
	font-size: 0.6875rem;
	font-weight: 500;
	border: 1px solid;
}

.disc-badge--instance {
	background: rgba(139, 92, 246, 0.1);
	border-color: rgba(139, 92, 246, 0.25);
	color: #c4b5fd;
}

.disc-badge--event {
	background: rgba(16, 185, 129, 0.08);
	border-color: rgba(16, 185, 129, 0.2);
	color: #6ee7b7;
}

.disc-replies {
	font-size: 0.6875rem;
	color: rgba(255, 255, 255, 0.2);
}

.disc-date {
	font-size: 0.6875rem;
	color: rgba(255, 255, 255, 0.2);
	margin-left: auto;
}

.disc-row-title {
	font-size: 0.875rem;
	font-weight: 600;
	color: rgba(255, 255, 255, 0.9);
	line-height: 1.4;
	margin: 0;
	transition: color 0.15s;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.disc-row-title--cancelled {
	text-decoration: line-through;
	opacity: 0.5;
}

.disc-location {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 0.6875rem;
	color: rgba(255, 255, 255, 0.25);
	margin: 0;
}

.disc-excerpt {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.3);
	line-height: 1.5;
	margin: 0;
	display: -webkit-box;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	-webkit-box-orient: vertical;
	overflow: hidden;
}

.disc-tags {
	display: flex;
	flex-wrap: wrap;
	gap: 4px;
}

.disc-tag {
	padding: 2px 7px;
	font-size: 0.6875rem;
	background: rgba(255, 255, 255, 0.04);
	border: 1px solid rgba(255, 255, 255, 0.07);
	color: rgba(255, 255, 255, 0.35);
}

.disc-arrow {
	position: absolute;
	right: 14px;
	top: 50%;
	transform: translateY(-50%);
	width: 16px;
	height: 16px;
	color: rgba(255, 255, 255, 0.15);
}

/* ── Pagination ─────────────────────────────────────────────────────────────── */
.disc-pagination {
	display: flex;
	justify-content: center;
	margin-top: 28px;
}

.disc-next-btn {
	padding: 9px 22px;
	border: 1px solid rgba(255, 255, 255, 0.1);
	background: rgba(255, 255, 255, 0.03);
	color: rgba(255, 255, 255, 0.6);
	font-size: 0.8125rem;
	text-decoration: none;
	transition: background 0.15s, color 0.15s;
}

.disc-next-btn:hover {
	background: rgba(255, 255, 255, 0.06);
	color: #fff;
}

/* ── Empty state ────────────────────────────────────────────────────────────── */
.disc-empty {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	padding: 80px 20px;
	text-align: center;
}

.disc-empty-icon {
	font-size: 2.5rem;
	margin-bottom: 16px;
	opacity: 0.3;
}

.disc-empty-main {
	font-size: 0.875rem;
	color: rgba(255, 255, 255, 0.45);
	margin: 0 0 6px;
}

.disc-empty-query {
	color: rgba(255, 255, 255, 0.75);
}

.disc-empty-sub {
	font-size: 0.75rem;
	color: rgba(255, 255, 255, 0.2);
	margin: 0;
}

.disc-code {
	background: rgba(255, 255, 255, 0.06);
	padding: 1px 5px;
	font-size: 0.7rem;
	color: rgba(255, 255, 255, 0.5);
}
</style>
