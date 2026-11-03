<script lang="ts">
	// Les commandes du chat (!regles, !faq…) : OctoGuard répond à la place de l'équipe.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import type { PageData } from './$types'

	type Cmd = { id: string; command: string; response: string; cooldown_seconds: number; enabled: boolean }
	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	let commands = $state<Cmd[]>(untrack(() => data.commands as Cmd[]))
	let name = $state('')
	let response = $state('')
	let cooldown = $state(5)
	let creating = $state(false)
	let formErr = $state<string | null>(null)
	const NAME = /^[a-z0-9_-]{1,64}$/

	async function create() {
		const n = name.trim().replace(/^!/, '').toLowerCase()
		if (!NAME.test(n)) { formErr = tFn('og2.cmd_err_name'); return }
		if (!response.trim()) { formErr = tFn('og2.cmd_err_response'); return }
		if (!Number.isInteger(cooldown) || cooldown < 0 || cooldown > 86400) { formErr = tFn('og2.err_range', { field: tFn('og2.cmd_cooldown'), min: 0, max: 86400 }); return }
		if (commands.some((c) => c.command === n)) { formErr = tFn('og2.cmd_err_exists', { n }); return }
		creating = true; formErr = null
		try {
			const res = await og<{ command: Cmd }>(token, '/commands', 'POST', { command: n, response: response.trim(), cooldown_seconds: cooldown, enabled: true })
			commands = [...commands, res.command]
			name = ''; response = ''; cooldown = 5
		} catch { formErr = tFn('og2.err_save') }
		finally { creating = false }
	}

	let rowErr = $state<string | null>(null)
	async function toggle(c: Cmd, on: boolean) {
		commands = commands.map((x) => (x.id === c.id ? { ...x, enabled: on } : x)); rowErr = null
		try { await og(token, `/commands/${c.id}`, 'PUT', { enabled: on }) }
		catch { commands = commands.map((x) => (x.id === c.id ? { ...x, enabled: !on } : x)); rowErr = tFn('og2.err_save') }
	}
	let confirmId = $state<string | null>(null)
	async function remove(c: Cmd) {
		rowErr = null
		try { await og(token, `/commands/${c.id}`, 'DELETE'); commands = commands.filter((x) => x.id !== c.id) }
		catch { rowErr = tFn('og2.err_save') }
		finally { confirmId = null }
	}
</script>

<svelte:head><title>{tFn('og2.nav_commands')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M5 7l5 5-5 5 M12 17h7" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_commands')}</h1>
				<p class="adm-desc">{tFn('og2.cmd_desc')}</p>
			</div>
		</div>
	</header>

	<div class="og-grid2">
		<section class="adm-card" aria-labelledby="cmd-list">
			<h2 id="cmd-list" class="adm-title" style="font-size:0.9375rem;margin-bottom:0.75rem">{tFn('og2.cmd_list', { n: commands.length })}</h2>
			{#if data.failed}
				<p class="og-error" role="alert">{tFn('og2.err_load')}</p>
			{:else if commands.length === 0}
				<p class="og-empty">{tFn('og2.cmd_none')}</p>
			{:else}
				<div class="og-rows">
					{#each commands as c (c.id)}
						<div class="og-row">
							<code class="og-glyph" style="font-size:0.78rem">!{c.command}</code>
							<div class="og-row-body">
								<div class="og-meta" style="color:var(--nx-text);white-space:pre-wrap;overflow-wrap:anywhere">{c.response.length > 160 ? c.response.slice(0, 160) + '…' : c.response}</div>
								<div class="og-meta">{tFn('og2.cmd_cooldown_n', { n: c.cooldown_seconds })}</div>
							</div>
							{#if confirmId === c.id}
								<span class="adm-actions">
									<button type="button" class="adm-btn adm-btn--danger adm-btn--sm" onclick={() => remove(c)}>{tFn('og2.delete_yes')}</button>
									<button type="button" class="adm-btn adm-btn--sm" onclick={() => (confirmId = null)}>{tFn('og2.cancel')}</button>
								</span>
							{:else}
								<label class="og-switch"><input type="checkbox" checked={c.enabled} onchange={(e) => toggle(c, e.currentTarget.checked)} aria-label={tFn('og2.cmd_toggle', { n: c.command })} /><span class="og-track"></span></label>
								<button type="button" class="adm-btn adm-btn--sm adm-btn--icon" onclick={() => (confirmId = c.id)} aria-label={tFn('og2.cmd_delete', { n: c.command })}><Icon d="M4 7h16 M10 11v6 M14 11v6 M5 7l1 13h12l1-13 M9 7V4h6v3" /></button>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
			{#if rowErr}<p class="og-error" role="alert">{rowErr}</p>{/if}
		</section>

		<section class="adm-card" aria-labelledby="cmd-new" style="display:flex;flex-direction:column;gap:0.875rem">
			<h2 id="cmd-new" class="adm-title" style="font-size:0.9375rem">{tFn('og2.cmd_new')}</h2>
			<div class="og-field">
				<label class="og-lbl" for="cmd-name">{tFn('og2.cmd_name')}</label>
				<div class="og-inline"><code class="og-glyph">!</code><input id="cmd-name" class="adm-input" style="flex:1" maxlength="64" bind:value={name} placeholder={tFn('og2.cmd_name_ph')} /></div>
				<p class="og-help">{tFn('og2.cmd_name_help')}</p>
			</div>
			<div class="og-field">
				<label class="og-lbl" for="cmd-resp">{tFn('og2.cmd_response')}</label>
				<textarea id="cmd-resp" class="adm-input" rows="4" maxlength="4000" style="padding:0.6rem 0.75rem;min-height:6rem;resize:vertical" bind:value={response} placeholder={tFn('og2.cmd_response_ph')}></textarea>
			</div>
			<label class="og-inline"><input class="adm-input og-num" type="number" min="0" max="86400" bind:value={cooldown} /><span>{tFn('og2.cmd_cooldown')}</span></label>
			{#if formErr}<p class="og-error" role="alert">{formErr}</p>{/if}
			<div class="adm-actions" style="justify-content:flex-end"><button type="button" class="adm-btn adm-btn--primary" disabled={creating} onclick={create}><Icon d="M12 5v14 M5 12h14" />{tFn('og2.cmd_create')}</button></div>
		</section>
	</div>
</div>
