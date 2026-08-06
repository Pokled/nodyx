<script lang="ts">
	import { onMount } from 'svelte'
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	// Channel Points Rewards manager : liste les rewards créées par l'app
	// Nodyx sur la chaine Twitch du streamer, formulaire de création, édition
	// inline (title/cost/cooldown/pause), suppression. Affiliate/Partner gate
	// côté UI : Twitch refuse l'API même avec les bons scopes pour les chaines
	// standard, on bloque en amont pour ne pas montrer un formulaire mort.

	interface Props {
		token:           string
		hasScope:        boolean
		broadcasterType: 'partner' | 'affiliate' | ''
	}

	let { token, hasScope, broadcasterType }: Props = $props()

	type Reward = {
		id:                                 string
		title:                              string
		prompt:                             string
		cost:                               number
		isEnabled:                          boolean
		isPaused:                           boolean
		isInStock:                          boolean
		isUserInputRequired:                boolean
		shouldRedemptionsSkipRequestQueue:  boolean
		backgroundColor:                    string
		cooldownSeconds:                    number | null
		isGlobalCooldownEnabled:            boolean
		maxPerStreamCount:                  number | null
		isMaxPerStreamEnabled:              boolean
		maxPerUserPerStreamCount:           number | null
		isMaxPerUserPerStreamEnabled:       boolean
		imageUrls: {
			url_1x: string | null
			url_2x: string | null
			url_4x: string | null
		}
	}

	const isMonetizable = $derived(broadcasterType === 'partner' || broadcasterType === 'affiliate')

	let rewards   = $state<Reward[]>([])
	let loading   = $state(true)
	let toast     = $state<{ text: string; ok: boolean } | null>(null)
	let openId    = $state<string | null>(null)        // id du reward en mode édition
	let createOpen = $state(false)

	// ── Form create ──────────────────────────────────────────────────────
	let formTitle           = $state('')
	let formPrompt          = $state('')
	let formCost            = $state(100)
	let formBgColor         = $state('#7c3aed')
	let formCooldown        = $state(0)                 // 0 = pas de cooldown
	let formMaxPerStream    = $state(0)
	let formMaxPerUserPerStream = $state(0)
	let formUserInput       = $state(false)
	let creating            = $state(false)

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 3500)
	}

	async function reload(): Promise<void> {
		if (!isMonetizable || !hasScope) { loading = false; return }
		try {
			const res = await apiFetch(fetch, '/streamer/twitch/rewards', {
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				const data = await res.json() as { rewards: Reward[] }
				rewards = data.rewards ?? []
			} else {
				const err = await res.json().catch(() => ({})) as { error?: string }
				flash(err.error ?? tFn('rewards.err_fetch'), false)
			}
		} catch {
			flash(tFn('rewards.err_network'), false)
		} finally {
			loading = false
		}
	}

	onMount(() => { reload() })

	async function createOne(): Promise<void> {
		if (creating || !formTitle.trim() || formCost < 1) return
		creating = true
		try {
			const res = await apiFetch(fetch, '/streamer/twitch/rewards', {
				method:  'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					title:               formTitle.trim(),
					prompt:              formPrompt.trim() || undefined,
					cost:                formCost,
					backgroundColor:     formBgColor,
					isUserInputRequired: formUserInput,
					cooldownSeconds:     formCooldown > 0 ? formCooldown : undefined,
					maxPerStream:        formMaxPerStream > 0 ? formMaxPerStream : undefined,
					maxPerUserPerStream: formMaxPerUserPerStream > 0 ? formMaxPerUserPerStream : undefined,
				}),
			})
			if (res.ok) {
				flash(tFn('rewards.created'), true)
				formTitle = ''; formPrompt = ''; formCost = 100
				formCooldown = 0; formMaxPerStream = 0; formMaxPerUserPerStream = 0
				formUserInput = false
				createOpen = false
				await reload()
			} else {
				const err = await res.json().catch(() => ({})) as { error?: string }
				const raw = err.error ?? ''
				flash(
					raw === 'missing_scope_manage_redemptions' ? tFn('rewards.err_scope') :
					raw.includes('not_partner_or_affiliate') || raw.includes('CHANNEL_POINTS_NOT_ENABLED') ?
						tFn('rewards.err_not_affiliate') :
					tFn('rewards.err_generic', { error: raw || tFn('rewards.twitch_error') }),
					false,
				)
			}
		} catch {
			flash(tFn('rewards.err_network'), false)
		} finally {
			creating = false
		}
	}

	async function patchOne(rewardId: string, patch: Record<string, unknown>): Promise<void> {
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/rewards/${rewardId}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify(patch),
			})
			if (res.ok) {
				flash(tFn('rewards.updated'), true)
				await reload()
			} else {
				const err = await res.json().catch(() => ({})) as { error?: string }
				flash(tFn('rewards.err_generic', { error: err.error ?? tFn('rewards.twitch_error') }), false)
			}
		} catch {
			flash(tFn('rewards.err_network'), false)
		}
	}

	async function deleteOne(reward: Reward): Promise<void> {
		if (!confirm(tFn('rewards.delete_confirm', { title: reward.title }))) return
		try {
			const res = await apiFetch(fetch, `/streamer/twitch/rewards/${reward.id}`, {
				method:  'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) { flash(tFn('rewards.deleted'), true); await reload() }
			else        flash(tFn('rewards.err_delete'), false)
		} catch {
			flash(tFn('rewards.err_network'), false)
		}
	}

	function fmtCooldown(sec: number | null): string {
		if (!sec) return '·'
		if (sec < 60) return `${sec}s`
		if (sec < 3600) return `${Math.floor(sec / 60)}m`
		return `${Math.floor(sec / 3600)}h`
	}
</script>

<section class="rounded-xl border border-purple-500/25 bg-gradient-to-br from-purple-950/30 via-slate-900/60 to-pink-950/20 p-5 space-y-4">
	<header class="flex items-center justify-between gap-3 flex-wrap">
		<div class="flex items-center gap-2.5">
			<svg class="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zM5 21h14a2 2 0 002-2v-9a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2z"/></svg>
			<h2 class="text-sm font-semibold text-white">Channel Points Rewards</h2>
		</div>
		<a href="https://help.twitch.tv/s/article/channel-points-guide" target="_blank" rel="noopener noreferrer"
			class="text-[11px] text-purple-400 hover:text-purple-300 inline-flex items-center gap-1">
			{tFn('rewards.guide_link')}
			<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
		</a>
	</header>

	{#if toast}
		<div class="rounded-lg border p-3 text-xs flex items-center gap-2 {toast.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	{#if !isMonetizable}
		<div class="rounded-lg border border-purple-500/40 bg-purple-500/5 p-4 flex items-start gap-3 text-xs">
			<svg class="w-5 h-5 text-purple-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
			<div class="flex-1 space-y-1">
				<div class="font-semibold text-purple-200">{tFn('rewards.not_monetizable_title')}</div>
				<p class="text-purple-300/80 leading-relaxed">
					{tFn('rewards.not_monetizable_desc')}
				</p>
				<a href="https://help.twitch.tv/s/article/joining-the-affiliate-program" target="_blank" rel="noopener noreferrer" class="text-purple-300 hover:text-purple-200 underline decoration-purple-500/40 inline-flex items-center gap-1">
					{tFn('rewards.affiliate_conditions')}
					<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/></svg>
				</a>
			</div>
		</div>
	{:else if !hasScope}
		<div class="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
			{@html tFn('rewards.scope_missing')}
		</div>
	{:else}
		<!-- Form create (collapsible) -->
		<div class="rounded-lg border border-slate-700/60 bg-slate-950/40">
			<button type="button" onclick={() => createOpen = !createOpen}
				class="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-800/30 transition-colors">
				<div class="flex items-center gap-2">
					<svg class="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>
					<span class="text-sm font-semibold text-purple-200">{tFn('rewards.create_new')}</span>
				</div>
				<svg class="w-4 h-4 text-slate-400 transition-transform {createOpen ? 'rotate-180' : ''}" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
			</button>
			{#if createOpen}
				<div class="px-4 pb-4 space-y-3 border-t border-slate-700/40 pt-3">
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						<div>
							<label for="rw-title" class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('rewards.form_title_label')}</label>
							<input id="rw-title" type="text" bind:value={formTitle} maxlength="45"
								placeholder={tFn('rewards.form_title_ph')}
								class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-3 py-2 text-sm text-white placeholder-slate-600 outline-none transition-colors"/>
						</div>
						<div>
							<label for="rw-cost" class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('rewards.form_cost_label')}</label>
							<input id="rw-cost" type="number" bind:value={formCost} min="1" step="50"
								class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-3 py-2 text-sm text-white outline-none transition-colors font-mono"/>
						</div>
					</div>
					<div>
						<label for="rw-prompt" class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('rewards.form_prompt_label')}</label>
						<textarea id="rw-prompt" bind:value={formPrompt} maxlength="200" rows="2"
							placeholder={tFn('rewards.form_prompt_ph')}
							class="w-full rounded-lg bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-3 py-2 text-xs text-white placeholder-slate-600 outline-none transition-colors resize-none"></textarea>
					</div>
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
						<div>
							<label for="rw-bg" class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('rewards.form_color_label')}</label>
							<div class="flex gap-1.5">
								<input id="rw-bg" type="color" bind:value={formBgColor}
									class="w-9 h-8 rounded border border-slate-700/60 bg-slate-950 cursor-pointer"/>
								<input type="text" bind:value={formBgColor} maxlength="7"
									class="flex-1 rounded bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-2 py-1.5 text-xs text-white outline-none font-mono"/>
							</div>
						</div>
						<div>
							<label for="rw-cd" class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('rewards.form_cooldown_label')}</label>
							<input id="rw-cd" type="number" bind:value={formCooldown} min="0" max="604800" step="30"
								class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-2 py-1.5 text-xs text-white outline-none font-mono"/>
						</div>
						<div>
							<label for="rw-mps" class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('rewards.form_maxstream_label')}</label>
							<input id="rw-mps" type="number" bind:value={formMaxPerStream} min="0" max="100" step="1"
								class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-2 py-1.5 text-xs text-white outline-none font-mono"/>
						</div>
						<div>
							<label for="rw-mpu" class="block text-[10px] uppercase tracking-wider text-slate-500 mb-1">{tFn('rewards.form_maxuser_label')}</label>
							<input id="rw-mpu" type="number" bind:value={formMaxPerUserPerStream} min="0" max="100" step="1"
								class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 focus:ring-2 focus:ring-purple-500/20 px-2 py-1.5 text-xs text-white outline-none font-mono"/>
						</div>
					</div>
					<label class="flex items-center gap-2 cursor-pointer">
						<input type="checkbox" bind:checked={formUserInput} class="accent-purple-500"/>
						<span class="text-xs text-slate-300">{tFn('rewards.form_userinput_label')}</span>
					</label>
					<button type="button" onclick={createOne} disabled={creating || !formTitle.trim() || formCost < 1}
						class="w-full rounded-lg bg-purple-500/15 hover:bg-purple-500/25 disabled:opacity-30 border border-purple-500/40 text-purple-200 font-medium px-4 py-2 text-sm transition-colors">
						{creating ? tFn('rewards.creating') : tFn('rewards.create_submit')}
					</button>
				</div>
			{/if}
		</div>

		<!-- Liste des rewards existantes -->
		<div class="space-y-2">
			<div class="text-[11px] uppercase tracking-widest font-semibold text-slate-400">{tFn('rewards.active_count', { n: rewards.length })}</div>
			{#if loading}
				<div class="text-xs text-slate-500 text-center py-6">{tFn('rewards.loading')}</div>
			{:else if rewards.length === 0}
				<div class="rounded-lg border border-dashed border-slate-700/60 bg-slate-900/30 p-6 text-center text-xs text-slate-500">
					{tFn('rewards.empty')}
				</div>
			{:else}
				{#each rewards as r (r.id)}
					<div class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-2"
					     style="border-left: 3px solid {r.backgroundColor};">
						<div class="flex items-start justify-between gap-3">
							<div class="flex items-center gap-3 flex-1 min-w-0">
								{#if r.imageUrls.url_2x}
									<img src={r.imageUrls.url_2x} alt="" class="w-10 h-10 rounded shrink-0" loading="lazy"/>
								{:else}
									<div class="w-10 h-10 rounded shrink-0" style="background: {r.backgroundColor}"></div>
								{/if}
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="text-sm font-semibold text-white">{r.title}</span>
										<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/30">{r.cost.toLocaleString('fr-FR')} pts</span>
										{#if !r.isEnabled}
											<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700/40 text-slate-400 border border-slate-600/40">disabled</span>
										{:else if r.isPaused}
											<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">paused</span>
										{:else if !r.isInStock}
											<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">out of stock</span>
										{:else}
											<span class="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">live</span>
										{/if}
									</div>
									{#if r.prompt}
										<div class="text-[11px] text-slate-400 mt-0.5 line-clamp-2">{r.prompt}</div>
									{/if}
									<div class="text-[10px] text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
										{#if r.cooldownSeconds}<span>{tFn('rewards.cooldown', { v: fmtCooldown(r.cooldownSeconds) })}</span>{/if}
										{#if r.maxPerStreamCount}<span>{tFn('rewards.max_stream', { n: r.maxPerStreamCount })}</span>{/if}
										{#if r.maxPerUserPerStreamCount}<span>{tFn('rewards.max_user', { n: r.maxPerUserPerStreamCount })}</span>{/if}
										{#if r.isUserInputRequired}<span>{tFn('rewards.text_required')}</span>{/if}
									</div>
								</div>
							</div>
							<div class="flex flex-col gap-1 shrink-0">
								<button type="button" onclick={() => patchOne(r.id, { isPaused: !r.isPaused })}
									class="text-[10px] px-2 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-200 transition-colors">
									{r.isPaused ? tFn('rewards.resume') : tFn('rewards.pause')}
								</button>
								<button type="button" onclick={() => patchOne(r.id, { isEnabled: !r.isEnabled })}
									class="text-[10px] px-2 py-1 rounded bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/40 text-slate-200 transition-colors">
									{r.isEnabled ? tFn('rewards.disable') : tFn('rewards.enable')}
								</button>
								<button type="button" onclick={() => deleteOne(r)}
									class="text-[10px] px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 transition-colors">
									{tFn('rewards.delete')}
								</button>
							</div>
						</div>
					</div>
				{/each}
			{/if}
		</div>

		<!-- Note explicative -->
		<details class="rounded-lg border border-slate-700/60 bg-slate-900/30 text-xs">
			<summary class="px-4 py-2.5 cursor-pointer text-slate-300 hover:text-white">
				{tFn('rewards.how_title')}
			</summary>
			<div class="px-4 pb-4 pt-1 text-slate-400 space-y-2 leading-relaxed">
				{@html tFn('rewards.how_1')}
				{@html tFn('rewards.how_2')}
				{@html tFn('rewards.how_3')}
			</div>
		</details>
	{/if}
</section>
