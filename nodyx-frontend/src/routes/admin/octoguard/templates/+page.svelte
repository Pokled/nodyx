<script lang="ts">
	// Modèles : le profil de base de Nodyx (installé, personnalisé, ou retiré et
	// réinstallable), l'export de vos règles, et l'import d'un profil avec un
	// aperçu AVANT d'appliquer. L'import ajoute et met à jour, ne supprime jamais.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og, OgError } from '$lib/octoguard/api'
	import { API_URL } from '$lib/api'
	import { ruleIcon, describe, type Rule } from '$lib/octoguard/rules'
	import type { PageData } from './$types'

	type Preset = { key: string; name: { fr: string; en: string }; type: string; params: Record<string, any>; conditions?: Rule['conditions']; installed: boolean; customized: boolean }
	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const lang = $derived(String($locale ?? 'fr').startsWith('fr') ? 'fr' : 'en')

	let presets = $state<Preset[]>(untrack(() => (data.base?.presets ?? []) as Preset[]))
	const asRule = (p: Preset) => ({ ...p, name: p.name[lang], scopes: [], action: 'report_only', dry_run: false, enabled: true } as unknown as Rule)

	let busyKey = $state<string | null>(null)
	let presetErr = $state<string | null>(null)
	async function reinstall(p: Preset) {
		busyKey = p.key; presetErr = null
		try {
			await og(token, `/profile/base/${encodeURIComponent(p.key)}`, 'POST')
			presets = presets.map((x) => (x.key === p.key ? { ...x, installed: true, customized: false } : x))
		} catch (e) {
			if (e instanceof OgError && e.code === 'ALREADY_INSTALLED') presets = presets.map((x) => (x.key === p.key ? { ...x, installed: true } : x))
			else presetErr = tFn('og2.tpl_reinstall_err')
		} finally { busyKey = null }
	}

	// Export : un fichier JSON, téléchargé par le navigateur.
	let exporting = $state(false)
	let exportErr = $state<string | null>(null)
	async function exportRules() {
		exporting = true; exportErr = null
		try {
			const res = await fetch(`${API_URL}/admin/octoguard/profile/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
			if (!res.ok) throw new Error(String(res.status))
			const blob = new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' })
			const a = document.createElement('a')
			a.href = URL.createObjectURL(blob)
			a.download = `octoguard-profile-${new Date().toISOString().slice(0, 10)}.json`
			a.click()
			setTimeout(() => URL.revokeObjectURL(a.href), 1000)
		} catch { exportErr = tFn('og2.tpl_export_err') }
		finally { exporting = false }
	}

	// Import : lire le fichier, montrer l'aperçu, appliquer seulement après accord.
	type Preview = { add: string[]; update: string[]; unchanged: string[]; problems: Array<{ rule: string; reason: string }> }
	let profile = $state<unknown>(null)
	let fileName = $state('')
	let preview = $state<Preview | null>(null)
	let importErr = $state<string | null>(null)
	let importing = $state(false)
	let applied = $state<Preview | null>(null)
	async function onFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0]
		preview = null; applied = null; importErr = null; profile = null
		if (!f) return
		fileName = f.name
		if (f.size > 1_000_000) { importErr = tFn('og2.tpl_file_big'); return }
		try { profile = JSON.parse(await f.text()) } catch { importErr = tFn('og2.tpl_file_json'); return }
		try { preview = (await og<{ preview: Preview }>(token, '/profile/preview', 'POST', { profile })).preview }
		catch { importErr = tFn('og2.tpl_file_invalid'); profile = null }
	}
	async function applyImport() {
		importing = true; importErr = null
		try {
			applied = (await og<{ result: Preview }>(token, '/profile/import', 'POST', { profile })).result
			preview = null; profile = null
		} catch { importErr = tFn('og2.tpl_import_err') }
		finally { importing = false }
	}
	const PROBLEMS = ['invalid_params', 'regex_missing_pattern', 'regex_unsafe', 're2_required']
	const reason = (r: string) => tFn(PROBLEMS.includes(r) ? `og2.imp_reason_${r}` : 'og2.imp_reason_other')
</script>

<svelte:head><title>{tFn('og2.nav_templates')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M12 3l9 5-9 5-9-5z M3 13l9 5 9-5" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_templates')}</h1>
				<p class="adm-desc">{tFn('og2.tpl_desc')}</p>
			</div>
		</div>
	</header>

	<section class="adm-card" aria-labelledby="tpl-base">
		<div class="adm-card-head">
			<div>
				<h2 id="tpl-base" class="adm-title" style="font-size:0.9375rem">{tFn('og2.tpl_base_title')}</h2>
				<p class="og-help" style="margin-top:0.125rem">{tFn('og2.tpl_base_desc', { v: data.base?.version ?? 1 })}</p>
			</div>
			<span class="adm-pill adm-pill--ok">{tFn('og2.tpl_installed_count', { n: presets.filter((p) => p.installed).length, total: presets.length })}</span>
		</div>
		{#if data.failed}
			<p class="og-error" role="alert">{tFn('og2.err_load')}</p>
		{:else}
			<div class="og-rows">
				{#each presets as p (p.key)}
					<div class="og-row">
						<span class="og-rule-ico"><Icon d={ruleIcon(p)} /></span>
						<div class="og-row-body">
							<div><b style="font-weight:600">{p.name[lang]}</b></div>
							<div class="og-meta">{describe(asRule(p), tFn)}</div>
						</div>
						{#if !p.installed}
							<button type="button" class="adm-btn adm-btn--sm" disabled={busyKey === p.key} onclick={() => reinstall(p)}><Icon d="M12 5v14 M5 12h14" />{tFn('og2.tpl_reinstall')}</button>
						{:else if p.customized}
							<span class="adm-pill" title={tFn('og2.tpl_customized_help')}>{tFn('og2.customized')}</span>
						{:else}
							<span class="adm-pill adm-pill--ok">{tFn('og2.tpl_installed')}</span>
						{/if}
					</div>
				{/each}
			</div>
			{#if presetErr}<p class="og-error" role="alert">{presetErr}</p>{/if}
			<p class="og-help" style="margin-top:0.75rem">{tFn('og2.tpl_base_note')}</p>
		{/if}
	</section>

	<div class="og-grid2">
		<section class="adm-card" aria-labelledby="tpl-export">
			<h2 id="tpl-export" class="adm-title" style="font-size:0.9375rem">{tFn('og2.tpl_export_title')}</h2>
			<p class="og-help" style="margin:0.25rem 0 0.875rem">{tFn('og2.tpl_export_desc')}</p>
			<button type="button" class="adm-btn" disabled={exporting} onclick={exportRules}><Icon d="M12 4v11m0 0l4-4m-4 4l-4-4 M4 20h16" />{tFn('og2.tpl_export_btn')}</button>
			{#if exportErr}<p class="og-error" role="alert">{exportErr}</p>{/if}
		</section>

		<section class="adm-card" aria-labelledby="tpl-import">
			<h2 id="tpl-import" class="adm-title" style="font-size:0.9375rem">{tFn('og2.tpl_import_title')}</h2>
			<p class="og-help" style="margin:0.25rem 0 0.875rem">{tFn('og2.tpl_import_desc')}</p>
			<label class="adm-btn" style="cursor:pointer">
				<Icon d="M12 16V5m0 0l4 4m-4-4l-4 4 M4 20h16" />{tFn('og2.tpl_import_pick')}
				<input type="file" accept="application/json,.json" class="sr-only" onchange={onFile} />
			</label>
			{#if fileName}<span class="og-help" style="margin-left:0.5rem">{fileName}</span>{/if}
			{#if importErr}<p class="og-error" role="alert">{importErr}</p>{/if}

			{#if preview}
				<div class="og-rows" style="margin-top:0.875rem">
					{#each [['add', 'og-k-ok'], ['update', 'og-k-report'], ['unchanged', 'og-k-observe']] as [k, tone] (k)}
						{@const list = (preview as any)[k] as string[]}
						{#if list.length}
							<div class="og-row"><span class="adm-pill og-tone {tone}">{tFn(`og2.imp_${k}`, { n: list.length })}</span><div class="og-row-body og-meta">{list.join(', ')}</div></div>
						{/if}
					{/each}
					{#each preview.problems as pb, i (i)}
						<div class="og-row"><span class="adm-pill og-tone og-k-delete">{tFn('og2.imp_refused')}</span><div class="og-row-body og-meta"><b>{pb.rule}</b> : {reason(pb.reason)}</div></div>
					{/each}
				</div>
				<p class="og-help" style="margin:0.75rem 0">{tFn('og2.imp_never_deletes')}</p>
				<div class="adm-actions">
					<button type="button" class="adm-btn adm-btn--primary" disabled={importing || preview.add.length + preview.update.length === 0} onclick={applyImport}>{tFn('og2.imp_apply', { n: preview.add.length + preview.update.length })}</button>
					<button type="button" class="adm-btn" onclick={() => { preview = null; profile = null; fileName = '' }}>{tFn('og2.cancel')}</button>
				</div>
			{/if}
			{#if applied}
				<p class="og-okmsg" role="status">{tFn('og2.imp_done', { a: applied.add.length, u: applied.update.length, r: applied.problems.length })} <a class="og-linkbtn" href="/admin/octoguard/rules">{tFn('og2.nav_rules')}</a></p>
			{/if}
		</section>
	</div>
</div>
