<script lang="ts">
	import { page } from '$app/state'
	import { t as i18n } from '$lib/i18n'
	import { mayOpenAdmin } from '$lib/adminAccess'
	let { children } = $props()

	const tFn = $derived($i18n)

	const tabs = [
		{ href: '/admin/octoguard',          key: 'octoguard.tab_overview', icon: '🐙' },
		{ href: '/admin/octoguard/automod',  key: 'octoguard.tab_automod',  icon: '🛡️' },
		{ href: '/admin/octoguard/welcome',  key: 'octoguard.tab_welcome',  icon: '👋' },
		{ href: '/admin/octoguard/commands', key: 'octoguard.tab_commands', icon: '⚡' },
		{ href: '/admin/octoguard/mutes',    key: 'octoguard.tab_mutes',    icon: '🔇' },
		{ href: '/admin/octoguard/logs',     key: 'octoguard.tab_logs',     icon: '📋' },
		{ href: '/admin/octoguard/webhook',  key: 'octoguard.tab_webhook',  icon: '🔗' },
	]

	// Un modérateur sans manage_octoguard ne voit que sourdines et signalements
	const visibleTabs = $derived(tabs.filter((tab) => mayOpenAdmin(tab.href, (page.data as any).access)))

	function isActive(href: string): boolean {
		if (href === '/admin/octoguard') return page.url.pathname === href
		return page.url.pathname.startsWith(href)
	}
</script>

<div class="og-shell">
	<header class="og-header">
		<div class="og-title-wrap">
			<h1 class="og-title">OctoGuard</h1>
			<p class="og-subtitle">{tFn('octoguard.subtitle')}</p>
		</div>
	</header>

	<nav class="og-nav">
		{#each visibleTabs as t (t.href)}
			<a href={t.href} class="og-tab" class:og-tab--active={isActive(t.href)}>
				<span class="og-tab-icon">{t.icon}</span>
				<span>{tFn(t.key)}</span>
			</a>
		{/each}
	</nav>

	<main class="og-main">
		{@render children?.()}
	</main>
</div>

<style>
	.og-shell {
		max-width: 1200px;
		margin: 0 auto;
		padding: 28px 16px 64px;
	}
	.og-header {
		display: flex;
		align-items: center;
		gap: 16px;
		padding-bottom: 14px;
		margin-bottom: 18px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
	}
	.og-title {
		font-size: 22px;
		font-weight: 700;
		color: #f1f5f9;
		margin: 0;
		font-family: 'Space Grotesk', system-ui, sans-serif;
		letter-spacing: -0.01em;
	}
	.og-subtitle {
		font-size: 11px;
		color: #64748b;
		margin: 2px 0 0;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.og-nav {
		display: flex;
		gap: 2px;
		overflow-x: auto;
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		margin-bottom: 24px;
		padding-bottom: 0;
	}
	.og-tab {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 10px 14px;
		font-size: 13px;
		color: #94a3b8;
		text-decoration: none;
		border-bottom: 2px solid transparent;
		white-space: nowrap;
		transition: color .1s linear, border-color .1s linear;
	}
	.og-tab:hover { color: #e2e8f0; }
	.og-tab--active {
		color: #f1f5f9;
		border-bottom-color: var(--nx-accent);
		font-weight: 600;
	}
	.og-tab-icon { font-size: 14px; }
	.og-main {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
</style>
