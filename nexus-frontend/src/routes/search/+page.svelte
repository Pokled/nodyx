<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const q       = $derived(data.q);
	const threads = $derived(data.threads);
	const posts   = $derived(data.posts);

	let activeTab = $state<'threads' | 'posts'>('threads');
	let query     = $state('');
	$effect(() => { query = data.q ?? ''; });

	function formatDate(iso: string) {
		return new Date(iso).toLocaleDateString('fr-FR', {
			day: '2-digit', month: 'short', year: 'numeric'
		});
	}
</script>

<svelte:head>
	<title>{q ? `Recherche : ${q}` : 'Recherche'} — Nexus</title>
</svelte:head>

<div class="max-w-3xl">
	<h1 class="text-2xl font-bold text-white mb-6">Recherche</h1>

	<!-- Search bar -->
	<form method="GET" class="mb-6 flex gap-2">
		<input
			name="q"
			type="search"
			bind:value={query}
			placeholder="Rechercher..."
			class="flex-1 rounded-lg bg-gray-800 border border-gray-700 px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
		/>
		<button type="submit"
			class="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-5 py-2.5 text-sm font-semibold text-white transition-colors">
			Rechercher
		</button>
	</form>

	{#if q}
		<!-- Tabs -->
		<div class="flex gap-1 mb-4 border-b border-gray-800">
			<button
				onclick={() => activeTab = 'threads'}
				class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
				{activeTab === 'threads' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}"
			>
				Sujets ({threads.length})
			</button>
			<button
				onclick={() => activeTab = 'posts'}
				class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px
				{activeTab === 'posts' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}"
			>
				Messages ({posts.length})
			</button>
		</div>

		<!-- Thread results -->
		{#if activeTab === 'threads'}
			{#if threads.length === 0}
				<p class="text-gray-500 text-sm">Aucun sujet trouvé pour « {q} ».</p>
			{:else}
				<div class="space-y-2">
					{#each threads as thread}
						<a href="/forum/{thread.category_id}/{thread.slug ?? thread.id}"
							class="block rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 hover:border-indigo-700 transition-colors">
							<div class="flex items-start justify-between gap-4">
								<div class="flex-1 min-w-0">
									<p class="text-xs text-gray-500 mb-1">{thread.category_name}</p>
									<p class="font-medium text-white">{thread.title}</p>
									{#if thread.headline}
										<p class="mt-1 text-sm text-gray-400 line-clamp-2">
											{@html thread.headline}
										</p>
									{/if}
								</div>
								<div class="text-right shrink-0 text-xs text-gray-500">
									<p>{thread.author_username}</p>
									<p>{formatDate(thread.created_at)}</p>
								</div>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		{/if}

		<!-- Post results -->
		{#if activeTab === 'posts'}
			{#if posts.length === 0}
				<p class="text-gray-500 text-sm">Aucun message trouvé pour « {q} ».</p>
			{:else}
				<div class="space-y-2">
					{#each posts as post}
						<a href="/forum/{post.category_id}/{post.thread_id}#{post.id}"
							class="block rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 hover:border-indigo-700 transition-colors">
							<div class="flex items-start justify-between gap-4">
								<div class="flex-1 min-w-0">
									<p class="text-xs text-gray-500 mb-1">Dans : {post.thread_title}</p>
									{#if post.headline}
										<p class="text-sm text-gray-300">
											{@html post.headline}
										</p>
									{/if}
								</div>
								<div class="text-right shrink-0 text-xs text-gray-500">
									<p>{post.author_username}</p>
									<p>{formatDate(post.created_at)}</p>
								</div>
							</div>
						</a>
					{/each}
				</div>
			{/if}
		{/if}
	{:else}
		<p class="text-gray-500 text-sm">Entrez un terme pour rechercher dans les sujets et messages.</p>
	{/if}
</div>

<style>
	:global(mark) {
		background-color: #eab308;
		color: #111;
		border-radius: 2px;
		padding: 0 2px;
	}
</style>
