<script lang="ts">
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()

	const pg = $derived(data.wikiPage)
	const canEdit = $derived(
		data.user?.role === 'admin' ||
		data.user?.role === 'moderator' ||
		data.user?.username === pg?.author_username
	)

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			day: 'numeric', month: 'long', year: 'numeric',
		})
	}

	async function deletePage() {
		if (!confirm(`Supprimer définitivement « ${pg.title} » ?`)) return
		const res = await fetch(`/api/v1/wiki/${pg.slug}`, { method: 'DELETE' })
		if (res.ok) window.location.href = '/wiki'
	}
</script>

<svelte:head>
	<title>{pg?.title ?? 'Wiki'} — {data.communityName}</title>
	<meta name="description" content={pg?.excerpt ?? ''} />
</svelte:head>

<div class="max-w-3xl mx-auto py-8 px-4">

	<!-- Breadcrumb -->
	<div class="flex items-center gap-2 text-sm text-gray-500 mb-6">
		<a href="/wiki" class="hover:text-gray-300 transition-colors">Wiki</a>
		{#if pg?.category}
			<span>/</span>
			<a href="/wiki?category={encodeURIComponent(pg.category)}"
			   class="hover:text-gray-300 transition-colors text-amber-500/70">{pg.category}</a>
		{/if}
		<span>/</span>
		<span class="text-gray-400 truncate">{pg?.title}</span>
	</div>

	<!-- Title + actions -->
	<div class="flex items-start justify-between gap-4 mb-6">
		<h1 class="text-2xl font-bold text-white leading-tight">{pg?.title}</h1>
		{#if canEdit}
			<div class="flex items-center gap-2 shrink-0">
				<a href="/wiki/{pg.slug}/edit"
				   class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-gray-300 text-xs font-medium transition-colors">
					<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
						      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
					</svg>
					Modifier
				</a>
				{#if data.user?.role === 'admin' || data.user?.role === 'moderator'}
					<button onclick={deletePage}
					        class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-red-900/40 text-gray-500 hover:text-red-400 text-xs font-medium transition-colors">
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
							      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
						</svg>
						Supprimer
					</button>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Meta bar -->
	<div class="flex items-center gap-4 text-xs text-gray-500 mb-8 pb-4 border-b border-gray-800">
		<div class="flex items-center gap-1.5">
			{#if pg?.author_avatar}
				<img src={pg.author_avatar} alt="" class="w-5 h-5 rounded-full object-cover" />
			{:else}
				<div class="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">
					{(pg?.author_username ?? '?')[0].toUpperCase()}
				</div>
			{/if}
			<span>{pg?.author_username ?? 'Inconnu'}</span>
		</div>
		<span>Créé le {formatDate(pg?.created_at)}</span>
		{#if pg?.editor_username && pg.editor_username !== pg.author_username}
			<span>· Modifié par {pg.editor_username}</span>
		{/if}
		<span class="flex items-center gap-1">
			<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
				      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
				      d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
			</svg>
			{pg?.views} vue{pg?.views !== 1 ? 's' : ''}
		</span>
		{#if pg?.is_public}
			<span class="px-2 py-0.5 rounded-full bg-green-900/30 text-green-500 border border-green-500/20">
				Public
			</span>
		{/if}
	</div>

	<!-- Content — rendered HTML from NodyxEditor (trusted authors only) -->
	<div class="prose prose-invert prose-sm max-w-none
	            prose-headings:font-bold prose-headings:text-white
	            prose-p:text-gray-300 prose-p:leading-relaxed
	            prose-a:text-violet-400 prose-a:no-underline hover:prose-a:underline
	            prose-code:text-cyan-300 prose-code:bg-gray-800/60 prose-code:px-1 prose-code:rounded
	            prose-pre:bg-gray-900/80 prose-pre:border prose-pre:border-gray-700/60
	            prose-blockquote:border-violet-500/50 prose-blockquote:text-gray-400
	            prose-hr:border-gray-800
	            prose-img:rounded-xl">
		{@html pg?.content ?? ''}
	</div>

	<!-- Back link -->
	<div class="mt-12 pt-6 border-t border-gray-800">
		<a href="/wiki" class="text-sm text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1.5">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
			</svg>
			Retour au wiki
		</a>
	</div>
</div>
