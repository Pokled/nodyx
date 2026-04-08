<script lang="ts">
	import { page } from '$app/stores'
	import type { LayoutData } from './$types'

	let { children, data }: { children: any; data: LayoutData } = $props()

	type NavItem = { href: string; label: string; icon: string; exact?: boolean; soon?: boolean }
	type NavGroup = { section: string; items: NavItem[] }

	const nav: NavGroup[] = [
		{
			section: 'Communauté',
			items: [
				{ href: '/admin',             label: 'Dashboard',    icon: '📊', exact: true },
				{ href: '/admin/members',     label: 'Membres',      icon: '👥' },
				{ href: '/admin/grades',      label: 'Grades',       icon: '🏅' },
				{ href: '/admin/categories',  label: 'Catégories',   icon: '📁' },
				{ href: '/admin/moderation',  label: 'Modération',   icon: '🛡️' },
				{ href: '/admin/tags',        label: 'Tags',         icon: '🏷️' },
				{ href: '/admin/audit-log',   label: 'Journal',      icon: '📋' },
			],
		},
		{
			section: 'Communication',
			items: [
				{ href: '/admin/channels/text',  label: 'Canaux texte',  icon: '💬' },
				{ href: '/admin/channels/voice', label: 'Canaux vocaux', icon: '🔊' },
			],
		},
		{
			section: 'Contenu',
			items: [
				{ href: '/admin/homepage', label: 'Homepage',  icon: '🏠' },
				{ href: '/admin/widgets',  label: 'Widgets',   icon: '🧩' },
				{ href: '/admin/assets',   label: 'Assets',    icon: '🖼️' },
				{ href: '/admin/garden',   label: 'Jardin',    icon: '🌱' },
			],
		},
		{
			section: 'Plateforme',
			items: [
				{ href: '/admin/modules', label: 'Modules', icon: '🧩' },
			],
		},
		{
			section: 'Instance',
			items: [
				{ href: '/admin/announcements', label: 'Annonces',      icon: '📢' },
				{ href: '/admin/settings',      label: 'Paramètres',    icon: '⚙️' },
				{ href: '/admin/status',        label: 'Statut réseau', icon: '🌐' },
				{ href: '/admin/ai',            label: 'Neural Engine', icon: '🧠' },
			],
		},
	]

	const isActive = (href: string, exact = false) =>
		exact
			? $page.url.pathname === href
			: $page.url.pathname.startsWith(href)
</script>

<div class="flex flex-1 min-h-0">

	<!-- ── Sidebar ──────────────────────────────────────────────────────────── -->
	<aside class="w-56 shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col">

		<!-- Header -->
		<div class="h-14 flex items-center gap-2.5 px-4 border-b border-gray-800">
			<div class="w-7 h-7 rounded-md bg-indigo-700 flex items-center justify-center text-xs font-bold text-white">
				A
			</div>
			<div class="min-w-0">
				<div class="text-xs font-semibold text-white truncate">Administration</div>
				<div class="text-xs text-gray-500 truncate">{data.communityName ?? 'Nodyx'}</div>
			</div>
		</div>

		<!-- Nav -->
		<nav class="flex-1 overflow-y-auto py-3 px-2">
			{#each nav as group}
				<div class="mb-4">
					<p class="px-2 mb-1 text-xs font-semibold text-gray-600 uppercase tracking-wider">
						{group.section}
					</p>
					{#each group.items as item}
						<a
							href={item.href}
							class="flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-colors mb-0.5
							       {isActive(item.href, item.exact)
							         ? 'bg-indigo-900/60 text-indigo-200'
							         : 'text-gray-400 hover:text-white hover:bg-gray-800/60'}
							       {item.soon ? 'opacity-60 pointer-events-none' : ''}"
						>
							<span class="text-base leading-none w-5 text-center">{item.icon}</span>
							<span class="flex-1">{item.label}</span>
							{#if item.soon}
								<span class="text-xs text-gray-600 font-medium shrink-0">bientôt</span>
							{/if}
						</a>
					{/each}
				</div>
			{/each}
		</nav>

		<!-- Footer -->
		<div class="border-t border-gray-800 p-3">
			<a
				href="/"
				class="flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-gray-500
				       hover:text-white hover:bg-gray-800/60 transition-colors"
			>
				<span>←</span>
				<span>Retour au forum</span>
			</a>
		</div>
	</aside>

	<!-- ── Main content ─────────────────────────────────────────────────────── -->
	<div class="flex-1 flex flex-col min-w-0">

		<!-- Update banner -->
		{#if data.updateCheck?.has_update}
			<div class="bg-indigo-900/70 border-b border-indigo-700/50 px-6 py-2.5 flex items-center justify-between gap-4 shrink-0">
				<div class="flex items-center gap-2.5 text-sm">
					<span class="text-indigo-300 font-semibold">Mise à jour disponible</span>
					<span class="text-indigo-400">v{data.updateCheck.current_version} → v{data.updateCheck.latest_version}</span>
				</div>
				{#if data.updateCheck.release_url}
					<a
						href={data.updateCheck.release_url}
						target="_blank"
						rel="noopener noreferrer"
						class="text-xs font-medium text-indigo-200 hover:text-white bg-indigo-700/60 hover:bg-indigo-600 px-3 py-1.5 rounded-lg transition-colors shrink-0"
					>
						Voir les notes de version
					</a>
				{/if}
			</div>
		{/if}

		<!-- Top bar -->
		<header class="h-14 border-b border-gray-800 bg-gray-900/50 flex items-center justify-between px-6 shrink-0">
			<nav class="text-sm text-gray-500 flex items-center gap-1.5">
				<a href="/" class="hover:text-gray-300">Forum</a>
				<span>/</span>
				<span class="text-gray-300">Administration</span>
			</nav>
			<div class="flex items-center gap-2 text-xs text-gray-500">
				<span class="w-1.5 h-1.5 rounded-full bg-green-400"></span>
				<span class="text-green-500 font-medium">{data.stats?.online ?? 0}</span> en ligne
			</div>
		</header>

		<!-- Page content -->
		<main class="flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
