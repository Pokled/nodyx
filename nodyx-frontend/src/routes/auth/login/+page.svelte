<script lang="ts">
	import { t } from '$lib/i18n'
	import type { ActionData, PageData } from './$types';
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';

	const tFn = $derived($t)

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let submitting     = $state(false);
	let totpCode       = $state('');
	let totpSubmitting = $state(false);
	let demoOpen       = $state(false);
	let emailInput     = $state('');
	let passwordInput  = $state('');
	let focusedField   = $state<string | null>(null);

	// Auto-déclenche Signet quand le backend retourne requires_signet après password OK
	$effect(() => {
		if (form?.requires_signet && form?.username && signetState === 'idle') {
			signetUsername = form.username as string
			signetStart()
		}
	})

	// ── Nodyx Signet ──────────────────────────────────────────────────────────
	type SignetState = 'idle' | 'waiting' | 'approved' | 'rejected' | 'expired' | 'error'

	let signetState    = $state<SignetState>(untrack(() => data.signetError ? 'error' : 'idle'))
	let signetUsername = $state('')
	let signetError    = $state(untrack(() => data.signetError ?? ''))
	let signetToken   = $state('')
	let signetChallengeId = $state('')
	let signetPollInterval: ReturnType<typeof setInterval> | null = null
	let signetFormRef = $state<HTMLFormElement | null>(null)

	$effect(() => {
		if (signetState === 'approved' && signetFormRef) {
			signetFormRef.submit()
		}
	})

	function signetReset() {
		if (signetPollInterval) clearInterval(signetPollInterval)
		signetPollInterval = null
		signetState = 'idle'
		signetError = ''
		signetToken = ''
		signetChallengeId = ''
	}

	async function signetStart() {
		if (!signetUsername.trim()) { signetError = tFn('auth.signet.enter_username_error'); return }
		signetError = ''
		signetState = 'waiting'

		try {
			const res = await fetch('/api/auth/challenges/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					username: signetUsername.trim(),
					hubUrl: window.location.origin
				})
			})
			if (!res.ok) {
				const j = await res.json()
				const msg = j.code === 'NO_DEVICE'
					? tFn('auth.signet.no_device')
					: (j.error ?? tFn('auth.signet.challenge_error'))
				signetError = msg
				signetState = 'error'
				return
			}
			const { challengeId, pollNonce } = await res.json()
			signetChallengeId = challengeId
			signetStartPolling(challengeId, pollNonce)
		} catch {
			signetError = tFn('auth.signet.server_error')
			signetState = 'error'
		}
	}

	// ── Mode QR cross-instance (sans compte pré-existant) ─────────────────────
	let signetQrMode     = $state(false)
	let signetQrUrl      = $state('')
	let signetQrCanvas   = $state<HTMLCanvasElement | null>(null)

	async function signetStartCross() {
		signetError = ''
		signetQrMode = true
		signetState = 'waiting'
		try {
			const res = await fetch('/api/auth/challenges/create', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ hubUrl: window.location.origin })
			})
			if (!res.ok) {
				const j = await res.json()
				signetError = j.error ?? tFn('auth.signet.challenge_error')
				signetState = 'error'
				return
			}
			const { challengeId, challenge, pollNonce } = await res.json()
			signetChallengeId = challengeId

			// Construire l'URL pour la PWA Signet
			const signetUrl = new URL('https://signet.nodyx.org/connect')
			signetUrl.searchParams.set('instance', window.location.origin)
			signetUrl.searchParams.set('challengeId', challengeId)
			signetUrl.searchParams.set('challenge', challenge)
			signetUrl.searchParams.set('nonce', pollNonce)
			signetQrUrl = signetUrl.toString()

			// Générer le QR
			const QRCode = (await import('qrcode')).default
			if (signetQrCanvas) {
				await QRCode.toCanvas(signetQrCanvas, signetQrUrl, { width: 200, margin: 1, color: { dark: '#000000', light: '#ffffff' } })
			}

			signetStartPolling(challengeId, pollNonce)
		} catch {
			signetError = tFn('auth.signet.server_error')
			signetState = 'error'
		}
	}

	function signetStartPolling(challengeId: string, pollNonce: string) {
		signetPollInterval = setInterval(async () => {
			try {
				const poll = await fetch(`/api/auth/challenges/status/${challengeId}?nonce=${pollNonce}`)
				if (!poll.ok) return
				const j = await poll.json()
				if (j.status === 'approved' && j.token) {
					clearInterval(signetPollInterval!)
					if (signetQrMode) {
						// Flow cross-instance : fetch direct pour poser le cookie, puis navigation
						try {
							await fetch('?/signet', {
								method: 'POST',
								credentials: 'same-origin',
								headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
								body: new URLSearchParams({ token: j.token, redirectTo: data.redirectTo || '/' })
							})
						} catch {}
						window.location.href = data.redirectTo || '/'
					} else {
						signetToken = j.token
						signetState = 'approved'
					}
				} else if (j.status === 'rejected') {
					clearInterval(signetPollInterval!)
					signetState = 'rejected'
				} else if (j.status === 'expired') {
					clearInterval(signetPollInterval!)
					signetState = 'expired'
				}
			} catch {}
		}, 2000)
	}

	function signetResetFull() {
		signetReset()
		signetQrMode = false
		signetQrUrl  = ''
	}
