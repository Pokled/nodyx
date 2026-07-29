<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData } from './$types'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	let { data }: { data: PageData } = $props()
	const community = $derived(data.community)
	const categories = $derived(data.categories)
	const members = $derived(data.members)
	const isMember = $derived(data.isMember)
	const userRole = $derived(data.userRole)

	const isAdmin = $derived(userRole === 'owner' || userRole === 'admin')
</script>

<svelte:head>
	<title>{community.name} — Nodyx</title>
	<meta name="description" content={community.description ?? tFn('community_page.meta_desc', { name: community.name })} />
	<meta property="og:title" content="{community.name} — Nodyx" />
	<meta property="og:type" content="website" />
</svelte:head>

<!-- Community header -->
<div class="border-b border-gray-800 bg-gray-900/50">
	<div class="max-w-5xl mx-auto px-4 py-6 flex items-start gap-5">
		<!-- Avatar -->
		<div class="shrink-0">
			{#if community.avatar}
				<img src={community.avatar} alt={community.name} class="w-16 h-16 rounded-xl object-cover" />
			{:else}
				<div class="w-16 h-16 rounded-xl bg-indigo-800 flex items-center justify-center text-white text-2xl font-bold select-none">
					{community.name.charAt(0).toUpperCase()}
				</div>
			{/if}
		</div>

		<div class="flex-1 min-w-0">
			<h1 class="text-2xl font-bold text-white">{community.name}</h1>
			{#if community.description}
				<p class="text-gray-400 mt-1">{community.description}</p>
			{/if}
			<p class="text-xs text-gray-600 mt-1">{members.length} membre{members.length > 1 ? 's' : ''}</p>
		</div>

		<!-- Actions -->
		<div class="flex gap-2 shrink-0">
			{#if isAdmin}
				<a
					href="/communities/{community.slug}/admin/grades"
					class="rounded border border-gray-700 hover:border-gray-500 px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors"
				>
					Admin
				</a>
			{/if}

			{#if !isMember}
				<form method="POST" action="?/join" use:enhance>
					<button
						type="submit"
						class="rounded bg-indigo-600 hover:bg-indigo-500 px-4 py-1.5 text-sm font-semibold text-white transition-colors"
					>
						Rejoindre
					</button>
				</form>
			{:else if userRole !== 'owner'}
				<form method="POST" action="?/leave" use:enhance>
					<button
						type="submit"
						class="rounded border border-gray-700 hover:border-red-700 px-4 py-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors"
					>
						Quitter
					</button>
				</form>
			{/if}
		</div>
	</div>
</div>

<!-- Categories -->
<div class="max-w-5xl mx-auto px-4 py-6">
	{#if categories.length === 0}
		<div class="text-center py-12 text-gray-500">
			<p>{tFn('community_page.no_category')}</p>
			{#if isAdmin}
				<p class="text-sm mt-2">
					<a href="/communities/{community.slug}/admin/grades" class="text-indigo-400 hover:text-indigo-300">
						{tFn('community_page.configure')}
					</a>
				</p>
			{/if}
		</div>
	{:else}
		<div class="space-y-3">
			{#each categories as category}
				<a
					href="/forum/{category.slug ?? category.id}"
					class="flex items-center gap-4 rounded-lg border border-gray-800 bg-gray-900 px-5 py-4 hover:border-indigo-700 hover:bg-gray-800/60 transition-colors group"
				>
					<div class="flex-1 min-w-0">
						<h2 class="text-base font-semibold text-white group-hover:text-indigo-300 transition-colors">
							{category.name}
						</h2>
						{#if category.description}
							<p class="text-sm text-gray-400 mt-0.5">{category.description}</p>
						{/if}
					</div>
					<span class="text-gray-600 text-sm shrink-0">→</span>
				</a>
			{/each}
		</div>
	{/if}
</div>
