<script lang="ts">
	import type { PageData } from './$types'
	let { data }: { data: PageData } = $props()
	const s = $derived(data.stats)

	// Cartes stats : style UNIFORME (fond zinc, bordure discrète), un seul
	// accent. L'émeraude est réservée aux deltas positifs (sémantique), pas
	// de couleur par carte. Icônes SVG monochromes (iconPath outline 24x24).
	const statCards = $derived([
		{ label: 'Membres',    value: s.users.total,   delta: s.users.new_this_week,   sub: 'cette semaine',
		  iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
		{ label: 'Fils',       value: s.threads.total, delta: s.threads.new_this_week, sub: 'cette semaine',
		  iconPath: 'M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 13h4a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l4.586-4.586z' },
		{ label: 'Messages',   value: s.posts.total,   delta: s.posts.new_this_week,   sub: 'cette semaine',
		  iconPath: 'M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' },
		{ label: 'En ligne',   value: s.online,        delta: null,                    sub: 'utilisateurs actifs', live: true,
		  iconPath: 'M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728m-9.9-2.829a5 5 0 010-7.07m7.072 0a5 5 0 010 7.07M13 12a1 1 0 11-2 0 1 1 0 012 0z' },
		{ label: 'Événements', value: s.events?.total ?? 0, delta: null, sub: `${s.events?.upcoming ?? 0} à venir`,
		  iconPath: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
		{ label: 'Sondages',   value: s.polls?.total ?? 0,  delta: null, sub: `${s.polls?.open ?? 0} ouverts`,
		  iconPath: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
		{ label: 'Assets',     value: s.assets?.total ?? 0, delta: null, sub: 'dans la bibliothèque',
		  iconPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
		{ label: 'Chat',       value: s.chat?.total ?? 0,   delta: s.chat?.new_this_week ?? null, sub: 'cette semaine',
		  iconPath: 'M13 10V3L4 14h7v7l9-11h-7z' },
	])

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

	const quickActions = [
		{ href: '/admin/members',    label: 'Membres',    iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
		{ href: '/admin/grades',     label: 'Grades',     iconPath: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
		{ href: '/admin/categories', label: 'Catégories', iconPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
		{ href: '/admin/moderation', label: 'Modération', iconPath: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
		{ href: '/admin/channels',   label: 'Salons',     iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
		{ href: '/admin/settings',   label: 'Paramètres', iconPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
	]
</script>

<svelte:head><title>Dashboard — Admin Nodyx</title></svelte:head>

<div class="space-y-5 max-w-6xl">
	<div>
		<h1 class="text-xl font-semibold text-zinc-100">Dashboard</h1>
		<p class="text-[13px] text-zinc-500 mt-0.5">Vue d'ensemble de l'instance</p>
	</div>

	<!-- ── Stats : 8 cartes uniformes ───────────────────────────────────────── -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
		{#each statCards as card}
			<div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
				<div class="flex items-center justify-between mb-3">
					<span class="text-[11px] font-medium text-zinc-500 uppercase tracking-wide">{card.label}</span>
					<svg class="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
						<path d={card.iconPath}/>
					</svg>
				</div>
				<div class="flex items-baseline gap-2">
					<span class="text-2xl font-semibold text-zinc-100 tabular-nums leading-none">{card.value.toLocaleString('fr-FR')}</span>
					{#if card.live}
						<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 mb-0.5"></span>
					{/if}
				</div>
				<div class="text-xs text-zinc-600 mt-1.5">
					{#if card.delta !== null && card.delta !== undefined && card.delta > 0}
						<span class="text-emerald-400 font-medium tabular-nums">+{card.delta}</span>
						<span> {card.sub}</span>
					{:else}
						{card.sub}
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- ── Grille principale ────────────────────────────────────────────────── -->
	<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">

		<!-- Activité 7j — posts + nouveaux membres -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
			<div class="flex items-center justify-between mb-4">
				<h2 class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">
					Activité · 7 derniers jours
				</h2>
				<div class="flex items-center gap-3 text-[11px] text-zinc-500">
					<span class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-sm bg-indigo-500 inline-block"></span>
						Messages
					</span>
					<span class="flex items-center gap-1.5">
						<span class="w-2 h-2 rounded-sm bg-zinc-600 inline-block"></span>
						Inscriptions
					</span>
				</div>
			</div>
			<div class="flex items-end gap-1.5 h-28">
				{#each chartDays as day}
					<div class="flex-1 flex flex-col items-center gap-1">
						<div class="w-full flex items-end gap-0.5 h-20">
							<!-- Posts bar -->
							<div
								class="flex-1 rounded-t-sm bg-indigo-500/80 hover:bg-indigo-400 transition-colors min-h-[2px]"
								style="height: {Math.max((day.posts / chartMax) * 76, day.posts > 0 ? 3 : 0)}px"
								title="{day.posts} message{day.posts !== 1 ? 's' : ''}"
							></div>
							<!-- New members bar -->
							<div
								class="flex-1 rounded-t-sm bg-zinc-600/80 hover:bg-zinc-500 transition-colors min-h-[2px]"
								style="height: {Math.max((day.new_members / chartMax) * 76, day.new_members > 0 ? 3 : 0)}px"
								title="{day.new_members} inscription{day.new_members !== 1 ? 's' : ''}"
							></div>
						</div>
						<span class="text-[10px] text-zinc-600 tabular-nums">{day.label}</span>
					</div>
				{/each}
			</div>
		</div>

		<!-- Top contributeurs -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
			<h2 class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-4">
				Top contributeurs · 30 jours
			</h2>
			{#if s.top_contributors.length === 0}
				<p class="text-sm text-zinc-600">Aucun message ce mois-ci.</p>
			{:else}
				<ol class="space-y-2.5">
					{#each s.top_contributors as c, i}
						<li class="flex items-center gap-3">
							<span class="text-xs font-medium text-zinc-600 w-4 tabular-nums">{i + 1}</span>
							<div class="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-semibold text-zinc-300 shrink-0 overflow-hidden">
								{#if c.avatar}
									<img src={c.avatar} alt={c.username} class="w-full h-full object-cover" />
								{:else}
									{c.username.charAt(0).toUpperCase()}
								{/if}
							</div>
							<a href="/users/{c.username}" class="text-[13px] text-zinc-300 hover:text-white flex-1 font-medium transition-colors">
								{c.username}
							</a>
							<span class="text-xs text-zinc-500 tabular-nums">{c.post_count} msg</span>
						</li>
					{/each}
				</ol>
			{/if}
		</div>

		<!-- Derniers inscrits -->
		<div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
			<h2 class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-4">
				Derniers inscrits
			</h2>
			{#if !s.recent_members || s.recent_members.length === 0}
				<p class="text-sm text-zinc-600">Aucun membre récent.</p>
			{:else}
				<ul class="space-y-2.5">
					{#each s.recent_members as m}
						<li class="flex items-center gap-3">
							<div class="w-6 h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[10px] font-semibold text-zinc-300 shrink-0 overflow-hidden">
								{#if m.avatar}
									<img src={m.avatar} alt={m.username} class="w-full h-full object-cover" />
								{:else}
									{m.username.charAt(0).toUpperCase()}
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<a href="/users/{m.username}" class="text-[13px] text-zinc-300 hover:text-white font-medium block truncate transition-colors">
									{m.username}
								</a>
								<span class="text-xs text-zinc-600 truncate block">{m.email}</span>
							</div>
							<div class="text-right shrink-0">
								<span class="text-xs text-zinc-500 tabular-nums">{timeAgo(m.joined_at)}</span>
								{#if m.role !== 'member'}
									<span class="block text-[10px] text-indigo-400 font-medium capitalize">{m.role}</span>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
				<a href="/admin/members" class="mt-4 text-xs text-zinc-400 hover:text-zinc-200 inline-flex items-center gap-1 transition-colors">
					Voir tous les membres
					<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
				</a>
			{/if}
		</div>

		<!-- Forum + Actions rapides -->
		<div class="space-y-4">
			<div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
				<h2 class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-4">État du forum</h2>
				<dl class="space-y-2 text-[13px]">
					<div class="flex justify-between">
						<dt class="text-zinc-500">Catégories</dt>
						<dd class="text-zinc-200 font-medium tabular-nums">{s.categories.total}</dd>
					</div>
					<div class="flex justify-between">
						<dt class="text-zinc-500">Fils épinglés</dt>
						<dd class="text-zinc-200 font-medium tabular-nums">{s.threads.pinned}</dd>
					</div>
					<div class="flex justify-between">
						<dt class="text-zinc-500">Fils verrouillés</dt>
						<dd class="text-zinc-200 font-medium tabular-nums">{s.threads.locked}</dd>
					</div>
					<div class="flex justify-between">
						<dt class="text-zinc-500">Moy. msgs / fil</dt>
						<dd class="text-zinc-200 font-medium tabular-nums">
							{s.threads.total > 0 ? (s.posts.total / s.threads.total).toFixed(1) : '—'}
						</dd>
					</div>
					{#if s.dms}
					<div class="flex justify-between">
						<dt class="text-zinc-500">Conversations DM</dt>
						<dd class="text-zinc-200 font-medium tabular-nums">{s.dms.total}</dd>
					</div>
					{/if}
				</dl>
			</div>

			<div class="rounded-lg border border-zinc-800 bg-zinc-900/60 p-5">
				<h2 class="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-3">Actions rapides</h2>
				<div class="grid grid-cols-2 gap-2">
					{#each quickActions as link}
						<a
							href={link.href}
							class="flex items-center gap-2.5 px-3 py-2 rounded-md bg-zinc-900 hover:bg-zinc-800/70
							       border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-zinc-100 transition-colors"
						>
							<svg class="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
								<path d={link.iconPath}/>
							</svg>
							<span class="text-xs font-medium">{link.label}</span>
						</a>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>
