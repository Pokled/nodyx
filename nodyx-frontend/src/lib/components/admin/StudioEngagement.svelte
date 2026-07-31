<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	interface Props {
		token:           string
		hasPolls:        boolean
		hasPredictions:  boolean
		broadcasterType: 'partner' | 'affiliate' | ''
	}

	let { token, hasPolls, hasPredictions, broadcasterType }: Props = $props()

	// Twitch verrouille polls et predictions aux chaines Affiliate ou Partner.
	// API renvoie 403 "ownedBy X is not a partner or affiliate" si non éligible.
	// On bloque le formulaire en amont avec un message clair pour ne pas
	// laisser le streamer cliquer pour rien.
	const isMonetizable = $derived(broadcasterType === 'partner' || broadcasterType === 'affiliate')

	type PollChoice = { id: string; title: string; votes: number; channelPointsVotes: number }
	type Poll = {
		id: string; title: string; status: string
		choices: PollChoice[]
		channelPointsVotingEnabled: boolean
		channelPointsPerVote: number
		startedAt: string; endedAt: string | null; durationSeconds: number
	}

	type PredOutcome = { id: string; title: string; color: 'BLUE' | 'PINK'; users: number; channelPoints: number }
	type Prediction = {
		id: string; title: string; status: string
		winningOutcomeId: string | null
		outcomes: PredOutcome[]
		predictionWindowSeconds: number
		startedAt: string; lockedAt: string | null; endedAt: string | null
	}

	let mode: 'poll' | 'prediction' = $state('poll')

	let activePoll       = $state<Poll | null>(null)
	let activePrediction = $state<Prediction | null>(null)
	let loading          = $state(true)
	let now              = $state(Date.now())
	let pollTimer:    ReturnType<typeof setInterval> | null = null
	let refreshTimer: ReturnType<typeof setInterval> | null = null

	// Form state — Poll
	let pollTitle    = $state('')
	let pollChoices  = $state<string[]>(['', ''])
	let pollDuration = $state(120)
	let pollSubmitting = $state(false)

	// Form state — Prédiction
	let predTitle    = $state('')
	let predOutcomes = $state<string[]>(['', ''])
	let predWindow   = $state(120)
	let predSubmitting = $state(false)
	let resolvingId  = $state<string | null>(null)   // outcome.id en cours de validation

	let toast = $state<{ text: string; ok: boolean } | null>(null)

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 4000)
	}

	async function reloadActive(): Promise<void> {
		const [p, pr] = await Promise.all([
			hasPolls       ? apiFetch(fetch, '/streamer/twitch/poll/active',       { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
			hasPredictions ? apiFetch(fetch, '/streamer/twitch/prediction/active', { headers: { Authorization: `Bearer ${token}` } }) : Promise.resolve(null),
		])
		if (p && p.ok) {
			const d = await p.json() as { poll: Poll | null }
			activePoll = d.poll
		}
		if (pr && pr.ok) {
			const d = await pr.json() as { prediction: Prediction | null }
			activePrediction = d.prediction
		}
		loading = false
	}

	onMount(() => {
		reloadActive()
		// Ticker pour les timers (h/m/s)
		pollTimer = setInterval(() => { now = Date.now() }, 1000)
		// Refresh régulier de l'état actif (toutes les 5 s)
		refreshTimer = setInterval(reloadActive, 5000)
	})

	onDestroy(() => {
		if (pollTimer)    clearInterval(pollTimer)
		if (refreshTimer) clearInterval(refreshTimer)
	})

	// ── Helpers ────────────────────────────────────────────────────────────

	function fmtRemaining(startedAtIso: string, totalSeconds: number): string {
		const endMs = new Date(startedAtIso).getTime() + totalSeconds * 1000
		const remMs = Math.max(0, endMs - now)
		const m = Math.floor(remMs / 60_000)
		const s = Math.floor((remMs % 60_000) / 1000)
		return `${m}:${s.toString().padStart(2, '0')}`
	}

	const pollTotalVotes = $derived(
		activePoll?.choices.reduce((sum, c) => sum + c.votes + c.channelPointsVotes, 0) ?? 0,
	)
	const predTotalUsers = $derived(
		activePrediction?.outcomes.reduce((sum, o) => sum + o.users, 0) ?? 0,
	)

	function fmtNumber(n: number): string {
		if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
		return n.toString()
	}

	// ── Form helpers ───────────────────────────────────────────────────────

	function addPollChoice(): void {
		if (pollChoices.length < 5) pollChoices = [...pollChoices, '']
	}
	function removePollChoice(i: number): void {
		if (pollChoices.length > 2) pollChoices = pollChoices.filter((_, idx) => idx !== i)
	}
	function addPredOutcome(): void {
		if (predOutcomes.length < 10) predOutcomes = [...predOutcomes, '']
	}
	function removePredOutcome(i: number): void {
		if (predOutcomes.length > 2) predOutcomes = predOutcomes.filter((_, idx) => idx !== i)
	}

	function durationLabel(sec: number): string {
		if (sec < 60) return `${sec}s`
		const m = Math.floor(sec / 60)
		const s = sec % 60
		return s === 0 ? `${m} min` : `${m}m ${s}s`
	}

	// ── Submit handlers ────────────────────────────────────────────────────

	async function submitPoll(): Promise<void> {
		if (!hasPolls || pollSubmitting) return
		const cleaned = pollChoices.map(c => c.trim()).filter(c => c.length > 0)
		if (!pollTitle.trim() || cleaned.length < 2) {
			flash(tFn('seng.err_poll_min'), false); return
		}
		pollSubmitting = true
		try {
			const res = await apiFetch(fetch, '/streamer/twitch/poll', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ title: pollTitle.trim(), choices: cleaned, duration: pollDuration }),
			})
			if (res.ok) {
				flash(tFn('seng.poll_launched'), true)
				pollTitle = ''; pollChoices = ['', '']
				await reloadActive()
			} else {
				const data = await res.json().catch(() => ({})) as { error?: string }
				const raw  = data.error ?? ''
				flash(
					raw === 'missing_scope_manage_polls'
						? tFn('seng.err_scope')
						: raw.includes('not a partner or affiliate')
							? tFn('seng.err_poll_affiliate')
							: tFn('seng.err_generic', { error: raw || tFn('seng.twitch_error') }),
					false,
				)
			}
		} catch {
			flash(tFn('seng.err_network'), false)
		} finally {
			pollSubmitting = false
		}
	}

	async function terminatePoll(): Promise<void> {
		if (!activePoll || !confirm(tFn('seng.terminate_poll_confirm'))) return
		const res = await apiFetch(fetch, `/streamer/twitch/poll/${activePoll.id}`, {
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ status: 'TERMINATED' }),
		})
		if (res.ok) { flash(tFn('seng.poll_ended'), true); await reloadActive() }
		else flash(tFn('seng.err_terminate'), false)
	}

	async function submitPrediction(): Promise<void> {
		if (!hasPredictions || predSubmitting) return
		const cleaned = predOutcomes.map(o => o.trim()).filter(o => o.length > 0)
		if (!predTitle.trim() || cleaned.length < 2) {
			flash(tFn('seng.err_pred_min'), false); return
		}
		predSubmitting = true
		try {
			const res = await apiFetch(fetch, '/streamer/twitch/prediction', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ title: predTitle.trim(), outcomes: cleaned, predictionWindow: predWindow }),
			})
			if (res.ok) {
				flash(tFn('seng.pred_launched'), true)
				predTitle = ''; predOutcomes = ['', '']
				await reloadActive()
			} else {
				const data = await res.json().catch(() => ({})) as { error?: string }
				const raw  = data.error ?? ''
				flash(
					raw === 'missing_scope_manage_predictions'
						? tFn('seng.err_scope')
						: raw.includes('not a partner or affiliate')
							? tFn('seng.err_pred_affiliate')
							: tFn('seng.err_generic', { error: raw || tFn('seng.twitch_error') }),
					false,
				)
			}
		} catch {
			flash(tFn('seng.err_network'), false)
		} finally {
			predSubmitting = false
		}
	}

	async function patchPred(status: 'LOCKED' | 'RESOLVED' | 'CANCELED', winningOutcomeId?: string): Promise<void> {
		if (!activePrediction) return
		if (status === 'CANCELED' && !confirm(tFn('seng.cancel_pred_confirm'))) return
		if (status === 'RESOLVED') resolvingId = winningOutcomeId ?? null
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/prediction/${activePrediction.id}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ status, winningOutcomeId }),
			})
			if (res.ok) {
				flash(status === 'LOCKED'   ? tFn('seng.bets_locked')
				    : status === 'RESOLVED' ? tFn('seng.pred_resolved')
				    :                          tFn('seng.pred_canceled'), true)
				await reloadActive()
			} else flash(tFn('seng.err_action'), false)
		} finally {
			resolvingId = null
		}
	}

	function colorFor(c: 'BLUE' | 'PINK'): string {
		return c === 'BLUE' ? '#3b82f6' : '#ec4899'
	}
