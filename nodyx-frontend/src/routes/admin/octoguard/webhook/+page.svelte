<script lang="ts">
	// Le webhook : chaque action d'OctoGuard envoyée à une adresse de votre choix,
	// signée avec un secret. Le secret ne revient jamais du serveur.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	const w = untrack(() => (data.webhook ?? {}) as Record<string, any>)
	let enabled = $state<boolean>(!!w.enabled)
	let url = $state<string>(w.url ?? '')
	let secret = $state('')
	let hasSecret = $state<boolean>(!!w.has_secret)
	let busy = $state(false)
	let status = $state<{ ok: boolean; text: string } | null>(null)

	async function save() {
		const u = url.trim()
		if (u && !/^https?:\/\/[^\s]+$/i.test(u)) { status = { ok: false, text: tFn('og2.wh_err_url') }; return }
		if (enabled && !u) { status = { ok: false, text: tFn('og2.wh_need_url') }; return }
		if (secret && (secret.length < 8 || secret.length > 256)) { status = { ok: false, text: tFn('og2.wh_err_secret') }; return }
		busy = true; status = null
		try {
			await og(token, '/webhook', 'PUT', { enabled, url: u || null, ...(secret ? { secret } : {}) })
			if (secret) hasSecret = true
			secret = ''
			status = { ok: true, text: tFn('og2.saved') }
		} catch { status = { ok: false, text: tFn('og2.err_save') } }
		finally { busy = false }
	}
</script>

<svelte:head><title>{tFn('og2.nav_webhook')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_webhook')}</h1>
				<p class="adm-desc">{tFn('og2.wh_desc')}</p>
			</div>
		</div>
		<label class="og-switch"><input type="checkbox" bind:checked={enabled} /><span class="og-track"></span>{tFn(enabled ? 'og2.wh_on' : 'og2.wh_off')}</label>
	</header>

	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}

	<div class="og-grid2">
		<section class="adm-card" style="display:flex;flex-direction:column;gap:1rem">
			<div class="og-field">
				<label class="og-lbl" for="wh-url">{tFn('og2.wh_url')}</label>
				<input id="wh-url" class="adm-input" type="url" bind:value={url} placeholder={tFn('og2.wh_url_ph')} />
			</div>
			<div class="og-field">
				<label class="og-lbl" for="wh-secret">{tFn('og2.wh_secret')}</label>
				<input id="wh-secret" class="adm-input" type="password" autocomplete="new-password" maxlength="256" bind:value={secret} placeholder={tFn(hasSecret ? 'og2.wh_secret_set' : 'og2.wh_secret_ph')} />
				<p class="og-help">{tFn('og2.wh_secret_help')}</p>
			</div>
			<div class="adm-actions" style="justify-content:flex-end">
				{#if status}<span class={status.ok ? 'og-okmsg' : 'og-error'} role="status">{status.text}</span>{/if}
				<button type="button" class="adm-btn adm-btn--primary" disabled={busy} onclick={save}>{tFn('og2.save')}</button>
			</div>
		</section>
		<section class="adm-card" aria-labelledby="wh-how">
			<h2 id="wh-how" class="adm-title" style="font-size:0.9375rem">{tFn('og2.wh_how')}</h2>
			<div class="og-rows" style="margin-top:0.75rem">
				<div class="og-row"><span class="og-ic og-k-acc"><Icon d="M4 4h16v16H4z M8 9h8 M8 13h5" /></span><div class="og-row-body"><b style="font-weight:600">{tFn('og2.wh_format')}</b><div class="og-meta"><code>{'{ action, event_id, target_type, target_id, target_label, metadata, at }'}</code></div></div></div>
				<div class="og-row"><span class="og-ic og-k-acc"><Icon d="M5 11h14v10H5z M8 11V7a4 4 0 018 0v4" /></span><div class="og-row-body"><b style="font-weight:600">{tFn('og2.wh_sign')}</b><div class="og-meta"><code>X-Octoguard-Signature: sha256=…</code> · {tFn('og2.wh_sign_help')}</div></div></div>
				<div class="og-row"><span class="og-ic og-k-acc"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2" /></span><div class="og-row-body"><b style="font-weight:600">{tFn('og2.wh_perf')}</b><div class="og-meta">{tFn('og2.wh_perf_help')}</div></div></div>
			</div>
		</section>
	</div>
</div>
