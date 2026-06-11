<script lang="ts">
	import { page } from '$app/stores'
	import type { LayoutData } from './$types'
	import NodyxVersionBadge from '$lib/components/NodyxVersionBadge.svelte'

	let { children, data }: { children: any; data: LayoutData } = $props()

	// iconPath : SVG outline 24x24 (heroicons/lucide), rendu monochrome via
	// stroke currentColor. Pas d'emoji dans les labels système (référence
	// design admin : Linear / Vercel / Stripe, un seul accent).
	type NavItem = { href: string; label: string; iconPath: string; exact?: boolean; soon?: boolean }
	type NavGroup = { section: string; items: NavItem[] }

	const nav: NavGroup[] = [
		{
			section: 'Communauté',
			items: [
				{ href: '/admin',             label: 'Dashboard',    exact: true, iconPath: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
				{ href: '/admin/members',     label: 'Membres',      iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
				{ href: '/admin/grades',      label: 'Grades',       iconPath: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z' },
				{ href: '/admin/categories',  label: 'Catégories',   iconPath: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' },
				{ href: '/admin/moderation',  label: 'Modération',   iconPath: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
				{ href: '/admin/octoguard',   label: 'OctoGuard',    iconPath: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' },
				{ href: '/admin/tags',        label: 'Tags',         iconPath: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
				{ href: '/admin/audit-log',   label: 'Journal',      iconPath: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
			],
		},
		{
			section: 'Communication',
			items: [
				{ href: '/admin/channels/text',  label: 'Canaux texte',  iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
				{ href: '/admin/channels/voice', label: 'Canaux vocaux', iconPath: 'M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z' },
			],
		},
		{
			section: 'Contenu',
			items: [
				{ href: '/admin/homepage',         label: 'Homepage',     iconPath: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
				{ href: '/admin/homepage/builder', label: 'Grid Builder', iconPath: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
				{ href: '/admin/widgets',          label: 'Widgets',      iconPath: 'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z' },
				{ href: '/admin/media',            label: 'Médiathèque',  iconPath: 'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z' },
				{ href: '/admin/assets',           label: 'Assets',       iconPath: 'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4' },
				{ href: '/admin/garden',           label: 'Jardin',       iconPath: 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z' },
			],
		},
		{
			section: 'Plateforme',
			items: [
				{ href: '/admin/modules', label: 'Modules', iconPath: 'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4' },
			],
		},
		{
			section: 'Intégrations',
			items: [
				{ href: '/admin/streamer-hub', label: 'Streamer Hub', iconPath: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
			],
		},
		{
			section: 'Instance',
			items: [
				{ href: '/admin/announcements', label: 'Annonces',      iconPath: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
				{ href: '/admin/settings',      label: 'Paramètres',    iconPath: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
				{ href: '/admin/status',        label: 'Statut réseau', iconPath: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9' },
				{ href: '/admin/backups',       label: 'Sauvegardes',   iconPath: 'M4 7v10c0 2 3.582 3 8 3s8-1 8-3V7M4 7c0 2 3.582 3 8 3s8-1 8-3M4 7c0-2 3.582-3 8-3s8 1 8 3' },
				{ href: '/admin/ai',            label: 'Neural Engine', iconPath: 'M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z' },
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
	<aside class="w-56 shrink-0 border-r border-zinc-800/80 bg-zinc-950 flex flex-col">

		<!-- Header -->
		<div class="h-14 flex items-center gap-2.5 px-4 border-b border-zinc-800/80">
			<div class="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
				<svg class="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
					<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/>
				</svg>
			</div>
			<div class="min-w-0">
				<div class="text-[13px] font-semibold text-zinc-100 truncate leading-tight">Administration</div>
				<div class="text-[11px] text-zinc-500 truncate leading-tight">{data.communityName ?? 'Nodyx'}</div>
			</div>
		</div>

		<!-- Nav -->
		<nav class="flex-1 overflow-y-auto py-3 px-2">
			{#each nav as group}
				<div class="mb-3.5">
					<p class="px-2.5 mb-1 text-[10px] font-semibold text-zinc-600 uppercase tracking-[0.08em]">
						{group.section}
					</p>
					{#each group.items as item}
						{@const active = isActive(item.href, item.exact)}
						<a
							href={item.href}
							class="relative flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-colors mb-px
							       {active
							         ? 'bg-zinc-800/80 text-zinc-100'
							         : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-900'}
							       {item.soon ? 'opacity-60 pointer-events-none' : ''}"
						>
							{#if active}
								<span class="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 rounded-full bg-indigo-400"></span>
							{/if}
							<svg class="w-4 h-4 shrink-0 {active ? 'text-indigo-300' : 'text-zinc-500'}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
								<path d={item.iconPath}/>
							</svg>
							<span class="flex-1 truncate">{item.label}</span>
							{#if item.soon}
								<span class="text-[10px] text-zinc-600 font-medium shrink-0">bientôt</span>
							{/if}
						</a>
					{/each}
				</div>
			{/each}
		</nav>

		<!-- Footer -->
		<div class="border-t border-zinc-800/80 p-2 space-y-1">
			<a
				href="/"
				class="flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] text-zinc-500
				       hover:text-zinc-100 hover:bg-zinc-900 transition-colors"
			>
				<svg class="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
					<path d="M10 19l-7-7m0 0l7-7m-7 7h18"/>
				</svg>
				<span>Retour au forum</span>
			</a>
			<div class="px-2.5 pt-1.5 border-t border-zinc-800/60">
				<NodyxVersionBadge
					version={data.updateCheck?.current_version ?? (data as any).nodyxVersion ?? 'unknown'}
					variant="admin"
				/>
			</div>
		</div>
	</aside>

	<!-- ── Main content ─────────────────────────────────────────────────────── -->
	<div class="flex-1 flex flex-col min-w-0">

		<!-- Update banner -->
		{#if data.updateCheck?.has_update}
			<div class="bg-zinc-900 border-b border-zinc-800 px-6 py-2 flex items-center justify-between gap-4 shrink-0">
				<div class="flex items-center gap-2.5 text-[13px]">
					<span class="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0"></span>
					<span class="text-zinc-200 font-medium">Mise à jour disponible</span>
					<span class="text-zinc-500 tabular-nums">v{data.updateCheck.current_version} → v{data.updateCheck.latest_version}</span>
				</div>
				{#if data.updateCheck.release_url}
					<a
						href={data.updateCheck.release_url}
						target="_blank"
						rel="noopener noreferrer"
						class="text-xs font-medium text-zinc-200 hover:text-white border border-zinc-700 hover:border-zinc-500 px-2.5 py-1 rounded-md transition-colors shrink-0"
					>
						Notes de version
					</a>
				{/if}
			</div>
		{/if}

		<!-- Top bar -->
		<header class="h-14 border-b border-zinc-800/80 bg-zinc-950/60 flex items-center justify-between px-6 shrink-0">
			<nav class="text-[13px] text-zinc-500 flex items-center gap-1.5">
				<a href="/" class="hover:text-zinc-300 transition-colors">Forum</a>
				<svg class="w-3 h-3 text-zinc-700" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>
				<span class="text-zinc-300">Administration</span>
			</nav>
			<div class="flex items-center gap-2 text-xs">
				<span class="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
				<span class="text-zinc-400"><span class="text-zinc-200 font-medium tabular-nums">{data.stats?.online ?? 0}</span> en ligne</span>
			</div>
		</header>

		<!-- Page content -->
		<main class="flex-1 overflow-auto p-6">
			{@render children()}
		</main>
	</div>
</div>
