<script lang="ts">
	import { enhance } from '$app/forms'
	import { t } from '$lib/i18n'
	import type { PageData, ActionData } from './$types'
	let { data, form }: { data: PageData; form: ActionData } = $props()
	const tFn = $derived($t)
	let showForm = $state(false)
	let f_command = $state('')
	let f_response = $state('')
	let f_cooldown = $state(5)
</script>

<svelte:head><title>{tFn('octoguard.commands_title')} — OctoGuard</title></svelte:head>

<header class="og-h">
	<div>
		<h2>{tFn('octoguard.commands_h2')}</h2>
		<p>{tFn('octoguard.commands_desc_pre')} <code>!nom</code> {tFn('octoguard.commands_desc_post')}</p>
	</div>
	<button class="og-btn" onclick={() => showForm = !showForm}>{showForm ? tFn('octoguard.close') : tFn('octoguard.commands_new')}</button>
</header>

{#if form?.error}<div class="og-err">⚠ {form.error}</div>{/if}

{#if showForm}
	<form method="POST" action="?/create" use:enhance={() => async ({ result, update }) => {
		await update()
		if (result.type === 'success') { showForm = false; f_command = ''; f_response = ''; }
	}} class="og-form">
		<div class="og-row">
			<label>{tFn('octoguard.commands_name_label')}<input name="command" type="text" required maxlength="64"
				pattern="[a-z0-9_-]+" bind:value={f_command} placeholder={tFn('octoguard.commands_name_ph')} /></label>
			<label>{tFn('octoguard.commands_cooldown_label')}<input name="cooldown_seconds" type="number" min="0" max="86400" bind:value={f_cooldown} /></label>
		</div>
		<label>{tFn('octoguard.commands_response_label')}<textarea name="response" rows="3" required maxlength="4000" bind:value={f_response}
			placeholder={tFn('octoguard.commands_response_ph')}></textarea></label>
		<div class="og-actions">
			<button type="submit" class="og-btn-primary">{tFn('octoguard.create')}</button>
		</div>
	</form>
{/if}

{#if data.commands.length === 0}
	<div class="og-empty">{tFn('octoguard.commands_empty')} <code>!regles</code>, <code>!faq</code>, etc.</div>
{:else}
	<ul class="og-list">
		{#each data.commands as c (c.id)}
			<li>
				<span class="og-cmd-name">!{c.command}</span>
				<span class="og-cmd-resp">{c.response.slice(0, 80)}{c.response.length > 80 ? '…' : ''}</span>
				<span class="og-cmd-cd">cd:{c.cooldown_seconds}s</span>
				{#if !c.enabled}<span class="og-tag-off">{tFn('octoguard.commands_disabled')}</span>{/if}
				<form method="POST" action="?/delete" use:enhance class="og-inline-form">
					<input type="hidden" name="id" value={c.id} />
					<button type="submit" class="og-btn-link og-btn-link--danger"
						onclick={(e) => { if (!confirm(tFn('octoguard.commands_delete_confirm', { name: c.command }))) e.preventDefault() }}>{tFn('octoguard.delete')}</button>
				</form>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.og-h { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 12px; }
	.og-h h2 { font-size: 16px; font-weight: 600; color: #f1f5f9; margin: 0; }
	.og-h p { font-size: 12px; color: #94a3b8; margin: 4px 0 0; }
	.og-h code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 2px; font-size: 11px; font-family: ui-monospace, monospace; }
	.og-btn { padding: 6px 12px; font-size: 12px; background: transparent; color: #94a3b8; border: 1px solid #374151; border-radius: 3px; cursor: pointer; }
	.og-btn:hover { color: #e2e8f0; }
	.og-btn-primary { padding: 6px 12px; font-size: 12px; color: #fff; background: var(--nx-accent); border: none; border-radius: 3px; cursor: pointer; }
	.og-err { padding: 10px 14px; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #fca5a5; border-radius: 4px; font-size: 13px; margin-bottom: 12px; }
	.og-form { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid rgba(255,255,255,0.06); border-radius: 4px; background: rgba(255,255,255,0.01); margin-bottom: 12px; }
	.og-row { display: grid; grid-template-columns: 1fr 120px; gap: 10px; }
	label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #94a3b8; }
	input, textarea { padding: 6px 8px; font-size: 12px; background: #1f2937; border: 1px solid #374151; border-radius: 3px; color: #e2e8f0; font-family: ui-monospace, monospace; }
	textarea { resize: vertical; }
	.og-actions { display: flex; justify-content: flex-end; }
	.og-list { list-style: none; margin: 0; padding: 0; border: 1px solid rgba(255,255,255,0.05); border-radius: 4px; }
	.og-list li { display: flex; align-items: center; gap: 12px; padding: 10px 12px; font-size: 13px; }
	.og-list li + li { border-top: 1px solid rgba(255,255,255,0.04); }
	.og-cmd-name { font-family: ui-monospace, monospace; color: #a5b4fc; font-weight: 600; min-width: 100px; }
	.og-cmd-resp { color: #cbd5e1; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.og-cmd-cd { font-family: ui-monospace, monospace; font-size: 10px; color: #64748b; }
	.og-tag-off { font-size: 9px; padding: 1px 5px; background: rgba(251,146,60,0.15); color: #fb923c; border-radius: 2px; }
	.og-inline-form { display: inline; }
	.og-btn-link { background: transparent; border: none; color: #94a3b8; font-size: 11px; cursor: pointer; }
	.og-btn-link--danger:hover { color: #fca5a5; }
	.og-empty { padding: 24px; text-align: center; color: #64748b; font-size: 13px; border: 1px dashed rgba(255,255,255,0.08); border-radius: 4px; }
	.og-empty code { background: rgba(255,255,255,0.05); padding: 1px 4px; border-radius: 2px; font-size: 11px; font-family: ui-monospace, monospace; }
</style>
