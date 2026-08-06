<script lang="ts">
	import { enhance } from '$app/forms'
	import { t as i18n } from '$lib/i18n'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()

	const tFn = $derived($i18n)

	let showCreate = $state(false)
	let editingId = $state<string | null>(null)

	const RULE_TYPES = [
		{ value: 'regex',         labelKey: 'octoguard.rule_type_regex',        params: { pattern: '\\b(motA|motB)\\b', flags: 'i' } },
		{ value: 'caps',          labelKey: 'octoguard.rule_type_caps',         params: { min_length: 15, threshold_percent: 70 } },
		{ value: 'link_domain',   labelKey: 'octoguard.rule_type_link_domain',  params: { mode: 'blacklist', domains: ['discord.gg'] } },
		{ value: 'mention_spam',  labelKey: 'octoguard.rule_type_mention_spam', params: { max_mentions: 5 } },
		{ value: 'link_spam',     labelKey: 'octoguard.rule_type_link_spam',    params: { max_links: 2 } },
	]

	const ACTIONS = [
		{ value: 'delete',       labelKey: 'octoguard.action_delete' },
		{ value: 'warn',         labelKey: 'octoguard.action_warn' },
		{ value: 'mute',         labelKey: 'octoguard.action_mute' },
		{ value: 'ban_temp',     labelKey: 'octoguard.action_ban_temp' },
		{ value: 'notify_only',  labelKey: 'octoguard.action_notify_only' },
		{ value: 'report_only',  labelKey: 'octoguard.action_report_only' },
	]

	// Form state (create or edit)
	let f_name = $state('')
	let f_type = $state<string>('regex')
	let f_action = $state('delete')
	let f_paramsJson = $state(JSON.stringify({ pattern: '\\b(motA|motB)\\b', flags: 'i' }, null, 2))
	let f_durationJson = $state('')
	let f_immRoles = $state('owner, admin, moderator')
	let f_dryRun = $state(false)
	let f_enabled = $state(true)

	function resetForm() {
		f_name = ''
		f_type = 'regex'
		f_action = 'delete'
		const tpl = RULE_TYPES.find(t => t.value === 'regex')!
		f_paramsJson = JSON.stringify(tpl.params, null, 2)
		f_durationJson = ''
		f_immRoles = 'owner, admin, moderator'
		f_dryRun = false
		f_enabled = true
	}

	function startEdit(r: any) {
		editingId = r.id
		showCreate = false
		f_name   = r.name
		f_type   = r.type
		f_action = r.action
		f_paramsJson   = JSON.stringify(r.params ?? {}, null, 2)
		f_durationJson = r.action_duration ? JSON.stringify(r.action_duration) : ''
		f_immRoles = (r.immunized_role_types ?? []).join(', ')
		f_dryRun = !!r.dry_run
		f_enabled = !!r.enabled
	}

	function openCreate() {
		editingId = null
		showCreate = true
		resetForm()
	}

	function cancelForm() {
		editingId = null
		showCreate = false
	}

	function onTypeChange() {
		const tpl = RULE_TYPES.find(t => t.value === f_type)
		if (tpl) f_paramsJson = JSON.stringify(tpl.params, null, 2)
	}
</script>

<svelte:head><title>{tFn('octoguard.tab_automod')} · OctoGuard</title></svelte:head>

