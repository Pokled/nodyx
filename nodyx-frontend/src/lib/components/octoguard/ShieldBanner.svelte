<script lang="ts">
	// Le bouclier anti-raid vu par un membre (lot 6) : rien quand il est baissé ;
	// levé, une phrase courte AVANT d'écrire, adaptée à la personne :
	//  - compte de moins d'1 jour : « tu peux lire, tu pourras écrire à 21:30 » ;
	//  - membre : « un message toutes les 10 s, les liens attendent d'être relus » ;
	//  - équipe : « tu n'es pas concerné, l'équipe garde la main ».
	// Suit le bouclier en direct (événement « octoguard:shield »).
	import { onMount, onDestroy } from 'svelte'
	import { t, locale } from '$lib/i18n'
	import { apiFetch } from '$lib/api'
	import { getSocket } from '$lib/socket'

	let { token, surface = 'chat', space = '' }: { token: string | null | undefined; surface?: 'chat' | 'forum' | 'dm'; space?: string } = $props()
	const tFn = $derived($t)

	type Shield = { active: boolean; until: string | null; readonly: boolean; team?: boolean; slow_seconds: number }
	let s = $state<Shield | null>(null)
	let timer: ReturnType<typeof setTimeout> | null = null

	async function load() {
		if (!token) return
		try {
			const res = await apiFetch(fetch, '/reports/shield', { headers: { Authorization: `Bearer ${token}` } })
			s = res.ok ? await res.json() : null
		} catch { s = null }
		// Il retombe tout seul : on le relit à l'heure dite
		if (timer) clearTimeout(timer)
		if (s?.active && s.until) timer = setTimeout(load, Math.max(1000, Date.parse(s.until) - Date.now() + 1000))
	}
	const onShield = () => { void load() }
	onMount(() => { void load(); getSocket()?.on('octoguard:shield', onShield) })
	onDestroy(() => { if (timer) clearTimeout(timer); getSocket()?.off('octoguard:shield', onShield) })

	const at = $derived(s?.until ? new Date(s.until).toLocaleTimeString($locale, { hour: '2-digit', minute: '2-digit' }) : '')
	const text = $derived(!s?.active ? '' : s.readonly
		? tFn('ogshield.readonly', { at })
		: s.team
			? tFn('ogshield.team', { at })
			: tFn(surface === 'chat' ? 'ogshield.member_chat' : surface === 'forum' ? 'ogshield.member_forum' : 'ogshield.member_dm', { at, s: s.slow_seconds }))
</script>

{#if s?.active}
	<div class="shb" class:shb--ro={s.readonly} style:margin={space || null} role="status">
		<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />{#if s.readonly}<path d="M9.5 12v-1.5a2.5 2.5 0 015 0V12 M9 12h6v4H9z" />{/if}</svg>
		<span><b>{tFn('ogshield.title')}</b> {text}</span>
	</div>
{/if}

<style>
	.shb { display: flex; gap: 0.5rem; align-items: flex-start; padding: 0.5rem 0.75rem; font-size: 0.8rem; line-height: 1.45; color: var(--nx-text); border: 1px solid color-mix(in srgb, var(--nx-header-accent) 40%, var(--nx-border)); background: color-mix(in srgb, var(--nx-header-accent) 8%, var(--nx-surface)); border-radius: 8px; }
	.shb svg { width: 1.05rem; height: 1.05rem; flex: none; margin-top: 1px; fill: none; stroke: var(--nx-header-accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
	.shb b { font-weight: 650; }
	.shb--ro { border-color: color-mix(in srgb, var(--nx-warn) 50%, var(--nx-border)); background: color-mix(in srgb, var(--nx-warn) 10%, var(--nx-surface)); }
	.shb--ro svg { stroke: var(--nx-warn); }
</style>
