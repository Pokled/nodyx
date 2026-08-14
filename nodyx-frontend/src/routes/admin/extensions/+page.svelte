<script lang="ts">
	// Administration des extensions.
	//
	// L'ecran de permissions est le coeur de cette page, pas une formalite : il
	// est le seul moment ou un humain decide ce qu'un code inconnu aura le droit
	// de toucher. Il s'affiche donc AVANT toute installation, y compris pour une
	// extension qui ne demande rien, parce que c'est la meme porte pour tout le
	// monde.

	import { page } from '$app/stores'
	import { invalidateAll } from '$app/navigation'
	import { t } from '$lib/i18n'
	import type { PageData } from './$types'

	const tFn = $derived($t)
	let { data }: { data: PageData } = $props()

	interface Inspection {
		manifest:            Record<string, unknown>
		messages:            Record<string, string>
		requested:           string[]
		sensitive:           string[]
		privateNetworkHosts: string[]
		sanitized:           Record<string, string[]>
	}

	let file:       File | null   = $state(null)
	let inspection: Inspection | null = $state(null)
	let issues:     Array<{ code: string; path: string; message: string }> = $state([])
	let busy        = $state(false)
	let notice      = $state('')

	const token = $derived($page.data.token as string | null)

	/** Libelle lisible d'une capacite, sans jargon de code. */
	function capabilityLabel(cap: string): string {
		if (cap === 'identity')                   return tFn('ext_admin.cap_identity')
		if (cap.startsWith('identity:'))          return tFn('ext_admin.cap_identity_field', { field: cap.slice(9) })
		if (cap === 'storage.user')               return tFn('ext_admin.cap_storage_user')
		if (cap === 'storage.instance.read')      return tFn('ext_admin.cap_storage_read')
		if (cap === 'storage.instance.write')     return tFn('ext_admin.cap_storage_write')
		if (cap.startsWith('core:'))              return tFn('ext_admin.cap_core', { scope: cap.slice(5) })
		if (cap.startsWith('net:'))               return tFn('ext_admin.cap_net', { host: cap.slice(4) })
		return cap
	}

	function resolve(value: unknown): string {
		const raw = String(value ?? '')
		if (!raw.startsWith('@')) return raw
		return inspection?.messages?.[raw.slice(1)] ?? raw.slice(1)
	}

	async function inspect(picked: File) {
		busy = true; issues = []; inspection = null; notice = ''
		const body = new FormData()
		body.append('file', picked)
		try {
			const res = await fetch('/api/v1/admin/extensions/inspect', {
				method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
			})
			const json = await res.json()
			if (!res.ok) { issues = json.issues ?? [{ code: json.code ?? 'ERROR', path: '', message: json.error ?? '' }]; return }
			inspection = json
			file = picked
		} finally {
			busy = false
		}
	}

	async function confirmInstall() {
		if (!inspection || !file) return
		busy = true
		const body = new FormData()
		body.append('file', file)
		// La decision voyage explicitement : on accorde ce qui a ete montre, et
		// rien d'autre. Un ecran qui affiche sans transmettre serait decoratif.
		body.append('accept', JSON.stringify(inspection.requested))
		try {
			const res = await fetch('/api/v1/admin/extensions/install', {
				method: 'POST', headers: { Authorization: `Bearer ${token}` }, body,
			})
			const json = await res.json()
			if (!res.ok) { issues = json.issues ?? []; return }
			notice = tFn('ext_admin.installed', { name: json.id })
			inspection = null; file = null
			await invalidateAll()
		} finally {
			busy = false
		}
	}

	async function toggle(id: string, enabled: boolean) {
		await fetch(`/api/v1/admin/extensions/${id}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ enabled }),
		})
		await invalidateAll()
	}

	async function uninstall(id: string) {
		if (!confirm(tFn('ext_admin.confirm_uninstall', { name: id }))) return
		await fetch(`/api/v1/admin/extensions/${id}`, {
			method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
		})
		await invalidateAll()
	}
</script>

<div class="ea">
	<header class="ea-head">
		<h1>{tFn('ext_admin.title')}</h1>
		<p>{tFn('ext_admin.intro')}</p>
	</header>

	{#if notice}<div class="ea-notice">{notice}</div>{/if}

	<!-- ── Installation ────────────────────────────────────────────────── -->
	<section class="ea-card">
		<h2>{tFn('ext_admin.install_title')}</h2>

		{#if !inspection}
			<p class="ea-muted">{tFn('ext_admin.install_hint')}</p>
			<label class="ea-file">
				<input
					type="file" accept=".nyx,.zip" disabled={busy}
					onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; if (f) inspect(f) }}
				/>
				<span>{busy ? tFn('ext_admin.reading') : tFn('ext_admin.pick_file')}</span>
			</label>
		{:else}
			<!-- L'ecran de permissions. Il dit ce que l'extension pourra TOUCHER,
			     pas ce qu'elle fait : c'est la question a laquelle un admin doit
			     repondre. -->
			<div class="ea-perm">
				<div class="ea-perm-id">
					<strong>{resolve(inspection.manifest.label)}</strong>
					<span class="ea-version">{String(inspection.manifest.version ?? '')}</span>
				</div>
				<p class="ea-muted">{resolve(inspection.manifest.description)}</p>

				{#if inspection.requested.length === 0}
					<p class="ea-none">{tFn('ext_admin.no_permission')}</p>
				{:else}
					<p class="ea-perm-lead">{tFn('ext_admin.can_touch')}</p>
					<ul class="ea-caps">
						{#each inspection.requested as cap (cap)}
							<li class:sensitive={inspection.sensitive.includes(cap)}>
								{capabilityLabel(cap)}
								{#if inspection.sensitive.includes(cap)}
									<span class="ea-flag">{tFn('ext_admin.sensitive')}</span>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}

				{#if inspection.privateNetworkHosts.length}
					<p class="ea-warn">
						{tFn('ext_admin.private_network', { hosts: inspection.privateNetworkHosts.join(', ') })}
					</p>
				{/if}

				{#if Object.keys(inspection.sanitized).length}
					<p class="ea-muted ea-small">
						{tFn('ext_admin.sanitized', { files: Object.keys(inspection.sanitized).join(', ') })}
					</p>
				{/if}

				<div class="ea-actions">
					<button class="ea-btn ea-btn--go" disabled={busy} onclick={confirmInstall}>
						{tFn('ext_admin.accept_install')}
					</button>
					<button class="ea-btn" disabled={busy} onclick={() => { inspection = null; file = null }}>
						{tFn('common.cancel')}
					</button>
				</div>
			</div>
		{/if}

		{#if issues.length}
			<ul class="ea-issues">
				{#each issues as issue (issue.code + issue.path)}
					<li><code>{issue.code}</code> {issue.path ? `· ${issue.path}` : ''} <span>{issue.message}</span></li>
				{/each}
			</ul>
		{/if}
	</section>

	<!-- ── Installees ──────────────────────────────────────────────────── -->
	<section class="ea-card">
		<h2>{tFn('ext_admin.installed_title')}</h2>

		{#if data.extensions.length === 0}
			<p class="ea-muted">{tFn('ext_admin.none_installed')}</p>
		{:else}
			<ul class="ea-list">
				{#each data.extensions as ext (ext.id)}
					<li class="ea-item">
						<div class="ea-item-main">
							<strong>{ext.id}</strong>
							<span class="ea-version">{ext.version}</span>
							{#if !ext.enabled}<span class="ea-off">{tFn('ext_admin.disabled')}</span>{/if}
							<div class="ea-item-caps">
								{ext.granted.length
									? ext.granted.map(capabilityLabel).join(' · ')
									: tFn('ext_admin.no_permission')}
							</div>
						</div>
						<div class="ea-item-actions">
							<button class="ea-btn" onclick={() => toggle(ext.id, !ext.enabled)}>
								{ext.enabled ? tFn('ext_admin.disable') : tFn('ext_admin.enable')}
							</button>
							<button class="ea-btn ea-btn--danger" onclick={() => uninstall(ext.id)}>
								{tFn('ext_admin.uninstall')}
							</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.ea { max-width: 900px; display: flex; flex-direction: column; gap: 20px; }
	.ea-head h1 { font-size: 20px; font-weight: 600; margin: 0 0 4px; }
	.ea-head p  { margin: 0; font-size: 13px; color: var(--nx-text-muted, #6b7280); }

	.ea-card {
		background: var(--nx-bg-elevated, rgba(255,255,255,.02));
		border: 1px solid var(--nx-border, rgba(255,255,255,.08));
		border-radius: 8px;
		padding: 18px;
	}
	.ea-card h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; }

	.ea-muted { color: var(--nx-text-muted, #6b7280); font-size: 13px; margin: 0 0 12px; }
	.ea-small { font-size: 12px; }

	.ea-file input { display: none; }
	.ea-file span {
		display: inline-block; padding: 8px 14px; font-size: 13px; cursor: pointer;
		border: 1px solid var(--nx-border, rgba(255,255,255,.12)); border-radius: 6px;
	}

	.ea-perm-id { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
	.ea-version { font-size: 11px; color: var(--nx-text-muted, #6b7280); font-family: ui-monospace, monospace; }
	.ea-perm-lead { font-size: 13px; font-weight: 600; margin: 12px 0 6px; }
	.ea-none { font-size: 13px; color: var(--nx-text-muted, #6b7280); margin: 12px 0; }

	.ea-caps { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-direction: column; gap: 4px; }
	.ea-caps li { font-size: 13px; padding: 6px 10px; border-radius: 6px; background: rgba(255,255,255,.03); }
	.ea-caps li.sensitive { border-left: 2px solid #f59e0b; }
	.ea-flag { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #f59e0b; margin-left: 6px; }
	.ea-warn { font-size: 13px; color: #f59e0b; margin: 0 0 12px; }

	.ea-actions { display: flex; gap: 8px; margin-top: 4px; }
	.ea-btn {
		font-size: 13px; padding: 7px 14px; border-radius: 6px; cursor: pointer;
		border: 1px solid var(--nx-border, rgba(255,255,255,.12));
		background: transparent; color: inherit;
	}
	.ea-btn--go     { border-color: rgba(167,139,250,.4); }
	.ea-btn--danger { border-color: rgba(239,68,68,.3); color: #fca5a5; }
	.ea-btn:disabled { opacity: .5; cursor: default; }

	.ea-issues { list-style: none; margin: 12px 0 0; padding: 0; font-size: 12px; }
	.ea-issues li { padding: 4px 0; color: #fca5a5; }
	.ea-issues code { font-family: ui-monospace, monospace; }

	.ea-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
	.ea-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--nx-border, rgba(255,255,255,.06)); }
	.ea-item:first-child { border-top: 0; }
	.ea-item-main strong { font-size: 13px; }
	.ea-item-caps { font-size: 12px; color: var(--nx-text-muted, #6b7280); margin-top: 2px; }
	.ea-item-actions { display: flex; gap: 6px; flex: none; }
	.ea-off { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: #f59e0b; }
	.ea-notice { font-size: 13px; padding: 10px 14px; border-radius: 6px; border: 1px solid rgba(16,185,129,.3); color: #6ee7b7; }
</style>
