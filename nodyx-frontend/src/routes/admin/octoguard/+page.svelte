<script lang="ts">
	import { t } from '$lib/i18n'
	import type { PageData } from './$types'
	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)

	const enabled       = $derived(data.settings?.enabled === true)
	const re2Active     = $derived(data.settings?.re2_active === true)
	const hateFilter    = $derived(data.settings?.hate_filter === true)
	const totalRules    = $derived(data.rules.length)
	const enabledRules  = $derived(data.rules.filter((r: any) => r.enabled).length)
	const activeMutes   = $derived(data.activeMutes.length)
	const openReports   = $derived(data.openReports.length)
</script>

<svelte:head><title>{tFn('octoguard.overview_title')} · Admin Nodyx</title></svelte:head>

<!-- État global -->
<section class="og-section">
	<h2 class="og-section-title">{tFn('octoguard.overview_global_state')}</h2>

	<div class="og-status-grid">
		<div class="og-status-card" class:og-status-card--ok={enabled} class:og-status-card--warn={!enabled}>
			<div class="og-status-label">OctoGuard</div>
			<div class="og-status-value">{enabled ? tFn('octoguard.status_on') : tFn('octoguard.status_off')}</div>
			<div class="og-status-hint">
				{#if enabled}
					{tFn('octoguard.overview_pipeline_on')}
				{:else}
					{tFn('octoguard.overview_pipeline_off_1')} <code>OCTOGUARD_ENABLED</code>. {tFn('octoguard.overview_pipeline_off_2')} <code>.env</code> {tFn('octoguard.overview_pipeline_off_3')}
				{/if}
			</div>
		</div>

		<div class="og-status-card" class:og-status-card--ok={re2Active}>
			<div class="og-status-label">{tFn('octoguard.overview_redos_label')}</div>
			<div class="og-status-value">{re2Active ? tFn('octoguard.overview_re2_on') : tFn('octoguard.overview_re2_off')}</div>
			<div class="og-status-hint">
				{#if re2Active}
					{tFn('octoguard.overview_re2_hint_on')}
				{:else}
					{tFn('octoguard.overview_re2_hint_off')}
				{/if}
			</div>
		</div>

		<div class="og-status-card" class:og-status-card--ok={hateFilter}>
			<div class="og-status-label">{tFn('octoguard.overview_hate_label')}</div>
			<div class="og-status-value">{hateFilter ? tFn('octoguard.status_on') : tFn('octoguard.status_off')}</div>
			<div class="og-status-hint">
				{#if hateFilter}
					{tFn('octoguard.overview_hate_hint_on')}
				{:else}
					{tFn('octoguard.overview_hate_hint_off')}
				{/if}
			</div>
		</div>
	</div>
</section>

<!-- Stats rapides -->
<section class="og-section">
	<h2 class="og-section-title">{tFn('octoguard.tab_overview')}</h2>

	<div class="og-stats-grid">
		<a href="/admin/octoguard/automod" class="og-stat-card">
			<div class="og-stat-num">{enabledRules}<span class="og-stat-sep">/{totalRules}</span></div>
			<div class="og-stat-label">{tFn('octoguard.overview_stat_rules')}</div>
		</a>

		<a href="/admin/octoguard/mutes" class="og-stat-card">
			<div class="og-stat-num">{activeMutes}</div>
			<div class="og-stat-label">{tFn('octoguard.mutes_h2')}</div>
		</a>

		<a href="/admin/octoguard/reports" class="og-stat-card" class:og-stat-card--warn={openReports > 0}>
			<div class="og-stat-num">{openReports}</div>
			<div class="og-stat-label">{tFn('octoguard.overview_stat_reports')}</div>
		</a>
	</div>
</section>

<!-- Aide rapide -->
<section class="og-section">
	<h2 class="og-section-title">{tFn('octoguard.overview_help_title')}</h2>
	<ol class="og-help">
		<li><strong>{tFn('octoguard.help1_strong')}</strong> {tFn('octoguard.help1_a')} <code>OCTOGUARD_ENABLED=true</code> {tFn('octoguard.help1_b')} <code>.env</code> {tFn('octoguard.help1_c')} <code>pm2 restart nodyx-core</code>.</li>
		<li><strong>{tFn('octoguard.help2_strong')}</strong> {tFn('octoguard.help_in')} <a href="/admin/octoguard/automod">{tFn('octoguard.tab_automod')}</a>. {tFn('octoguard.help2_b')} <code>report_only</code> {tFn('octoguard.help2_c')}</li>
		<li><strong>{tFn('octoguard.help3_strong')}</strong> {tFn('octoguard.help_in')} <a href="/admin/octoguard/welcome">{tFn('octoguard.tab_welcome')}</a> {tFn('octoguard.help3_b')}</li>
		<li><strong>{tFn('octoguard.help4_strong')}</strong> {tFn('octoguard.help_in')} <a href="/admin/octoguard/commands">{tFn('octoguard.tab_commands')}</a> {tFn('octoguard.help4_b')} <code>!regles</code>, <code>!faq</code>, etc.</li>
		<li><strong>{tFn('octoguard.help5_strong')}</strong> {tFn('octoguard.help_in')} <a href="/admin/octoguard/logs">{tFn('octoguard.tab_logs')}</a> {tFn('octoguard.help5_b')} <a href="/admin/octoguard/reports">{tFn('octoguard.help5_reports_link')}</a>.</li>
	</ol>
</section>

<style>
	.og-section {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.og-section-title {
		font-size: 11px;
		font-weight: 600;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin: 0 0 4px;
	}
	.og-status-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
		gap: 12px;
	}
	.og-status-card {
		padding: 14px;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.01);
	}
	.og-status-card--ok { border-left: 3px solid #22c55e; }
	.og-status-card--warn { border-left: 3px solid #fb923c; }
	.og-status-label {
		font-size: 11px;
		color: #64748b;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.og-status-value {
		font-size: 16px;
		font-weight: 700;
		color: #f1f5f9;
		margin: 4px 0;
		font-family: 'Space Grotesk', sans-serif;
	}
	.og-status-hint {
		font-size: 12px;
		color: #94a3b8;
		line-height: 1.5;
	}
	.og-status-hint code {
		background: rgba(255, 255, 255, 0.05);
		padding: 1px 4px;
		border-radius: 2px;
		font-size: 10px;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.og-stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}
	.og-stat-card {
		display: block;
		padding: 14px;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.01);
		text-decoration: none;
		color: inherit;
		transition: background .1s linear, border-color .1s linear;
	}
	.og-stat-card:hover { background: rgba(255, 255, 255, 0.03); border-color: rgb(var(--nx-accent-rgb) / 0.3); }
	.og-stat-card--warn { border-left: 3px solid #fb923c; }
	.og-stat-num {
		font-size: 28px;
		font-weight: 700;
		color: #f1f5f9;
		font-family: 'Space Grotesk', sans-serif;
		letter-spacing: -0.02em;
	}
	.og-stat-sep { font-size: 18px; color: #64748b; margin-left: 4px; }
	.og-stat-label {
		font-size: 11px;
		color: #94a3b8;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		font-family: ui-monospace, SFMono-Regular, monospace;
		margin-top: 4px;
	}
	.og-help {
		padding: 0 0 0 20px;
		margin: 0;
		font-size: 13px;
		color: #cbd5e1;
		line-height: 1.7;
	}
	.og-help li { margin-bottom: 4px; }
	.og-help code {
		background: rgba(255, 255, 255, 0.05);
		padding: 1px 6px;
		border-radius: 2px;
		font-size: 11px;
		font-family: ui-monospace, SFMono-Regular, monospace;
	}
	.og-help a { color: #a5b4fc; text-decoration: none; }
	.og-help a:hover { text-decoration: underline; }
</style>
