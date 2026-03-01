<script lang="ts">
	import type { PageData } from './$types'
	let { data }: { data: PageData } = $props()
	const s = $derived(data.stats)

	const statCards = $derived([
		{ label: 'Membres',    value: s.users.total,    delta: s.users.new_this_week,    icon: '👥', color: 'indigo' },
		{ label: 'Fils',       value: s.threads.total,  delta: s.threads.new_this_week,  icon: '💬', color: 'violet' },
		{ label: 'Messages',   value: s.posts.total,    delta: s.posts.new_this_week,    icon: '✉️', color: 'blue' },
		{ label: 'En ligne',   value: s.online,         delta: null,                     icon: '🟢', color: 'green' },
	])

	const COLOR: Record<string, string> = {
		indigo: 'bg-indigo-900/40 border-indigo-800/60 text-indigo-400',
		violet: 'bg-violet-900/40 border-violet-800/60 text-violet-400',
		blue:   'bg-blue-900/40 border-blue-800/60 text-blue-400',
		green:  'bg-green-900/40 border-green-800/60 text-green-400',
	}
</script>

<svelte:head><title>Dashboard — Admin Nexus</title></svelte:head>

<div>
	<h1 class="text-2xl font-bold text-white mb-6">Dashboard</h1>

	<!-- Stat cards -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
		{#each statCards as card}
			<div class="rounded-xl border p-5 {COLOR[card.color]}">
				<div class="flex items-start justify-between mb-3">
					<span class="text-xl">{card.icon}</span>
					{#if card.delta !== null}
						<span class="text-xs text-gray-500">+{card.delta} cette semaine</span>
					{/if}
				</div>
				<div class="text-3xl font-bold text-white">{card.value.toLocaleString('fr-FR')}</div>
				<div class="text-sm text-gray-400 mt-1">{card.label}</div>
			</div>
		{/each}
	</div>

	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

		<!-- Activity last 7 days -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
			<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
				Activité — 7 derniers jours
			</h2>
			{#if s.activity_last_7_days.length === 0}
				<p class="text-sm text-gray-600">Aucune activité récente.</p>
			{:else}
				{@const max = Math.max(...s.activity_last_7_days.map((d: any) => d.posts), 1)}
				<div class="flex items-end gap-2 h-24">
					{#each s.activity_last_7_days as day}
						<div class="flex-1 flex flex-col items-center gap-1">
							<div
								class="w-full rounded-t bg-indigo-600/70 hover:bg-indigo-500 transition-colors min-h-[2px]"
								style="height: {Math.max((day.posts / max) * 80, 2)}px"
								title="{day.posts} message{day.posts > 1 ? 's' : ''}"
							></div>
							<span class="text-xs text-gray-600 tabular-nums">
								{new Date(day.day).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Top contributors -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
			<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
				Top contributeurs — 30 jours
			</h2>
			{#if s.top_contributors.length === 0}
				<p class="text-sm text-gray-600">Aucun message ce mois-ci.</p>
			{:else}
				<ol class="space-y-2.5">
					{#each s.top_contributors as c, i}
						<li class="flex items-center gap-3">
							<span class="text-sm font-bold text-gray-600 w-4 tabular-nums">{i + 1}</span>
							<div class="w-7 h-7 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold text-indigo-200 shrink-0">
								{c.username.charAt(0).toUpperCase()}
							</div>
							<a href="/users/{c.username}" class="text-sm text-gray-200 hover:text-white flex-1 font-medium">
								{c.username}
							</a>
							<span class="text-sm text-gray-500 tabular-nums">{c.post_count} msg</span>
						</li>
					{/each}
				</ol>
			{/if}
		</div>

		<!-- Quick stats -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
			<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">État du forum</h2>
			<dl class="space-y-2.5 text-sm">
				<div class="flex justify-between">
					<dt class="text-gray-500">Catégories</dt>
					<dd class="text-white font-medium">{s.categories.total}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="text-gray-500">Fils épinglés</dt>
					<dd class="text-white font-medium">{s.threads.pinned}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="text-gray-500">Fils verrouillés</dt>
					<dd class="text-white font-medium">{s.threads.locked}</dd>
				</div>
				<div class="flex justify-between">
					<dt class="text-gray-500">Moy. messages / fil</dt>
					<dd class="text-white font-medium">
						{s.threads.total > 0 ? (s.posts.total / s.threads.total).toFixed(1) : '—'}
					</dd>
				</div>
			</dl>
		</div>

		<!-- Quick links -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
			<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">Actions rapides</h2>
			<div class="grid grid-cols-2 gap-2">
				{#each [
					{ href: '/admin/members',    label: 'Gérer les membres',    icon: '👥' },
					{ href: '/admin/grades',     label: 'Gérer les grades',     icon: '🏅' },
					{ href: '/admin/categories', label: 'Gérer les catégories', icon: '📁' },
					{ href: '/admin/moderation', label: 'Modération',           icon: '🛡️' },
				] as link}
					<a
						href={link.href}
						class="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-gray-800 hover:bg-gray-700
						       border border-gray-700 text-sm text-gray-300 hover:text-white transition-colors"
					>
						<span>{link.icon}</span>
						<span class="text-xs">{link.label}</span>
					</a>
				{/each}
			</div>
		</div>
	</div>
</div>
