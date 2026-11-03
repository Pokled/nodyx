<script lang="ts">
	// Les sourdines en cours. Mettre un membre en sourdine se fait depuis sa
	// fiche (on sait alors QUI on vise) ; ici on voit, et on lève.
	import { page } from '$app/state'
	import { untrack, onMount } from 'svelte'
	import { t } from '$lib/i18n'
	import Icon from '$lib/components/octoguard/Icon.svelte'
	import { og } from '$lib/octoguard/api'
	import type { PageData } from './$types'

	type Mute = { id: string; user_id: string; user_username: string | null; channel_id: string | null; reason: string | null; applied_by: string | null; applied_at: string; expires_at: string | null }
	let { data }: { data: PageData } = $props()
	const tFn = $derived($t)
	const token = $derived(((page.data as any).token as string | null) ?? null)

	let mutes = $state<Mute[]>(untrack(() => data.mutes as Mute[]))
	let now = $state(Date.now())
	onMount(() => { const id = setInterval(() => (now = Date.now()), 30_000); return () => clearInterval(id) })

	function left(iso: string | null): string {
		if (!iso) return tFn('og2.mute_forever')
		const min = Math.max(0, Math.round((new Date(iso).getTime() - now) / 60000))
		if (min < 1) return tFn('og2.mute_ending')
		if (min < 60) return tFn('og2.mute_left_min', { n: min })
		if (min < 2880) return tFn('og2.mute_left_h', { n: Math.round(min / 60) })
		return tFn('og2.mute_left_d', { n: Math.round(min / 1440) })
	}

	let confirmId = $state<string | null>(null)
	let busy = $state<string | null>(null)
	let error = $state<string | null>(null)
	async function lift(m: Mute) {
		busy = m.id; error = null
		try {
			await og(token, `/mutes/${m.id}`, 'DELETE')
			mutes = mutes.filter((x) => x.id !== m.id)
		} catch { error = tFn('og2.mute_lift_err') }
		finally { busy = null; confirmId = null }
	}
</script>

<svelte:head><title>{tFn('og2.nav_mutes')} · OctoGuard</title></svelte:head>

<div class="adm-page og-page">
	<header class="adm-head">
		<div class="og-head-l">
			<span class="og-mark"><Icon d="M11 5L6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6" /></span>
			<div>
				<h1 class="adm-title">{tFn('og2.nav_mutes')}</h1>
				<p class="adm-desc">{tFn('og2.mutes_desc')}</p>
			</div>
		</div>
		<a class="adm-btn" href="/admin/members"><Icon d="M9 4.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z M2.5 20a6.5 6.5 0 0113 0 M16 4.6a3.5 3.5 0 010 6.8 M21.5 20a6.5 6.5 0 00-4-6" />{tFn('og2.mutes_to_members')}</a>
	</header>

	<div class="og-note"><Icon d="M12 3a9 9 0 100 18 9 9 0 000-18z M12 11v5 M12 8h.01" />{tFn('og2.mutes_how')}</div>

	{#if error}<p class="og-error" role="alert">{error}</p>{/if}

	<section class="adm-card">
		{#if data.failed}
			<p class="og-error" role="alert">{tFn('og2.err_load')}</p>
		{:else if mutes.length === 0}
			<p class="og-empty">{tFn('og2.mutes_none')}</p>
		{:else}
			<div class="og-rows">
				{#each mutes as m (m.id)}
					<div class="og-row">
						<span class="og-ic og-k-delete"><Icon d="M11 5L6 9H3v6h3l5 4z M22 9l-6 6 M16 9l6 6" /></span>
						<div class="og-row-body">
							<div><a class="og-linkbtn" href="/admin/members/{m.user_id}">{m.user_username ?? m.user_id.slice(0, 8)}</a> · {tFn(m.channel_id ? 'og2.mute_one_channel' : 'og2.mute_everywhere')}</div>
							{#if m.reason}<p class="og-quote">{m.reason}</p>{/if}
							<div class="og-meta">{tFn(m.applied_by ? 'og2.mute_by_team' : 'og2.mute_by_og')} · <b>{left(m.expires_at)}</b></div>
						</div>
						{#if confirmId === m.id}
							<span class="adm-actions">
								<button type="button" class="adm-btn adm-btn--primary adm-btn--sm" disabled={busy === m.id} onclick={() => lift(m)}>{tFn('og2.mute_lift_yes')}</button>
								<button type="button" class="adm-btn adm-btn--sm" onclick={() => (confirmId = null)}>{tFn('og2.cancel')}</button>
							</span>
						{:else}
							<button type="button" class="adm-btn adm-btn--sm" onclick={() => (confirmId = m.id)}>{tFn('og2.mute_lift')}</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>
