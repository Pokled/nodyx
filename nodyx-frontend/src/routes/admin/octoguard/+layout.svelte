<script lang="ts">
	import { page } from '$app/stores'
	let { children } = $props()

	const tabs = [
		{ href: '/admin/octoguard',          label: 'Vue d\'ensemble',  icon: '🐙' },
		{ href: '/admin/octoguard/automod',  label: 'Auto-mod',         icon: '🛡️' },
		{ href: '/admin/octoguard/welcome',  label: 'Bienvenue',        icon: '👋' },
		{ href: '/admin/octoguard/commands', label: 'Commandes',        icon: '⚡' },
		{ href: '/admin/octoguard/mutes',    label: 'Mutes',            icon: '🔇' },
		{ href: '/admin/octoguard/reports',  label: 'Signalements',     icon: '🚩' },
		{ href: '/admin/octoguard/logs',     label: 'Journal',          icon: '📋' },
		{ href: '/admin/octoguard/webhook',  label: 'Webhook',          icon: '🔗' },
	]

	function isActive(href: string): boolean {
		if (href === '/admin/octoguard') return $page.url.pathname === href
		return $page.url.pathname.startsWith(href)
	}
</script>

<div class="og-shell">
	<header class="og-header">
		<div class="og-title-wrap">
			<h1 class="og-title">OctoGuard</h1>
			<p class="og-subtitle">Modérateur automatique natif Nodyx, Phase 1</p>
		</div>
	</header>

	<nav class="og-nav">
		{#each tabs as t (t.href)}
			<a href={t.href} class="og-tab" class:og-tab--active={isActive(t.href)}>
				<span class="og-tab-icon">{t.icon}</span>
				<span>{t.label}</span>
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
