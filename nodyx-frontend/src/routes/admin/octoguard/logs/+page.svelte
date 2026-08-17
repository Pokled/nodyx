<script lang="ts">
	import { enhance } from '$app/forms'
	import { t } from '$lib/i18n'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()
	const tFn = $derived($t)

	const totalPages = $derived(Math.ceil(data.total / data.limit))
</script>

<svelte:head><title>{tFn('octoguard.logs_title')} · OctoGuard</title></svelte:head>

<header class="og-h">
	<h2>{tFn('octoguard.logs_h2')}</h2>
	<p>{tFn('octoguard.logs_desc')} <code>admin_audit_log</code>.</p>
</header>

{#if form?.error}<div class="og-err">⚠ {form.error}</div>{/if}

{#if data.logs.length === 0}
	<div class="og-empty">{tFn('octoguard.logs_empty')}</div>
{:else}
	<table class="tableau-cartes og-table md:min-w-[620px]">
		<thead>
			<tr>
				<th>{tFn('octoguard.col_date')}</th><th>{tFn('octoguard.col_actor')}</th><th>{tFn('octoguard.col_action')}</th><th>{tFn('octoguard.col_target')}</th><th>{tFn('octoguard.col_details')}</th><th></th>
			</tr>
		</thead>
		<tbody>
			{#each data.logs as l (l.id)}
				<tr>
					<td class="og-date" data-label={tFn('octoguard.col_date')}>{new Date(l.created_at).toLocaleString()}</td>
					<td data-label={tFn('octoguard.col_actor')}>{l.actor_username}</td>
					<td class="og-action">{l.action.replace('octoguard.', '')}</td>
					<td data-label={tFn('octoguard.col_target')}>{l.target_type ?? '·'}{l.target_id ? ` ${l.target_id.slice(0,8)}` : ''}</td>
					<td class="og-label" data-label={tFn('octoguard.col_details')}>{l.target_label ?? '·'}</td>
					<td>
						{#if l.metadata?.undoable}
							<form method="POST" action="?/undo" use:enhance>
								<input type="hidden" name="id" value={l.id} />
								<button type="submit" class="og-btn-link">{tFn('octoguard.logs_undo')}</button>
							</form>
						{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>

	{#if totalPages > 1}
		<div class="og-pager">
			<span>{tFn('octoguard.logs_page', { page: data.page, total_pages: totalPages, total: data.total })}</span>
			<div>
				{#if data.page > 1}
					<a href={`?page=${data.page - 1}${data.action ? '&action=' + data.action : ''}`}>{tFn('octoguard.prev')}</a>
				{/if}
				{#if data.page < totalPages}
					<a href={`?page=${data.page + 1}${data.action ? '&action=' + data.action : ''}`}>{tFn('octoguard.next')}</a>
				{/if}
			</div>
		</div>
	{/if}
{/if}

<style>
	.og-h h2 { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; }
	.og-h p { font-size: 12px; color: #94a3b8; margin: 4px 0 16px; }
	.og-h code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 2px; font-size: 11px; font-family: ui-monospace, monospace; }
	.og-err { padding: 10px 14px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
	.og-table { width: 100%; border-collapse: collapse; font-size: 12px; }
	.og-table th, .og-table td { padding: 6px 10px; text-align: left; border-bottom: 1px solid rgba(255,255,255,0.04); }
	.og-table th { color: #64748b; font-weight: 500; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; font-family: ui-monospace, monospace; }
	.og-table td { color: #cbd5e1; font-family: ui-monospace, monospace; font-size: 11px; }
	.og-date { color: #64748b; white-space: nowrap; }
	.og-action { color: #a5b4fc; font-weight: 600; }
	.og-label { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.og-btn-link { background: transparent; border: 1px solid #374151; color: #94a3b8; font-size: 10px; padding: 2px 6px; border-radius: 2px; cursor: pointer; }
	.og-btn-link:hover { color: #e2e8f0; }
	.og-pager { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; font-size: 12px; color: #94a3b8; font-family: ui-monospace, monospace; }
	.og-pager a { color: #a5b4fc; text-decoration: none; margin-left: 8px; }
	.og-empty { padding: 24px; text-align: center; color: #64748b; font-size: 13px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 4px; }
</style>
