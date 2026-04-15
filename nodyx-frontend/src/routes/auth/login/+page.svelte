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
				await QRCode.toCanvas(signetQrCanvas, signetQrUrl, { width: 200, margin: 1, color: { dark: '#ffffff', light: '#00000000' } })
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
	<title>{tFn('auth.login.title')} — Nodyx</title>
</svelte:head>

<div class="mx-auto max-w-sm">
	<h1 class="text-2xl font-bold text-white mb-6">{tFn('auth.login.title')}</h1>

	{#if data.demoMode}
	<div class="mb-6 rounded-xl border p-4" style="border-color: rgba(99,102,241,0.4); background: rgba(99,102,241,0.06)">
		<p class="text-sm font-semibold text-white mb-2">{tFn('auth.demo.title')}</p>
		<p class="text-xs mb-3" style="color: rgb(156,163,175)">
			{tFn('auth.demo.description')}
		</p>
		<div class="space-y-1.5 text-xs mb-2">
			{#each ['alice', 'bob', 'charlie', 'admin'] as u}
			<div class="rounded-lg px-3 py-2 flex items-center justify-between gap-2"
				style="background: rgba(0,0,0,0.25); border: 1px solid rgba(99,102,241,0.2)">
				<span class="font-mono text-white shrink-0">{u}@demo.nodyx.org</span>
				<span class="shrink-0" style="color: rgb(156,163,175)">demo1234</span>
			</div>
			{/each}
		</div>
	</div>
	{/if}

	{#if data.passwordReset}
		<div class="mb-4 rounded border border-green-700/50 bg-green-900/20 px-4 py-2.5 text-sm text-green-300">
			{tFn('auth.password_reset.success_message')}
		</div>
	{/if}

	{#if form?.requires_signet}
		<!-- ── Étape 2 : approbation Signet ─────────────────────────────────── -->
		<div class="rounded-xl border p-6"
			style="border-color: rgba(251,191,36,0.3); background: rgba(251,191,36,0.04)">
			<div class="flex items-center gap-3 mb-5">
				<div class="w-10 h-10 rounded-xl flex items-center justify-center text-xl font-bold shrink-0"
					style="background: rgba(251,191,36,0.12); border: 1px solid rgba(251,191,36,0.35); color: #fbbf24">
					◈
				</div>
				<div>
					<p class="text-sm font-semibold text-white">{tFn('auth.signet.verification_title')}</p>
					<p class="text-xs mt-0.5" style="color: rgb(156,163,175)">
						{tFn('auth.signet.verify_description')}
					</p>
				</div>
			</div>

			{#if signetState === 'idle' || signetState === 'waiting'}
				<div class="flex flex-col items-center gap-4 py-2">
					<div class="relative">
						<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
							style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.4); color: #fbbf24">
							◈
						</div>
						<div class="absolute inset-0 rounded-2xl animate-ping opacity-20"
							style="background: rgba(251,191,36,0.3)"></div>
					</div>
					<div class="text-center">
						<p class="text-sm font-semibold text-white">{tFn('common.waiting_approval')}</p>
						<p class="text-xs mt-1" style="color: rgb(156,163,175)">{tFn('auth.signet.open_app_message')}</p>
					</div>
					{#if signetError}
						<p class="text-xs text-center" style="color: rgb(248,113,113)">{signetError}</p>
					{/if}
				</div>

			{:else if signetState === 'approved'}
				<form bind:this={signetFormRef} method="POST" action="?/signet">
					<input type="hidden" name="token" value={signetToken} />
					<input type="hidden" name="redirectTo" value={form?.redirectTo ?? data.redirectTo} />
				</form>
				<div class="flex flex-col items-center gap-3 py-3">
					<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
						style="background: rgba(74,222,128,0.1); border: 2px solid rgb(74,222,128)">✓</div>
					<p class="text-sm font-semibold" style="color: rgb(74,222,128)">{tFn('auth.signet.approved_logging_in')}</p>
				</div>

			{:else if signetState === 'rejected'}
				<div class="flex flex-col items-center gap-3 py-3">
					<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
						style="background: rgba(248,113,113,0.1); border: 2px solid rgb(248,113,113)">✕</div>
					<p class="text-sm font-semibold mb-1" style="color: rgb(248,113,113)">{tFn('auth.signet.request_rejected')}</p>
					<p class="text-xs" style="color: rgb(156,163,175)">{tFn('auth.signet.retry_message')}</p>
					<a href="/auth/login" class="text-xs underline mt-1" style="color: #fbbf24">{tFn('auth.signet.back_to_login')}</a>
				</div>

			{:else if signetState === 'expired'}
				<div class="flex flex-col items-center gap-3 py-3">
					<p class="text-sm" style="color: rgb(156,163,175)">{tFn('auth.signet.challenge_expired')}</p>
					<a href="/auth/login" class="text-xs underline" style="color: #fbbf24">{tFn('auth.signet.back_to_login')}</a>
				</div>

			{:else if signetState === 'error'}
				<div class="flex flex-col items-center gap-3 py-3">
					<p class="text-xs text-center mb-2" style="color: rgb(248,113,113)">{signetError}</p>
					<a href="/auth/login" class="text-xs underline" style="color: #fbbf24">{tFn('auth.signet.back_to_login')}</a>
				</div>
			{/if}
		</div>

	{:else if form?.requires_totp}
		<!-- ── Étape 2 : code TOTP ──────────────────────────────────────────── -->
		<div class="mb-6 rounded-xl border border-indigo-700/40 bg-indigo-900/10 px-5 py-4">
			<div class="flex items-center gap-3 mb-3">
				<span class="text-2xl">🔐</span>
				<div>
					<p class="text-sm font-semibold text-white">{tFn('auth.totp.title')}</p>
					<p class="text-xs text-gray-500 mt-0.5">{tFn('auth.totp.enter_code_instruction')}</p>
				</div>
			</div>
			{#if form?.error}
				<p class="mb-3 rounded bg-red-900/40 border border-red-700/50 px-3 py-2 text-xs text-red-300">{form.error}</p>
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
					class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2.5 text-white text-center
					       text-xl font-mono tracking-[0.5em] focus:outline-none focus:border-indigo-500"
				/>
				<button
					type="submit"
					disabled={totpSubmitting || totpCode.length < 6}
					class="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed
					       px-4 py-2 text-sm font-semibold text-white transition-colors"
				>
					{totpSubmitting ? tFn('common.verifying') : tFn('auth.totp.confirm_button')}
				</button>
			</form>
		</div>

	{:else}

	{#if form?.error}
		{#if form.code === 'EMAIL_NOT_VERIFIED'}
			<div class="mb-4 rounded border border-amber-700/50 bg-amber-900/20 px-4 py-3 text-sm text-amber-300">
				<p class="font-semibold mb-1">{tFn('auth.email_not_verified')}</p>
				<p class="text-amber-400/80">{form.error}</p>
				<a href="/auth/verify-pending" class="mt-2 inline-block underline text-amber-300 hover:text-amber-200">
					{tFn('auth.resend_verification_email')}
				</a>
			</div>
		{:else}
			<p class="mb-4 rounded bg-red-900/50 border border-red-700 px-4 py-2 text-sm text-red-300">
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
			<label for="email" class="block text-sm text-gray-400 mb-1">{tFn('common.email')}</label>
			<input
				id="email"
				name="email"
				type="email"
				required
				autocomplete="email"
				class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<div>
			<div class="flex items-center justify-between mb-1">
				<label for="password" class="text-sm text-gray-400">{tFn('common.password')}</label>
				<a href="/auth/forgot-password" class="text-xs text-indigo-400 hover:text-indigo-300">
					{tFn('auth.forgot_password_link')}
				</a>
			</div>
			<input
				id="password"
				name="password"
				type="password"
				required
				autocomplete="current-password"
				class="w-full rounded bg-gray-800 border border-gray-700 px-3 py-2 text-white focus:outline-none focus:border-indigo-500"
			/>
		</div>

		<button
			type="submit"
			disabled={submitting}
			class="w-full rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
		>
			{submitting ? tFn('auth.login.submitting') : tFn('auth.login.button')}
		</button>
	</form>

	<p class="mt-4 text-center text-sm text-gray-500">
		{tFn('auth.login.no_account_prompt')}
		<a href="/auth/register" class="text-indigo-400 hover:text-indigo-300">{tFn('auth.register_link')}</a>
	</p>

	{/if}

	<!-- ── Nodyx Signet (passwordless) — masqué pendant le flow 2FA Signet ── -->
	{#if !form?.requires_signet}
	<div class="mt-8">
		<div class="flex items-center gap-3 mb-4">
			<div class="flex-1 h-px bg-gray-800"></div>
			<span class="text-xs text-gray-600 uppercase tracking-widest">{tFn('common.or')}</span>
			<div class="flex-1 h-px bg-gray-800"></div>
		</div>

		<div class="rounded-xl border p-5 transition-colors"
			style="border-color: rgba(251,191,36,0.25); background: rgba(251,191,36,0.03)">

			<!-- En-tête -->
			<div class="flex items-center gap-3 mb-4">
				<div class="w-9 h-9 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
					style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.3); color: #fbbf24">
					◈
				</div>
				<div>
					<p class="text-sm font-semibold text-white">Nodyx Signet</p>
					<p class="text-xs" style="color: rgb(156,163,175)">{tFn('auth.signet.tagline')}</p>
				</div>
				<a href="https://signet.nodyx.org" target="_blank" rel="noopener"
					class="ml-auto text-xs px-2 py-1 rounded-lg shrink-0 transition-opacity hover:opacity-80"
					style="color: #fbbf24; background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.2)">
					{tFn('auth.signet.get_app_button')}
				</a>
			</div>

			{#if signetState === 'idle' || signetState === 'error'}
				<!-- Connexion compte existant -->
				<div class="flex gap-2">
					<input
						type="text"
						bind:value={signetUsername}
						placeholder={tFn('auth.signet.username_placeholder')}
						onkeydown={(e) => e.key === 'Enter' && signetStart()}
						class="flex-1 rounded-lg px-3 py-2 text-sm text-white focus:outline-none transition-colors"
						style="background: rgba(0,0,0,0.3); border: 1px solid rgba(251,191,36,0.2)"
					/>
					<button
						onclick={signetStart}
						disabled={!signetUsername.trim()}
						class="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40 transition-all shrink-0"
						style="background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.4); color: #fbbf24">
						{tFn('auth.signet.sign_button')}
					</button>
				</div>

				<!-- Séparateur + bouton première connexion -->
				<div class="mt-3 pt-3" style="border-top: 1px solid rgba(251,191,36,0.1)">
					<p class="text-xs mb-2" style="color: rgb(107,114,128)">{tFn('auth.signet.first_visit_prompt')}</p>
					<button
						onclick={signetStartCross}
						class="w-full py-2 rounded-lg text-sm font-medium transition-all"
						style="background: rgba(251,191,36,0.06); border: 1px dashed rgba(251,191,36,0.3); color: #fbbf24">
						{tFn('auth.signet.scan_and_create_button')}
					</button>
				</div>

				{#if signetError}
					<p class="mt-2 text-xs" style="color: rgb(248,113,113)">{signetError}</p>
				{/if}

			{:else if signetState === 'waiting'}
				{#if signetQrMode}
					<!-- Mode QR cross-instance -->
					<div class="flex flex-col items-center gap-3 py-2">
						<p class="text-sm font-semibold text-white">{tFn('auth.signet.scan_instruction')}</p>
						<canvas bind:this={signetQrCanvas}
							class="rounded-xl"
							style="background: rgba(0,0,0,0.4); padding: 8px">
						</canvas>
						<p class="text-xs text-center" style="color: rgb(156,163,175)">
							{tFn('auth.signet.auto_create_message')}
						</p>
						{#if signetQrUrl}
							<a href={signetQrUrl} target="_blank" rel="noopener"
								class="text-xs underline" style="color: rgba(251,191,36,0.6)">
								{tFn('auth.signet.open_on_device_link')}
							</a>
						{/if}
						<button onclick={signetResetFull} class="text-xs" style="color: rgb(107,114,128)">
							{tFn('common.cancel')}
						</button>
					</div>
				{:else}
					<!-- Mode challenge classique (compte existant) -->
					<div class="flex flex-col items-center gap-4 py-3">
						<div class="relative">
							<div class="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold"
								style="background: rgba(251,191,36,0.1); border: 1px solid rgba(251,191,36,0.4); color: #fbbf24">
								◈
							</div>
							<div class="absolute inset-0 rounded-2xl animate-ping opacity-20"
								style="background: rgba(251,191,36,0.3)"></div>
						</div>
						<div class="text-center">
							<p class="text-sm font-semibold text-white">{tFn('common.waiting_approval')}</p>
							<p class="text-xs mt-1" style="color: rgb(156,163,175)">{tFn('auth.signet.open_phone_approve_message')}</p>
						</div>
						<button onclick={signetReset} class="text-xs" style="color: rgb(107,114,128)">
							Annuler
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
					<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
						style="background: rgba(74,222,128,0.1); border: 2px solid rgb(74,222,128)">
						✓
					</div>
					<p class="text-sm font-semibold" style="color: rgb(74,222,128)">{tFn('auth.signet.approved_logging_in')}</p>
				</div>

			{:else if signetState === 'rejected'}
				<div class="flex flex-col items-center gap-3 py-3">
					<div class="w-14 h-14 rounded-full flex items-center justify-center text-2xl"
						style="background: rgba(248,113,113,0.1); border: 2px solid rgb(248,113,113)">
						✕
					</div>
					<p class="text-sm font-semibold" style="color: rgb(248,113,113)">{tFn('auth.signet.request_rejected')}</p>
					<button onclick={signetReset} class="text-xs underline" style="color: rgb(156,163,175)">{tFn('common.retry')}</button>
				</div>

			{:else if signetState === 'expired'}
				<div class="flex flex-col items-center gap-3 py-3">
					<p class="text-sm" style="color: rgb(156,163,175)">{tFn('auth.signet.challenge_expired_90s')}</p>
					<button onclick={signetReset} class="text-xs underline" style="color: #fbbf24">{tFn('common.retry')}</button>
				</div>
			{/if}
		</div>
	</div>
	{/if}
</div>
