<script lang="ts">
	// La page d'atterrissage du bouton « Installer » du magasin.
	//
	// Le lien ne fait QUE pre-remplir cet ecran : rien n'est telecharge ni
	// installe avant que l'admin ait vu ce que l'extension demande et dit oui.
	// Un lien fabrique ne peut donc pas installer quoi que ce soit tout seul.
	// cf SPECS/NODYX_SDK_CDC.md §9.5

	import { page } from '$app/stores'
	import { onMount } from 'svelte'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	interface Inspection {
		manifest:            Record<string, unknown>
		messages:            Record<string, string>
		requested:           string[]
		sensitive:           string[]
		privateNetworkHosts: string[]
		sanitized:           Record<string, string[]>
		version:             string
	}

	const token    = $derived($page.data.token as string | null)
	const registry = $derived($page.url.searchParams.get('src') ?? '')
	const id       = $derived($page.url.searchParams.get('id') ?? '')
	const version  = $derived($page.url.searchParams.get('v') ?? '')

	let inspection: Inspection | null = $state(null)
	let issues: Array<{ code: string; path?: string; message: string }> = $state([])
	let registries: string[] = $state([])
	let busy = $state(true)
	let done = $state(false)

	function capabilityLabel(cap: string): string {
		if (cap === 'identity')               return tFn('ext_admin.cap_identity')
		if (cap.startsWith('identity:'))      return tFn('ext_admin.cap_identity_field', { field: cap.slice(9) })
		if (cap === 'storage.user')           return tFn('ext_admin.cap_storage_user')
		if (cap === 'storage.instance.read')  return tFn('ext_admin.cap_storage_read')
		if (cap === 'storage.instance.write') return tFn('ext_admin.cap_storage_write')
		if (cap.startsWith('core:'))          return tFn('ext_admin.cap_core', { scope: cap.slice(5) })
		if (cap.startsWith('net:'))           return tFn('ext_admin.cap_net', { host: cap.slice(4) })
		return cap
	}

	function resolve(value: unknown): string {
		const raw = String(value ?? '')
		if (!raw.startsWith('@')) return raw
		return inspection?.messages?.[raw.slice(1)] ?? raw.slice(1)
	}

	async function post(body: Record<string, unknown>) {
		return fetch('/api/v1/admin/extensions/from-registry', {
			method: 'POST',
			headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ registry, id, version, ...body }),
		})
	}

	onMount(async () => {
		if (!id || !version || !registry) { busy = false; return }
		try {
			const res = await post({ dryRun: true })
			const json = await res.json()
			if (!res.ok) {
				issues     = json.issues ?? [{ code: json.code ?? 'ERROR', message: json.error ?? '' }]
				registries = json.registries ?? []
				return
			}
			inspection = json
		} finally {
			busy = false
		}
	})

	async function confirmInstall() {
		if (!inspection) return
		busy = true
		try {
			const res = await post({ accept: inspection.requested })
			const json = await res.json()
			if (!res.ok) { issues = json.issues ?? [{ code: json.code ?? 'ERROR', message: json.error ?? '' }]; return }
			done = true
		} finally {
			busy = false
		}
	}
</script>

<div class="ei">
	<h1>{tFn('ext_install.title')}</h1>

	{#if !id || !version || !registry}
		<p class="ei-muted">{tFn('ext_install.bad_link')}</p>
		<a class="ei-btn" href="/admin/extensions">{tFn('ext_install.back')}</a>

	{:else if done}
		<p class="ei-ok">{tFn('ext_admin.installed', { name: id })}</p>
		<a class="ei-btn" href="/admin/extensions">{tFn('ext_install.back')}</a>

	{:else if busy && !inspection}
		<p class="ei-muted">{tFn('ext_install.reading', { registry })}</p>

	{:else if inspection}
		<p class="ei-from">{tFn('ext_install.from', { registry })}</p>

		<div class="ei-id">
			<strong>{resolve(inspection.manifest.label)}</strong>
			<span class="ei-version">{inspection.version}</span>
		</div>
		<p class="ei-muted">{resolve(inspection.manifest.description)}</p>

		{#if inspection.requested.length === 0}
			<p class="ei-none">{tFn('ext_admin.no_permission')}</p>
		{:else}
			<p class="ei-lead">{tFn('ext_admin.can_touch')}</p>
			<ul class="ei-caps">
				{#each inspection.requested as cap (cap)}
					<li class:sensitive={inspection.sensitive.includes(cap)}>
						{capabilityLabel(cap)}
						{#if inspection.sensitive.includes(cap)}<span class="ei-flag">{tFn('ext_admin.sensitive')}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if inspection.privateNetworkHosts.length}
			<p class="ei-warn">{tFn('ext_admin.private_network', { hosts: inspection.privateNetworkHosts.join(', ') })}</p>
		{/if}

		<div class="ei-actions">
			<button class="ei-btn ei-btn--go" disabled={busy} onclick={confirmInstall}>{tFn('ext_admin.accept_install')}</button>
			<a class="ei-btn" href="/admin/extensions">{tFn('common.cancel')}</a>
		</div>
	{/if}

	{#if issues.length}
		<ul class="ei-issues">
			{#each issues as issue (issue.code + (issue.path ?? ''))}
				<li><code>{issue.code}</code> <span>{issue.message}</span></li>
			{/each}
		</ul>
		{#if registries.length}
			<p class="ei-muted">{tFn('ext_install.allowed_registries', { list: registries.join(', ') })}</p>
		{/if}
	{/if}
</div>

<style>
	.ei { max-width: 640px; display: flex; flex-direction: column; gap: 10px; }
	.ei h1 { font-size: 20px; font-weight: 600; margin: 0; }
	.ei-from { font-size: 12px; color: var(--nx-text-muted, #6b7280); margin: 0; }
	.ei-id { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
	.ei-version { font-size: 11px; font-family: ui-monospace, monospace; color: var(--nx-text-muted, #6b7280); }
	.ei-muted { color: var(--nx-text-muted, #6b7280); font-size: 13px; margin: 0; }
	.ei-lead { font-size: 13px; font-weight: 600; margin: 10px 0 4px; }
	.ei-none { font-size: 13px; color: var(--nx-text-muted, #6b7280); margin: 10px 0; }
	.ei-caps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.ei-caps li { font-size: 13px; padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,.03); }
	.ei-caps li.sensitive { border-left: 2px solid #f59e0b; }
	.ei-flag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #f59e0b; margin-left: 6px; }
	.ei-warn { font-size: 13px; color: #f59e0b; margin: 6px 0 0; }
	.ei-actions { display: flex; gap: 8px; margin-top: 14px; }
	.ei-btn {
		font-size: 13px; padding: 7px 14px; border-radius: 6px; cursor: pointer; text-decoration: none;
		border: 1px solid var(--nx-border, rgba(255,255,255,.12)); background: transparent; color: inherit;
		display: inline-block;
	}
	.ei-btn--go { border-color: rgba(167,139,250,.4); }
	.ei-btn:disabled { opacity: .5; cursor: default; }
	.ei-ok { font-size: 13px; color: #6ee7b7; margin: 0; }
	.ei-issues { list-style: none; margin: 10px 0 0; padding: 0; font-size: 12px; }
	.ei-issues li { padding: 3px 0; color: #fca5a5; }
	.ei-issues code { font-family: ui-monospace, monospace; }
</style>