</script>

<svelte:head>
	<title>{tFn('auth.login.title')} · Nodyx</title>
</svelte:head>

<!-- ── Split layout: presentation a gauche, formulaire a droite ── -->
<div class="w-full h-full min-h-0 p-6 sm:p-8 overflow-hidden">

	<div class="w-full h-full min-h-0 grid grid-cols-1 md:grid-cols-[1fr_minmax(420px,35%)] gap-4">

		<!-- ════════ Left: texte de presentation ════════ -->
		<!-- Affiche sombre dans les deux thèmes (.nx-on-dark) : halos et robot pensés pour le noir. -->
		<div class="nx-on-dark relative overflow-hidden hidden md:flex flex-col justify-start min-h-0 p-6 sm:p-8 rounded-2xl bg-[#06060a]">

			<!-- Dot grid + radial glows -->
			<div class="absolute inset-0 pointer-events-none"
				style="background:
					radial-gradient(circle at 15% 40%, rgba(124,58,237,0.12) 0%, transparent 45%),
					radial-gradient(circle at 85% 15%, rgba(6,182,212,0.06) 0%, transparent 35%),
					radial-gradient(color-mix(in srgb, var(--nx-text) 3.5%, transparent) 1px, transparent 1px);
					background-size: 100%, 100%, 28px 28px">
			</div>

			<!-- Community text -->
			<div class="relative z-10 max-w-md mt-2">
				<div class="text-[11px] uppercase tracking-[0.15em] mb-3"
					style="color: var(--nx-cyan-soft, #67e8f9); font-family: ui-monospace, monospace">
					{tFn('auth.hero.tagline')}
				</div>
				<h2 class="titre-heros text-4xl font-bold leading-tight mb-3 text-[var(--nx-text)]">
					{tFn('auth.hero.login_title_1')}<span class="titre-heros-sep">{' '}</span><span style="color: var(--nx-accent-2-soft, var(--nx-header-accent))">{tFn('auth.hero.login_title_2')}</span><span class="titre-heros-point">.</span>
				</h2>
				<p class="text-sm leading-relaxed text-[var(--nx-text-muted)]">
					{tFn('auth.hero.login_desc')}
				</p>
			</div>
		</div>

		<!-- ════════ Right: Login form ════════ -->
		<div class="relative flex items-center justify-center min-h-0 h-full overflow-y-auto p-6 sm:p-8">

			<!-- Dot grid (subtle) -->
			<div class="absolute inset-0 pointer-events-none opacity-50"
				style="background: radial-gradient(color-mix(in srgb, var(--nx-text) 3.5%, transparent) 1px, transparent 1px); background-size: 28px 28px">
			</div>

		<div class="relative z-10 w-full max-w-md">

			<!-- Logo & Robot header -->
			<div class="flex items-center justify-between mb-4">
				<span class="text-lg font-bold text-[var(--nx-text)] tracking-tight">Nodyx</span>
				
				<!-- Robot Avatar directly on top of form -->
				<div class="flex flex-col items-center">
					<!-- Speech bubble -->
					<div class="relative mb-2 w-full max-w-40">
						<div class="rounded-lg px-3 py-1.5 shadow-md text-center w-full border transition-colors duration-300
						            {form?.error ? 'bg-red-950/60 border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)]' : 'bg-[var(--nx-surface-raised)]/90 border-[var(--nx-border)]'}">
							<p class="text-[11px] leading-tight transition-colors duration-200 {form?.error ? 'text-[var(--nx-bad)]' : 'text-[var(--nx-text)]'}">
								{form?.error ? form.error : submitting ? tFn('auth.login.submitting') : focusedField === 'email' ? tFn('auth.register.email_hint') : focusedField === 'password' ? tFn('auth.bot.password_shy') : tFn('auth.register.welcome_message')}
							</p>
						</div>
						<div class="absolute -bottom-[6px] left-1/2 -translate-x-1/2 w-0 h-0 border-l-[6px] border-r-[6px] border-t-[7px] border-l-transparent border-r-transparent {form?.error ? 'border-t-red-800/60' : 'border-t-[var(--nx-border)]'}"></div>
					</div>

					<svg width="60" height="90" viewBox="0 0 80 132" class="transition-all duration-300 drop-shadow-lg" class:robot-shake={!!form?.error}>
						<!-- Antenna -->
						<line x1="40" y1="14" x2="40" y2="6" stroke={form?.error ? '#ef4444' : submitting ? '#f59e0b' : '#6366f1'} stroke-width="2" stroke-linecap="round"/>
						<circle cx="40" cy="4.5" r="3.5" fill={form?.error ? '#ef4444' : submitting ? '#f59e0b' : '#6366f1'} class:antenna-bounce={focusedField !== null || submitting}/>

						<!-- Head -->
						<rect x="8" y="14" width="64" height="44" rx="9" fill="#0f172a"/>
						<rect x="8" y="14" width="64" height="44" rx="9" fill="none" stroke="#1e293b" stroke-width="2"/>

						<!-- Eyes -->
						{#if form?.error}
							<line x1="18" y1="28" x2="32" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
							<line x1="32" y1="28" x2="18" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
							<line x1="48" y1="28" x2="62" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
							<line x1="62" y1="28" x2="48" y2="42" stroke="#ef4444" stroke-width="3" stroke-linecap="round"/>
						{:else if submitting}
							<circle cx="25" cy="35" r="8" fill="#0f172a"/>
							<circle cx="25" cy="35" r="5" fill="none" stroke="#1e293b" stroke-width="2"/>
							<circle cx="25" cy="30" r="2" fill="#f59e0b">
								<animateTransform attributeName="transform" type="rotate" from="0 25 35" to="360 25 35" dur="0.9s" repeatCount="indefinite"/>
							</circle>
							<circle cx="55" cy="35" r="8" fill="#0f172a"/>
							<circle cx="55" cy="35" r="5" fill="none" stroke="#1e293b" stroke-width="2"/>
							<circle cx="55" cy="30" r="2" fill="#f59e0b">
								<animateTransform attributeName="transform" type="rotate" from="0 55 35" to="360 55 35" dur="0.9s" repeatCount="indefinite"/>
							</circle>
						{:else if focusedField === 'password'}
							<path d="M 18 36 Q 25 44 32 36" stroke="var(--nx-header-accent)" stroke-width="3" fill="none" stroke-linecap="round"/>
							<path d="M 48 36 Q 55 44 62 36" stroke="var(--nx-header-accent)" stroke-width="3" fill="none" stroke-linecap="round"/>
							<rect x="15" y="26" width="18" height="14" rx="4" fill="#1e293b" stroke="var(--nx-header-accent)" stroke-width="1.5"/>
							<rect x="47" y="26" width="18" height="14" rx="4" fill="#1e293b" stroke="var(--nx-header-accent)" stroke-width="1.5"/>
						{:else}
							<circle cx="25" cy="35" r="8" fill="#0f172a"/>
							<circle cx={22 + Math.min(6, (emailInput.length || 0) * 0.25)} cy="35" r="4.5" fill={focusedField ? 'var(--nx-header-accent)' : '#6366f1'} class="transition-all duration-150"/>
							<circle cx={19.5 + Math.min(6, (emailInput.length || 0) * 0.25)} cy="32" r="1.5" fill="white" opacity="0.8" class="transition-all duration-150"/>
							<circle cx="55" cy="35" r="8" fill="#0f172a"/>
							<circle cx={52 + Math.min(6, (emailInput.length || 0) * 0.25)} cy="35" r="4.5" fill={focusedField ? 'var(--nx-header-accent)' : '#6366f1'} class="transition-all duration-150"/>
							<circle cx={49.5 + Math.min(6, (emailInput.length || 0) * 0.25)} cy="32" r="1.5" fill="white" opacity="0.8" class="transition-all duration-150"/>
						{/if}

						<!-- Mouth -->
						{#if form?.error}
							<path d="M 27 54 Q 40 49 53 54" stroke="#ef4444" stroke-width="2" fill="none" stroke-linecap="round"/>
						{:else if submitting}
							<circle cx="40" cy="52" r="3.5" fill="none" stroke="#f59e0b" stroke-width="1.5" stroke-dasharray="3.5 2">
								<animateTransform attributeName="transform" type="rotate" from="0 40 52" to="360 40 52" dur="1.5s" repeatCount="indefinite"/>
							</circle>
						{:else if focusedField}
							<ellipse cx="40" cy="52" rx="5" ry="3.5" fill="#0f172a" stroke="#334155" stroke-width="1.5"/>
						{:else}
							<path d="M 29 51 Q 40 54 51 51" stroke="#334155" stroke-width="2" fill="none" stroke-linecap="round"/>
						{/if}

						<!-- Body -->
						<rect x="13" y="62" width="54" height="32" rx="8" fill="#0f172a"/>
						<rect x="13" y="62" width="54" height="32" rx="8" fill="none" stroke="#1e293b" stroke-width="2"/>
						<rect x="21" y="69" width="38" height="18" rx="4" fill="#020617"/>
						<circle cx="30" cy="78" r="3.5" fill={form?.error ? '#ef4444' : 'var(--nx-accent)'} opacity={focusedField ? '0.9' : '0.4'}/>
						<circle cx="40" cy="78" r="3.5" fill={submitting ? '#f59e0b' : 'var(--nx-accent)'} opacity={focusedField ? '0.7' : '0.25'}/>
						<circle cx="50" cy="78" r="3.5" fill="#334155" opacity="0.4"/>
					</svg>
				</div>
			</div>

		{#if data.demoMode}
		<div class="mb-4 rounded-lg border border-[color-mix(in_srgb,var(--nx-text)_6%,transparent)] overflow-hidden">
			<button type="button" onclick={() => demoOpen = !demoOpen}
				class="w-full px-3.5 py-2 flex items-center gap-2 text-left transition-colors"
				style="background: color-mix(in srgb, var(--nx-text) 2%, transparent); color: var(--nx-text-muted)">
				<span class="text-[10px] transition-transform" style="transform: rotate({demoOpen ? '90deg' : '0'})">▶</span>
				<span class="text-[11px]">{tFn('auth.demo.title')}</span>
			</button>
			{#if demoOpen}
			<div class="p-1.5 space-y-1">
				{#each ['alice', 'bob', 'charlie', 'admin'] as u}
				<div class="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg"
					style="background: color-mix(in srgb, var(--nx-text) 3%, transparent); border: 1px solid color-mix(in srgb, var(--nx-text) 4%, transparent)">
					<span class="font-mono text-[11px] text-[var(--nx-text)] shrink-0">{u}@demo.nodyx.org</span>
					<span class="text-[11px] shrink-0 text-[var(--nx-text-muted)]">demo1234</span>
					<button type="button"
						onclick={() => { emailInput = u + '@demo.nodyx.org'; passwordInput = 'demo1234'; demoOpen = false; }}
						class="px-2 py-0.5 rounded text-[10px] font-medium shrink-0 transition-colors active:scale-[0.97]"
						style="background: rgba(99,102,241,0.15); border: 1px solid rgba(99,102,241,0.3); color: var(--nx-accent-soft, var(--nx-header-accent))">
						use
					</button>
				</div>
				{/each}
			</div>
			{/if}
		</div>
		{/if}

			{#if data.passwordReset}
				<div class="mb-4 rounded border border-[color-mix(in_srgb,var(--nx-ok)_40%,transparent)] bg-[color-mix(in_srgb,var(--nx-ok)_10%,transparent)] px-4 py-2.5 text-sm text-[var(--nx-ok)]">
					{tFn('auth.password_reset.success_message')}
				</div>
			{/if}

			{#if form?.requires_signet}
				<!-- ── Étape 2 : approbation Signet ─────────────────────────────────── -->
				<div class="rounded-lg border p-6"
					style="border-color: color-mix(in srgb, var(--nx-warn) 30%, transparent); background: color-mix(in srgb, var(--nx-warn) 4%, transparent)">
					<div class="flex items-center gap-3 mb-5">
						<div class="w-10 h-10 rounded-lg flex items-center justify-center text-xl font-bold shrink-0"
							style="background: color-mix(in srgb, var(--nx-warn) 12%, transparent); border: 1px solid color-mix(in srgb, var(--nx-warn) 35%, transparent); color: var(--nx-warn)">
							◈
						</div>
						<div>
							<p class="text-sm font-semibold text-[var(--nx-text)]">{tFn('auth.signet.verification_title')}</p>
							<p class="text-xs mt-0.5 text-[var(--nx-text-muted)]">
								{tFn('auth.signet.verify_description')}
							</p>
						</div>
					</div>

					{#if signetState === 'idle' || signetState === 'waiting'}
						<div class="flex flex-col items-center gap-4 py-2">
							<div class="relative">
								<div class="w-14 h-14 rounded-lg flex items-center justify-center text-2xl font-bold signet-icon">
									◈
								</div>
								<div class="absolute inset-0 rounded-lg animate-ping opacity-20 signet-ping"></div>
							</div>
							<div class="text-center">
								<p class="text-sm font-semibold text-[var(--nx-text)]">{tFn('common.waiting_approval')}</p>
								<p class="text-xs mt-1 text-[var(--nx-text-muted)]">{tFn('auth.signet.open_app_message')}</p>
							</div>
							{#if signetError}
								<p class="text-xs text-center text-[var(--nx-bad)]">{signetError}</p>
							{/if}
						</div>

					{:else if signetState === 'approved'}
						<form bind:this={signetFormRef} method="POST" action="?/signet">
							<input type="hidden" name="token" value={signetToken} />
							<input type="hidden" name="redirectTo" value={form?.redirectTo ?? data.redirectTo} />
						</form>
						<div class="flex flex-col items-center gap-3 py-3">
							<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl signet-ok">✓</div>
							<p class="text-sm font-semibold text-[var(--nx-ok)]">{tFn('auth.signet.approved_logging_in')}</p>
						</div>

					{:else if signetState === 'rejected'}
						<div class="flex flex-col items-center gap-3 py-3">
							<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl signet-err">✕</div>
							<p class="text-sm font-semibold mb-1 text-[var(--nx-bad)]">{tFn('auth.signet.request_rejected')}</p>
							<p class="text-xs text-[var(--nx-text-muted)]">{tFn('auth.signet.retry_message')}</p>
							<a href="/auth/login" class="text-xs underline mt-1 text-[var(--nx-warn)]">{tFn('auth.signet.back_to_login')}</a>
						</div>

					{:else if signetState === 'expired'}
						<div class="flex flex-col items-center gap-3 py-3">
							<p class="text-sm text-[var(--nx-text-muted)]">{tFn('auth.signet.challenge_expired')}</p>
							<a href="/auth/login" class="text-xs underline text-[var(--nx-warn)]">{tFn('auth.signet.back_to_login')}</a>
						</div>

					{:else if signetState === 'error'}
						<div class="flex flex-col items-center gap-3 py-3">
							<p class="text-xs text-center mb-2 text-[var(--nx-bad)]">{signetError}</p>
							<a href="/auth/login" class="text-xs underline text-[var(--nx-warn)]">{tFn('auth.signet.back_to_login')}</a>
						</div>
					{/if}
				</div>

			{:else if form?.requires_totp}
				<!-- ── Étape 2 : code TOTP ──────────────────────────────────────────── -->
				<div class="mb-6 rounded-lg border border-indigo-700/40 bg-[rgb(var(--nx-accent-rgb)/0.05)] px-5 py-4">
					<div class="flex items-center gap-3 mb-3">
						<span class="text-2xl">🔐</span>
						<div>
							<p class="text-sm font-semibold text-[var(--nx-text)]">{tFn('auth.totp.title')}</p>
							<p class="text-xs text-[var(--nx-text-muted)] mt-0.5">{tFn('auth.totp.enter_code_instruction')}</p>
						</div>
					</div>
					{#if form?.error}
						<p class="mb-3 rounded bg-[color-mix(in_srgb,var(--nx-bad)_15%,transparent)] border border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] px-3 py-2 text-xs text-[var(--nx-bad)]">{form.error}</p>
					{/if}
					<form
						method="POST"
						action="?/totp"
						use:enhance={() => {
							totpSubmitting = true;
							return async ({ result }) => {
								if (result.type === 'redirect') {
									window.location.href = result.location;
								} else {
									totpSubmitting = false;
									const { applyAction } = await import('$app/forms');
									await applyAction(result);
								}
							};
						}}
						class="space-y-3"
					>
						<input type="hidden" name="totp_pending" value={form.totp_pending} />
						<input type="hidden" name="redirectTo"   value={form.redirectTo ?? data.redirectTo} />
						<input
							name="code"
							type="text"
							inputmode="numeric"
							pattern="[0-9]{6}"
							maxlength="6"
							bind:value={totpCode}
							placeholder="000 000"
							autocomplete="one-time-code"
							class="w-full rounded bg-[var(--nx-surface-raised)] border border-[var(--nx-border)] px-3 py-2.5 text-[var(--nx-text)] text-center
							       text-xl font-mono tracking-[0.5em] focus:outline-none focus:border-indigo-500"
						/>
						<button
							type="submit"
							disabled={totpSubmitting || totpCode.length < 6}
							class="nx-login-btn w-full rounded px-4 py-2 text-sm font-semibold text-white transition-[transform] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
							
							
						>
							{totpSubmitting ? tFn('common.verifying') : tFn('auth.totp.confirm_button')}
						</button>
					</form>
				</div>

			{:else}

			{#if form?.error}
				{#if form.code === 'EMAIL_NOT_VERIFIED'}
					<div class="mb-4 rounded border border-[color-mix(in_srgb,var(--nx-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--nx-warn)_10%,transparent)] px-4 py-3 text-sm text-[var(--nx-warn)]">
						<p class="font-semibold mb-1">{tFn('auth.email_not_verified')}</p>
						<p class="text-amber-400/80">{form.error}</p>
						<a href="/auth/verify-pending" class="mt-2 inline-block underline text-[var(--nx-warn)] hover:text-[var(--nx-warn)]">
							{tFn('auth.resend_verification_email')}
						</a>
					</div>
				{:else}
					<p class="mb-4 rounded bg-[color-mix(in_srgb,var(--nx-bad)_15%,transparent)] border border-[color-mix(in_srgb,var(--nx-bad)_40%,transparent)] px-4 py-2 text-sm text-[var(--nx-bad)]">
						{form.error}
					</p>
				{/if}
			{/if}

			<form
				method="POST"
				action="?/login"
				use:enhance={() => {
					submitting = true;
					return async ({ result }) => {
						if (result.type === 'redirect') {
							// Force full page navigation so the cookie is sent in the next request
							window.location.href = result.location;
						} else {
							submitting = false;
							// Re-run the default update for error results
							const { applyAction } = await import('$app/forms');
							await applyAction(result);
						}
					};
				}}
				class="space-y-4"
			>
				<input type="hidden" name="redirectTo" value={form?.redirectTo ?? data.redirectTo} />

				<div>
					<label for="email" class="block text-xs font-medium text-[var(--nx-text)] mb-1.5 uppercase tracking-wider">{tFn('common.email')}</label>
					<input
						id="email"
						bind:value={emailInput}
						name="email"
						type="email"
						required
						autocomplete="email"
						onfocus={() => focusedField = 'email'}
						onblur={() => focusedField = null}
						class="w-full rounded-lg bg-[color-mix(in_srgb,var(--nx-text)_4%,transparent)] border border-[color-mix(in_srgb,var(--nx-text)_10%,transparent)] px-3.5 py-2.5 text-sm text-[var(--nx-text)] placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20 transition-colors duration-200"
					/>
				</div>

				<div>
					<div class="flex items-center justify-between mb-1.5">
						<label for="password" class="text-xs font-medium text-[var(--nx-text)] uppercase tracking-wider">{tFn('common.password')}</label>
						<a href="/auth/forgot-password" class="text-xs text-[var(--nx-header-accent)] hover:text-[var(--nx-header-accent)] transition-colors">
							{tFn('auth.forgot_password_link')}
						</a>
					</div>
					<input
						id="password"
						bind:value={passwordInput}
						name="password"
						type="password"
						required
						autocomplete="current-password"
						onfocus={() => focusedField = 'password'}
						onblur={() => focusedField = null}
						class="w-full rounded-lg bg-[color-mix(in_srgb,var(--nx-text)_4%,transparent)] border border-[color-mix(in_srgb,var(--nx-text)_10%,transparent)] px-3.5 py-2.5 text-sm text-[var(--nx-text)] placeholder-[var(--nx-text-muted)] focus:outline-none focus:border-indigo-500/80 focus:ring-2 focus:ring-indigo-500/20 transition-colors duration-200"
					/>
				</div>

				<button
					type="submit"
					disabled={submitting}
					class="nx-login-btn w-full rounded-lg px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-purple-900/20 hover:shadow-purple-700/30 transition-[transform,box-shadow] duration-150 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100"
				>
					{submitting ? tFn('auth.login.submitting') : tFn('auth.login.button')}
				</button>
			</form>

			<p class="mt-5 text-center text-sm text-[var(--nx-text-muted)]">
				{tFn('auth.login.no_account_prompt')}
				<a href="/auth/register" class="font-medium text-[var(--nx-header-accent)] hover:text-[var(--nx-header-accent)] transition-colors">{tFn('auth.register_link')}</a>
			</p>

			{/if}

			<!-- ── Nodyx Signet (passwordless) — masqué pendant le flow 2FA Signet ── -->
			{#if !form?.requires_signet}
			<div class="mt-8">
				<div class="flex items-center gap-3 mb-4">
					<div class="flex-1 h-px bg-[var(--nx-surface-raised)]"></div>
					<span class="text-xs text-[var(--nx-text-muted)] uppercase tracking-widest">{tFn('common.or')}</span>
					<div class="flex-1 h-px bg-[var(--nx-surface-raised)]"></div>
				</div>

				<div class="rounded-lg border p-5 transition-colors"
					style="border-color: color-mix(in srgb, var(--nx-warn) 25%, transparent); background: color-mix(in srgb, var(--nx-warn) 3%, transparent)">

					<!-- En-tête -->
					<div class="flex items-center gap-3 mb-4">
						<div class="w-9 h-9 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
							style="background: color-mix(in srgb, var(--nx-warn) 10%, transparent); border: 1px solid color-mix(in srgb, var(--nx-warn) 30%, transparent); color: var(--nx-warn)">
							◈
						</div>
						<div>
							<p class="text-sm font-semibold text-[var(--nx-text)]">Nodyx Signet</p>
							<p class="text-xs text-[var(--nx-text-muted)]">{tFn('auth.signet.tagline')}</p>
						</div>
						<a href="https://signet.nodyx.org" target="_blank" rel="noopener"
							class="ml-auto text-xs px-2 py-1 rounded-lg shrink-0 transition-opacity hover:opacity-80"
							style="color: var(--nx-warn); background: color-mix(in srgb, var(--nx-warn) 8%, transparent); border: 1px solid color-mix(in srgb, var(--nx-warn) 20%, transparent)">
							{tFn('auth.signet.get_app_button')}
						</a>
					</div>

					{#if signetState === 'idle' || signetState === 'error'}
						<!-- Connexion compte existant -->
						<div class="flex flex-col sm:flex-row gap-2">
							<input
								type="text"
								bind:value={signetUsername}
								placeholder={tFn('auth.signet.username_placeholder')}
								onkeydown={(e) => e.key === 'Enter' && signetStart()}
								class="flex-1 min-w-0 rounded-lg px-3 py-2 text-sm text-[var(--nx-text)] focus:outline-none transition-colors"
								style="background: color-mix(in srgb, var(--nx-text) 4%, transparent); border: 1px solid color-mix(in srgb, var(--nx-warn) 20%, transparent)"
							/>
							<button
								onclick={signetStart}
								disabled={!signetUsername.trim()}
								class="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition-colors active:scale-[0.97] shrink-0 whitespace-nowrap"
								style="background: color-mix(in srgb, var(--nx-warn) 15%, transparent); border: 1px solid color-mix(in srgb, var(--nx-warn) 40%, transparent); color: var(--nx-warn)">
								{tFn('auth.signet.sign_button')}
							</button>
						</div>

						<!-- Séparateur + bouton première connexion -->
						<div class="mt-3 pt-3" style="border-top: 1px solid color-mix(in srgb, var(--nx-warn) 10%, transparent)">
							<p class="text-xs mb-2 text-[var(--nx-text-muted)]">{tFn('auth.signet.first_visit_prompt')}</p>
							<button
								onclick={signetStartCross}
								class="w-full py-2 rounded-lg text-sm font-medium transition-colors active:scale-[0.97]"
								style="background: color-mix(in srgb, var(--nx-warn) 6%, transparent); border: 1px dashed color-mix(in srgb, var(--nx-warn) 30%, transparent); color: var(--nx-warn)">
								{tFn('auth.signet.scan_and_create_button')}
							</button>
						</div>

						{#if signetError}
							<p class="mt-2 text-xs text-[var(--nx-bad)]">{signetError}</p>
						{/if}

					{:else if signetState === 'waiting'}
						{#if signetQrMode}
							<!-- Mode QR cross-instance -->
							<div class="flex flex-col items-center gap-3 py-2">
								<p class="text-sm font-semibold text-[var(--nx-text)]">{tFn('auth.signet.scan_instruction')}</p>
								<canvas bind:this={signetQrCanvas}
									class="rounded-lg"
									style="background: #fff; padding: 8px">
								</canvas>
								<p class="text-xs text-center text-[var(--nx-text-muted)]">
									{tFn('auth.signet.auto_create_message')}
								</p>
								{#if signetQrUrl}
									<a href={signetQrUrl} target="_blank" rel="noopener"
										class="text-xs underline" style="color: var(--nx-warn)">
										{tFn('auth.signet.open_on_device_link')}
									</a>
								{/if}
								<button onclick={signetResetFull} class="text-xs text-[var(--nx-text-muted)]">
									{tFn('common.cancel')}
								</button>
							</div>
						{:else}
							<!-- Mode challenge classique (compte existant) -->
							<div class="flex flex-col items-center gap-4 py-3">
								<div class="relative">
									<div class="w-14 h-14 rounded-lg flex items-center justify-center text-2xl font-bold signet-icon">
										◈
									</div>
									<div class="absolute inset-0 rounded-lg animate-ping opacity-20 signet-ping"></div>
								</div>
								<div class="text-center">
									<p class="text-sm font-semibold text-[var(--nx-text)]">{tFn('common.waiting_approval')}</p>
									<p class="text-xs mt-1 text-[var(--nx-text-muted)]">{tFn('auth.signet.open_phone_approve_message')}</p>
								</div>
								<button onclick={signetReset} class="text-xs text-[var(--nx-text-muted)]">
									{tFn('auth.cancel')}
								</button>
							</div>
						{/if}

					{:else if signetState === 'approved'}
						<!-- Soumission automatique via $effect -->
						<form bind:this={signetFormRef} method="POST" action="?/signet">
							<input type="hidden" name="token" value={signetToken} />
							<input type="hidden" name="redirectTo" value={form?.redirectTo ?? data.redirectTo} />
						</form>
						<div class="flex flex-col items-center gap-3 py-3">
							<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl signet-ok">
								✓
							</div>
							<p class="text-sm font-semibold text-[var(--nx-ok)]">{tFn('auth.signet.approved_logging_in')}</p>
						</div>

					{:else if signetState === 'rejected'}
						<div class="flex flex-col items-center gap-3 py-3">
							<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl signet-err">
								✕
							</div>
							<p class="text-sm font-semibold text-[var(--nx-bad)]">{tFn('auth.signet.request_rejected')}</p>
							<button onclick={signetReset} class="text-xs underline text-[var(--nx-text-muted)]">{tFn('common.retry')}</button>
						</div>
					{:else if signetState === 'expired'}
						<div class="flex flex-col items-center gap-3 py-3">
							<p class="text-sm text-[var(--nx-text-muted)]">{tFn('auth.signet.challenge_expired_90s')}</p>
							<button onclick={signetReset} class="text-xs underline text-[var(--nx-warn)]">{tFn('common.retry')}</button>
						</div>
					{/if}
				</div>
			</div>
			{/if}
		</div>
		</div>
	</div>
</div>

<style>
	.nx-login-btn {
		background: var(--nx-accent-2, #a855f7);
		transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1), background 200ms ease-out, box-shadow 200ms ease-out;
	}
	.nx-login-btn:hover:not(:disabled) {
		background: var(--nx-accent-2-strong, #7c3aed);
	}
	.signet-icon {
		background: color-mix(in srgb, var(--nx-warn) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--nx-warn) 40%, transparent);
		color: var(--nx-warn);
	}
	.signet-ping {
		background: color-mix(in srgb, var(--nx-warn) 30%, transparent);
	}
	.signet-ok {
		background: color-mix(in srgb, var(--nx-ok) 10%, transparent);
		border: 2px solid rgb(74, 222, 128);
	}
	.signet-err {
		background: color-mix(in srgb, var(--nx-bad) 10%, transparent);
		border: 2px solid rgb(248, 113, 113);
	}
</style>