</script>

<section class="rounded-xl border border-purple-500/25 bg-gradient-to-br from-purple-950/30 via-slate-900/60 to-pink-950/20 p-5 space-y-4">
	<header class="flex items-center justify-between gap-3 flex-wrap">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/></svg>
			<h2 class="text-sm font-semibold text-white">{tFn('seng.title')}</h2>
		</div>
		<!-- Toggle Poll / Prediction -->
		<div class="inline-flex rounded-lg border border-slate-700/60 bg-slate-950/60 p-0.5">
			<button type="button" onclick={() => mode = 'poll'}
				class="px-3 py-1 text-xs font-medium rounded-md transition-colors {mode === 'poll' ? 'bg-purple-500/20 text-purple-200' : 'text-slate-500 hover:text-slate-300'}">
				{tFn('seng.tab_poll')}
			</button>
			<button type="button" onclick={() => mode = 'prediction'}
				class="px-3 py-1 text-xs font-medium rounded-md transition-colors {mode === 'prediction' ? 'bg-pink-500/20 text-pink-200' : 'text-slate-500 hover:text-slate-300'}">
				{tFn('seng.tab_prediction')}
			</button>
		</div>
	</header>

	{#if !isMonetizable}
		<div class="rounded-lg border border-purple-500/40 bg-purple-500/5 p-4 flex items-start gap-3 text-xs">
			<svg class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
			<div class="flex-1 space-y-1">
				<div class="font-semibold text-purple-200">{tFn('seng.not_monetizable_title')}</div>
				<p class="text-purple-300/80 leading-relaxed">
					{tFn('seng.not_monetizable_desc')}
				</p>
				<a href="https://help.twitch.tv/s/article/joining-the-affiliate-program" target="_blank" rel="noopener noreferrer" class="text-purple-300 hover:text-purple-200 underline decoration-purple-500/40 inline-flex items-center gap-1">
					{tFn('seng.affiliate_conditions')}
					<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
				</a>
			</div>
		</div>
	{:else if mode === 'poll' && !hasPolls}
		<div class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
			{@html tFn('seng.scope_polls')}
		</div>
	{:else if mode === 'prediction' && !hasPredictions}
		<div class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
			{@html tFn('seng.scope_predictions')}
		</div>
	{/if}

	{#if toast}
		<div class="rounded-lg border p-3 text-xs flex items-center gap-2 {toast.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	{#if loading}
		<div class="text-xs text-slate-500 text-center py-6">{tFn('seng.loading')}</div>
	{/if}

	<!-- ══ POLL ════════════════════════════════════════════════════════════ -->
	{#if mode === 'poll' && !loading && isMonetizable}
		{#if activePoll}
			<!-- Live state -->
			<div class="rounded-lg border border-purple-500/40 bg-purple-500/5 p-4 space-y-3">
				<div class="flex items-center justify-between gap-3 flex-wrap">
					<div class="flex items-center gap-2">
						<span class="relative flex h-2.5 w-2.5">
							<span class="absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-60 animate-ping"></span>
							<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500"></span>
						</span>
						<div class="text-sm font-semibold text-white">{activePoll.title}</div>
					</div>
					<div class="text-[11px] text-purple-300 font-mono">
						{tFn('seng.poll_remaining', { time: fmtRemaining(activePoll.startedAt, activePoll.durationSeconds) })} · {pollTotalVotes > 1 ? tFn('seng.votes_many', { n: fmtNumber(pollTotalVotes) }) : tFn('seng.votes_one', { n: fmtNumber(pollTotalVotes) })}
					</div>
				</div>
				<div class="space-y-2">
					{#each activePoll.choices as choice (choice.id)}
						{@const total = choice.votes + choice.channelPointsVotes}
						{@const pct   = pollTotalVotes > 0 ? Math.round((total / pollTotalVotes) * 100) : 0}
						<div class="space-y-1">
							<div class="flex justify-between text-[11px]">
								<span class="text-slate-200">{choice.title}</span>
								<span class="text-slate-400 font-mono tabular-nums">{fmtNumber(total)} · {pct}%</span>
							</div>
							<div class="h-2 rounded-full bg-slate-800 overflow-hidden">
								<div class="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500" style="width: {pct}%"></div>
							</div>
						</div>
					{/each}
				</div>
				<button type="button" onclick={terminatePoll}
					class="w-full rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 font-medium px-3 py-2 text-xs transition-colors">
					{tFn('seng.terminate_now')}
				</button>
			</div>
		{:else}
			<!-- Form create poll -->
			<div class="space-y-3">
				<div>
					<label for="poll-title" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('seng.poll_question_label')}</label>
					<input id="poll-title" type="text" bind:value={pollTitle} maxlength="60" disabled={!hasPolls}
						placeholder={tFn('seng.poll_question_ph')}
						class="w-full rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-50"/>
					<div class="text-[10px] text-slate-500 mt-1 text-right font-mono">{pollTitle.length} / 60</div>
				</div>
				<div>
					<label for="poll-choice-0" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('seng.choices_label', { n: pollChoices.length })}</label>
					<div class="space-y-2">
						{#each pollChoices as _choice, i}
							<div class="flex gap-2">
								<input id={i === 0 ? 'poll-choice-0' : undefined} type="text" bind:value={pollChoices[i]} maxlength="25" disabled={!hasPolls}
									placeholder={tFn('seng.choice_ph', { n: i + 1 })}
									class="flex-1 rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-50"/>
								{#if pollChoices.length > 2}
									<button type="button" onclick={() => removePollChoice(i)} disabled={!hasPolls}
										class="px-2 text-slate-500 hover:text-rose-400 disabled:opacity-40" aria-label={tFn('seng.remove_choice')}>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
									</button>
								{/if}
							</div>
						{/each}
					</div>
					{#if pollChoices.length < 5}
						<button type="button" onclick={addPollChoice} disabled={!hasPolls}
							class="mt-2 text-[11px] text-purple-400 hover:text-purple-300 disabled:opacity-50 inline-flex items-center gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
							{tFn('seng.add_choice')}
						</button>
					{/if}
				</div>
				<div>
					<label for="poll-duration" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('seng.duration_label')} <span class="text-purple-300 font-mono">{durationLabel(pollDuration)}</span></label>
					<input id="poll-duration" type="range" min="15" max="1800" step="15" bind:value={pollDuration} disabled={!hasPolls}
						class="w-full accent-purple-500"/>
					<div class="flex justify-between text-[10px] text-slate-600 font-mono mt-0.5"><span>15s</span><span>30 min</span></div>
				</div>
				<button type="button" onclick={submitPoll} disabled={!hasPolls || pollSubmitting}
					class="w-full rounded-lg bg-purple-500/15 hover:bg-purple-500/25 disabled:opacity-30 disabled:cursor-not-allowed border border-purple-500/40 text-purple-200 font-medium px-4 py-2.5 text-sm transition-colors">
					{pollSubmitting ? tFn('seng.sending') : tFn('seng.launch_poll')}
				</button>
			</div>
		{/if}
	{/if}

	<!-- ══ PREDICTION ═════════════════════════════════════════════════════ -->
	{#if mode === 'prediction' && !loading && isMonetizable}
		{#if activePrediction}
			<!-- Live state -->
			<div class="rounded-lg border border-pink-500/40 bg-pink-500/5 p-4 space-y-3">
				<div class="flex items-center justify-between gap-3 flex-wrap">
					<div class="flex items-center gap-2">
						<span class="relative flex h-2.5 w-2.5">
							<span class="absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-60 animate-ping"></span>
							<span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-pink-500"></span>
						</span>
						<div class="text-sm font-semibold text-white">{activePrediction.title}</div>
					</div>
					<div class="text-[11px] text-pink-300 font-mono">
						{activePrediction.status === 'ACTIVE'
							? tFn('seng.pred_remaining', { time: fmtRemaining(activePrediction.startedAt, activePrediction.predictionWindowSeconds) })
							: tFn('seng.bets_locked_label')} · {predTotalUsers > 1 ? tFn('seng.participants_many', { n: fmtNumber(predTotalUsers) }) : tFn('seng.participants_one', { n: fmtNumber(predTotalUsers) })}
					</div>
				</div>
				<div class="space-y-2">
					{#each activePrediction.outcomes as outcome (outcome.id)}
						{@const pct = predTotalUsers > 0 ? Math.round((outcome.users / predTotalUsers) * 100) : 0}
						<div class="space-y-1">
							<div class="flex justify-between text-[11px]">
								<span class="text-slate-200 flex items-center gap-1.5">
									<span class="w-2 h-2 rounded-full" style="background: {colorFor(outcome.color)}"></span>
									{outcome.title}
								</span>
								<span class="text-slate-400 font-mono tabular-nums">{fmtNumber(outcome.users)} · {fmtNumber(outcome.channelPoints)} pts · {pct}%</span>
							</div>
							<div class="flex gap-2 items-center">
								<div class="flex-1 h-2 rounded-full bg-slate-800 overflow-hidden">
									<div class="h-full transition-all duration-500" style="width: {pct}%; background: {colorFor(outcome.color)}"></div>
								</div>
								{#if activePrediction.status === 'LOCKED'}
									<button type="button" onclick={() => patchPred('RESOLVED', outcome.id)} disabled={resolvingId !== null}
										class="text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-50 text-emerald-200 border border-emerald-500/40 px-2 py-1 rounded transition-colors shrink-0">
										{resolvingId === outcome.id ? '…' : tFn('seng.winner')}
									</button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
				<div class="flex gap-2 pt-1">
					{#if activePrediction.status === 'ACTIVE'}
						<button type="button" onclick={() => patchPred('LOCKED')}
							class="flex-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-200 font-medium px-3 py-2 text-xs transition-colors">
							{tFn('seng.lock_bets')}
						</button>
					{/if}
					<button type="button" onclick={() => patchPred('CANCELED')}
						class="flex-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 font-medium px-3 py-2 text-xs transition-colors">
						{tFn('seng.cancel_refund')}
					</button>
				</div>
			</div>
		{:else}
			<!-- Form create prediction -->
			<div class="space-y-3">
				<div>
					<label for="pred-title" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('seng.pred_question_label')}</label>
					<input id="pred-title" type="text" bind:value={predTitle} maxlength="45" disabled={!hasPredictions}
						placeholder={tFn('seng.pred_question_ph')}
						class="w-full rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/20 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-50"/>
					<div class="text-[10px] text-slate-500 mt-1 text-right font-mono">{predTitle.length} / 45</div>
				</div>
				<div>
					<label for="pred-outcome-0" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('seng.outcomes_label', { n: predOutcomes.length })}</label>
					<div class="space-y-2">
						{#each predOutcomes as _outcome, i}
							{@const color = i % 2 === 0 ? '#3b82f6' : '#ec4899'}
							<div class="flex gap-2 items-center">
								<span class="w-2 h-2 rounded-full shrink-0" style="background: {color}"></span>
								<input id={i === 0 ? 'pred-outcome-0' : undefined} type="text" bind:value={predOutcomes[i]} maxlength="25" disabled={!hasPredictions}
									placeholder={tFn('seng.outcome_ph', { n: i + 1 })}
									class="flex-1 rounded-lg bg-slate-950/60 border border-slate-700/60 focus:border-pink-500/60 focus:ring-2 focus:ring-pink-500/20 px-3 py-1.5 text-sm text-white placeholder-slate-600 outline-none transition-colors disabled:opacity-50"/>
								{#if predOutcomes.length > 2}
									<button type="button" onclick={() => removePredOutcome(i)} disabled={!hasPredictions}
										class="px-2 text-slate-500 hover:text-rose-400 disabled:opacity-40" aria-label={tFn('seng.remove_outcome')}>
										<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
									</button>
								{/if}
							</div>
						{/each}
					</div>
					{#if predOutcomes.length < 10}
						<button type="button" onclick={addPredOutcome} disabled={!hasPredictions}
							class="mt-2 text-[11px] text-pink-400 hover:text-pink-300 disabled:opacity-50 inline-flex items-center gap-1">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
							{tFn('seng.add_outcome')}
						</button>
					{/if}
				</div>
				<div>
					<label for="pred-window" class="block text-[11px] uppercase tracking-widest font-semibold text-slate-400 mb-1.5">{tFn('seng.window_label')} <span class="text-pink-300 font-mono">{durationLabel(predWindow)}</span></label>
					<input id="pred-window" type="range" min="30" max="1800" step="30" bind:value={predWindow} disabled={!hasPredictions}
						class="w-full accent-pink-500"/>
					<div class="flex justify-between text-[10px] text-slate-600 font-mono mt-0.5"><span>30s</span><span>30 min</span></div>
				</div>
				<button type="button" onclick={submitPrediction} disabled={!hasPredictions || predSubmitting}
					class="w-full rounded-lg bg-pink-500/15 hover:bg-pink-500/25 disabled:opacity-30 disabled:cursor-not-allowed border border-pink-500/40 text-pink-200 font-medium px-4 py-2.5 text-sm transition-colors">
					{predSubmitting ? tFn('seng.sending') : tFn('seng.launch_prediction')}
				</button>
			</div>
		{/if}
	{/if}
</section>