{#if form?.error}
	<div class="og-error">
		⚠ {form.error}
		{#if form.assessment?.reason}
			<div class="og-error-detail">{form.assessment.reason}</div>
		{/if}
	</div>
{/if}

<header class="og-page-header">
	<div>
		<h2 class="og-page-title">{tFn('octoguard.automod_title')}</h2>
		<p class="og-page-sub">{data.rules.length !== 1 ? tFn('octoguard.rules_count_many', { n: data.rules.length }) : tFn('octoguard.rules_count_one', { n: data.rules.length })}</p>
	</div>
	{#if !showCreate && !editingId}
		<button class="og-btn-primary" onclick={openCreate}>{tFn('octoguard.automod_new')}</button>
	{/if}
</header>

{#if showCreate || editingId}
	<form method="POST" action={editingId ? '?/update' : '?/create'} use:enhance={() => async ({ result, update }) => {
		await update()
		if (result.type === 'success') { cancelForm() }
	}} class="og-form">
		{#if editingId}<input type="hidden" name="id" value={editingId} />{/if}

		<div class="og-form-row">
			<label class="og-label">
				<span>{tFn('octoguard.field_name')}</span>
				<input name="name" type="text" required maxlength="100" bind:value={f_name} placeholder={tFn('octoguard.automod_name_ph')} />
			</label>
			<label class="og-label">
				<span>{tFn('octoguard.field_type')}</span>
				<select name="type" bind:value={f_type} onchange={onTypeChange}>
					{#each RULE_TYPES as t}<option value={t.value}>{tFn(t.labelKey)}</option>{/each}
				</select>
			</label>
			<label class="og-label">
				<span>{tFn('octoguard.field_action')}</span>
				<select name="action" bind:value={f_action}>
					{#each ACTIONS as a}<option value={a.value}>{tFn(a.labelKey)}</option>{/each}
				</select>
			</label>
		</div>

		<label class="og-label">
			<span>{tFn('octoguard.automod_params_label')}</span>
			<textarea name="params" rows="5" bind:value={f_paramsJson}></textarea>
		</label>

		{#if f_action === 'mute' || f_action === 'ban_temp'}
			<label class="og-label">
				<span>{tFn('octoguard.automod_duration_label_pre')} <code>{`{"value":1,"unit":"h"}`}</code>{tFn('octoguard.automod_duration_label_post')}</span>
				<input name="action_duration" type="text" bind:value={f_durationJson} placeholder={'{"value":1,"unit":"h"}'} />
			</label>
		{/if}

		<label class="og-label">
			<span>{tFn('octoguard.automod_immroles_label')}</span>
			<input name="immunized_role_types" type="text" bind:value={f_immRoles} />
		</label>

		<div class="og-form-row">
			<label class="og-checkbox">
				<input name="dry_run" type="checkbox" bind:checked={f_dryRun} value="1" />
				<span>{tFn('octoguard.automod_dryrun_label')}</span>
			</label>
			<label class="og-checkbox">
				<input name="enabled" type="checkbox" bind:checked={f_enabled} value="1" />
				<span>{tFn('octoguard.automod_enabled_label')}</span>
			</label>
		</div>

		<div class="og-form-actions">
			<button type="button" class="og-btn-secondary" onclick={cancelForm}>{tFn('octoguard.cancel')}</button>
			<button type="submit" class="og-btn-primary">{editingId ? tFn('octoguard.save') : tFn('octoguard.create')}</button>
		</div>
	</form>
{/if}

{#if data.rules.length === 0 && !showCreate}
	<div class="og-empty">
		{tFn('octoguard.automod_empty_pre')} <strong>{tFn('octoguard.automod_new')}</strong> {tFn('octoguard.automod_empty_post')}
	</div>
{:else}
	<ul class="og-rules-list">
		{#each data.rules as r (r.id)}
			<li class="og-rule">
				<div class="og-rule-head">
					<span class="og-rule-status" class:og-rule-status--off={!r.enabled}>
						{r.enabled ? '●' : '○'}
					</span>
					<span class="og-rule-name">{r.name}</span>
					<span class="og-rule-badge">{r.type}</span>
					<span class="og-rule-badge og-rule-badge--action">→ {r.action}</span>
					{#if r.dry_run}<span class="og-rule-badge og-rule-badge--dry">dry-run</span>{/if}
					<div class="og-rule-actions">
						<button class="og-btn-link" onclick={() => editingId === r.id ? cancelForm() : startEdit(r)}>
							{editingId === r.id ? tFn('octoguard.close') : tFn('octoguard.edit')}
						</button>
						<form method="POST" action="?/delete" use:enhance>
							<input type="hidden" name="id" value={r.id} />
							<button type="submit" class="og-btn-link og-btn-link--danger"
								onclick={(e) => { if (!confirm(tFn('octoguard.automod_delete_confirm', { name: r.name }))) e.preventDefault() }}>
								{tFn('octoguard.delete')}
							</button>
						</form>
					</div>
				</div>
				<details class="og-rule-detail">
					<summary>{tFn('octoguard.automod_view_params')}</summary>
					<pre>{JSON.stringify(r.params, null, 2)}</pre>
				</details>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.og-error {
		padding: 12px 14px;
		background: rgba(239, 68, 68, 0.1);
		border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 4px;
		color: #fca5a5;
		font-size: 13px;
	}
	.og-error-detail {
		margin-top: 6px;
		font-size: 11px;
		color: #fb923c;
		font-family: ui-monospace, monospace;
	}
	.og-page-header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	.og-page-title { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; font-family: 'Space Grotesk', sans-serif; }
	.og-page-sub { font-size: 11px; color: #64748b; margin: 2px 0 0; font-family: ui-monospace, monospace; }
	.og-btn-primary {
		padding: 6px 12px; font-size: 12px; color: #fff;
		background: var(--nx-accent); border: none; border-radius: 3px; cursor: pointer;
	}
	.og-btn-primary:hover { background: var(--nx-accent-strong); }
	.og-btn-secondary {
		padding: 6px 12px; font-size: 12px; color: #94a3b8;
		background: transparent; border: 1px solid #374151; border-radius: 3px; cursor: pointer;
	}
	.og-btn-secondary:hover { color: #e2e8f0; }
	.og-form {
		padding: 16px;
		border: 1px solid rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.01);
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 16px;
	}
	.og-form-row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
	}
	.og-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: #94a3b8;
	}
	.og-label code { font-size: 10px; }
	.og-label input,
	.og-label select,
	.og-label textarea {
		padding: 6px 8px;
		font-size: 12px;
		background: #1f2937;
		border: 1px solid #374151;
		border-radius: 3px;
		color: #e2e8f0;
		font-family: ui-monospace, monospace;
	}
	.og-label textarea { resize: vertical; min-height: 80px; }
	.og-checkbox {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #cbd5e1;
	}
	.og-form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
	.og-rules-list {
		list-style: none;
		padding: 0; margin: 0;
		border: 1px solid rgba(255, 255, 255, 0.05);
		border-radius: 4px;
		background: rgba(255, 255, 255, 0.01);
	}
	.og-rule {
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.og-rule + .og-rule { border-top: 1px solid rgba(255, 255, 255, 0.04); }
	.og-rule-head {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.og-rule-status { color: #22c55e; font-size: 12px; }
	.og-rule-status--off { color: #475569; }
	.og-rule-name { font-size: 13px; font-weight: 600; color: #e2e8f0; }
	.og-rule-badge {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: 2px;
		background: rgba(255, 255, 255, 0.05);
		color: #94a3b8;
		font-family: ui-monospace, monospace;
	}
	.og-rule-badge--action { background: rgb(var(--nx-accent-rgb) / 0.15); color: #a5b4fc; }
	.og-rule-badge--dry { background: rgba(251, 146, 60, 0.15); color: #fb923c; }
	.og-rule-actions {
		margin-left: auto;
		display: flex;
		gap: 8px;
	}
	.og-btn-link {
		padding: 2px 6px;
		font-size: 11px;
		background: transparent;
		border: none;
		color: #94a3b8;
		cursor: pointer;
	}
	.og-btn-link:hover { color: #e2e8f0; }
	.og-btn-link--danger:hover { color: #fca5a5; }
	.og-rule-detail summary {
		font-size: 11px;
		color: #64748b;
		cursor: pointer;
		font-family: ui-monospace, monospace;
	}
	.og-rule-detail pre {
		margin: 4px 0 0;
		padding: 8px;
		background: #0f172a;
		border-radius: 3px;
		font-size: 11px;
		color: #cbd5e1;
		overflow-x: auto;
	}
	.og-empty {
		padding: 28px;
		text-align: center;
		color: #64748b;
		font-size: 13px;
		border: 1px dashed rgba(255, 255, 255, 0.08);
		border-radius: 4px;
	}
</style>
