<script lang="ts">
	// Le message de bienvenue d'OctoGuard : où il s'affiche, ce qu'il dit (avec
	// un aperçu tel que le membre le verra), et le grade donné à l'arrivée.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	const w = untrack(() => (data.welcome ?? {}) as Record<string, any>)
	let enabled = $state<boolean>(!!w.enabled)
	let channelId = $state<string>(w.channel_id ?? '')
	let message = $state<string>(w.public_message ?? '')
	let gradeId = $state<string>(w.auto_grade_id ?? '')
	let busy = $state(false)
	let status = $state<{ ok: boolean; text: string } | null>(null)

	const VARS = ['{user}', '{userMention}', '{communityName}', '{rulesUrl}']
	// Même substitution que le moteur (services/octoguard/welcome.ts).
	const preview = $derived(
		message
			.replace(/\{user\}/g, tFn('og2.wel_sample_user'))
			.replace(/\{userMention\}/g, '@' + tFn('og2.wel_sample_user'))
			.replace(/\{communityName\}/g, data.communityName)
			.replace(/\{rulesUrl\}/g, tFn('og2.wel_sample_rules')),
	)
	let ta: HTMLTextAreaElement | null = $state(null)
	function insert(v: string) {
		if (!ta) { message += v; return }
		const a = ta.selectionStart, b = ta.selectionEnd
		message = message.slice(0, a) + v + message.slice(b)
		queueMicrotask(() => { ta?.focus(); ta?.setSelectionRange(a + v.length, a + v.length) })
	}
	const channelKnown = $derived(!channelId || data.channels.some((c: any) => c.id === channelId))
	const gradeKnown = $derived(!gradeId || data.grades.some((g: any) => g.id === gradeId))

	async function save() {
		if (enabled && !message.trim()) { status = { ok: false, text: tFn('og2.wel_need_message') }; return }
		busy = true; status = null
		try {
			await og(token, '/welcome', 'PUT', { enabled, channel_id: channelId || null, public_message: message.trim() || null, auto_grade_id: gradeId || null })
			status = { ok: true, text: tFn('og2.saved') }
		} catch { status = { ok: false, text: tFn('og2.err_save') } }
		finally { busy = false }
	}
</script>

<svelte:head><title>{tFn('og2.nav_welcome')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M7 11V6a2 2 0 014 0v4 M11 10V5a2 2 0 014 0v5 M15 10V7a2 2 0 014 0v6a8 8 0 01-8 8 7 7 0 01-6-3l-2.5-4a2 2 0 013.4-2L7 13" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_welcome')}</h1>
				<p class="adm-desc">{tFn('og2.wel_desc')}</p>
			</div>
		</div>
		<label class="og-switch"><input type="checkbox" bind:checked={enabled} /><span class="og-track"></span>{tFn(enabled ? 'og2.wel_on' : 'og2.wel_off')}</label>
	</header>

	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}

	<div class="og-grid2">
		<section class="adm-card" style="display:flex;flex-direction:column;gap:1rem">
			<div class="og-field">
				<label class="og-lbl" for="wel-channel">{tFn('og2.wel_channel')}</label>
				<select id="wel-channel" class="adm-input" bind:value={channelId}>
					<option value="">{tFn('og2.wel_channel_none')}</option>
					{#each data.channels as c (c.id)}<option value={c.id}># {c.name}</option>{/each}
					{#if !channelKnown}<option value={channelId}>{tFn('og2.wel_unknown')}</option>{/if}
				</select>
			</div>
			<div class="og-field">
				<label class="og-lbl" for="wel-msg">{tFn('og2.wel_message')}</label>
				<textarea id="wel-msg" class="adm-input" rows="5" maxlength="2000" style="padding:0.6rem 0.75rem;min-height:7rem;resize:vertical" bind:this={ta} bind:value={message} placeholder={tFn('og2.wel_message_ph')}></textarea>
				<div class="adm-actions" style="gap:0.375rem">
					<span class="og-help">{tFn('og2.wel_vars')}</span>
					{#each VARS as v (v)}<button type="button" class="adm-chip" onclick={() => insert(v)}><code>{v}</code></button>{/each}
				</div>
			</div>
			<div class="og-field">
				<label class="og-lbl" for="wel-grade">{tFn('og2.wel_grade')}</label>
				<select id="wel-grade" class="adm-input" bind:value={gradeId}>
					<option value="">{tFn('og2.wel_grade_none')}</option>
					{#each data.grades as g (g.id)}<option value={g.id}>{g.name}</option>{/each}
					{#if !gradeKnown}<option value={gradeId}>{tFn('og2.wel_unknown')}</option>{/if}
				</select>
				<p class="og-help">{tFn('og2.wel_grade_help')}</p>
			</div>
			<div class="adm-actions" style="justify-content:flex-end">
				{#if status}<span class={status.ok ? 'og-okmsg' : 'og-error'} role="status">{status.text}</span>{/if}
				<button type="button" class="adm-btn adm-btn--primary" disabled={busy} onclick={save}>{tFn('og2.save')}</button>
			</div>
		</section>

		<section class="adm-card" aria-labelledby="wel-prev">
			<h2 id="wel-prev" class="adm-title" style="font-size:0.9375rem">{tFn('og2.wel_preview')}</h2>
			<p class="og-help" style="margin:0.25rem 0 0.875rem">{tFn('og2.wel_preview_help')}</p>
			<div class="og-quote" style="white-space:pre-wrap;font-size:0.875rem;padding:0.75rem 0.875rem">{preview || tFn('og2.wel_preview_empty')}</div>
			{#if !enabled}<p class="og-help" style="margin-top:0.75rem">{tFn('og2.wel_preview_off')}</p>{/if}
		</section>
	</div>
</div>
