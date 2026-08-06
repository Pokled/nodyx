<script lang="ts">
	import { enhance } from '$app/forms'
	import { t } from '$lib/i18n'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()
	const tFn = $derived($t)

	let url = $state(data.webhook?.url ?? '')
	let enabled = $state(data.webhook?.enabled ?? false)
</script>

<svelte:head><title>{tFn('octoguard.webhook_title')} · OctoGuard</title></svelte:head>

<header class="og-h">
	<h2>{tFn('octoguard.webhook_h2')}</h2>
	<p>{tFn('octoguard.webhook_desc')}</p>
</header>

{#if form?.error}<div class="og-err">⚠ {form.error}</div>{/if}
{#if form?.ok}<div class="og-ok">✓ {tFn('octoguard.saved')}</div>{/if}

<form method="POST" action="?/save" use:enhance class="og-form">
	<label class="og-checkbox">
		<input type="checkbox" name="enabled" bind:checked={enabled} value="1" />
		<span>{tFn('octoguard.webhook_enable')}</span>
	</label>

	<label>
		<span>{tFn('octoguard.webhook_url_label')}</span>
		<input name="url" type="url" bind:value={url} placeholder={tFn('octoguard.webhook_url_ph')} />
	</label>

	<label>
		<span>{tFn('octoguard.webhook_secret_label')}</span>
		<input name="secret" type="password" autocomplete="new-password" minlength="8" maxlength="256"
			placeholder={data.webhook?.has_secret ? tFn('octoguard.webhook_secret_set_ph') : tFn('octoguard.webhook_secret_min_ph')} />
	</label>

	<div class="og-info">
		<strong>{tFn('octoguard.webhook_info_format_label')}</strong> : <code>{`{ action, event_id, target_type, target_id, target_label, metadata, at }`}</code><br/>
		<strong>{tFn('octoguard.webhook_info_header_label')}</strong> : <code>X-Octoguard-Signature: sha256=hex</code> {tFn('octoguard.webhook_info_header_note')}<br/>
		<strong>{tFn('octoguard.webhook_info_perf_label')}</strong> : {tFn('octoguard.webhook_info_perf_note')}
	</div>

	<div class="og-actions">
		<button type="submit" class="og-btn-primary">{tFn('octoguard.save')}</button>
	</div>
</form>

<style>
	.og-h h2 { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; }
	.og-h p { font-size: 12px; color: #94a3b8; margin: 4px 0 16px; }
	.og-err, .og-ok { padding: 10px 14px; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
	.og-err { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; }
	.og-ok { background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); color: #86efac; }
	.og-form { display: flex; flex-direction: column; gap: 12px; padding: 16px; border: 1px solid rgba(255,255,255,0.06); border-radius: 4px; background: rgba(255,255,255,0.01); }
	label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #94a3b8; }
	input { padding: 6px 8px; font-size: 12px; background: #1f2937; border: 1px solid #374151; border-radius: 3px; color: #e2e8f0; font-family: ui-monospace, monospace; }
	.og-checkbox { flex-direction: row; align-items: center; color: #cbd5e1; font-size: 12px; }
	.og-info { font-size: 11px; color: #c7d2fe; background: rgb(var(--nx-accent-rgb) / 0.05); border: 1px solid rgb(var(--nx-accent-rgb) / 0.2); padding: 10px 12px; border-radius: 3px; line-height: 1.6; }
	.og-info code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 2px; font-size: 10px; font-family: ui-monospace, monospace; }
	.og-actions { display: flex; justify-content: flex-end; }
	.og-btn-primary { padding: 6px 12px; font-size: 12px; color: #fff; background: var(--nx-accent); border: none; border-radius: 3px; cursor: pointer; }
</style>
