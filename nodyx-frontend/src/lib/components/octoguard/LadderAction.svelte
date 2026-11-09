<script lang="ts">
	// « Appliquer le barème » (maquette validée), avec les garde-fous décidés le 09/11 :
	// une confirmation qui dit exactement ce qui va se passer, un motif écrit pour toute
	// exclusion, et le second avis pour une exclusion de 7 jours ou plus.
	import { t } from '$lib/i18n'
	import Icon from './Icon.svelte'
	import { og, OgError } from '$lib/octoguard/api'
	import { kindOf, needsSecondOpinion, optionKey, durationKey, LADDER_ERR, type MemberLadder } from '$lib/octoguard/ladder'

	let { token, userId, username, reportId = null, state, canMembers, canBan, myId, onChanged }: {
		token: string | null; userId: string; username: string; reportId?: string | null
		state: MemberLadder | null; canMembers: boolean; canBan: boolean; myId: string | undefined
		onChanged: () => Promise<void> | void
	} = $props()
	const tFn = $derived($t)

	const SCALE = 'M12 3v18 M5 21h14 M6 7h12 M6 7l-3 7a3 3 0 006 0z M18 7l-3 7a3 3 0 006 0z'
	let open = $state(false)
	let reason = $state('')
	let busy = $state(false)
	let error = $state<string | null>(null)
	let done = $state<string | null>(null)

	const next = $derived(state?.next ?? null)
	const kind = $derived(next ? kindOf(next.sanction) : null)
	const allowed = $derived(kind === 'ban' ? canBan : canMembers)
	const waits = $derived(!!next && !!state?.settings.double_validation && needsSecondOpinion(next.sanction))
	const reasonOk = $derived(kind !== 'ban' || reason.trim().length >= 3)
	const pending = $derived(state?.pending ?? null)
	const mine = $derived(!!pending && pending.actor_id === myId)

	async function act(fn: () => Promise<unknown>, okKey: string) {
		busy = true; error = null; done = null
		try {
			await fn()
			done = tFn(okKey)
			open = false; reason = ''
			await onChanged()
		} catch (e) {
			error = tFn((e instanceof OgError && e.code && LADDER_ERR[e.code]) || 'areports.err_generic')
			if (e instanceof OgError && (e.code === 'LADDER_STEP_CHANGED' || e.code === 'ALREADY_DECIDED')) await onChanged()
		} finally { busy = false }
	}
	const apply = () => act(
		() => og(token, '/ladder/apply', 'POST', { user_id: userId, expected_step: next!.step, report_id: reportId, reason: reason.trim() || null }),
		waits ? 'og2.lad_ok_pending' : 'og2.lad_ok_applied',
	)
	const decide = (d: 'approve' | 'refuse') => act(
		() => og(token, `/ladder/${pending!.id}/${d}`, 'POST'),
		d === 'approve' ? 'og2.lad_ok_approved' : mine ? 'og2.lad_ok_withdrawn' : 'og2.lad_ok_refused',
	)
</script>

{#if state}
	<div class="lad-act">
		{#if pending}
			<div class="lad-box lad-box--wait">
				<b>{tFn('og2.lad_pending_title', { what: tFn(optionKey(pending.sanction)) })}</b>
				<span>{tFn('og2.lad_pending_by', { who: pending.actor ?? '' })}</span>
				{#if pending.reason}<span class="lad-quote">« {pending.reason} »</span>{/if}
				{#if canBan && !mine}
					<div class="lad-row">
						<button type="button" class="adm-btn adm-btn--sm adm-btn--danger" disabled={busy} onclick={() => decide('approve')}>{tFn('og2.lad_approve')}</button>
						<button type="button" class="adm-btn adm-btn--sm" disabled={busy} onclick={() => decide('refuse')}>{tFn('og2.lad_refuse')}</button>
					</div>
				{:else if mine}
					<span class="lad-help">{tFn('og2.lad_pending_mine')}</span>
					<button type="button" class="adm-btn adm-btn--sm" disabled={busy} onclick={() => decide('refuse')}>{tFn('og2.lad_withdraw')}</button>
				{:else}
					<span class="lad-help">{tFn('og2.lad_pending_others')}</span>
				{/if}
			</div>
		{:else if next && !open}
			<button type="button" class="adm-btn adm-btn--primary" disabled={busy || !allowed} title={allowed ? undefined : tFn(kind === 'ban' ? 'og2.lad_need_ban' : 'areports.err_forbidden')} onclick={() => { open = true; done = null; error = null }}>
				<Icon d={SCALE} />{tFn('og2.lad_apply')}
			</button>
			{#if !allowed && kind === 'ban'}<span class="lad-help">{tFn('og2.lad_need_ban')}</span>{/if}
		{:else if next && open}
			<div class="lad-box" class:lad-box--ban={kind === 'ban'}>
				<b>{tFn(`og2.lad_confirm_${kind}`, { name: username, d: kind === 'warn' ? '' : tFn(durationKey(next.sanction)) })}</b>
				<span class="lad-help">{tFn(`og2.lad_confirm_${kind}_after`)}</span>
				{#if kind === 'ban'}
					<label class="lad-field">
						<span>{tFn('og2.lad_reason')}</span>
						<textarea class="adm-input" rows="2" maxlength="500" bind:value={reason} placeholder={tFn('og2.lad_reason_ph')}></textarea>
					</label>
					{#if waits}<span class="lad-help lad-help--wait">{tFn('og2.lad_waits')}</span>{/if}
				{/if}
				<div class="lad-row">
					<button type="button" class="adm-btn adm-btn--sm {kind === 'ban' ? 'adm-btn--danger' : 'adm-btn--primary'}" disabled={busy || !reasonOk} onclick={apply}>
						{tFn(waits ? 'og2.lad_confirm_ask' : 'og2.lad_confirm_go')}
					</button>
					<button type="button" class="adm-btn adm-btn--sm" disabled={busy} onclick={() => { open = false; reason = '' }}>{tFn('og2.lad_cancel')}</button>
				</div>
			</div>
		{:else if !next}
			<span class="lad-help">{tFn('og2.lad_beyond_help')}</span>
		{/if}
		{#if error}<p class="lad-msg lad-msg--bad" role="alert">{error}</p>{/if}
		{#if done}<p class="lad-msg lad-msg--ok" role="status">{done}</p>{/if}
	</div>
{/if}

<style>
	.lad-act { display: flex; flex-direction: column; gap: 8px; }
	.lad-box { display: flex; flex-direction: column; gap: 8px; padding: 12px; border-radius: 10px; border: 1px solid var(--nx-border); background: color-mix(in srgb, var(--nx-text) 3%, transparent); font-size: 0.875rem; }
	.lad-box--ban { border-color: color-mix(in srgb, var(--nx-bad) 45%, var(--nx-border)); }
	.lad-box--wait { border-color: color-mix(in srgb, var(--nx-warn) 45%, var(--nx-border)); }
	.lad-row { display: flex; flex-wrap: wrap; gap: 8px; }
	.lad-field { display: flex; flex-direction: column; gap: 4px; font-size: 0.8125rem; font-weight: 600; }
	.lad-help { font-size: 0.8125rem; color: var(--nx-text-muted); }
	.lad-help--wait { color: var(--nx-warn); }
	.lad-quote { font-size: 0.8125rem; color: var(--nx-text-muted); font-style: italic; }
	.lad-msg { margin: 0; font-size: 0.8125rem; }
	.lad-msg--bad { color: var(--nx-bad); }
	.lad-msg--ok { color: var(--nx-ok); }
</style>
