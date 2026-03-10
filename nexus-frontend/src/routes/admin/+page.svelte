<script lang="ts">
	import type { PageData } from './$types'
	let { data }: { data: PageData } = $props()
	const s = $derived(data.stats)

	const statCards = $derived([
		{ label: 'Membres',    value: s.users.total,    delta: s.users.new_this_week,    icon: '👥', color: 'indigo', sub: `+${s.users.new_this_week} cette semaine` },
		{ label: 'Fils',       value: s.threads.total,  delta: s.threads.new_this_week,  icon: '💬', color: 'violet', sub: `+${s.threads.new_this_week} cette semaine` },
		{ label: 'Messages',   value: s.posts.total,    delta: s.posts.new_this_week,    icon: '✉️', color: 'blue',   sub: `+${s.posts.new_this_week} cette semaine` },
		{ label: 'En ligne',   value: s.online,         delta: null,                     icon: '🟢', color: 'green',  sub: 'utilisateurs actifs' },
	])

	const statCards2 = $derived([
		{ label: 'Événements',  value: s.events?.total ?? 0,   sub: `${s.events?.upcoming ?? 0} à venir`,   icon: '📅', color: 'amber' },
		{ label: 'Sondages',    value: s.polls?.total  ?? 0,   sub: `${s.polls?.open ?? 0} ouverts`,        icon: '📊', color: 'sky' },
		{ label: 'Assets',      value: s.assets?.total ?? 0,   sub: 'dans la bibliothèque',                 icon: '🖼️', color: 'rose' },
		{ label: 'Chat msgs',   value: s.chat?.total   ?? 0,   sub: `+${s.chat?.new_this_week ?? 0} cette semaine`, icon: '⚡', color: 'teal' },
	])

	const COLOR: Record<string, string> = {
		indigo: 'bg-indigo-900/40 border-indigo-800/60 text-indigo-400',
		violet: 'bg-violet-900/40 border-violet-800/60 text-violet-400',
		blue:   'bg-blue-900/40   border-blue-800/60   text-blue-400',
		green:  'bg-green-900/40  border-green-800/60  text-green-400',
		amber:  'bg-amber-900/40  border-amber-800/60  text-amber-400',
		sky:    'bg-sky-900/40    border-sky-800/60    text-sky-400',
		rose:   'bg-rose-900/40   border-rose-800/60   text-rose-400',
		teal:   'bg-teal-900/40   border-teal-800/60   text-teal-400',
	}

	function buildChartDays(rows: any[]) {
		const axis: string[] = []
		for (let i = 6; i >= 0; i--) {
			const d = new Date(); d.setDate(d.getDate() - i)
			axis.push(d.toISOString().slice(0, 10))
		}
		const byDay: Record<string, { posts: number; new_members: number }> = {}
		for (const row of rows) {
			const key = typeof row.day === 'string' ? row.day.slice(0, 10) : new Date(row.day).toISOString().slice(0, 10)
			byDay[key] = { posts: row.posts ?? 0, new_members: row.new_members ?? 0 }
		}
		return axis.map(d => ({
			day: d,
			label: new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
			posts: byDay[d]?.posts ?? 0,
			new_members: byDay[d]?.new_members ?? 0,
		}))
	}

	const chartDays = $derived(buildChartDays(s.activity_last_7_days ?? []))

	const maxPosts    = $derived(Math.max(...chartDays.map(d => d.posts), 1))
	const maxMembers  = $derived(Math.max(...chartDays.map(d => d.new_members), 1))
	const chartMax    = $derived(Math.max(maxPosts, maxMembers, 1))

	function timeAgo(d: string) {
		const diff = Date.now() - new Date(d).getTime()
		const m = Math.floor(diff / 60000)
		const h = Math.floor(m / 60)
		const day = Math.floor(h / 24)
		if (m < 1)  return 'à l\'instant'
		if (m < 60) return `${m}min`
		if (h < 24) return `${h}h`
		if (day < 30) return `${day}j`
		return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
	}
</script>

<svelte:head><title>Dashboard — Admin Nexus</title></svelte:head>

