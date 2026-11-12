<script lang="ts">
	// Modèles prêts (maquette validée) : six profils de communauté illustrés.
	// « Voir le détail » ouvre ce qui change, calculé par le serveur
	// (/profile/preview) ; « Appliquer » passe par /profile/import. Rien n'est
	// supprimé, et les règles que l'admin a personnalisées ne sont pas touchées.
	import { page } from '$app/state'
	import { untrack } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import { portal } from '$lib/actions/portal'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import { API_URL } from '$lib/api'
	import { describe, ruleIcon, type Rule } from '$lib/octoguard/rules'
	import { TEMPLATES, buildProfile, resolveRule, type Template } from '$lib/octoguard/templates'
	import type { PageData } from './$types'

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const lang = $derived(String($locale ?? 'fr').startsWith('fr') ? 'fr' : 'en')

	type Preset = { key: string; name: { fr: string; en: string }; type: string; params: Record<string, any>; conditions?: any; installed: boolean; customized: boolean }
	let presets = $state<Preset[]>(untrack(() => (data.base?.presets ?? []) as Preset[]))
	let rules = $state<Rule[]>(untrack(() => data.rules as Rule[]))
	const installed = $derived(presets.filter((p) => p.installed).length)
	const customizedKeys = $derived(new Set(rules.filter((r) => r.preset_key && r.customized).map((r) => r.preset_key as string)))

	const TONE: Record<string, string> = { ok: 'og-k-ok', report: 'og-k-report', warn: 'og-k-warn', observe: 'og-k-observe', hold: 'og-k-acc', delete: 'og-k-delete' }

	// ── Fenêtre « ce qui change » ────────────────────────────────────────────
	type Preview = { add: string[]; update: string[]; unchanged: string[]; problems: Array<{ rule: string; reason: string }> }
	type Row = { name: string; desc: string; icon: string; state: 'add' | 'update' | 'unchanged' | 'kept' | 'refused' | 'missing' | 'installed' | 'customized' }
	let modal = $state<null | { kind: 'base' } | { kind: 'tpl'; tpl: Template } | { kind: 'file'; name: string; profile: any }>(null)
	let rows = $state<Row[]>([])
	let preview = $state<Preview | null>(null)
	let sendProfile: any = null
	// Le modèle allume « Tu es sûr ? » et il est éteint ici : un changement de plus
	let nudgeChange = $state(false)
	const NUDGE_ICON = 'M21 12a8 8 0 01-11.6 7.1L3 21l1.9-6.4A8 8 0 1121 12z M12 8v4 M12 15h.01'
	let busy = $state(false)
	let error = $state<string | null>(null)
	let done = $state<string | null>(null)

	const asRule = (r: any) => ({ scopes: [], dry_run: false, enabled: true, ...r }) as Rule
	function close() { modal = null; preview = null; rows = []; error = null; done = null; sendProfile = null; nudgeChange = false }

	async function openTemplate(tpl: Template) {
		close(); modal = { kind: 'tpl', tpl }; busy = true
		const all = tpl.rules.map((r) => resolveRule(r, lang))
		const kept = all.filter((r) => r.preset_key && customizedKeys.has(r.preset_key))
		const send = all.filter((r) => !kept.includes(r))
		sendProfile = { ...buildProfile(tpl, lang, tFn(`og2.tpl_${tpl.id}_name`)), rules: send }
		try {
			preview = send.length ? (await og<{ preview: Preview }>(token, '/profile/preview', 'POST', { profile: sendProfile })).preview : { add: [], update: [], unchanged: [], problems: [] }
			const st = (n: string): Row['state'] => preview!.problems.some((p) => p.rule === n) ? 'refused' : preview!.add.includes(n) ? 'add' : preview!.update.includes(n) ? 'update' : 'unchanged'
			rows = [
				...send.map((r) => ({ name: r.name, desc: describe(asRule(r), tFn), icon: ruleIcon(asRule(r)), state: st(r.name) })),
				...kept.map((r) => ({ name: r.name, desc: describe(asRule(r), tFn), icon: ruleIcon(asRule(r)), state: 'kept' as const })),
			]
			if (tpl.nudge) {
				const cur = await og<{ nudge?: boolean }>(token, '/settings')
				nudgeChange = !cur.nudge
				rows = [...rows, { name: tFn('og2.tpl_nudge_name'), desc: tFn('og2.tpl_nudge_desc'), icon: NUDGE_ICON, state: nudgeChange ? 'add' : 'unchanged' }]
			}
		} catch { error = tFn('og2.tpl_preview_err') }
		finally { busy = false }
	}
	function openBase() {
		close(); modal = { kind: 'base' }
		rows = presets.map((p) => ({ name: p.name[lang], desc: describe(asRule(p), tFn), icon: ruleIcon(asRule(p)), state: !p.installed ? 'missing' : p.customized ? 'customized' : 'installed' }))
	}
	async function apply() {
		if (!sendProfile) return
		busy = true; error = null
		try {
			const res = sendProfile.rules?.length
				? (await og<{ result: Preview }>(token, '/profile/import', 'POST', { profile: sendProfile })).result
				: { add: [], update: [], unchanged: [], problems: [] }
			const nudgeAdded = nudgeChange
			if (nudgeChange) { await og(token, '/settings', 'PUT', { nudge: true }); nudgeChange = false }
			done = tFn('og2.imp_done', { a: res.add.length, u: res.update.length, r: res.problems.length }) + (nudgeAdded ? ' ' + tFn('og2.tpl_nudge_done') : '')
			rows = rows.map((r) => (r.state === 'add' || r.state === 'update' ? { ...r, state: 'unchanged' } : r))
			preview = { ...preview!, add: [], update: [] }
			try { rules = (await og<{ rules: Rule[] }>(token, '/rules')).rules } catch { /* l'affichage suivra au rechargement */ }
		} catch { error = tFn('og2.tpl_import_err') }
		finally { busy = false }
	}
	async function reinstall(key: string) {
		busy = true; error = null
		try {
			await og(token, `/profile/base/${encodeURIComponent(key)}`, 'POST')
			presets = presets.map((p) => (p.key === key ? { ...p, installed: true, customized: false } : p))
			openBase()
		} catch { error = tFn('og2.tpl_reinstall_err') }
		finally { busy = false }
	}
	const changes = $derived((preview ? preview.add.length + preview.update.length : 0) + (nudgeChange ? 1 : 0))

	// ── Importer / exporter ──────────────────────────────────────────────────
	let fileInput: HTMLInputElement | null = $state(null)
	async function onFile(e: Event) {
		const f = (e.currentTarget as HTMLInputElement).files?.[0]
		;(e.currentTarget as HTMLInputElement).value = ''
		if (!f) return
		close()
		let profile: any
		if (f.size > 1_000_000) { modal = { kind: 'file', name: f.name, profile: null }; error = tFn('og2.tpl_file_big'); return }
		try { profile = JSON.parse(await f.text()) } catch { modal = { kind: 'file', name: f.name, profile: null }; error = tFn('og2.tpl_file_json'); return }
		modal = { kind: 'file', name: f.name, profile }; busy = true
		try {
			preview = (await og<{ preview: Preview }>(token, '/profile/preview', 'POST', { profile })).preview
			sendProfile = profile
			const st = (n: string): Row['state'] => preview!.problems.some((p) => p.rule === n) ? 'refused' : preview!.add.includes(n) ? 'add' : preview!.update.includes(n) ? 'update' : 'unchanged'
			rows = (profile.rules ?? []).map((r: any) => ({ name: r.name, desc: describe(asRule(r), tFn), icon: ruleIcon(asRule(r)), state: st(r.name) }))
		} catch { error = tFn('og2.tpl_file_invalid') }
		finally { busy = false }
	}
	let exportErr = $state<string | null>(null)
	async function exportRules() {
		exportErr = null
		try {
			const res = await fetch(`${API_URL}/admin/octoguard/profile/export`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
			if (!res.ok) throw new Error(String(res.status))
			const a = document.createElement('a')
			a.href = URL.createObjectURL(new Blob([JSON.stringify(await res.json(), null, 2)], { type: 'application/json' }))
			a.download = `octoguard-profile-${new Date().toISOString().slice(0, 10)}.json`
			a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
		} catch { exportErr = tFn('og2.tpl_export_err') }
	}

	const STATE_PILL: Record<Row['state'], string> = { add: 'og-k-ok', update: 'og-k-report', unchanged: 'og-k-observe', kept: 'og-k-acc', refused: 'og-k-delete', missing: 'og-k-warn', installed: 'og-k-ok', customized: 'og-k-acc' }
	const reasonOf = (name: string) => preview?.problems.find((p) => p.rule === name)?.reason
	const PROBLEMS = ['invalid_params', 'regex_missing_pattern', 'regex_unsafe', 're2_required']
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
		<div class="adm-actions relative">
			<button type="button" class="adm-btn" onclick={() => fileInput?.click()}><Icon d="M12 16V5m0 0l4 4m-4-4l-4 4 M4 20h16" />{tFn('og2.tpl_import_btn')}</button>
			<input bind:this={fileInput} type="file" accept="application/json,.json" class="sr-only" onchange={onFile} aria-label={tFn('og2.tpl_import_btn')} />
			<button type="button" class="adm-btn" onclick={exportRules}><Icon d="M12 4v11m0 0l4-4m-4 4l-4-4 M4 20h16" />{tFn('og2.tpl_export_btn')}</button>
		</div>
	</header>
	{#if exportErr}<p class="og-error" role="alert">{exportErr}</p>{/if}
	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}

	<div class="og-grid3">
		<!-- Base Nodyx -->
		<article class="adm-card og-tpl">
			<div class="og-tile-art"><svg viewBox="0 0 180 84" aria-hidden="true"><rect class="og-art-p" x="58" y="12" width="64" height="62" rx="12"/><path class="og-art-a" d="M90 24l16 6v12c0 10-7 17-16 19-9-2-16-9-16-19V30z"/><path d="M83 42l5 5 9-10" fill="none" stroke="var(--nx-header-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
			<div class="og-tpl-tx">
				<div class="og-tpl-h"><b>{tFn('og2.tpl_base_name')}</b><span class="adm-pill og-tone {installed === presets.length ? 'og-k-ok' : 'og-k-warn'}">{installed === presets.length ? tFn('og2.tpl_installed') : tFn('og2.tpl_installed_count', { n: installed, total: presets.length })}</span></div>
				<p>{tFn('og2.tpl_base_desc2')}</p>
				<div class="og-tpl-f"><span class="og-help">{tFn('og2.tpl_rules_n', { n: presets.length })} · {tFn('og2.tpl_version', { v: data.base?.version ?? 1 })}</span><button type="button" class="adm-btn adm-btn--sm" onclick={openBase}>{tFn('og2.tpl_see')}</button></div>
			</div>
		</article>

		{#each TEMPLATES as tpl (tpl.id)}
			<article class="adm-card og-tpl">
				<div class="og-tile-art">
					<svg viewBox="0 0 180 84" aria-hidden="true">
						{#if tpl.art === 'youth'}<circle class="og-art-p" cx="66" cy="44" r="18"/><circle class="og-art-p" cx="114" cy="44" r="18"/><circle class="og-art-a" cx="90" cy="38" r="14"/><path class="og-art-s" d="M58 48c4 5 12 5 16 0M106 48c4 5 12 5 16 0"/>
						{:else if tpl.art === 'gaming'}<rect class="og-art-a" x="50" y="26" width="80" height="38" rx="19"/><circle cx="70" cy="45" r="4" fill="var(--nx-header-accent)"/><path d="M104 38v14M97 45h14" stroke="var(--nx-header-accent)" stroke-width="2.5" stroke-linecap="round"/>
						{:else if tpl.art === 'help'}<rect class="og-art-p" x="54" y="14" width="72" height="56" rx="9"/><path d="M74 32l-8 10 8 10M106 32l8 10-8 10M96 28l-12 28" fill="none" stroke="var(--nx-header-accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
						{:else if tpl.art === 'creative'}<rect class="og-art-p" x="52" y="14" width="76" height="56" rx="9"/><circle cx="74" cy="34" r="6" fill="var(--nx-header-accent)"/><path d="M52 62l22-18 16 12 14-10 24 18" class="og-art-s"/>
						{:else}<rect class="og-art-p" x="66" y="34" width="48" height="38" rx="7"/><path class="og-art-s" d="M76 34v-8a14 14 0 0128 0v8"/><circle cx="90" cy="53" r="4" fill="var(--nx-header-accent)"/>{/if}
					</svg>
				</div>
				<div class="og-tpl-tx">
					<div class="og-tpl-h"><b>{tFn(`og2.tpl_${tpl.id}_name`)}</b><span class="adm-pill og-tone {TONE[tpl.tone]}">{tFn(`og2.tpl_${tpl.id}_tag`)}</span></div>
					<p>{tFn(`og2.tpl_${tpl.id}_desc`)}</p>
					<div class="og-tpl-f"><span class="og-help">{tFn('og2.tpl_rules_n', { n: tpl.rules.length })} · {tFn(`og2.tpl_${tpl.id}_meta`)}</span><button type="button" class="adm-btn adm-btn--sm" onclick={() => openTemplate(tpl)}>{tFn('og2.tpl_see')}</button></div>
				</div>
			</article>
		{/each}
	</div>
	<p class="og-help">{tFn('og2.tpl_note')}</p>
</div>

{#if modal}
	<div use:portal>
		<div class="og-modal og-page" role="dialog" aria-modal="true" aria-labelledby="og-tpl-title" tabindex="-1" onclick={(e) => { if (e.target === e.currentTarget) close() }} onkeydown={(e) => { if (e.key === 'Escape') close() }}>
			<div class="adm-card" style="display:flex;flex-direction:column;gap:0.875rem">
				<div class="adm-card-head" style="margin:0">
					<h2 id="og-tpl-title" class="adm-title" style="font-size:1rem">
						{#if modal.kind === 'base'}{tFn('og2.tpl_base_name')}{:else if modal.kind === 'tpl'}{tFn('og2.tpl_changes', { name: tFn(`og2.tpl_${modal.tpl.id}_name`) })}{:else}{tFn('og2.tpl_changes', { name: modal.name })}{/if}
					</h2>
					<button type="button" class="adm-btn adm-btn--icon" onclick={close} aria-label={tFn('og2.close')}><Icon d="M6 6l12 12 M18 6L6 18" /></button>
				</div>
				<p class="og-help">{tFn(modal.kind === 'base' ? 'og2.tpl_base_help' : 'og2.tpl_preview_help')}</p>
				{#if busy && !rows.length}<p class="og-help">{tFn('og2.loading')}</p>{/if}
				<div class="og-rows">
					{#each rows as r, i (i)}
						<div class="og-row">
							<span class="og-rule-ico"><Icon d={r.icon} /></span>
							<div class="og-row-body"><b style="font-weight:600">{r.name}</b><div class="og-meta">{r.desc}{#if r.state === 'refused'} · {tFn(PROBLEMS.includes(reasonOf(r.name) ?? '') ? `og2.imp_reason_${reasonOf(r.name)}` : 'og2.imp_reason_other')}{/if}</div></div>
							{#if modal.kind === 'base' && r.state === 'missing'}
								<button type="button" class="adm-btn adm-btn--sm" disabled={busy} onclick={() => reinstall(presets[i].key)}>{tFn('og2.tpl_reinstall')}</button>
							{:else}
								<span class="adm-pill og-tone {STATE_PILL[r.state]}">{tFn(`og2.tpl_state_${r.state}`)}</span>
							{/if}
						</div>
					{/each}
				</div>
				{#if error}<p class="og-error" role="alert">{error}</p>{/if}
				{#if done}<p class="og-okmsg" role="status">{done} <a class="og-linkbtn" href="/admin/octoguard/rules">{tFn('og2.nav_rules')}</a></p>{/if}
				{#if modal.kind !== 'base'}
					<div class="adm-actions" style="justify-content:flex-end">
						<button type="button" class="adm-btn" onclick={close}>{tFn(done ? 'og2.close' : 'og2.cancel')}</button>
						{#if !done}<button type="button" class="adm-btn adm-btn--primary" disabled={busy || changes === 0} onclick={apply}>{changes ? tFn('og2.tpl_apply', { n: changes }) : tFn('og2.tpl_nothing')}</button>{/if}
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.og-tpl { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
	.og-tpl-tx { padding: 0.875rem 1rem 1rem; display: flex; flex-direction: column; gap: 0.5rem; flex: 1; }
	.og-tpl-h { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.og-tpl-h b { font-size: 0.9rem; font-weight: 650; }
	.og-tpl-tx p { margin: 0; font-size: 0.78rem; color: var(--nx-text-muted); line-height: 1.5; flex: 1; }
	.og-tpl-f { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
	.og-modal { position: fixed; z-index: 62; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgb(10 9 7 / .5); }
	.og-modal > :global(.adm-card) { width: min(36rem, 100%); max-height: calc(100vh - 2rem); overflow-y: auto; }
</style>
