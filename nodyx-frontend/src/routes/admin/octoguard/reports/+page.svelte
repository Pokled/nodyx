<script lang="ts">
	import { enhance } from '$app/forms'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()
	const STATUSES = ['open', 'reviewed', 'dismissed', 'actioned']
</script>

<svelte:head><title>Signalements — OctoGuard</title></svelte:head>

<header class="og-h">
	<h2>Signalements utilisateurs</h2>
	<p>Reports envoyés par des membres sur du contenu ou des utilisateurs.</p>
	<nav class="og-filters">
		{#each STATUSES as s}
			<a href={`/admin/octoguard/reports?status=${s}`} class="og-filter" class:active={data.status === s}>{s}</a>
		{/each}
	</nav>
</header>

{#if form?.error}<div class="og-err">⚠ {form.error}</div>{/if}

{#if data.reports.length === 0}
	<div class="og-empty">Aucun report dans cet état.</div>
{:else}
	<ul class="og-reports">
		{#each data.reports as r (r.id)}
			<li class="og-report">
				<div class="og-report-head">
					<span class="og-report-cat">{r.category ?? 'other'}</span>
					<span class="og-report-target">{r.target_type} <code>{r.target_id.slice(0,8)}</code></span>
					<span class="og-report-by">par {r.reporter_username ?? r.reporter_id?.slice(0,8) ?? '—'}</span>
					<span class="og-report-date">{new Date(r.created_at).toLocaleString()}</span>
				</div>
				<p class="og-report-reason">{r.reason}</p>
				{#if r.resolution}
					<p class="og-report-resolution"><strong>Résolution :</strong> {r.resolution}</p>
				{/if}
				{#if r.status === 'open'}
					<form method="POST" action="?/patch" use:enhance class="og-report-actions">
						<input type="hidden" name="id" value={r.id} />
						<input name="resolution" type="text" placeholder="Note de résolution (optionnel)" />
						<button type="submit" name="status" value="reviewed" class="og-btn-link">Marquer revu</button>
						<button type="submit" name="status" value="actioned" class="og-btn-link og-btn-link--accent">Action prise</button>
						<button type="submit" name="status" value="dismissed" class="og-btn-link og-btn-link--danger">Rejeter</button>
					</form>
				{:else}
					<div class="og-report-status">Statut: <code>{r.status}</code></div>
				{/if}
			</li>
		{/each}
	</ul>
{/if}

<style>
	.og-h h2 { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; }
	.og-h p { font-size: 12px; color: #94a3b8; margin: 4px 0 12px; }
	.og-filters { display: flex; gap: 4px; margin-bottom: 16px; }
	.og-filter { padding: 4px 10px; font-size: 11px; color: #94a3b8; text-decoration: none; border-radius: 2px; background: rgba(255,255,255,0.02); font-family: ui-monospace, monospace; }
	.og-filter:hover { background: rgba(255,255,255,0.05); color: #e2e8f0; }
	.og-filter.active { background: rgb(var(--nx-accent-rgb) / 0.15); color: #a5b4fc; }
	.og-err { padding: 10px 14px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
	.og-reports { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
	.og-report { padding: 12px; border: 1px solid rgba(255,255,255,0.06); border-radius: 4px; background: rgba(255,255,255,0.01); }
	.og-report-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; font-size: 11px; color: #64748b; font-family: ui-monospace, monospace; margin-bottom: 8px; }
	.og-report-cat { padding: 2px 6px; background: rgba(251,146,60,0.15); color: #fb923c; border-radius: 2px; font-weight: 600; text-transform: uppercase; font-size: 9px; }
	.og-report-target code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 2px; }
	.og-report-by { color: #94a3b8; }
	.og-report-date { margin-left: auto; }
	.og-report-reason { font-size: 13px; color: #e2e8f0; margin: 0 0 8px; line-height: 1.5; }
	.og-report-resolution { font-size: 12px; color: #94a3b8; background: rgba(255,255,255,0.02); padding: 6px 10px; border-radius: 3px; margin: 0 0 8px; }
	.og-report-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
	.og-report-actions input { flex: 1; min-width: 200px; padding: 6px 8px; font-size: 12px; background: #1f2937; border: 1px solid #374151; border-radius: 3px; color: #e2e8f0; }
	.og-btn-link { padding: 4px 10px; font-size: 11px; background: transparent; border: 1px solid #374151; color: #94a3b8; border-radius: 3px; cursor: pointer; }
	.og-btn-link:hover { color: #e2e8f0; }
	.og-btn-link--accent { border-color: rgb(var(--nx-accent-rgb) / 0.3); color: #a5b4fc; }
	.og-btn-link--danger:hover { color: #fca5a5; border-color: rgba(239,68,68,0.3); }
	.og-report-status { font-size: 11px; color: #64748b; font-family: ui-monospace, monospace; }
	.og-empty { padding: 24px; text-align: center; color: #64748b; font-size: 13px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 4px; }
</style>
