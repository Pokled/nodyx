<script lang="ts">
	import type { PageData } from './$types'
	let { data }: { data: PageData } = $props()

	const enabled       = $derived(data.settings?.enabled === true)
	const re2Active     = $derived(data.settings?.re2_active === true)
	const hateFilter    = $derived(data.settings?.hate_filter === true)
	const totalRules    = $derived(data.rules.length)
	const enabledRules  = $derived(data.rules.filter((r: any) => r.enabled).length)
	const activeMutes   = $derived(data.activeMutes.length)
	const openReports   = $derived(data.openReports.length)
</script>

<svelte:head><title>OctoGuard, vue d'ensemble — Admin Nodyx</title></svelte:head>

<!-- État global -->
<section class="og-section">
	<h2 class="og-section-title">État global</h2>

	<div class="og-status-grid">
		<div class="og-status-card" class:og-status-card--ok={enabled} class:og-status-card--warn={!enabled}>
			<div class="og-status-label">OctoGuard</div>
			<div class="og-status-value">{enabled ? 'Activé' : 'Désactivé'}</div>
			<div class="og-status-hint">
				{#if enabled}
					Le pipeline auto-mod tourne sur chaque message.
				{:else}
					Désactivé via <code>OCTOGUARD_ENABLED</code>. Active dans <code>.env</code> + redémarre PM2.
				{/if}
			</div>
		</div>

		<div class="og-status-card" class:og-status-card--ok={re2Active}>
			<div class="og-status-label">Protection ReDoS</div>
			<div class="og-status-value">{re2Active ? 're2 actif' : 'Mode dégradé'}</div>
			<div class="og-status-hint">
				{#if re2Active}
					Matching linéaire garanti, ReDoS impossible by design.
				{:else}
					re2 absent, fallback RegExp natif + safe-regex à l'admission.
				{/if}
			</div>
		</div>

		<div class="og-status-card" class:og-status-card--ok={hateFilter}>
			<div class="og-status-label">Filtre haineux</div>
			<div class="og-status-value">{hateFilter ? 'Activé' : 'Désactivé'}</div>
			<div class="og-status-hint">
				{#if hateFilter}
					Symboles nazis et runes haineuses bloqués automatiquement.
				{:else}
					Désactivé. Tu assumes la responsabilité légale du contenu hébergé.
				{/if}
			</div>
		</div>
	</div>
</section>

<!-- Stats rapides -->
<section class="og-section">
	<h2 class="og-section-title">Vue d'ensemble</h2>

	<div class="og-stats-grid">
		<a href="/admin/octoguard/automod" class="og-stat-card">
			<div class="og-stat-num">{enabledRules}<span class="og-stat-sep">/{totalRules}</span></div>
			<div class="og-stat-label">Règles auto-mod actives</div>
		</a>

		<a href="/admin/octoguard/mutes" class="og-stat-card">
			<div class="og-stat-num">{activeMutes}</div>
			<div class="og-stat-label">Mutes actifs</div>
		</a>

		<a href="/admin/octoguard/reports" class="og-stat-card" class:og-stat-card--warn={openReports > 0}>
			<div class="og-stat-num">{openReports}</div>
			<div class="og-stat-label">Signalements ouverts</div>
		</a>
	</div>
</section>

<!-- Aide rapide -->
<section class="og-section">
	<h2 class="og-section-title">Comment démarrer</h2>
	<ol class="og-help">
		<li><strong>Active OctoGuard</strong> en ajoutant <code>OCTOGUARD_ENABLED=true</code> dans ton <code>.env</code> et redémarre <code>pm2 restart nodyx-core</code>.</li>
		<li><strong>Crée tes règles auto-mod</strong> dans <a href="/admin/octoguard/automod">Auto-mod</a>. Commence en mode <code>report_only</code> pour tester sans agir.</li>
		<li><strong>Configure le message de bienvenue</strong> dans <a href="/admin/octoguard/welcome">Bienvenue</a> si tu veux accueillir les nouveaux membres.</li>
		<li><strong>Ajoute des commandes</strong> dans <a href="/admin/octoguard/commands">Commandes</a> pour répondre aux <code>!regles</code>, <code>!faq</code>, etc.</li>
		<li><strong>Surveille les actions</strong> dans <a href="/admin/octoguard/logs">Journal</a> et traite les <a href="/admin/octoguard/reports">signalements</a>.</li>
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