<div class="space-y-6">
	<h1 class="text-2xl font-bold text-white">Dashboard</h1>

	<!-- ── Ligne 1 : stats principales ──────────────────────────────────────── -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
		{#each statCards as card}
			<div class="rounded-xl border p-5 {COLOR[card.color]}">
				<div class="flex items-start justify-between mb-3">
					<span class="text-xl">{card.icon}</span>
					<span class="text-xs text-gray-600">{card.sub}</span>
				</div>
				<div class="text-3xl font-bold text-white">{card.value.toLocaleString('fr-FR')}</div>
				<div class="text-sm text-gray-400 mt-1">{card.label}</div>
			</div>
		{/each}
	</div>

	<!-- ── Ligne 2 : stats secondaires ──────────────────────────────────────── -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
		{#each statCards2 as card}
			<div class="rounded-xl border p-4 {COLOR[card.color]} flex items-center gap-4">
				<span class="text-2xl shrink-0">{card.icon}</span>
				<div class="min-w-0">
					<div class="text-2xl font-bold text-white">{card.value.toLocaleString('fr-FR')}</div>
					<div class="text-xs font-medium text-gray-300 leading-tight">{card.label}</div>
					<div class="text-xs text-gray-600 mt-0.5 truncate">{card.sub}</div>
				</div>
			</div>
		{/each}
	</div>

	<!-- ── Grille principale ────────────────────────────────────────────────── -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

		<!-- Activité 7j — posts + nouveaux membres -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider">
					Activité — 7 derniers jours
				</h2>
				<div class="flex items-center gap-3 text-xs text-gray-600">
					<span class="flex items-center gap-1.5">
						<span class="w-2.5 h-2.5 rounded-sm bg-indigo-600/80 inline-block"></span>
						Messages
					</span>
					<span class="flex items-center gap-1.5">
						<span class="w-2.5 h-2.5 rounded-sm bg-emerald-600/80 inline-block"></span>
						Inscriptions
					</span>
				</div>
			</div>
			<div class="flex items-end gap-1.5 h-28">
				{#each chartDays as day}
					<div class="flex-1 flex flex-col items-center gap-0.5">
						<div class="w-full flex items-end gap-0.5 h-20">
							<!-- Posts bar -->
							<div
								class="flex-1 rounded-t bg-indigo-600/70 hover:bg-indigo-500 transition-colors min-h-[2px]"
								style="height: {Math.max((day.posts / chartMax) * 76, day.posts > 0 ? 3 : 0)}px"
								title="{day.posts} message{day.posts !== 1 ? 's' : ''}"
							></div>
							<!-- New members bar -->
							<div
								class="flex-1 rounded-t bg-emerald-600/70 hover:bg-emerald-500 transition-colors min-h-[2px]"
								style="height: {Math.max((day.new_members / chartMax) * 76, day.new_members > 0 ? 3 : 0)}px"
								title="{day.new_members} inscription{day.new_members !== 1 ? 's' : ''}"
							></div>
						</div>
						<span class="text-[10px] text-gray-600 tabular-nums">{day.label}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Top contributeurs -->
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
							<div class="w-7 h-7 rounded-full bg-indigo-800 flex items-center justify-center text-xs font-bold text-indigo-200 shrink-0 overflow-hidden">
								{#if c.avatar}
									<img src={c.avatar} alt={c.username} class="w-full h-full object-cover" />
								{:else}
									{c.username.charAt(0).toUpperCase()}
								{/if}
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

		<!-- Derniers inscrits -->
		<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
			<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
				Derniers inscrits
			</h2>
			{#if !s.recent_members || s.recent_members.length === 0}
				<p class="text-sm text-gray-600">Aucun membre récent.</p>
			{:else}
				<ul class="space-y-2.5">
					{#each s.recent_members as m}
						<li class="flex items-center gap-3">
							<div class="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-300 shrink-0 overflow-hidden">
								{#if m.avatar}
									<img src={m.avatar} alt={m.username} class="w-full h-full object-cover" />
								{:else}
									{m.username.charAt(0).toUpperCase()}
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<a href="/users/{m.username}" class="text-sm text-gray-200 hover:text-white font-medium block truncate">
									{m.username}
								</a>
								<span class="text-xs text-gray-600 truncate block">{m.email}</span>
							</div>
							<div class="text-right shrink-0">
								<span class="text-xs text-gray-500">{timeAgo(m.joined_at)}</span>
								{#if m.role !== 'member'}
									<span class="block text-[10px] text-indigo-400 font-medium capitalize">{m.role}</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				<a href="/admin/members" class="mt-4 text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
					Voir tous les membres →
				</a>
			{/if}
		</div>

		<!-- Forum + Actions rapides -->
		<div class="space-y-4">
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
						<dt class="text-gray-500">Moy. msgs / fil</dt>
						<dd class="text-white font-medium">
							{s.threads.total > 0 ? (s.posts.total / s.threads.total).toFixed(1) : '—'}
						</dd>
					</div>
					{#if s.dms}
					<div class="flex justify-between">
						<dt class="text-gray-500">Conversations DM</dt>
						<dd class="text-white font-medium">{s.dms.total}</dd>
					</div>
					{/if}
				</dl>
			</div>

			<div class="rounded-xl border border-gray-800 bg-gray-900/40 p-5">
				<h2 class="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Actions rapides</h2>
				<div class="grid grid-cols-2 gap-2">
					{#each [
						{ href: '/admin/members',    label: 'Membres',     icon: '👥' },
						{ href: '/admin/grades',     label: 'Grades',      icon: '🏅' },
						{ href: '/admin/categories', label: 'Catégories',  icon: '📁' },
						{ href: '/admin/moderation', label: 'Modération',  icon: '🛡️' },
						{ href: '/admin/channels',   label: 'Salons',      icon: '💬' },
						{ href: '/admin/settings',   label: 'Paramètres',  icon: '⚙️' },
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
</div>
