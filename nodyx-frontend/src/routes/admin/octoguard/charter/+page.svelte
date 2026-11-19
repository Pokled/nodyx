<script lang="ts">
	// Les chartes (lot 7 ; maquette v3 validée le 19/11/2026, CDC §E4j). Deux chartes :
	// celle des membres (la porte d'entrée) et celle de l'équipe. Ce lot (7b) pose
	// l'éditeur ; la page d'admin complète (allumer, chiffres, parcours, listes, versions,
	// la case, la signature) arrive avec le lot 7c.
	import { onDestroy, untrack } from 'svelte'
	import { page } from '$app/state'
	import { t, locale } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import CharterEditor from '$lib/components/charter/CharterEditor.svelte'
	import type { PageData } from './$types'

	type Aud = 'members' | 'team'
	type Charter = { enabled: boolean; draft_html: string; current_version: number | null; versions: Array<{ version: number; published_at: string }> }

	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)
	const canManage = $derived(((page.data as any).access?.role === 'owner' || (page.data as any).access?.role === 'admin' || ((page.data as any).access?.permissions ?? []).includes('manage_octoguard')) as boolean)

	const init = untrack(() => ({ members: data.members as Charter | null, team: data.team as Charter | null }))
	let aud = $state<Aud>('members')
	const charters = $state<Record<Aud, Charter | null>>({ members: init.members, team: init.team })
	const ch = $derived(charters[aud])

	// Le brouillon s'enregistre tout seul, une seconde après la dernière frappe
	let status = $state<'idle' | 'saving' | 'saved' | 'error' | 'readonly'>('idle')
	let timer: ReturnType<typeof setTimeout> | null = null
	let pending: { aud: Aud; html: string } | null = null
	async function flush() {
		if (!pending) return
		const { aud: a, html } = pending
		pending = null
		status = 'saving'
		try {
			const res = await apiFetch(fetch, `/admin/charter/${a}/draft`, {
				method: 'PUT',
				headers: token ? { Authorization: `Bearer ${token}` } : {},
				body: JSON.stringify({ html }),
			})
			if (res.status === 403) { status = 'readonly'; return }
			if (!res.ok) { status = 'error'; return }
			const j = await res.json()
			if (charters[a]) charters[a]!.draft_html = j.draft_html
			status = 'saved'
		} catch { status = 'error' }
	}
	function onChange(html: string) {
		if (!canManage) { status = 'readonly'; return }
		// Gardé tout de suite : changer d'onglet et revenir ne perd pas la dernière seconde
		if (charters[aud]) charters[aud]!.draft_html = html
		pending = { aud, html }
		status = 'idle'
		if (timer) clearTimeout(timer)
		timer = setTimeout(flush, 1000)
	}
	function switchTo(a: Aud) {
		if (a === aud) return
		if (timer) { clearTimeout(timer); timer = null; void flush() }
		aud = a
		status = 'idle'
	}
	onDestroy(() => { if (timer) { clearTimeout(timer); void flush() } })

	const published = (c: Charter | null) => {
		const v = c?.versions?.[0]
		if (!v) return tFn('chpage.not_published')
		return tFn('chpage.version_published', { n: String(v.version), date: new Date(v.published_at).toLocaleDateString($locale, { day: 'numeric', month: 'short' }) })
	}
	const PEN = 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4'
	const USERS = 'M9 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M2.5 20a6.5 6.5 0 0113 0 M16 4.6a3.5 3.5 0 010 6.8 M21.5 20a6.5 6.5 0 00-4-6'
	const SHIELD = 'M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z'
</script>

<svelte:head><title>{tFn('chpage.title')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d={PEN} /></span>
			<div>
				<h1 class="adm-title">{tFn('chpage.title')}</h1>
				<p class="adm-desc">{tFn('chpage.desc')}</p>
			</div>
		</div>
	</header>

	{#if data.failed}<p class="og-error" role="alert">{tFn('og2.err_load')}</p>{/if}

	<div class="ch-tabs" role="tablist" aria-label={tFn('chpage.tabs_aria')}>
		{#each (['members', 'team'] as Aud[]) as a (a)}
			<button type="button" role="tab" class="ch-tab" aria-selected={aud === a} onclick={() => switchTo(a)}>
				<span class="ch-tab-ic" class:team={a === 'team'}><Icon d={a === 'members' ? USERS : SHIELD} /></span>
				<span><b>{tFn(`chpage.tab_${a}`)}</b><small>{tFn(`chpage.tab_${a}_sub`)}</small></span>
				<span class="pill" class:ok={charters[a]?.enabled}>{charters[a]?.enabled ? tFn('chpage.on') : tFn('chpage.off')}</span>
			</button>
		{/each}
	</div>

	{#if ch}
		<section class="adm-card ch-editor-card">
			<div class="card-head">
				<h2>{tFn('chpage.editor_title')}</h2>
				<span class="small faint">
					{published(ch)}
					{#if status === 'saving'} · {tFn('chpage.saving')}{:else if status === 'saved'} · {tFn('chpage.saved')}{:else if status === 'error'} · <span class="bad">{tFn('chpage.save_error')}</span>{:else if status === 'readonly'} · {tFn('chpage.readonly')}{/if}
				</span>
			</div>
			{#key aud}
				<CharterEditor audience={aud} html={ch.draft_html} onchange={onChange} />
			{/key}
		</section>
	{/if}
</div>

<style>
	.ch-tabs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr)); gap: 10px; margin-bottom: 16px; }
	.ch-tab { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; text-align: left; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--nx-border); background: var(--nx-surface); color: var(--nx-text); font: inherit; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
	.ch-tab b { display: block; font-size: 14px; font-weight: 650; }
	.ch-tab small { display: block; font-size: 12px; color: var(--nx-text-muted); margin-top: 2px; }
	.ch-tab[aria-selected="true"] { border-color: var(--nx-header-accent); box-shadow: inset 0 0 0 1px var(--nx-header-accent); background: color-mix(in srgb, var(--nx-header-accent) 6%, var(--nx-surface)); }
	.ch-tab-ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; background: color-mix(in srgb, var(--nx-ok) 13%, transparent); color: var(--nx-ok); }
	.ch-tab-ic.team { background: color-mix(in srgb, #8b5cf6 14%, transparent); color: #8b5cf6; }
	.ch-tab-ic :global(svg) { width: 19px; height: 19px; }
	.pill { display: inline-flex; align-items: center; gap: 5px; padding: 1px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; border: 1px solid color-mix(in srgb, currentColor 30%, transparent); background: color-mix(in srgb, currentColor 10%, transparent); color: var(--nx-text-muted); white-space: nowrap; }
	.pill.ok { color: var(--nx-ok); }
	.ch-editor-card { display: flex; flex-direction: column; gap: 0; }
	.card-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px 12px; margin-bottom: 10px; }
	.card-head h2 { margin: 0; font-size: 15px; font-weight: 600; }
	.small { font-size: 12px; } .faint { color: var(--nx-text-faint); } .bad { color: var(--nx-bad); }
</style>
